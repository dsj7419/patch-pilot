/* --------------------------------------------------------------------------
 *  PatchPilot — CodeLens Provider for interactive patch review
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { HunkManager } from './HunkManager';
import { pendingPatches } from './PatchSession';

export class PatchCodeLensProvider implements vscode.CodeLensProvider {
  private static _instance: PatchCodeLensProvider;
  private hunkManager: HunkManager;
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    this.hunkManager = new HunkManager();
    PatchCodeLensProvider._instance = this;
  }

  /**
   * Statically trigger a refresh of the CodeLenses.
   */
  public static refresh(): void {
    if (PatchCodeLensProvider._instance) {
      PatchCodeLensProvider._instance._onDidChangeCodeLenses.fire();
    }
  }

 /*  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  } */

  public async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    // Only provide CodeLens for our modified documents
    if (document.uri.scheme !== 'patchpilot-mod') {
      return [];
    }

    const patchData = pendingPatches.get(document.uri.toString());
    if (!patchData) {
      return [];
    }

    // Get original content
    // For new files, original content is empty string
    let originalContent = '';
    try {
      // We stored the targetUri in pendingPatches.
      // If it's an existing file, we read it from disk.
      // If it's a new file (targetUri doesn't exist), we assume empty string.
      // However, PatchSession logic uses 'patchpilot-orig' scheme for left side.
      // Let's try to read the file from disk first.
      const fileStats = await vscode.workspace.fs.stat(patchData.targetUri).then(
        () => true,
        () => false
      );

      if (fileStats) {
        const bytes = await vscode.workspace.fs.readFile(patchData.targetUri);
        originalContent = new TextDecoder().decode(bytes);
      }
    } catch (e) {
      // Fallback to empty string if read fails (e.g. new file)
      console.warn('Could not read original file for CodeLens:', e);
    }

    const modifiedContent = document.getText();
    const hunks = this.hunkManager.compare(originalContent, modifiedContent);
    const lenses: vscode.CodeLens[] = [];

    for (const hunk of hunks) {
      const range = new vscode.Range(
        hunk.modifiedStart, 
        0, 
        hunk.modifiedStart, 
        0
      );

      const command: vscode.Command = {
        title: '$(close) Reject Change',
        command: 'patchPilot.discardHunk',
        arguments: [document.uri, hunk]
      };

      lenses.push(new vscode.CodeLens(range, command));
    }

    return lenses;
  }
}
