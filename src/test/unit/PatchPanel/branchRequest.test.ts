// src/test/unit/PatchPanel/branchRequest.test.ts

import * as vscode from 'vscode';
import { PatchPanel } from '../../../PatchPanel';
import { trackEvent } from '../../../telemetry';

// Mock dependencies
jest.mock('vscode');
jest.mock('../../../telemetry', () => ({
  trackEvent: jest.fn()
}));

describe('PatchPanel Branch Request Handling', () => {
  let extensionUri: vscode.Uri;
  let mockWebviewPanel: any;
  let mockWebview: any;
  let mockOutputChannel: any;
  let panel: PatchPanel;
  let messageHandler: Function;
  
  beforeEach(() => {
    jest.resetAllMocks();
    
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
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mockOutputChannel);
    
    // Mock URI joinPath
    (vscode.Uri.joinPath as jest.Mock).mockImplementation((uri, ...paths) => {
      return {
        fsPath: uri.fsPath + '/' + paths.join('/'),
        with: jest.fn().mockReturnValue({
          fsPath: uri.fsPath + '/' + paths.join('/'),
          toString: jest.fn()
        })
      } as unknown as vscode.Uri;
    });
    
    // Mock commands
    (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, ...args) => {
      if (command === 'patchPilot.createBranch') {
        if (args[0] === 'failing-branch') {
          return Promise.reject(new Error('Failed to create branch'));
        }
        return Promise.resolve(args[0] || 'default-branch');
      }
      return Promise.resolve();
    });
    
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
  
  test('should handle createBranchRequest message with branch name', async () => {
    // Call the handler with a createBranchRequest message
    await messageHandler({
      command: 'createBranchRequest',
      branchName: 'feature-branch'
    });
    
    // Should execute the createBranch command
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'patchPilot.createBranch',
      'feature-branch'
    );
    
    // Should send success message back to webview
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'branchCreated',
        branchName: 'feature-branch'
      })
    );
    
    // Should track the action
    expect(trackEvent).toHaveBeenCalledWith(
      'webview_action',
      expect.objectContaining({ action: 'createBranch' })
    );
  });
  
  test('should handle createBranchRequest message without branch name', async () => {
    // Call the handler without a branch name
    await messageHandler({
      command: 'createBranchRequest'
    });
    
    // Should execute the createBranch command with undefined
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'patchPilot.createBranch',
      undefined
    );
    
    // Should send success message back to webview
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'branchCreated',
        branchName: 'default-branch'
      })
    );
  });
  
  test('should handle branch creation failure', async () => {
    // Call the handler with a branch name that will cause failure
    await messageHandler({
      command: 'createBranchRequest',
      branchName: 'failing-branch'
    });
    
    // Should execute the createBranch command
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'patchPilot.createBranch',
      'failing-branch'
    );
    
    // Should show error message
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create branch')
    );
    
    // Should send error message back to webview
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'branchError',
        error: expect.stringContaining('Failed to create branch')
      })
    );
    
    // Should track the error
    expect(trackEvent).toHaveBeenCalledWith(
      'branch_error',
      expect.objectContaining({
        error: expect.stringContaining('Failed to create branch')
      })
    );
  });
  
  test('should handle any error type during branch creation', async () => {
    // Override the executeCommand mock for this test
    (vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce('String error');
    
    // Call the handler
    await messageHandler({
      command: 'createBranchRequest',
      branchName: 'test-branch'
    });
    
    // Should send error message back to webview with string error
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'branchError',
        error: expect.stringContaining('String error')
      })
    );
  });
  
  test('should re-enable the create branch button after success', async () => {
    // Call the handler
    await messageHandler({
      command: 'createBranchRequest',
      branchName: 'test-branch'
    });
    
    // Should send success message back to webview
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'branchCreated',
        branchName: 'test-branch'
      })
    );
  });
  
  test('should re-enable the create branch button after failure', async () => {
    // Call the handler with a branch name that will cause failure
    await messageHandler({
      command: 'createBranchRequest',
      branchName: 'failing-branch'
    });
    
    // Should send error message back to webview
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'branchError',
        error: expect.stringContaining('Failed to create branch')
      })
    );
  });
});