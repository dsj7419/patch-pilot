// src/test/integration/commands/commands.test.ts
import * as vscode from 'vscode';
import { activate } from '../../../extension';
import { PatchPanel } from '../../../PatchPanel';
import { applyPatch, parsePatch } from '../../../applyPatch';
import { createTempBranch } from '../../../git';
import { WELL_FORMED_DIFF } from '../../fixtures/sample-diffs';

// Mock dependencies
jest.mock('vscode');
jest.mock('../../../PatchPanel');
jest.mock('../../../applyPatch');
jest.mock('../../../git');
jest.mock('../../../telemetry', () => ({
  initTelemetry: jest.fn().mockResolvedValue(undefined),
  trackEvent: jest.fn()
}));

describe('Extension Commands', () => {
  let context: vscode.ExtensionContext;
  let mockOutputChannel: any;
  let mockStatusBarItem: any;
  
  beforeEach(() => {
    jest.resetAllMocks();
    
    // Create a proper mock for the output channel
    mockOutputChannel = {
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    };
    
    // Create a proper mock for the status bar item
    mockStatusBarItem = {
      text: '',
      tooltip: '',
      command: '',
      backgroundColor: undefined,
      color: undefined,
      priority: 0,
      alignment: vscode.StatusBarAlignment.Right,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    };
    
    // Make sure createOutputChannel returns our mock
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mockOutputChannel);
    
    // Make sure createStatusBarItem returns our mock
    (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(mockStatusBarItem);
    
    // Define ExtensionKind enum if it doesn't exist in the mock
    if (!vscode.ExtensionKind) {
      (vscode as any).ExtensionKind = {
        UI: 1,
        Workspace: 2
      };
    }
    
    // Define StatusBarAlignment enum if it doesn't exist in the mock
    if (!vscode.StatusBarAlignment) {
      (vscode as any).StatusBarAlignment = {
        Left: 1,
        Right: 2
      };
    }
    
    // Mock EnvironmentVariableCollection implementation
    const mockEnvironmentCollection = {
      persistent: false,
      replace: jest.fn(),
      append: jest.fn(),
      prepend: jest.fn(),
      get: jest.fn(),
      forEach: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      getScoped: jest.fn(() => mockEnvironmentCollection),
      description: undefined,
      // Implement Symbol.iterator
      [Symbol.iterator]: jest.fn(function* () {
        // This is an empty generator function to satisfy the iterable interface
        yield* [];
      })
    };
    
    // Create a mock extension context
    context = {
      subscriptions: [],
      extensionUri: { fsPath: '/extension/path' } as any,
      extensionPath: '/extension/path',
      globalState: {
        get: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        keys: jest.fn().mockResolvedValue([]),
        setKeysForSync: jest.fn()
      },
      workspaceState: {
        get: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        keys: jest.fn().mockResolvedValue([])
      },
      secrets: {
        get: jest.fn(),
        store: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        onDidChange: jest.fn()
      },
      extensionMode: 1,
      logUri: { fsPath: '/logs' } as any,
      storageUri: { fsPath: '/storage' } as any,
      globalStorageUri: { fsPath: '/globalStorage' } as any,
      logPath: '/logs',
      storagePath: '/storage',
      globalStoragePath: '/globalStorage',
      asAbsolutePath: jest.fn(path => `/extension/path/${path}`),
      // Add the correct environment variable collection
      environmentVariableCollection: mockEnvironmentCollection,
      // Add extension property
      extension: {
        id: 'mock-extension-id',
        extensionUri: { fsPath: '/extension/path' } as any,
        extensionPath: '/extension/path',
        isActive: true,
        packageJSON: {},
        extensionKind: vscode.ExtensionKind.UI,
        exports: undefined,
        activate: jest.fn().mockResolvedValue(undefined)
      }
    } as unknown as vscode.ExtensionContext;
    
    // Setup commands mock
    (vscode.commands.registerCommand as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    
    // Setup workspace mock
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockImplementation((key, defaultValue) => {
        if (key === 'autoStage') {return false;}
        if (key === 'fuzzFactor') {return 2;}
        return defaultValue;
      }),
      update: jest.fn().mockResolvedValue(undefined)
    });
  });

  describe('Extension Activation', () => {
    it('should register all commands on activation', async () => {
      await activate(context);
      
      // Verify all commands are registered
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'patchPilot.pasteDiff',
        expect.any(Function)
      );
      
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'patchPilot.applyPatch',
        expect.any(Function)
      );
      
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'patchPilot.parsePatch',
        expect.any(Function)
      );
      
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'patchPilot.createBranch',
        expect.any(Function)
      );
      
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'patchPilot.applySelectedDiff',
        expect.any(Function)
      );
      
      // Verify status bar item is created
      expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
      
      // Verify all disposables are added to subscriptions
      expect(context.subscriptions.length).toBeGreaterThan(0);
    });
  });

  describe('pasteDiff Command', () => {
    it('should create or show PatchPanel when invoked', async () => {
      await activate(context);
      
      // Get the pasteDiff command handler
      const pasteDiffHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.pasteDiff'
      )[1];
      
      // Call the handler
      pasteDiffHandler();
      
      // Verify PatchPanel.createOrShow was called
      expect(PatchPanel.createOrShow).toHaveBeenCalledWith(context.extensionUri);
    });
  });

  describe('applyPatch Command', () => {
    it('should call applyPatch with provided text and options', async () => {
      // Setup applyPatch mock
      (applyPatch as jest.Mock).mockResolvedValue([
        { file: 'file.ts', status: 'applied', strategy: 'strict' }
      ]);
      
      await activate(context);
      
      // Get the applyPatch command handler
      const applyPatchHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.applyPatch'
      )[1];
      
      // Call the handler
      const result = await applyPatchHandler(WELL_FORMED_DIFF, { preview: false });
      
      // Verify applyPatch was called with correct arguments
      expect(applyPatch).toHaveBeenCalledWith(WELL_FORMED_DIFF, { preview: false });
      
      // Verify result is returned
      expect(result).toEqual([
        { file: 'file.ts', status: 'applied', strategy: 'strict' }
      ]);
    });
  });

  describe('parsePatch Command', () => {
    it('should call parsePatch with provided text', async () => {
      // Setup parsePatch mock
      (parsePatch as jest.Mock).mockResolvedValue([
        { filePath: 'file.ts', exists: true, hunks: 1, changes: { additions: 1, deletions: 1 } }
      ]);
      
      await activate(context);
      
      // Get the parsePatch command handler
      const parsePatchHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.parsePatch'
      )[1];
      
      // Call the handler
      const result = await parsePatchHandler(WELL_FORMED_DIFF);
      
      // Verify parsePatch was called with correct arguments
      expect(parsePatch).toHaveBeenCalledWith(WELL_FORMED_DIFF);
      
      // Verify result is returned
      expect(result).toEqual([
        { filePath: 'file.ts', exists: true, hunks: 1, changes: { additions: 1, deletions: 1 } }
      ]);
    });
  });

  describe('createBranch Command', () => {
    it('should call createTempBranch with provided name', async () => {
      // Setup createTempBranch mock
      (createTempBranch as jest.Mock).mockResolvedValue('custom-branch');
      
      await activate(context);
      
      // Get the createBranch command handler
      const createBranchHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.createBranch'
      )[1];
      
      // Call the handler
      const result = await createBranchHandler('custom-branch');
      
      // Verify createTempBranch was called with correct arguments
      expect(createTempBranch).toHaveBeenCalledWith('custom-branch');
      
      // Verify result is returned
      expect(result).toBe('custom-branch');
    });
  });

  describe('applySelectedDiff Command', () => {
    it('should apply selected text as a patch', async () => {
      // Setup active editor mock
      (vscode.window.activeTextEditor as any) = {
        selection: {
          isEmpty: false
        },
        document: {
          getText: jest.fn().mockReturnValue(WELL_FORMED_DIFF)
        }
      };
      
      // Setup applyPatch mock
      (applyPatch as jest.Mock).mockResolvedValue([
        { file: 'file.ts', status: 'applied', strategy: 'strict' }
      ]);
      
      await activate(context);
      
      // Get the applySelectedDiff command handler
      const applySelectedDiffHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.applySelectedDiff'
      )[1];
      
      // Call the handler
      await applySelectedDiffHandler();
      
      // Verify applyPatch was called with selected text
      expect(applyPatch).toHaveBeenCalledWith(
        WELL_FORMED_DIFF,
        expect.objectContaining({
          preview: true,
          fuzz: 2
        })
      );
      
      // Verify success message was shown
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Successfully applied patches to 1 file(s).'
      );
    });

    it('should show error when no active editor', async () => {
      // Setup no active editor
      (vscode.window.activeTextEditor as any) = undefined;
      
      await activate(context);
      
      // Get the applySelectedDiff command handler
      const applySelectedDiffHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.applySelectedDiff'
      )[1];
      
      // Call the handler
      await applySelectedDiffHandler();
      
      // Verify error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'No active editor found'
      );
    });

    it('should show error when no text selected', async () => {
      // Setup active editor with empty selection
      (vscode.window.activeTextEditor as any) = {
        selection: {
          isEmpty: true
        }
      };
      
      await activate(context);
      
      // Get the applySelectedDiff command handler
      const applySelectedDiffHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.applySelectedDiff'
      )[1];
      
      // Call the handler
      await applySelectedDiffHandler();
      
      // Verify error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'No text selected'
      );
    });
    
    it('should handle apply patch errors', async () => {
      // Setup active editor mock
      (vscode.window.activeTextEditor as any) = {
        selection: {
          isEmpty: false
        },
        document: {
          getText: jest.fn().mockReturnValue(WELL_FORMED_DIFF)
        }
      };
      
      // Setup applyPatch to throw error
      (applyPatch as jest.Mock).mockRejectedValue(new Error('Test error'));
      
      await activate(context);
      
      // Get the applySelectedDiff command handler
      const applySelectedDiffHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.applySelectedDiff'
      )[1];
      
      // Call the handler
      await applySelectedDiffHandler();
      
      // Verify error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to apply patch: Test error'
      );
    });
    
    it('should show warning when some patches fail', async () => {
      // Setup active editor mock
      (vscode.window.activeTextEditor as any) = {
        selection: {
          isEmpty: false
        },
        document: {
          getText: jest.fn().mockReturnValue(WELL_FORMED_DIFF)
        }
      };
      
      // Setup applyPatch with mixed results
      (applyPatch as jest.Mock).mockResolvedValue([
        { file: 'file1.ts', status: 'applied', strategy: 'strict' },
        { file: 'file2.ts', status: 'failed', reason: 'File not found' }
      ]);
      
      await activate(context);
      
      // Get the applySelectedDiff command handler
      const applySelectedDiffHandler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
        call => call[0] === 'patchPilot.applySelectedDiff'
      )[1];
      
      // Call the handler
      await applySelectedDiffHandler();
      
      // Verify warning message was shown
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Applied 1 patch(es), 1 failed. Check output for details.'
      );
      
      // Verify output was shown
      expect(mockOutputChannel.appendLine).toHaveBeenCalled();
      expect(mockOutputChannel.show).toHaveBeenCalled();
    });
  });
});