/* --------------------------------------------------------------------------
 *  PatchPilot - VS Code extension for AI-grade patch application
 *  
 *  Entry point for the extension, registers commands and UI elements
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { PatchPanel } from './PatchPanel';
import { applyPatch, parsePatchStats } from './applyPatch';
import { initTelemetry, trackEvent } from './telemetry';
import { registerLoggers, getMainOutputChannel } from './logger';
import { isGitAvailable, createTempBranch, autoStageFiles } from './git';
import { ApplyOptions, ApplyResult, FileInfo } from './types/patchTypes';
import { pendingPatches, processNextPatch, registerSessionCleaner } from './patch/PatchSession';
import { PatchCodeLensProvider } from './patch/PatchCodeLensProvider';
import { HunkManager, HunkRange } from './patch/HunkManager';

/**
 * Activates the extension and registers commands
 * @param context The extension context provided by VS Code
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize loggers
  registerLoggers(context);
  const output = getMainOutputChannel();  
  output.appendLine('PatchPilot is now active');
  
  // Initialize telemetry if enabled
  await initTelemetry(context);
  
  // Register session cleaner to prevent memory leaks
  registerSessionCleaner(context);
  
  // Track activation
  trackEvent('extension_activated', { 
    vsCodeVersion: vscode.version,
    hasGit: await isGitAvailable()
  });
  
  // Register the paste diff command with webview panel
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.pasteDiff', () => {
      // Track command usage
      trackEvent('command_executed', { command: 'pasteDiff' });
      
      // Create and show panel
      PatchPanel.createOrShow(context.extensionUri);
    })
  );
  
  // Register the programmatic API for AI/extension integration
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.applyPatch', async (patchText: string, options?: ApplyOptions): Promise<ApplyResult[]> => {
      // Track API usage
      trackEvent('api_called', { method: 'applyPatch' });
      
      // Apply the patch with provided options or defaults
      try {
        const results = await applyPatch(patchText, options);
        
        // Track application results
        trackEvent('patch_applied', { 
          fileCount: results.length,
          successCount: results.filter((r: ApplyResult) => r.status === 'applied').length
        });
        
        return results;
      } catch (error) {
        // Track error
        trackEvent('api_error', { 
          method: 'applyPatch',
          error: error instanceof Error ? error.message : String(error)
        });
        
        throw error;
      }
    })
  );

  // Register the parse patch command for file info extraction
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.parsePatch', async (patchText: string): Promise<FileInfo[]> => {
      // Track API usage
      trackEvent('api_called', { method: 'parsePatch' });
      
      try {
        // Parse the patch to get file information
        return await parsePatchStats(patchText);
      } catch (error) {
        // Track error
        trackEvent('api_error', { 
          method: 'parsePatch',
          error: error instanceof Error ? error.message : String(error)
        });
        
        throw error;
      }
    })
  );
  
  // Register the create branch command for quick branching before applying a patch
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.createBranch', async (branchName?: string): Promise<string> => {
      // Track API usage
      trackEvent('api_called', { method: 'createBranch' });
      
      try {
        // If branchName is not provided, show input box to get it from user
        if (branchName === undefined) {
          const defaultBranchName = `patchpilot/${new Date().toISOString().replace(/[:.]/g, '-')}`;
          branchName = await vscode.window.showInputBox({
            prompt: 'Enter a name for the new branch',
            placeHolder: defaultBranchName,
            value: defaultBranchName
          });
          
          // If user cancelled the input box, show message and return
          if (branchName === undefined) {
            vscode.window.showInformationMessage('Branch creation cancelled.');
            throw new Error('Branch creation cancelled');
          }
          
          // Track if a custom name was provided (not using the default)
          trackEvent('command_executed', { 
            command: 'createBranch', 
            customName: branchName !== defaultBranchName && branchName !== ''
          });
        }
        
        // Create a branch for the patch
        return await createTempBranch(branchName === '' ? undefined : branchName);
      } catch (error) {
        // Track error
        trackEvent('api_error', { 
          method: 'createBranch',
          error: error instanceof Error ? error.message : String(error)
        });
        
        throw error;
      }
    })
  );
  
  // Register configuration change handler to react to settings updates
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('patchPilot')) {
        // Refresh settings if they change
        PatchPanel.updateSettings();
      }
    })
  );
  
  // Register status bar item to quickly access PatchPilot
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(diff) PatchPilot";
  statusBarItem.tooltip = "Open PatchPilot to paste a diff";
  statusBarItem.command = 'patchPilot.pasteDiff';
  statusBarItem.show();
  
  // Add the status bar item to disposables
  context.subscriptions.push(statusBarItem);
  
  // Register a context menu command for text selections
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.applySelectedDiff', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
      }
      
      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showErrorMessage('No text selected');
        return;
      }
      
      const selectedText = editor.document.getText(selection);
      
      // Track command usage
      trackEvent('command_executed', { command: 'applySelectedDiff' });
      
      // Apply the selected text as a patch
      try {
        const config = vscode.workspace.getConfiguration('patchPilot');
        const autoStage = config.get<boolean>('autoStage', false);
        const fuzz = config.get<number>('fuzzFactor', 2);
        
        const results = await applyPatch(selectedText, {
          preview: true,
          autoStage,
          fuzz: fuzz as 0|1|2|3
        });
        
        // Show results
        const successCount = results.filter(r => r.status === 'applied').length;
        const failCount = results.length - successCount;
        
        if (failCount === 0) {
          const isPreview = results.some(r => r.strategy === 'preview');
          if (isPreview) {
            vscode.window.showInformationMessage(`Patch prepared. Review changes in the diff editor.`);
          } else {
            vscode.window.showInformationMessage(`Successfully applied patches to ${successCount} file(s).`);
          }
        } else {
          vscode.window.showWarningMessage(`Applied ${successCount} patch(es), ${failCount} failed. Check output for details.`);
          
          const outputChannel = getMainOutputChannel();
          outputChannel.appendLine(`--- PatchPilot Results ---`);
          results.forEach((result: ApplyResult) => {
            if (result.status === 'failed') {
              outputChannel.appendLine(`❌ ${result.file}: ${result.reason || 'Unknown error'}`);
            }
          });
          outputChannel.show();
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to apply patch: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  // Register CodeLens provider for interactive patch review
  const codeLensProvider = new PatchCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'patchpilot-mod', language: '*' },
      codeLensProvider
    )
  );

  // Event emitter to signal document changes
  const _onDidChangeDoc = new vscode.EventEmitter<vscode.Uri>();

  // Register command to reset changes (undo all discards)
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.resetPatch', async (...args: any[]) => {
      let uri: vscode.Uri | undefined;

      if (args[0] instanceof vscode.Uri) {
        uri = args[0];
      } else {
        uri = vscode.window.activeTextEditor?.document.uri;
      }

      if (!uri) { return; }

      const patchData = pendingPatches.get(uri.toString());
      if (!patchData) { return; }

      patchData.patchedContent = patchData.originalPatchedContent;
      pendingPatches.set(uri.toString(), patchData);
      _onDidChangeDoc.fire(uri);
    })
  );

  // Register command to discard a specific hunk
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.discardHunk', async (uri: vscode.Uri, hunk: HunkRange) => {
      const patchData = pendingPatches.get(uri.toString());
      if (!patchData) { return; }

      // Get original content
      let originalContent = '';
      try {
        const fileStats = await vscode.workspace.fs.stat(patchData.targetUri).then(() => true, () => false);
        if (fileStats) {
          const bytes = await vscode.workspace.fs.readFile(patchData.targetUri);
          originalContent = new TextDecoder().decode(bytes);
        }
      } catch (e) { /* ignore */ }

      const hunkManager = new HunkManager();
      const newContent = hunkManager.revertHunk(originalContent, patchData.patchedContent, hunk);

      // Update pending patch data
      patchData.patchedContent = newContent;
      pendingPatches.set(uri.toString(), patchData);

      // Signal update
      _onDidChangeDoc.fire(uri);
    })
  );

  // Register content provider for patched content (Right side of diff)
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('patchpilot-mod', {
      onDidChange: _onDidChangeDoc.event,
      provideTextDocumentContent(uri: vscode.Uri): string {
        const data = pendingPatches.get(uri.toString());
        return data ? data.patchedContent : '';
      }
    })
  );

  // Register content provider for empty original files (Left side of diff for new files)
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('patchpilot-orig', {
      provideTextDocumentContent(): string {
        return ''; // Empty content for new files
      }
    })
  );

  // Register command to accept the patch from the diff view
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.acceptPatch', async (...args: any[]) => {
      let currentUri: vscode.Uri | undefined;

      if (args[0] instanceof vscode.Uri) {
        currentUri = args[0];
      } else {
        currentUri = vscode.window.activeTextEditor?.document.uri;
      }

      if (!currentUri) { return; }

      const patchData = pendingPatches.get(currentUri.toString());

      if (!patchData) {
        vscode.window.showErrorMessage("No active patch session found for this editor.");
        return;
      }

      const { targetUri, patchedContent, autoStage } = patchData;

      try {
        // Write the file (works for both new and existing)
        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(patchedContent));
        
        vscode.window.showInformationMessage(`Patch applied to ${vscode.workspace.asRelativePath(targetUri)}`);
        
        if (autoStage) {
          // Security: Must use relative path, as absolute paths are blocked by gitValidation
          const relativePath = vscode.workspace.asRelativePath(targetUri);
          
          try {
            await autoStageFiles([relativePath]);
          } catch (stageError) {
            // Suppress fatal error if only staging fails. The file is already written.
            const msg = stageError instanceof Error ? stageError.message : String(stageError);
            vscode.window.showWarningMessage(`Patch applied, but auto-stage failed: ${msg}`);
          }
        }

        // Cleanup
        pendingPatches.delete(currentUri.toString());
        
        // Close the diff editor
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        
        // Process the next patch in queue
        await processNextPatch();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to apply patch: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  // Register command to skip the current patch
  context.subscriptions.push(
    vscode.commands.registerCommand('patchPilot.skipPatch', async (...args: any[]) => {
      let currentUri: vscode.Uri | undefined;

      if (args[0] instanceof vscode.Uri) {
        currentUri = args[0];
      } else {
        currentUri = vscode.window.activeTextEditor?.document.uri;
      }

      if (!currentUri) { return; }
      // Cleanup current
      pendingPatches.delete(currentUri.toString());
      
      // Close and move next
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      vscode.window.setStatusBarMessage('Patch skipped', 3000);
      await processNextPatch();
    })
  );
}

/**
 * Deactivation handler - clean up resources
 */
export function deactivate(): void {
  trackEvent('extension_deactivated');
  
  // Clean up resources if needed
  // (VS Code automatically disposes of registered commands and subscriptions)
}