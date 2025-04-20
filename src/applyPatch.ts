/* --------------------------------------------------------------------------
 *  PatchPilot — AI‑grade unified‑diff applier
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as DiffLib from 'diff';
import { normalizeDiff } from './utilities';
import { autoStageFiles } from './git';
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
    } catch (e) {
      vscode.window.showWarningMessage(
        `Patch applied but Git staging failed: ${(e as Error).message}`,
      );
    }
  }

  trackEvent('apply_patch_complete', {
    files: results.length,
    success: results.filter((r) => r.status === 'applied').length,
    fuzz,
  });

  return results;
}

/* ───────────────────── Single‑file helper (strategy chain) ─────────────── */

export async function applyPatchToContent(
  content: string,
  patch: DiffParsedPatch,
  fuzz: 0 | 1 | 2 | 3,
): Promise<PatchResult> {
  return PatchStrategyFactory.createDefaultStrategy(fuzz).apply(content, patch);
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
      `Patch Preview – ${relPath}`,
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
  const found = await vscode.workspace.findFiles(
    `**/${fname}`,
    '**/node_modules/**',
  );

  if (found.length === 1) {return found[0];}
  if (found.length > 1) {
    const pick = await vscode.window.showQuickPick(
      found.map((f) => ({ label: vscode.workspace.asRelativePath(f), uri: f })),
      { placeHolder: `Select file for patch «${relPath}»` },
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

  for (const p of patches) {
    const path = extractFilePath(p);
    if (!path) {continue;}

    const uri = await resolveWorkspaceFile(path);
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
      exists: !!uri,
      hunks: p.hunks.length,
      changes: { additions: add, deletions: del },
    });
  }
  return info;
}

/* ------------------------------------------------------------------ *
 *  Jest shim — active only during unit tests, no `any` leaks
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
  (exports as { applyPatch: typeof applyPatch }).applyPatch =
    maybeJest.fn(applyPatch) as unknown as typeof applyPatch;
  (exports as { parsePatch: typeof parsePatch }).parsePatch =
    maybeJest.fn(parsePatch) as unknown as typeof parsePatch;
}
