/* --------------------------------------------------------------------------
 *  PatchPilot — Patch Session Management (Queue & UI)
 * ----------------------------------------------------------------------- */
import { PatchCodeLensProvider } from "./PatchCodeLensProvider";

import * as vscode from "vscode";
import { getOutputChannel } from "../logger";

/**
 * Global state for pending patches waiting to be accepted via the diff editor.
 * Key: URI string of the modification view (right side).
 * Value: Data needed to apply the patch.
 */
export const pendingPatches = new Map<
  string,
  {
    targetUri: vscode.Uri;
    patchedContent: string;
    originalPatchedContent: string; // To support Reset
    autoStage: boolean;
  }
>();

/**
 * Queue for sequential patch processing.
 */
export interface QueuedPatch {
  fileUri: vscode.Uri;
  original: string;
  patched: string;
  relPath: string;
  isNew: boolean;
  autoStage: boolean;
  strategy?: string;
}

const patchQueue: QueuedPatch[] = [];

export function addToPatchQueue(patch: QueuedPatch): void {
  patchQueue.push(patch);
}

export function clearPatchQueue(): void {
  patchQueue.length = 0;
}

export function getPatchQueueLength(): number {
  return patchQueue.length;
}

/**
 * Registers a listener to clean up pending patches when the diff editor is closed.
 * This prevents memory leaks when users manually close tabs.
 * @param context The extension context
 */
export function registerSessionCleaner(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      // Check if the closed document corresponds to a pending patch
      const uriString = doc.uri.toString();
      if (pendingPatches.has(uriString)) {
        pendingPatches.delete(uriString);
      }
    })
  );
}

/* ───────────────────────── Preview diff editor ─────────────────────────── */

export async function processNextPatch(): Promise<void> {
  const next = patchQueue.shift();

  if (!next) {
    getOutputChannel().appendLine("All files from patch have been processed.");
    // Delay message slightly to ensure UI has settled after closing the editor
    setTimeout(() => {
      vscode.window.showInformationMessage(
        "All files from patch have been processed."
      );
    }, 200);
    return;
  }

  await showNonBlockingDiff(
    next.fileUri,
    next.original,
    next.patched,
    next.relPath,
    next.isNew,
    next.autoStage
  );
}

async function showNonBlockingDiff(
  fileUri: vscode.Uri,
  original: string,
  patched: string,
  relPath: string,
  isNew: boolean,
  autoStage: boolean
): Promise<void> {
  // Left side:
  // If existing file -> use the real file URI (allows editing/copying from left)
  // If new file -> use a virtual empty document
  const leftUri = isNew
    ? fileUri.with({ scheme: "patchpilot-orig", query: "new" })
    : fileUri;

  // Right side:
  // Virtual document with the patched content
  const rightUri = fileUri.with({
    scheme: "patchpilot-mod",
    query: JSON.stringify({ ts: Date.now() }), // Unique query to ensure refresh/separation
  });

  // Store state for the "Accept" command
  pendingPatches.set(rightUri.toString(), {
    targetUri: fileUri,
    patchedContent: patched,
    originalPatchedContent: patched,
    autoStage,
  });

  await vscode.commands.executeCommand(
    "vscode.diff",
    leftUri,
    rightUri,
    `Patch: ${relPath} ${isNew ? "(New File)" : "" } (Click checkmark to accept)`,
    { preview: false, preserveFocus: false }
  );

  vscode.commands.executeCommand("workbench.action.compareEditor.focusSecondarySide");
  PatchCodeLensProvider.refresh();
}
