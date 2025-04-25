/* --------------------------------------------------------------------------
 *  PatchPilot - VS Code extension for AI-grade patch application
 *  
 *  Entry point for the extension, registers commands and UI elements
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { PatchPanel } from './PatchPanel';
import { applyPatch, parsePatch } from './applyPatch';
import { initTelemetry, trackEvent } from './telemetry';
import { isGitAvailable, createTempBranch } from './git';
import { ApplyOptions, ApplyResult, FileInfo } from './types/patchTypes';

/**
 * Activates the extension and registers commands
 * @param context The extension context provided by VS Code
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Use VS Code logging instead of console.log
  const output = vscode.window.createOutputChannel('PatchPilot');
  output.appendLine('PatchPilot is now active');
  
  // Initialize telemetry if enabled
  await initTelemetry(context);
  
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
        return await parsePatch(patchText);
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
          vscode.window.showInformationMessage(`Successfully applied patches to ${successCount} file(s).`);
        } else {
          vscode.window.showWarningMessage(`Applied ${successCount} patch(es), ${failCount} failed. Check output for details.`);
          
          // Log failed patches to output channel
          const outputChannel = vscode.window.createOutputChannel('PatchPilot');
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
}

/**
 * Deactivation handler - clean up resources
 */
export function deactivate(): void {
  trackEvent('extension_deactivated');
  
  // Clean up resources if needed
  // (VS Code automatically disposes of registered commands and subscriptions)
}