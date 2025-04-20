/* --------------------------------------------------------------------------
 *  PatchPilot — Webview Panel for patch input and preview
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { applyPatch, parsePatch } from './applyPatch';
import { getNonce, isUnifiedDiff } from './utilities';
import { trackEvent } from './telemetry';
import { ApplyResult, FileInfo } from './types/patchTypes';

/**
 * Messages from webview to extension
 */
interface WebviewMessage {
  command: string;
  patchText?: string;
}

/**
 * Messages from extension to webview
 */
interface ExtensionMessage {
  command: string;
  results?: ApplyResult[];
  fileInfo?: FileInfo[];
  error?: string;
  config?: Record<string, unknown>;
  patchText?: string;
}

/**
 * Manages the webview panel for patch input and preview
 */
export class PatchPanel {
  public static currentPanel: PatchPanel | undefined;
  private static readonly viewType = 'patchPilot.patchPanel';
  
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _outputChannel: vscode.OutputChannel;
  
  /**
   * Creates or shows the patch panel
   * @param extensionUri The extension URI for loading resources
   */
  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
      
    // If we already have a panel, show it
    if (PatchPanel.currentPanel) {
      PatchPanel.currentPanel._panel.reveal(column);
      return;
    }
    
    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      PatchPanel.viewType,
      'PatchPilot: Paste Diff',
      column || vscode.ViewColumn.One,
      {
        // Enable scripts in the webview
        enableScripts: true,
        // Retain panel state when hidden
        retainContextWhenHidden: true,
        // Restrict the webview to only load resources from the extension
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webview'),
          vscode.Uri.joinPath(extensionUri, 'out'),
          vscode.Uri.joinPath(extensionUri, 'media')
        ]
      }
    );
    
    PatchPanel.currentPanel = new PatchPanel(panel, extensionUri);
  }
  
  /**
   * Updates settings for the patch panel
   */
  public static updateSettings(): void {
    if (PatchPanel.currentPanel) {
      PatchPanel.currentPanel._postSettingsToWebview();
    }
  }
  
  /**
   * Creates a new panel instance
   * @param panel The webview panel
   * @param extensionUri The extension URI for loading resources
   */
  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._outputChannel = vscode.window.createOutputChannel('PatchPilot');
    
    // Set the webview's HTML content
    this._update();
    
    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    // Listen for when the panel becomes active
    this._panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        this._postSettingsToWebview();
      }
    }, null, this._disposables);
    
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.command) {
          case 'applyPatch':
            await this._handleApplyPatch(message.patchText || '');
            break;
          case 'previewPatch':
            await this._handlePreviewPatch(message.patchText || '');
            break;
          case 'cancelPatch':
            this._handleCancelPatch();
            break;
          case 'requestSettings':
            this._postSettingsToWebview();
            break;
          case 'checkClipboard':
            await this._handleCheckClipboard();
            break;
        }
      },
      null,
      this._disposables
    );
  }
  
  /**
   * Posts the current settings to the webview
   */
  private _postSettingsToWebview(): void {
    const config = vscode.workspace.getConfiguration('patchPilot');
    this._panel.webview.postMessage({
      command: 'updateSettings',
      config: {
        autoStage: config.get('autoStage', false),
        fuzzFactor: config.get('fuzzFactor', 2)
      }
    } as ExtensionMessage);
  }
  
  /**
   * Handles the apply patch command from the webview
   * @param patchText The patch text to apply
   */
  private async _handleApplyPatch(patchText: string): Promise<void> {
    trackEvent('webview_action', { action: 'applyPatch' });
    
    if (!patchText || patchText.trim() === '') {
      vscode.window.showErrorMessage('No patch text provided');
      this._sendErrorToWebview('No patch text provided');
      return;
    }
    
    if (!isUnifiedDiff(patchText)) {
      vscode.window.showErrorMessage('The provided text does not appear to be a valid unified diff');
      this._sendErrorToWebview('The provided text does not appear to be a valid unified diff');
      return;
    }
    
    // Get extension settings
    const config = vscode.workspace.getConfiguration('patchPilot');
    const autoStage = config.get<boolean>('autoStage', false);
    const fuzz = config.get<number>('fuzzFactor', 2);
    
    try {
      // Apply the patch
      const results = await applyPatch(patchText, {
        preview: true,
        autoStage,
        fuzz: fuzz as 0|1|2|3
      });
      
      // Show summary
      const successCount = results.filter((r: ApplyResult) => r.status === 'applied').length;
      const failCount = results.length - successCount;
      
      if (failCount === 0) {
        vscode.window.showInformationMessage(`Successfully applied patches to ${successCount} file(s).`);
      } else {
        vscode.window.showWarningMessage(`Applied ${successCount} patch(es), ${failCount} failed. Check output for details.`);
        
        // Log failed patches to output channel
        this._outputChannel.appendLine(`--- PatchPilot Results (${new Date().toLocaleString()}) ---`);
        results.forEach((result: ApplyResult) => {
          if (result.status === 'failed') {
            this._outputChannel.appendLine(`❌ ${result.file}: ${result.reason || 'Unknown error'}`);
          } else {
            this._outputChannel.appendLine(`✅ ${result.file} (${result.strategy || 'unknown strategy'})`);
          }
        });
        this._outputChannel.show();
      }
      
      // Track success and failure statistics
      trackEvent('patch_applied', { 
        successCount, 
        failCount,
        fuzzFactor: fuzz,
        filesAttempted: results.length
      });
      
      // Send results back to webview
      this._panel.webview.postMessage({
        command: 'patchResults',
        results
      } as ExtensionMessage);
      
    } catch (err) {
      const errorMessage = `Failed to apply patch: ${err instanceof Error ? err.message : String(err)}`;
      vscode.window.showErrorMessage(errorMessage);
      this._sendErrorToWebview(errorMessage);
      
      // Track the error
      trackEvent('patch_error', { 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  }
  
  /**
   * Handles the preview patch command from the webview
   * @param patchText The patch text to preview
   */
  private async _handlePreviewPatch(patchText: string): Promise<void> {
    trackEvent('webview_action', { action: 'previewPatch' });
    
    if (!patchText || patchText.trim() === '') {
      vscode.window.showErrorMessage('No patch text provided');
      this._sendErrorToWebview('No patch text provided');
      return;
    }
    
    if (!isUnifiedDiff(patchText)) {
      vscode.window.showErrorMessage('The provided text does not appear to be a valid unified diff');
      this._sendErrorToWebview('The provided text does not appear to be a valid unified diff');
      return;
    }
    
    try {
      // Parse the patch to get file info without applying
      const fileInfo = await parsePatch(patchText);
      
      if (fileInfo.length === 0) {
        vscode.window.showWarningMessage('No valid files found in the patch');
        this._sendErrorToWebview('No valid files found in the patch');
        return;
      }
      
      // Track the preview stats
      trackEvent('patch_preview', { 
        fileCount: fileInfo.length,
        missingFiles: fileInfo.filter(f => !f.exists).length,
        totalAdditions: fileInfo.reduce((sum, f) => sum + f.changes.additions, 0),
        totalDeletions: fileInfo.reduce((sum, f) => sum + f.changes.deletions, 0)
      });
      
      // Send preview info back to webview
      this._panel.webview.postMessage({
        command: 'patchPreview',
        fileInfo
      } as ExtensionMessage);
      
    } catch (err) {
      const errorMessage = `Failed to parse patch: ${err instanceof Error ? err.message : String(err)}`;
      vscode.window.showErrorMessage(errorMessage);
      this._sendErrorToWebview(errorMessage);
    }
  }
  
  /**
   * Handles the cancel patch command from the webview
   */
  private _handleCancelPatch(): void {
    trackEvent('webview_action', { action: 'cancelPatch' });
    vscode.window.showInformationMessage('Patch operation cancelled');
  }
  
  /**
   * Handles checking the clipboard for a patch
   */
  private async _handleCheckClipboard(): Promise<void> {
    try {
      const clipboardText = await vscode.env.clipboard.readText();
      
      if (clipboardText && isUnifiedDiff(clipboardText)) {
        // Send the clipboard content to the webview
        this._panel.webview.postMessage({
          command: 'clipboardContent',
          patchText: clipboardText
        } as ExtensionMessage);
        
        trackEvent('clipboard_check', { containsDiff: true });
      } else {
        trackEvent('clipboard_check', { containsDiff: false });
      }
    } catch (err) {
      // Log in a production-safe way using output channel
      const output = vscode.window.createOutputChannel('PatchPilot Clipboard');
      output.appendLine(`Error reading clipboard: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  
  /**
   * Sends an error to the webview
   * @param error The error message
   */
  private _sendErrorToWebview(error: string): void {
    this._panel.webview.postMessage({
      command: 'patchError',
      error
    } as ExtensionMessage);
  }
  
  /**
   * Updates the webview content
   */
  private _update(): void {
    const webview = this._panel.webview;
    
    this._panel.title = 'PatchPilot: Paste Diff';
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }
  
  /**
   * Gets the HTML for the webview
   * @param webview The webview instance
   * @returns The HTML content
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Get file paths
    const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js');
    const stylePath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'style.css');
    const logoPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'logo.png');
    
    // Get URIs that work in the webview
    const scriptUri = webview.asWebviewUri(scriptPath);
    const styleUri = webview.asWebviewUri(stylePath);
    const logoUri = webview.asWebviewUri(logoPath);
    
    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>PatchPilot: Paste Diff</title>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-container">
        <img src="${logoUri}" alt="PatchPilot Logo" class="logo" width="48" height="48">
        <h1>PatchPilot: Paste Unified Diff</h1>
      </div>
      <p>Paste your patch below and click "Preview" to see changes before applying.</p>
    </div>
    
    <div class="editor-container">
      <textarea id="patch-input" placeholder="Paste unified diff here..." spellcheck="false"></textarea>
    </div>
    
    <div class="preview-container" id="preview-area" style="display:none;">
      <h2>Patch Preview</h2>
      <div id="file-list"></div>
    </div>
    
    <div class="button-container">
      <button id="preview-btn" class="btn primary">Preview</button>
      <button id="apply-btn" class="btn success" disabled>Apply Patch</button>
      <button id="cancel-btn" class="btn danger" disabled>Cancel</button>
    </div>
    
    <div class="status-bar">
      <div id="status-message">Ready to parse your unified diff.</div>
    </div>
    
    <div class="footer">
      <p class="tip"><strong>Tip:</strong> Use <kbd>Ctrl+Enter</kbd> to preview the patch. AI-generated diffs with missing spaces and header will be automatically fixed.</p>
    </div>
  </div>
  
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
  
  /**
   * Disposes of the panel resources
   */
  public dispose(): void {
    PatchPanel.currentPanel = undefined;
    
    // Clean up resources
    this._panel.dispose();
    
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}