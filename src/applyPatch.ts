/* --------------------------------------------------------------------------
 *  PatchPilot — AI‑grade unified‑diff applier
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { normalizeDiff, normalizeLineEndings } from './utilities';
import { autoStageFiles } from './git';
import { getOutputChannel } from './logger';
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
import { parsePatch as parsePatchInternal, extractFilePath, resolveWorkspaceFile } from './patch/PatchParser';
import { addToPatchQueue, processNextPatch, clearPatchQueue } from './patch/PatchSession';

/* ────────────────────── Multi‑file entry point ─────────────────────────── */

export async function applyPatch(
  patchInput: string | DiffParsedPatch[],
  opts: ApplyOptions = {},
): Promise<ApplyResult[]> {
  trackEvent('apply_patch_start', { preview: opts.preview ?? true });

  const cfg = vscode.workspace.getConfiguration('patchPilot');
  const autoStage = opts.autoStage ?? cfg.get('autoStage', false);
  const fuzz = (opts.fuzz ?? cfg.get('fuzzFactor', 2)) as 0 | 1 | 2 | 3;
  const preview = opts.preview ?? true;
  const mtimeCheck = opts.mtimeCheck ?? cfg.get('mtimeCheck', true);

  let patches: DiffParsedPatch[];
  if (typeof patchInput === 'string') {
    const canonical = normalizeDiff(patchInput);
    patches = parsePatchInternal(canonical);
  } else {
    patches = patchInput;
  }

  if (patches.length === 0) {
    throw new Error('No valid patches found in the provided text.');
  }

  const results: ApplyResult[] = [];
  const staged: string[] = [];
  
  // Clear queue at start of new operation
  clearPatchQueue();

  for (const patch of patches) {
    const relPath = extractFilePath(patch) ?? 'unknown-file';

    try {
      const isNewFileFromPatch = patch.oldFileName === '/dev/null';
      const { uri: fileUri, isNew } = await resolveWorkspaceFile(relPath, isNewFileFromPatch);
      console.debug(`[DEBUG] File: ${relPath}, isNew: ${isNew}, URI: ${fileUri.toString()}`);

      // Record file stats before reading to detect external changes
      let fileStats: vscode.FileStat | undefined;
      if (mtimeCheck && !isNew) {
        try {
          fileStats = await vscode.workspace.fs.stat(fileUri);
        } catch (_err) {
          // If stat fails, continue anyway but without mtime check
          getOutputChannel().appendLine(`Could not get file stats for ${relPath}, skipping mtime check`);
        }
      }

      let original = '';
      let originalEOL = '\n';
      if (!isNew) {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        original = doc.getText();
        if (original.includes('\r\n')) {
          originalEOL = '\r\n';
        }
        original = normalizeLineEndings(original); // Normalize to LF for patching
      }

      const { patched, success, strategy } = await applyPatchToContent(
        original,
        patch,
        fuzz,
      );

      // Restore original EOL if needed
      let finalPatched = patched;
      if (originalEOL === '\r\n') {
        finalPatched = patched.replaceAll(/\n/g, '\r\n');
      }

      if (!success) {
        results.push({
          file: relPath,
          status: 'failed',
          reason: 'Patch could not be applied',
        });
        continue;
      }

      if (preview) {
        // Add to queue instead of showing immediately
        addToPatchQueue({
          fileUri,
          original,
          patched: finalPatched,
          relPath,
          isNew,
          autoStage,
          strategy: strategy || 'preview'
        });
        
        // Mark as 'applied' in terms of "successfully processed", waiting for user acceptance
        results.push({ file: relPath, status: 'applied', strategy: strategy || 'preview' });
        continue;
      }

      // Check if file was modified externally while we were working
      if (mtimeCheck && fileStats && !isNew) {
        try {
          const currentStats = await vscode.workspace.fs.stat(fileUri);
          
          // Compare mtimes directly
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
          getOutputChannel().appendLine(`Could not verify file stats for ${relPath}`);
        }
      }

      if (isNew) {
        console.debug(`[DEBUG] Creating directory for new file: ${fileUri.fsPath}`);
        // Ensure parent directory exists before writing file
        const parentDir = vscode.Uri.joinPath(fileUri, '..');
        await vscode.workspace.fs.createDirectory(parentDir);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(finalPatched));
      } else {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(fileUri, fullDocRange(doc), finalPatched);
        if (!(await vscode.workspace.applyEdit(edit))) {
          results.push({
            file: relPath,
            status: 'failed',
            reason: 'Workspace edit failed',
          });
          continue;
        }
      }

      if (!isNew) {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        if (doc.isDirty) {await doc.save();}
      }
      
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
  
  // Start processing the queue if we have items
  if (results.some(r => r.status === 'applied' && (r.strategy === 'preview' || opts.preview))) {
    await processNextPatch();
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

function fullDocRange(doc: vscode.TextDocument): vscode.Range {
  const lastLine = doc.lineCount - 1;
  return new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).text.length);
}
/* ───────────────────── Parsing helpers ─────────────────────────────────── */

export function parseUnifiedDiff(patchText: string): DiffParsedPatch[] {
  const canonical = normalizeDiff(patchText);
  return parsePatchInternal(canonical);
}

// Re-export parsePatch for backward compatibility with tests/extensions
export { parsePatchInternal as parsePatch };


/* ───────────────────── Parse‑only helper for WebView ───────────────────── */

export async function parsePatchStats(patchInput: string | DiffParsedPatch[]): Promise<FileInfo[]> {
  let patches: DiffParsedPatch[];
  if (typeof patchInput === 'string') {
    const normalized = normalizeDiff(patchInput);
    patches = parsePatchInternal(normalized);
  } else {
    patches = patchInput;
  }

  const info: FileInfo[] = [];

  // Performance enhancement: pre-check all files first to avoid redundant workspace queries
  const filePathMap = new Map<string, boolean>(); // Map of file path to existence status
  
  for (const p of patches) {
    const path = extractFilePath(p);
    if (!path) {continue;}
    
    // Skip duplicate paths
    if (filePathMap.has(path)) {continue;}
    
    // Check if file exists
    const isNewFileFromPatch = p.oldFileName === '/dev/null';
    const { isNew } = await resolveWorkspaceFile(path, isNewFileFromPatch);
    filePathMap.set(path, !isNew); // `!isNew` correctly indicates if the file exists
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