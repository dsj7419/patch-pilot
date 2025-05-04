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
import { correctHunkHeaders, CorrectionReport } from './services/hunkCorrectorService';

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
  const autoCorrectSetting = cfg.get<boolean>('autoCorrectHunkHeaders', true);

  const canonical = normalizeDiff(patchText);
  const patches = DiffLib.parsePatch(canonical) as DiffParsedPatch[];
  if (patches.length === 0) {
    throw new Error('No valid patches found in the provided text.');
  }

  let correctedPatches: DiffParsedPatch[];
  let correctionDetails: CorrectionReport = { correctionsMade: false, corrections: [] };

  if (autoCorrectSetting) {
    const correctorResult = correctHunkHeaders(patches);
    correctedPatches = correctorResult.correctedPatches;
    correctionDetails = correctorResult.correctionDetails;

    if (correctionDetails.correctionsMade) {
      const output = vscode.window.createOutputChannel('PatchPilot');
      output.appendLine('ℹ️ Automatically corrected hunk header line counts for accuracy:');
      
      for (const correction of correctionDetails.corrections) {
        output.appendLine(` - ${correction.filePath} [Hunk ${correction.hunkIndex}]: Old lines ${correction.originalOld} -> ${correction.correctedOld}, New lines ${correction.originalNew} -> ${correction.correctedNew}`);
      }
      
      output.show();
      
      trackEvent('hunk_correction_applied', {}, {
        fileCount: correctedPatches.length,
        correctedFileCount: new Set(correctionDetails.corrections.map(c => c.filePath)).size,
        totalHunkCount: correctedPatches.reduce((sum, p) => sum + p.hunks.length, 0),
        correctedHunkCount: correctionDetails.corrections.length
      });
    }
  } else {
    correctedPatches = patches as DiffParsedPatch[];
    trackEvent('hunk_correction_skipped_disabled', {
      patchCount: patches.length
    });
  }

  const results: ApplyResult[] = [];
  const staged: string[] = [];

  for (const patch of correctedPatches) {
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

      let fileStats: vscode.FileStat | undefined;
      if (mtimeCheck) {
        try {
          fileStats = await vscode.workspace.fs.stat(fileUri);
        } catch (_err) {
          const output = vscode.window.createOutputChannel('PatchPilot');
          output.appendLine(`Could not get file stats for ${relPath}, skipping mtime check`);
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

      if (mtimeCheck && fileStats) {
        try {
          const currentStats = await vscode.workspace.fs.stat(fileUri);
          
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
          const output = vscode.window.createOutputChannel('PatchPilot');
          output.appendLine(`Could not verify file stats for ${relPath}`);
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
  const isLargePatch = patch.hunks.length > 5 || content.length > 100000;
  const isLargeFile = content.length > 500000;
  
  if (isLargePatch || isLargeFile) {
    trackEvent('patch_content', { 
      strategy: 'optimized', 
      hunkCount: patch.hunks.length,
      contentSize: content.length
    });
    
    const standardStrategy = PatchStrategyFactory.createDefaultStrategy(fuzz);
    const optimizedStrategy = useOptimizedStrategies(standardStrategy, fuzz);
    
    return optimizedStrategy.apply(content, patch);
  } else {
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
    return p.newFileName.replace(/^b\//, '')
      .replace(/[\x00-\x1F\x7F]+/g, '')
      .replace(/\\r|\\n/g, '')
      .trim();
  }
  if (p.oldFileName && p.oldFileName !== '/dev/null') {
    return p.oldFileName.replace(/^a\//, '')
      .replace(/[\x00-\x1F\x7F]+/g, '')
      .replace(/\\r|\\n/g, '')
      .trim();
  }
  return undefined;
}

async function resolveWorkspaceFile(
  relPath: string,
): Promise<vscode.Uri | undefined> {
  const roots = vscode.workspace.workspaceFolders;
  if (!roots?.length) {throw new Error('No workspace folder open.');}

  if (!relPath || relPath.includes('..') || relPath.startsWith('/')) {
    throw new Error(`Invalid file path: ${relPath}`);
  }

  for (const r of roots) {
    const uri = vscode.Uri.joinPath(r.uri, relPath);
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      /* ignore */
    }
  }

  const fname = relPath.split('/').pop() ?? relPath;
  if (!fname || fname === '' || fname === '..' || fname === '.') {
    return undefined;
  }

  const found = await vscode.workspace.findFiles(
    `**/${fname}`,
    '**/node_modules/**',
    10
  );

  if (found.length === 1) {return found[0];}
  if (found.length > 1) {
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
  const cleanPatchText = patchText.replace(/\\r\\n|\\r|\\n/g, '');
  
  const normalized = normalizeDiff(cleanPatchText);
  const patches = DiffLib.parsePatch(normalized) as DiffParsedPatch[];

  const autoCorrectSetting = vscode.workspace.getConfiguration('patchPilot').get<boolean>('autoCorrectHunkHeaders', true);
  
  let correctedPatches: DiffParsedPatch[];
  let correctionDetails: CorrectionReport = { correctionsMade: false, corrections: [] };
  
  if (autoCorrectSetting) {
    const correctorResult = correctHunkHeaders(patches);
    correctedPatches = correctorResult.correctedPatches;
    correctionDetails = correctorResult.correctionDetails;
    
    if (correctionDetails.correctionsMade) {
      trackEvent('hunk_correction_applied', {}, {
        fileCount: correctedPatches.length,
        correctedFileCount: new Set(correctionDetails.corrections.map(c => c.filePath)).size,
        totalHunkCount: correctedPatches.reduce((sum, p) => sum + p.hunks.length, 0),
        correctedHunkCount: correctionDetails.corrections.length
      });
    }
  } else {
    correctedPatches = patches as DiffParsedPatch[];
    trackEvent('hunk_correction_skipped_disabled', {
      patchCount: patches.length
    });
  }

  const info: FileInfo[] = [];
  const filePathMap = new Map<string, boolean>();
  
  for (const p of correctedPatches) {
    const path = extractFilePath(p);
    if (!path) {continue;}
    
    if (filePathMap.has(path)) {continue;}
    
    const uri = await resolveWorkspaceFile(path);
    filePathMap.set(path, !!uri);
  }

  for (const p of correctedPatches) {
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

    const hasCorrections = autoCorrectSetting && correctionDetails.corrections.some(
      correction => correction.filePath === path
    );

    info.push({
      filePath: path,
      exists: filePathMap.get(path) ?? false,
      hunks: p.hunks.length,
      changes: { additions: add, deletions: del },
      hunkHeadersCorrected: hasCorrections
    });
  }
  return info;
}