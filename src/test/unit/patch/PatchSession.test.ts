/* --------------------------------------------------------------------------
 *  PatchPilot — Unit tests for PatchSession
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { 
  addToPatchQueue, 
  processNextPatch, 
  clearPatchQueue, 
  pendingPatches,
  QueuedPatch,
  registerSessionCleaner
} from '../../../patch/PatchSession';

// Mock dependencies
jest.mock('vscode', () => {
  return {
    workspace: {
      onDidCloseTextDocument: jest.fn().mockReturnValue({ dispose: jest.fn() })
    },
    window: {
      showInformationMessage: jest.fn(),
      visibleTextEditors: [], // Add this
      showTextDocument: jest.fn() // Add this
    },
    commands: {
      executeCommand: jest.fn()
    },
    Uri: {
      file: (path: string) => ({ 
        path, 
        scheme: 'file',
        with: jest.fn().mockReturnValue({ 
          scheme: 'patchpilot-orig', 
          query: 'new',
          toString: () => `patchpilot-orig:${path}?new`
        }),
        toString: () => `file://${path}`
      }),
      parse: (str: string) => ({ 
        path: str, 
        scheme: 'patchpilot-mod',
        toString: () => str 
      })
    }
  };
});

jest.mock('../../../logger', () => ({
  getOutputChannel: jest.fn().mockReturnValue({
    appendLine: jest.fn()
  })
}));

describe('PatchSession Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPatchQueue();
    pendingPatches.clear();
    
    // Mock timer
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Queue Management', () => {
    it('should add items to queue and process them', async () => {
      const patch: QueuedPatch = {
        fileUri: vscode.Uri.file('/test/file.ts'),
        original: 'original',
        patched: 'patched',
        relPath: 'file.ts',
        isNew: false,
        autoStage: false
      };

      addToPatchQueue(patch);
      
      await processNextPatch();
      
      // Should have called vscode.diff
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.anything(),
        expect.anything(),
        expect.stringContaining('Patch: file.ts'),
        expect.anything()
      );
      
      // Should have added to pendingPatches
      expect(pendingPatches.size).toBe(1);
    });

    it('should handle empty queue', async () => {
      await processNextPatch();
      
      // Should log completion
      const logger = require('../../../logger');
      expect(logger.getOutputChannel().appendLine).toHaveBeenCalledWith(
        expect.stringContaining('All files from patch have been processed')
      );
      
      // Should show info message (after timeout)
      jest.runAllTimers();
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });
  });

  describe('Diff View', () => {
    it('should use special scheme for new files', async () => {
      const patch: QueuedPatch = {
        fileUri: vscode.Uri.file('/test/new.ts'),
        original: '',
        patched: 'content',
        relPath: 'new.ts',
        isNew: true,
        autoStage: false
      };

      addToPatchQueue(patch);
      await processNextPatch();
      
      // Check arguments to vscode.diff
      const callArgs = (vscode.commands.executeCommand as jest.Mock).mock.calls[0];
      const leftUri = callArgs[1] as vscode.Uri;
      
      expect(leftUri.scheme).toBe('patchpilot-orig');
      expect(leftUri.query).toBe('new');
    });
  });

  describe('Session Cleanup', () => {
    it('should remove pending patch when document is closed', () => {
      // Setup mock context
      const subscriptions: any[] = [];
      const context = { subscriptions } as any;
      
      // Register cleaner
      registerSessionCleaner(context);
      
      // Should have added a listener
      expect(subscriptions.length).toBe(1);
      
      // Add a fake pending patch
      const uriString = 'patchpilot-mod://test';
      const uri = vscode.Uri.parse(uriString);
      
      pendingPatches.set(uriString, { 
        targetUri: vscode.Uri.file('/test'), 
        patchedContent: '', 
        autoStage: false 
      });
      
      // Simulate document close
      // We need to get the handler passed to onDidCloseTextDocument
      const handler = (vscode.workspace.onDidCloseTextDocument as jest.Mock).mock.calls[0][0];
      handler({ uri });
      
      expect(pendingPatches.has(uriString)).toBe(false);
    });
  });
});