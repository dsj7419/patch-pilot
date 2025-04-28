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
  data?: unknown;
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
  data?: unknown;
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
   */
  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
      
    if (PatchPanel.currentPanel) {
      PatchPanel.currentPanel._panel.reveal(column);
      return;
    }
    
    const panel = vscode.window.createWebviewPanel(
      PatchPanel.viewType,
      'PatchPilot: Paste Diff',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
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
   */
  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._outputChannel = vscode.window.createOutputChannel('PatchPilot');
    
    this._update();
    
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    this._panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        this._postSettingsToWebview();
      }
    }, null, this._disposables);
    
    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        try {
          this._outputChannel.appendLine(`Received message: ${JSON.stringify(message)}`);
          
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
            default:
              this._outputChannel.appendLine(`Unknown message command: ${message.command}`);
          }
        } catch (error) {
          this._outputChannel.appendLine(`Error handling message: ${error instanceof Error ? error.message : String(error)}`);
          vscode.window.showErrorMessage(`Operation failed: ${error instanceof Error ? error.message : String(error)}`);
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
    
    const config = vscode.workspace.getConfiguration('patchPilot');
    const autoStage = config.get<boolean>('autoStage', false);
    const fuzz = config.get<number>('fuzzFactor', 2);
    
    try {
      const results = await applyPatch(patchText, {
        preview: true,
        autoStage,
        fuzz: fuzz as 0|1|2|3
      });
      
      const successCount = results.filter((r: ApplyResult) => r.status === 'applied').length;
      const failCount = results.length - successCount;
      
      if (failCount === 0) {
        vscode.window.showInformationMessage(`Successfully applied patches to ${successCount} file(s).`);
      } else {
        vscode.window.showWarningMessage(`Applied ${successCount} patch(es), ${failCount} failed. Check output for details.`);
        
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
      
      trackEvent('patch_applied', { 
        successCount, 
        failCount,
        fuzzFactor: fuzz,
        filesAttempted: results.length
      });
      
      await this._panel.webview.postMessage({
        command: 'patchResults',
        results
      } as ExtensionMessage);
      
    } catch (err) {
      const errorMessage = `Failed to apply patch: ${err instanceof Error ? err.message : String(err)}`;
      vscode.window.showErrorMessage(errorMessage);
      this._sendErrorToWebview(errorMessage);
      
      trackEvent('patch_error', { 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  }
  
  /**
   * Handles the preview patch command from the webview
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
      const fileInfo = await parsePatch(patchText);
      
      if (fileInfo.length === 0) {
        vscode.window.showWarningMessage('No valid files found in the patch');
        this._sendErrorToWebview('No valid files found in the patch');
        return;
      }
      
      trackEvent('patch_preview', { 
        fileCount: fileInfo.length,
        missingFiles: fileInfo.filter(f => !f.exists).length,
        totalAdditions: fileInfo.reduce((sum, f) => sum + f.changes.additions, 0),
        totalDeletions: fileInfo.reduce((sum, f) => sum + f.changes.deletions, 0)
      });
      
      await this._panel.webview.postMessage({
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
        await this._panel.webview.postMessage({
          command: 'clipboardContent',
          patchText: clipboardText
        } as ExtensionMessage);
        
        trackEvent('clipboard_check', { containsDiff: true });
      } else {
        trackEvent('clipboard_check', { containsDiff: false });
      }
    } catch (err) {
      this._outputChannel.appendLine(`Error reading clipboard: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  
  /**
   * Sends an error to the webview
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
   */
  /**
 * Gets the HTML for the webview
 */
private _getHtmlForWebview(webview: vscode.Webview): string {
  const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js');
  const stylePath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'style.css');
  const logoPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'logo.png');
  
  const scriptUri = webview.asWebviewUri(scriptPath);
  const styleUri = webview.asWebviewUri(stylePath);
  const logoUri = webview.asWebviewUri(logoPath);
  
  const nonce = getNonce();
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
      content="
        default-src 'none';
        img-src    ${webview.cspSource} https: data:;
        style-src  ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}' ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>PatchPilot: Paste Diff</title>
</head>
<body>
  <div class="container">
    <header class="header" role="banner">
      <div class="logo-container">
        <img src="${logoUri}" alt="PatchPilot Logo" class="logo" width="48" height="48">
        <h1>PatchPilot: Paste Unified Diff</h1>
      </div>
      <p id="app-description">Paste your patch below and click "Preview" to see changes before applying.</p>
    </header>
    
    <main>
      <div class="editor-container">
        <label for="patch-input" id="patch-input-label" class="sr-only">Unified diff code</label>
        <textarea id="patch-input" 
          aria-labelledby="patch-input-label" 
          aria-describedby="app-description" 
          placeholder="Paste unified diff here..." 
          spellcheck="false"></textarea>
      </div>
      
      <section class="preview-container hidden" id="preview-area" aria-labelledby="preview-heading">
        <h2 id="preview-heading">Patch Preview</h2>
        <div id="file-list" role="list" aria-label="Files affected by patch"></div>
      </section>
      
      <div class="button-container" role="group" aria-label="Patch actions">
        <button id="preview-btn" class="btn primary">Preview</button>
        <button id="apply-btn" class="btn success" disabled aria-disabled="true">Apply Patch</button>
        <button id="cancel-btn" class="btn danger" disabled aria-disabled="true">Cancel</button>
      </div>
    </main>
    
    <div class="status-bar" role="status" aria-live="polite">
      <div id="status-message">Ready to parse your unified diff.</div>
    </div>
    
    <div id="debug-panel" class="debug-panel hidden">
      <div id="debug-status">Debug: Ready</div>
    </div>
    
    <div class="footer">
      <p class="tip"><strong>Tip:</strong> Use <kbd>Ctrl+Enter</kbd> to preview the patch. AI-generated diffs with missing spaces and header will be automatically fixed.</p>
      <p class="tip"><strong>Tip:</strong> To create a branch for your patch, use <kbd>Ctrl+Shift+P</kbd> and search for "PatchPilot: Create Branch".</p>
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
    
    this._panel.dispose();
    
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}