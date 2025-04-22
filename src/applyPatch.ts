/* --------------------------------------------------------------------------
 *  PatchPilot — AI‑grade unified‑diff applier
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as DiffLib from 'diff';
import { normalizeDiff } from './utilities';
import { autoStageFiles } from './gitSecure';
import { trackEvent } from './telemetry';
import {
  PatchStrategyFactory,
  PatchResult,
} from './strategies/patchStrategy';
import {
  ApplyOptions,
  ApplyResult,
  FileInfo,
  DiffParsedPatch,
} from './types/patchTypes';
import { useOptimizedStrategies } from './strategies/optimizedPatchStrategy';

/* ────────────────────── Multi‑file entry point ─────────────────────────── */

export async function applyPatch(
  patchText: string,
  opts: ApplyOptions = {},
): Promise<ApplyResult[]> {
  trackEvent('apply_patch_start', { preview: opts.preview ?? true });

  const cfg = vscode.workspace.getConfiguration('patchPilot');
  const autoStage = opts.autoStage ?? cfg.get('autoStage', false);
  const fuzz = (opts.fuzz ?? cfg.get('fuzzFactor', 2)) as 0 | 1 | 2 | 3;
  const preview = opts.preview ?? true;
  const mtimeCheck = opts.mtimeCheck ?? cfg.get('mtimeCheck', true);

  const canonical = normalizeDiff(patchText);
  const patches = DiffLib.parsePatch(canonical) as DiffParsedPatch[];
  if (patches.length === 0) {
    throw new Error('No valid patches found in the provided text.');
  }

  const results: ApplyResult[] = [];
  const staged: string[] = [];

  for (const patch of patches) {
    const relPath = extractFilePath(patch) ?? 'unknown-file';

    try {
      const fileUri = await resolveWorkspaceFile(relPath);
      if (!fileUri) {
        results.push({
          file: relPath,
          status: 'failed',
          reason: 'File not found in workspace',
        });
        continue;
      }

      // Record file stats before reading to detect external changes
      let fileStats: vscode.FileStat | undefined;
      if (mtimeCheck) {
        try {
          fileStats = await vscode.workspace.fs.stat(fileUri);
        } catch (_err) {
          // If stat fails, continue anyway but without mtime check
          console.warn(`Could not get file stats for ${relPath}, skipping mtime check`);
        }
      }

      const doc = await vscode.workspace.openTextDocument(fileUri);
      const original = doc.getText();
      const { patched, success, strategy } = await applyPatchToContent(
        original,
        patch,
        fuzz,
      );

      if (!success) {
        results.push({
          file: relPath,
          status: 'failed',
          reason: 'Patch could not be applied',
        });
        continue;
      }

      if (preview) {
        const confirmed = await showPatchPreview(
          fileUri,
          original,
          patched,
          relPath,
        );
        if (!confirmed) {
          results.push({
            file: relPath,
            status: 'failed',
            reason: 'User cancelled after preview',
          });
          continue;
        }
      }

      // Check if file was modified externally while we were working
      if (mtimeCheck && fileStats) {
        try {
          const currentStats = await vscode.workspace.fs.stat(fileUri);
          
          // Compare mtimes directly - in VS Code API these are numbers 
          // (milliseconds since epoch)
          if (fileStats.mtime !== currentStats.mtime) {
            const confirmOverwrite = await vscode.window.showWarningMessage(
              `File ${relPath} has been modified since reading it. Apply patch anyway?`,
              { modal: true },
              'Apply Anyway',
              'Cancel'
            );
            
            if (confirmOverwrite !== 'Apply Anyway') {
              results.push({
                file: relPath,
                status: 'failed',
                reason: 'File modified externally, update aborted'
              });
              continue;
            }
          }
        } catch (_err) {
          // If stat fails at this point, continue but log warning
          console.warn(`Could not verify file stats for ${relPath}`);
        }
      }

      const edit = new vscode.WorkspaceEdit();
      edit.replace(fileUri, fullDocRange(doc), patched);
      if (!(await vscode.workspace.applyEdit(edit))) {
        results.push({
          file: relPath,
          status: 'failed',
          reason: 'Workspace edit failed',
        });
        continue;
      }

      if (doc.isDirty) {await doc.save();}
      results.push({ file: relPath, status: 'applied', strategy });
      if (autoStage) {staged.push(relPath);}
    } catch (err) {
      results.push({
        file: relPath,
        status: 'failed',
        reason: (err as Error).message ?? String(err),
      });
    }
  }

  if (autoStage && staged.length) {
    try {
      await autoStageFiles(staged);
    } catch (_e) {
      vscode.window.showWarningMessage(
        `Patch applied but Git staging failed: ${(_e as Error).message}`,
      );
    }
  }

  trackEvent('apply_patch_complete', {
    files: results.length,
    success: results.filter((r) => r.status === 'applied').length,
    fuzz,
    mtimeCheck
  });

  return results;
}

