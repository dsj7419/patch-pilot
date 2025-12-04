// src/test/unit/PatchPanel.test.ts

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PatchPanel } from '../../PatchPanel';
import { applyPatch, parseUnifiedDiff, parsePatchStats } from '../../applyPatch';
import { trackEvent } from '../../telemetry';
import { WELL_FORMED_DIFF } from '../fixtures/sample-diffs';
import { isUnifiedDiff, getNonce } from '../../utilities';

// Mock dependencies
jest.mock('vscode');
jest.mock('../../applyPatch');
jest.mock('../../telemetry');
jest.mock('../../utilities', () => ({
  __esModule: true,
  isUnifiedDiff: jest.fn(),
  getNonce: jest.fn(),
  normalizeDiff: jest.fn(t => t),
  normalizeLineEndings: jest.fn(t => t),
  autoFixSpaces: jest.fn(t => t),
  addMissingHeaders: jest.fn(t => t)
}));

// Mock logger to capture output
jest.mock('../../logger', () => ({
  getMainOutputChannel: jest.fn(),
  getGitOutputChannel: jest.fn(),
  log: jest.fn()
}));

describe('PatchPanel', () => {
  let extensionUri: vscode.Uri;
  let mockWebviewPanel: any;
  let mockWebview: any;
  let mockOutputChannel: any;
  
  beforeEach(() => {
    jest.resetAllMocks();
    
    // Setup utilities mocks
    const utilities = require('../../utilities');
    utilities.isUnifiedDiff.mockReturnValue(true);
    utilities.getNonce.mockReturnValue('mock-nonce');
     
    // Create mock extension URI
    extensionUri = { 
      fsPath: '/test/extension', 
      with: jest.fn().mockReturnValue({
        fsPath: '/test/extension',
        toString: jest.fn()
      }) 
    } as unknown as vscode.Uri;
     
    // Create mock webview
    mockWebview = {
      html: '',
      postMessage: jest.fn(),
      onDidReceiveMessage: jest.fn(),
      asWebviewUri: jest.fn(uri => uri),
      cspSource: 'https://mock-host'
    };
     
    // Create mock webview panel
    mockWebviewPanel = {
      webview: mockWebview,
      onDidDispose: jest.fn(),
      onDidChangeViewState: jest.fn(),
      reveal: jest.fn(),
      dispose: jest.fn(),
      title: 'Test Panel'
    };
     
    // Mock createWebviewPanel to return our mock
    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(mockWebviewPanel);
     
    // Mock createOutputChannel
    mockOutputChannel = {
      appendLine: jest.fn(),
      append: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn()
    };
    
    // Setup logger mock to return our mock channel
    const logger = require('../../logger');
    logger.getMainOutputChannel.mockReturnValue(mockOutputChannel);
     
    // Mock URI joinPath
    (vscode.Uri.joinPath as jest.Mock).mockImplementation((uri, ...paths) => {
      return {
        fsPath: uri.fsPath + '/' + paths.join('/'),
        with: jest.fn().mockReturnValue({
          fsPath: uri.fsPath + '/' + paths.join('/'),
          toString: jest.fn()
        }),
        toString: jest.fn().mockReturnValue(`file://${uri.fsPath}/${paths.join('/')}`)
      } as unknown as vscode.Uri;
    });
     
    // Add proper configuration mock with get AND update methods
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockImplementation((key, defaultValue) => {
        if (key === 'autoStage') {return false;}
        if (key === 'fuzzFactor') {return 2;}
        return defaultValue;
      }),
      update: jest.fn().mockResolvedValue(undefined)
    });
     
    // Mock applyPatch and parsePatch
    (applyPatch as jest.Mock).mockResolvedValue([
      { file: 'file.ts', status: 'applied', strategy: 'test' }
    ]);
     
    (parsePatchStats as jest.Mock).mockResolvedValue([
      {
        filePath: 'file.ts',
        exists: true,
        hunks: 1,
        changes: { additions: 2, deletions: 1 }
      }
    ]);

    // Mock parseUnifiedDiff to return a dummy structure if needed, or rely on the fact it's mocked
    (parseUnifiedDiff as jest.Mock).mockReturnValue([]);
    
    // Mock clipboard
    if (!vscode.env) {
      (vscode as any).env = {};
    }
    if (!vscode.env.clipboard) {
      (vscode.env as any).clipboard = {
        readText: jest.fn().mockResolvedValue(''),
        writeText: jest.fn().mockResolvedValue(undefined)
      };
    }
    
    // Mock commands.executeCommand for branch tests
    (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, ...args) => {
      if (command === 'patchPilot.createBranch') {
        if (args[0] === 'failing-branch') {
          return Promise.reject(new Error('Failed to create branch'));
        }
        return Promise.resolve(args[0] || 'default-branch');
      }
      return Promise.resolve();
    });

    // Mock fs operations
    (vscode.workspace.fs.createDirectory as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    
    // Mock readFile to return the REAL index.html content when requested
    (vscode.workspace.fs.readFile as jest.Mock) = jest.fn().mockImplementation(async (uri: vscode.Uri) => {
      if (uri.fsPath.endsWith('index.html')) {
        const realPath = path.resolve(__dirname, '../../../webview/index.html');
        return fs.readFileSync(realPath);
      }
      return Buffer.from('');
    });
    
    (vscode.workspace.fs.writeFile as jest.Mock) = jest.fn().mockResolvedValue(undefined);
  });
  
  describe('createOrShow', () => {
    it('should create a new panel when none exists', () => {
      PatchPanel.currentPanel = undefined;
      
      PatchPanel.createOrShow(extensionUri);
      
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'patchPilot.patchPanel',
        'PatchPilot: Paste Diff',
        expect.anything(),
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true
        })
      );
      
      expect(PatchPanel.currentPanel).toBeDefined();
    });
    
    it('should reuse existing panel when one exists', () => {
      // Create a mock current panel
      const mockPanel = { _panel: { reveal: jest.fn() } };
      PatchPanel.currentPanel = mockPanel as unknown as PatchPanel;
      
      PatchPanel.createOrShow(extensionUri);
      
      // Should not create a new panel
      expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
      
      // Should reveal existing panel
      expect(mockPanel._panel.reveal).toHaveBeenCalled();
      
      // Reset for other tests
      PatchPanel.currentPanel = undefined;
    });
  });
  
  describe('message handling', () => {
    let panel: PatchPanel;
    let messageHandler: Function;
    
    beforeEach(() => {
      // Create panel instance
      PatchPanel.createOrShow(extensionUri);
      panel = PatchPanel.currentPanel as PatchPanel;
      
      // Capture the message handler
      messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
    });
    
    afterEach(() => {
      // Clean up
      if (panel) {
        panel.dispose();
      }
      PatchPanel.currentPanel = undefined;
    });
    
    it('should handle applyPatch message', async () => {
      // Force utilities.isUnifiedDiff to return true for this test
      (isUnifiedDiff as jest.Mock).mockReturnValue(true);
      
      // Setup applyPatch mock to return success
      (applyPatch as jest.Mock).mockResolvedValue([
        { file: 'file.ts', status: 'applied', strategy: 'test' }
      ]);
      
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('OK');
      
      // Call the handler with a message - we need to make sure it has the proper patchText
      await messageHandler({ 
        command: 'applyPatch', 
        patchText: WELL_FORMED_DIFF 
      });
      
      // Verify applyPatch was called with the right arguments
      expect(applyPatch).toHaveBeenCalledWith(
        WELL_FORMED_DIFF,
        expect.objectContaining({
          preview: true
        })
      );
    
      // Verify success message was shown
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Patch applied')
      );
      
      // Verify results were sent to webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'patchResults',
          results: expect.anything()
        })
      );
      
      // Verify telemetry was tracked
      expect(trackEvent).toHaveBeenCalledWith(
        'webview_action',
        expect.objectContaining({ action: 'applyPatch' })
      );
    });
    
    it('should handle previewPatch message', async () => {
      // Force utilities.isUnifiedDiff to return true for this test
      (isUnifiedDiff as jest.Mock).mockReturnValue(true);
      
      // Call the handler with a message
      await messageHandler({ 
        command: 'previewPatch', 
        patchText: WELL_FORMED_DIFF 
      });
      
      // Verify parsePatch was called with the right argument
      expect(parseUnifiedDiff).toHaveBeenCalledWith(WELL_FORMED_DIFF);
    
      // Verify fileInfo was sent to webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'patchPreview',
          fileInfo: expect.anything()
        })
      );
      
      // Verify telemetry was tracked
      expect(trackEvent).toHaveBeenCalledWith(
        'webview_action',
        expect.objectContaining({ action: 'previewPatch' })
      );
    });
    
    it('should handle cancelPatch message', async () => {
      // Call the handler with a message
      await messageHandler({ command: 'cancelPatch' });
      
      // Verify info message was shown
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Patch operation cancelled'
      );
      
      // Verify telemetry was tracked
      expect(trackEvent).toHaveBeenCalledWith(
        'webview_action',
        expect.objectContaining({ action: 'cancelPatch' })
      );
    });
    
    it('should handle requestSettings message', async () => {
      // Mock getConfiguration
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((key, defaultValue) => {
          if (key === 'autoStage') {return true;}
          if (key === 'fuzzFactor') {return 3;}
          return defaultValue;
        })
      });
      
      // Call the handler with a message
      await messageHandler({ command: 'requestSettings' });
      
      // Verify settings were sent to webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'updateSettings',
          config: {
            autoStage: true,
            fuzzFactor: 3
          }
        })
      );
    });
    
    it('should handle checkClipboard message', async () => {
      // Mock clipboard to contain a diff
      (vscode.env.clipboard.readText as jest.Mock).mockResolvedValue(WELL_FORMED_DIFF);
      
      // Mock isUnifiedDiff to return true
      (isUnifiedDiff as jest.Mock).mockReturnValue(true);
      
      // Call the handler with a message
      await messageHandler({ command: 'checkClipboard' });
      
      // Verify clipboard text was sent to webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'clipboardContent',
          patchText: WELL_FORMED_DIFF
        })
      );
      
      // Verify telemetry was tracked
      expect(trackEvent).toHaveBeenCalledWith(
        'clipboard_check',
        expect.objectContaining({ containsDiff: true })
      );
    });

    it('should handle previewPatch with no valid files', async () => {
      // Mock parsePatchStats to return empty array for this test only
      (parsePatchStats as jest.Mock).mockResolvedValueOnce([]);
      
      // Ensure isUnifiedDiff returns true so we get to the parsePatch call
      (isUnifiedDiff as jest.Mock).mockReturnValue(true);
      
      // Call the handler with a message
      await messageHandler({ 
        command: 'previewPatch', 
        patchText: WELL_FORMED_DIFF 
      });
      
      // Verify warning message was shown
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'No valid files found in the patch'
      );
      
      // Verify error was sent to webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'patchError',
          error: 'No valid files found in the patch'
        })
      );
    });
    
    it('should handle previewPatch with parsePatch throwing error', async () => {
      // Mock parseUnifiedDiff to throw a specific error
      const parseError = new Error('Parse error');
      (parseUnifiedDiff as jest.Mock).mockImplementationOnce(() => { throw parseError; });
      
      // Ensure isUnifiedDiff returns true
      (isUnifiedDiff as jest.Mock).mockReturnValue(true);
      
      // Call the handler with a message
      await messageHandler({ 
        command: 'previewPatch', 
        patchText: WELL_FORMED_DIFF 
      });
      
      // Verify error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse patch')
      );
      
      // Verify error was sent to webview with the specific error message
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'patchError',
          error: expect.stringContaining('Parse error')
        })
      );
    });
    
    it('should handle partial failures in applyPatch', async () => {
      // Mock applyPatch to return partial success/failure
      (applyPatch as jest.Mock).mockResolvedValueOnce([
        { file: 'file1.ts', status: 'applied', strategy: 'strict' },
        { file: 'file2.ts', status: 'failed', reason: 'File not found' }
      ]);
      
      // Ensure isUnifiedDiff returns true
      (isUnifiedDiff as jest.Mock).mockReturnValue(true);
      
      // Call the handler with a message
      await messageHandler({ 
        command: 'applyPatch', 
        patchText: WELL_FORMED_DIFF 
      });
      
      // Verify warning message was shown
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Applied 1 patch(es), 1 failed')
      );
      
      // Verify output channel was used
      expect(mockOutputChannel.appendLine).toHaveBeenCalled();
      expect(mockOutputChannel.show).toHaveBeenCalled();
    });
    
    it('should handle checkClipboard when clipboard has no diff', async () => {
      // Mock clipboard to return non-diff content
      (vscode.env.clipboard.readText as jest.Mock).mockResolvedValue('not a diff');
      
      // Mock isUnifiedDiff to return false
      (isUnifiedDiff as jest.Mock).mockReturnValue(false);
      
      // Call the handler
      await messageHandler({ command: 'checkClipboard' });
      
      // Should not send clipboard content to webview
      expect(mockWebview.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'clipboardContent'
        })
      );
      
      // Should track telemetry with containsDiff: false
      expect(trackEvent).toHaveBeenCalledWith(
        'clipboard_check',
        expect.objectContaining({ containsDiff: false })
      );
    });
    
    it('should handle clipboard read errors', async () => {
      // Mock clipboard to throw error
      (vscode.env.clipboard.readText as jest.Mock).mockRejectedValue(
        new Error('Clipboard error')
      );
      
      // Call the handler
      await messageHandler({ command: 'checkClipboard' });
      
      // Should not send clipboard content or track telemetry
      expect(mockWebview.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'clipboardContent'
        })
      );
      
      // Should not throw error to caller
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
    
    it('should handle empty patchText for applyPatch', async () => {
      // Call the handler with empty patch text
      await messageHandler({ 
        command: 'applyPatch', 
        patchText: '' 
      });
      
      // Verify error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No patch text provided');
      
      // Verify error was sent to webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'patchError',
          error: 'No patch text provided'
        })
      );
    });
    
    it('should handle invalid diff for applyPatch', async () => {
      // Mock isUnifiedDiff to return false for this test
      (isUnifiedDiff as jest.Mock).mockReturnValueOnce(false);
      
      // Call the handler with invalid diff
      await messageHandler({ 
        command: 'applyPatch', 
        patchText: 'not a valid diff' 
      });
      
      // Verify error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not appear to be a valid unified diff')
      );
      
      // Verify error was sent to webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'patchError',
          error: expect.stringContaining('not appear to be a valid unified diff')
        })
      );
    });
    
    it('should handle error conditions in applyPatch', async () => {
      // Setup mock to throw error
      const testError = new Error('Test error');
      (applyPatch as jest.Mock).mockRejectedValue(testError);
      
      // Force utilities.isUnifiedDiff to return true for this test  
      (isUnifiedDiff as jest.Mock).mockReturnValue(true);
      
      // Call the handler with a message
      await messageHandler({ 
        command: 'applyPatch', 
        patchText: WELL_FORMED_DIFF 
      });
      
      // Verify error message was shown with the correct text
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to apply patch: Test error')
      );
    
      // Verify error was sent to webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'patchError',
          error: expect.stringContaining('Test error')
        })
      );
      
      // Verify telemetry tracked the error
      expect(trackEvent).toHaveBeenCalledWith(
        'patch_error',
        expect.objectContaining({ error: expect.stringContaining('Test error') })
      );
    });
  });
  
  describe('updateSettings', () => {
    it('should update settings in the panel', () => {
      // Create a mock current panel
      const mockPanel = { 
        _postSettingsToWebview: jest.fn()
      };
      PatchPanel.currentPanel = mockPanel as unknown as PatchPanel;
      
      PatchPanel.updateSettings();
      
      expect(mockPanel._postSettingsToWebview).toHaveBeenCalled();
      
      // Reset for other tests
      PatchPanel.currentPanel = undefined;
    });
  });
  
  describe('panel lifecycle', () => {
    it('should dispose properly', () => {
      // Create panel
      PatchPanel.createOrShow(extensionUri);
      const panel = PatchPanel.currentPanel as PatchPanel;
      
      // Dispose panel
      panel.dispose();
      
      // Verify panel was disposed
      expect(mockWebviewPanel.dispose).toHaveBeenCalled();
      expect(PatchPanel.currentPanel).toBeUndefined();
    });
    
    it('should handle view state changes', () => {
      // Create panel
      PatchPanel.createOrShow(extensionUri);
      
      // Get the view state change handler
      const viewStateChangeHandler = mockWebviewPanel.onDidChangeViewState.mock.calls[0][0];
      
      // Mock _postSettingsToWebview
      const mockPanel = PatchPanel.currentPanel as any;
      mockPanel._postSettingsToWebview = jest.fn();
      
      // Call the handler with active state
      viewStateChangeHandler({ webviewPanel: { active: true } });
      
      // Verify settings were posted
      expect(mockPanel._postSettingsToWebview).toHaveBeenCalled();
      
      // Clean up
      PatchPanel.currentPanel?.dispose();
      PatchPanel.currentPanel = undefined;
    });
    
    it('should initialize HTML content correctly', async () => {
      // Create panel
      PatchPanel.createOrShow(extensionUri);
      
      // Wait for async file reading in constructor
      // Using jest.requireActual to bypass fake timers for this specific wait
      await new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

      // Check if HTML was set
      expect(mockWebviewPanel.webview.html).toBeDefined();
      expect(mockWebviewPanel.webview.html.length).toBeGreaterThan(0);
      
      // Verify it contains expected elements
      // Note: We are testing against the mock HTML defined in beforeEach
      expect(mockWebviewPanel.webview.html).toContain('<!DOCTYPE html>');
      expect(mockWebviewPanel.webview.html).toContain('nonce-mock-nonce');
      
      // Verify placeholders were replaced
      expect(mockWebviewPanel.webview.html).not.toContain('{{nonce}}');
      expect(mockWebviewPanel.webview.html).not.toContain('{{cspSource}}');
      
      // Clean up
      PatchPanel.currentPanel?.dispose();
      PatchPanel.currentPanel = undefined;
    });
  });
});