/* ───────────────────── Single‑file helper (strategy chain) ─────────────── */

export async function applyPatchToContent(
  content: string,
  patch: DiffParsedPatch,
  fuzz: 0 | 1 | 2 | 3,
): Promise<PatchResult> {
  // Check if the patch is large - could be performance intensive
  const isLargePatch = patch.hunks.length > 5 || content.length > 100000;
  const isLargeFile = content.length > 500000; // ~500KB
  
  if (isLargePatch || isLargeFile) {
    // Use optimized strategies for large patches or files
    // This enhances performance with potentially large diffs
    trackEvent('patch_content', { 
      strategy: 'optimized', 
      hunkCount: patch.hunks.length,
      contentSize: content.length
    });
    
    // Create the standard strategy first
    const standardStrategy = PatchStrategyFactory.createDefaultStrategy(fuzz);
    // Then wrap it with optimized strategies that handle large files better
    const optimizedStrategy = useOptimizedStrategies(standardStrategy, fuzz);
    
    return optimizedStrategy.apply(content, patch);
  } else {
    // Use standard strategies for normal patches
    trackEvent('patch_content', { 
      strategy: 'standard', 
      hunkCount: patch.hunks.length,
      contentSize: content.length
    });
    
    return PatchStrategyFactory.createDefaultStrategy(fuzz).apply(content, patch);
  }
}

/* ───────────────────────── Preview diff editor ─────────────────────────── */

async function showPatchPreview(
  fileUri: vscode.Uri,
  original: string,
  patched: string,
  relPath: string,
): Promise<boolean> {
  const left = fileUri.with({
    scheme: 'patchpilot-orig',
    query: fileUri.toString(),
  });
  const right = fileUri.with({
    scheme: 'patchpilot-mod',
    query: fileUri.toString(),
  });

  const origProvider = vscode.workspace.registerTextDocumentContentProvider(
    'patchpilot-orig',
    { provideTextDocumentContent: (u) => (u.query === fileUri.toString() ? original : '') },
  );
  const modProvider = vscode.workspace.registerTextDocumentContentProvider(
    'patchpilot-mod',
    { provideTextDocumentContent: (u) => (u.query === fileUri.toString() ? patched : '') },
  );

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `Patch Preview – ${relPath}`,
    );
    const choice = await vscode.window.showInformationMessage(
      `Apply patch to ${relPath}?`,
      { modal: true },
      'Apply',
    );
    return choice === 'Apply';
  } finally {
    origProvider.dispose();
    modProvider.dispose();
  }
}

/* ─────────────────────────── Utility helpers ───────────────────────────── */

export function extractFilePath(p: DiffParsedPatch): string | undefined {
  if (p.newFileName && p.newFileName !== '/dev/null') {
    return p.newFileName.replace(/^b\//, '');
  }
  if (p.oldFileName && p.oldFileName !== '/dev/null') {
    return p.oldFileName.replace(/^a\//, '');
  }
  return undefined;
}

async function resolveWorkspaceFile(
  relPath: string,
): Promise<vscode.Uri | undefined> {
  const roots = vscode.workspace.workspaceFolders;
  if (!roots?.length) {throw new Error('No workspace folder open.');}

  // Security improvement: Validate the relative path
  if (!relPath || relPath.includes('..') || relPath.startsWith('/')) {
    throw new Error(`Invalid file path: ${relPath}`);
  }

  // Try each workspace folder
  for (const r of roots) {
    const uri = vscode.Uri.joinPath(r.uri, relPath);
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      /* ignore */
    }
  }

  // If not found directly, try finding by filename
  const fname = relPath.split('/').pop() ?? relPath;
  if (!fname || fname === '' || fname === '..' || fname === '.') {
    return undefined;
  }

  const found = await vscode.workspace.findFiles(
    `**/${fname}`,
    '**/node_modules/**',
    10 // Limit results to avoid performance issues
  );

  if (found.length === 1) {return found[0];}
  if (found.length > 1) {
    // Get stats for each found file
    const filesWithStats = [];
    for (const f of found) {
      const stats = await vscode.workspace.fs.stat(f);
      filesWithStats.push({
        label: vscode.workspace.asRelativePath(f),
        uri: f,
        description: `Last modified: ${new Date(stats.mtime).toLocaleString()}`
      });
    }
    
    const pick = await vscode.window.showQuickPick(
      filesWithStats,
      {
        placeHolder: `Select file for patch «${relPath}»`,
        title: "Multiple files match the patch target"
      },
    );
    return pick?.uri;
  }
  return undefined;
}

function fullDocRange(doc: vscode.TextDocument): vscode.Range {
  const lastLine = doc.lineCount - 1;
  return new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).text.length);
}

/* ───────────────────── Parse‑only helper for WebView ───────────────────── */

export async function parsePatch(patchText: string): Promise<FileInfo[]> {
  const patches = DiffLib.parsePatch(
    normalizeDiff(patchText),
  ) as DiffParsedPatch[];

  const info: FileInfo[] = [];

  // Performance enhancement: pre-check all files first to avoid redundant workspace queries
  const filePathMap = new Map<string, boolean>(); // Map of file path to existence status
  
  for (const p of patches) {
    const path = extractFilePath(p);
    if (!path) {continue;}
    
    // Skip duplicate paths
    if (filePathMap.has(path)) {continue;}
    
    // Check if file exists
    const uri = await resolveWorkspaceFile(path);
    filePathMap.set(path, !!uri);
  }

  // Now process each patch with the pre-checked file existence status
  for (const p of patches) {
    const path = extractFilePath(p);
    if (!path) {continue;}

    let add = 0;
    let del = 0;

    p.hunks.forEach((h) =>
      h.lines.forEach((l) => {
        if (l.startsWith('+')) {add += 1;}
        else if (l.startsWith('-')) {del += 1;}
      }),
    );

    info.push({
      filePath: path,
      exists: filePathMap.get(path) ?? false,
      hunks: p.hunks.length,
      changes: { additions: add, deletions: del },
    });
  }
  return info;
}

/* ------------------------------------------------------------------ *
 *  Jest shim — active only during unit tests, no `any` leaks
 * ------------------------------------------------------------------ */
type JestLike = {
  fn: <A extends unknown[], R>(impl: (...args: A) => R) => (...args: A) => R;
};

function isJest(obj: unknown): obj is JestLike {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'fn' in obj &&
    typeof (obj as Record<string, unknown>).fn === 'function'
  );
}

const maybeJest = (globalThis as Record<string, unknown>).jest;

if (isJest(maybeJest)) {
  // Create mockable versions of the functions
  const mockableApplyPatch = maybeJest.fn(applyPatch);
  const mockableParsePatch = maybeJest.fn(parsePatch);
  
  // Replace exports with mockable versions
  module.exports = {
    ...module.exports,
    applyPatch: mockableApplyPatch,
    parsePatch: mockableParsePatch
  };
}