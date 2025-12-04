// src/test/unit/applyPatch.test.ts
import { applyPatch, applyPatchToContent, parsePatchStats, parseUnifiedDiff } from '../../applyPatch';
import { PatchStrategyFactory, PatchStrategy } from '../../strategies/patchStrategy';
import * as vscode from 'vscode';
import * as DiffLib from 'diff';
import { createMockDocument, createMockParsedPatch } from '../setup/test-utils';
import { autoStageFiles } from '../../git';
import {
  WELL_FORMED_DIFF,
  NEW_FOLDER_DIFF,
  MULTI_FILE_DIFF,
  MISSING_HEADER_DIFF,
  MISSING_SPACES_DIFF,
  SHIFTED_CONTEXT_DIFF,
  SAMPLE_FILE_CONTENT
} from '../fixtures/sample-diffs';
import * as utilities from '../../utilities';

// Mock dependencies
jest.mock('../../telemetry', () => ({
  trackEvent: jest.fn()
}));
jest.mock('../../git', () => ({
  autoStageFiles: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../strategies/patchStrategy', () => {
  // Create actual mock implementations of strategies for realistic testing
  const mockStrictStrategy = {
    name: 'strict',
    apply: jest.fn()
  };
  
  const mockShiftedStrategy = {
    name: 'shifted',
    apply: jest.fn()
  };
  
  const mockGreedyStrategy = {
    name: 'greedy',
    apply: jest.fn()
  };
  
  const mockChainedStrategy = {
    name: 'chained',
    apply: jest.fn()
  };
  
  return {
    PatchStrategyFactory: {
      createDefaultStrategy: jest.fn().mockImplementation((fuzz) => {
        mockStrictStrategy.apply.mockReset();
        mockShiftedStrategy.apply.mockReset();
        mockGreedyStrategy.apply.mockReset();
        mockChainedStrategy.apply.mockReset();
        
        return {
          name: 'chained',
          apply: mockChainedStrategy.apply
        };
      })
    },
    StrictStrategy: jest.fn().mockImplementation(() => mockStrictStrategy),
    ShiftedHeaderStrategy: jest.fn().mockImplementation(() => mockShiftedStrategy),
    GreedyStrategy: jest.fn().mockImplementation(() => mockGreedyStrategy),
    ChainedPatchStrategy: jest.fn().mockImplementation(() => mockChainedStrategy)
  };
});

// Mock PatchParser
jest.mock('../../patch/PatchParser', () => ({
  parsePatch: jest.fn(),
  extractFilePath: jest.fn(),
  resolveWorkspaceFile: jest.fn()
}));

// Mock PatchSession
jest.mock('../../patch/PatchSession', () => ({
  addToPatchQueue: jest.fn(),
  processNextPatch: jest.fn(),
  clearPatchQueue: jest.fn()
}));

describe('Apply Patch Module', () => {
  const fileUri = vscode.Uri.file('/workspace/src/file.ts');
  const file1Uri = vscode.Uri.file('/workspace/src/file1.ts');
  const file2Uri = vscode.Uri.file('/workspace/src/file2.ts');
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Define workspace folders
    (vscode.workspace.workspaceFolders as any) = [
      { uri: vscode.Uri.file('/workspace') }
    ];
    
    // Set up default mocks
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockImplementation((key, defaultValue) => {
        if (key === 'autoStage') {return false;}
        if (key === 'fuzzFactor') {return 2;}
        return defaultValue;
      })
    });
    
    // Mock filesystem operations to make files exist
    // Reset fs.stat to clear any lingering mockResolvedValueOnce from previous tests
    (vscode.workspace.fs.stat as jest.Mock).mockReset();
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ 
      type: vscode.FileType.File,
      mtime: Date.now()
    });
    (vscode.workspace.fs.createDirectory as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    (vscode.workspace.fs.writeFile as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    
    // Reset findFiles to ensure clean state
    (vscode.workspace.findFiles as jest.Mock).mockReset();

    // Ensure autoStageFiles is a mock
    (autoStageFiles as jest.Mock).mockClear();
    
    // Create a mock document
    const mockDoc = createMockDocument(SAMPLE_FILE_CONTENT, fileUri);
    
    // Mock workspace open text document
    (vscode.workspace.openTextDocument as jest.Mock).mockImplementation((uri) => {
      return Promise.resolve(mockDoc);
    });
    
    // Mock registerTextDocumentContentProvider
    (vscode.workspace.registerTextDocumentContentProvider as jest.Mock).mockReturnValue({
      dispose: jest.fn()
    });
    
    // Mock commands.executeCommand for diff preview
    (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, ...args) => {
      return Promise.resolve();
    });
    
    // Mock applyPatch success for most tests
    (PatchStrategyFactory.createDefaultStrategy as jest.Mock)().apply.mockReturnValue({
      success: true,
      patched: 'patched content',
      strategy: 'test-strategy'
    });
    
    // Setup default mocks for PatchParser
    const PatchParser = require('../../patch/PatchParser');
    PatchParser.parsePatch.mockReturnValue([createMockParsedPatch()]);
    PatchParser.extractFilePath.mockReturnValue('src/file.ts');
    PatchParser.resolveWorkspaceFile.mockResolvedValue({ uri: fileUri, isNew: false });
    
    // Setup default mocks for PatchSession
    const PatchSession = require('../../patch/PatchSession');
    PatchSession.processNextPatch.mockResolvedValue(undefined);
  });

  describe('applyPatchToContent', () => {
    it('should use the strategy factory with the specified fuzz factor', async () => {
      const mockStrategy = {
        apply: jest.fn().mockReturnValue({ 
          success: true, 
          patched: 'patched with mock',
          strategy: 'mock-strategy'
        })
      };
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock).mockReturnValue(mockStrategy);
      
      const content = 'original content';
      const patch = createMockParsedPatch();
      const fuzz = 3 as const;
      
      const result = await applyPatchToContent(content, patch, fuzz);
      
      expect(PatchStrategyFactory.createDefaultStrategy).toHaveBeenCalledWith(fuzz);
      expect(mockStrategy.apply).toHaveBeenCalledWith(content, patch);
      expect(result).toEqual({
        success: true,
        patched: 'patched with mock',
        strategy: 'mock-strategy'
      });
    });
    
    it('should return failure result when all strategies fail', async () => {
      const mockStrategy = {
        apply: jest.fn().mockReturnValue({ 
          success: false, 
          patched: 'original content',
          strategy: undefined
        })
      };
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock).mockReturnValue(mockStrategy);
      
      const content = 'original content';
      const patch = createMockParsedPatch();
      
      const result = await applyPatchToContent(content, patch, 2);
      
      expect(result.success).toBe(false);
      expect(result.patched).toBe('original content');
      expect(result.strategy).toBeUndefined();
    });
  });

  describe('parsePatchStats', () => {
    it('should parse a patch into file info objects', async () => {
      const PatchParser = require('../../patch/PatchParser');
      PatchParser.parsePatch.mockReturnValueOnce([
        createMockParsedPatch({
          oldFileName: 'a/src/file1.ts',
          newFileName: 'b/src/file1.ts'
        })
      ]);
      PatchParser.extractFilePath.mockReturnValue('src/file1.ts');
      PatchParser.resolveWorkspaceFile.mockResolvedValue({ uri: file1Uri, isNew: false });
      
      const fileInfo = await parsePatchStats(MULTI_FILE_DIFF);
      // Should have info for the file

      expect(fileInfo).toHaveLength(1);
      
      // First file should exist in workspace (we mocked it above)
      expect(fileInfo[0]).toMatchObject({
        filePath: 'src/file1.ts',
        exists: true,
        hunks: 1
      });
    });
    
    it('should correctly count additions and deletions', async () => {
      // Create a patch with known additions and deletions
      const mockPatch = createMockParsedPatch({
        hunks: [{
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          lines: [
            ' context line',
            '-deleted line 1',
            '-deleted line 2',
            '+added line 1',
            '+added line 2',
            '+added line 3',
            ' context line'
          ]
        }]
      });
      
      const PatchParser = require('../../patch/PatchParser');
      PatchParser.parsePatch.mockReturnValueOnce([mockPatch]);
      
      const fileInfo = await parsePatchStats(WELL_FORMED_DIFF);
      
      expect(fileInfo[0].changes).toMatchObject({
        additions: 3,
        deletions: 2
      });
    });
  });

  describe('applyPatch', () => {
    it('should not add diff headers to original file content (Bug Fix)', async () => {
      // This test ensures that we use normalizeLineEndings instead of normalizeDiff on file content
      const normalizeDiffSpy = jest.spyOn(utilities, 'normalizeDiff');
      const normalizeLineEndingsSpy = jest.spyOn(utilities, 'normalizeLineEndings');
      
      // Setup mocks
      const PatchParser = require('../../patch/PatchParser');
      PatchParser.parsePatch.mockReturnValue([createMockParsedPatch()]);
      PatchParser.extractFilePath.mockReturnValue('src/file.ts');
      PatchParser.resolveWorkspaceFile.mockResolvedValue({ uri: fileUri, isNew: false });
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

      await applyPatch(WELL_FORMED_DIFF, { preview: false });

      // normalizeDiff should be called on the PATCH text
      expect(normalizeDiffSpy).toHaveBeenCalledWith(expect.stringContaining('diff --git'));
      
      // normalizeLineEndings should be called on the FILE content
      // We can't easily check the exact arguments passed to the spy in this complex flow,
      // but we can verify that the strategy received content WITHOUT headers.
      // The mock strategy was called with (content, patch).
      const mockStrategy = (PatchStrategyFactory.createDefaultStrategy as jest.Mock)();
      const calledContent = mockStrategy.apply.mock.calls[0][0];
      
      expect(calledContent).not.toContain('diff --git');
      expect(calledContent).toContain('import React');
    });

    it('should accept pre-parsed patch objects (Optimization)', async () => {
      const parsedPatch = parseUnifiedDiff(WELL_FORMED_DIFF);
      const PatchParser = require('../../patch/PatchParser');
      
      // Reset the spy to ensure we don't re-parse
      const parseSpy = jest.spyOn(PatchParser, 'parsePatch');
      parseSpy.mockClear();

      await applyPatch(parsedPatch, { preview: false });

      // Should NOT call parsePatch again because we passed objects
      expect(parseSpy).not.toHaveBeenCalled();
    });

    it('should apply a valid patch with preview', async () => {
      // Mock successful patch application
      const mockStrategy = {
        apply: jest.fn().mockReturnValue({ 
          success: true, 
          patched: 'patched content',
          strategy: 'test-strategy'
        })
      };
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock).mockReturnValue(mockStrategy);
      
      const PatchParser = require('../../patch/PatchParser');
      PatchParser.parsePatch.mockReturnValue([createMockParsedPatch()]);
      PatchParser.extractFilePath.mockReturnValue('src/nonexistent.ts');
      PatchParser.resolveWorkspaceFile.mockResolvedValue({ uri: fileUri, isNew: false });
      
      // Ensure applyEdit succeeds
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);
      
      // User confirms the preview
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Apply');
            
      const PatchSession = require('../../patch/PatchSession');
      
      const results = await applyPatch(WELL_FORMED_DIFF, { preview: true });
      
      // Should add to queue
      expect(PatchSession.addToPatchQueue).toHaveBeenCalled();
      expect(PatchSession.processNextPatch).toHaveBeenCalled();
      
      // Should have one result for the single file
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        file: 'src/nonexistent.ts',
        status: 'applied',
        strategy: 'test-strategy' // From our mock strategy
      });
    });
    
    it('should create parent directory when applying patch to a new file', async () => {
      // Mock successful patch application      
      const mockStrategy = {
        apply: jest.fn().mockReturnValue({ 
          success: true, 
          patched: 'new file content',
          strategy: 'test-strategy'
        })
      };
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock).mockReturnValue(mockStrategy);
      
      const PatchParser = require('../../patch/PatchParser');
      PatchParser.extractFilePath.mockReturnValue('src/components/NewComponent.tsx');
      PatchParser.resolveWorkspaceFile.mockResolvedValue({ uri: fileUri, isNew: true });
      
      const results = await applyPatch(NEW_FOLDER_DIFF, { preview: false });

      expect(results[0].status).toBe('applied');
      
      // Verify createDirectory was called
      expect(vscode.workspace.fs.createDirectory).toHaveBeenCalled();
      
      // Verify writeFile was called
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
    });

    it('should apply without preview when preview is false', async () => {
      // Mock successful patch application
      const mockStrategy = {
        apply: jest.fn().mockReturnValue({ 
          success: true, 
          patched: 'patched content',
          strategy: 'test-strategy'
        })
      };
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock).mockReturnValue(mockStrategy);
      
      
      // Ensure applyEdit succeeds
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);
      
      const PatchSession = require('../../patch/PatchSession');
      
      const results = await applyPatch(WELL_FORMED_DIFF, { preview: false });
      
      // Should NOT add to queue
      expect(PatchSession.addToPatchQueue).not.toHaveBeenCalled();
      
      // Should have one successful result
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('applied');
      
      // Verify we DID NOT show a preview - should not call executeCommand for vscode.diff
      expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('vscode.diff', expect.anything(), expect.anything(), expect.anything());
    });
    
    it('should auto-stage files when configured', async () => {
      // Configure autoStage
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((key) => key === 'autoStage' ? true : 2)
      });
      
      // Mock successful patch application
      const mockStrategy = {
        apply: jest.fn().mockReturnValue({ 
          success: true, 
          patched: 'patched content',
          strategy: 'test-strategy'
        })
      };
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock).mockReturnValue(mockStrategy);
      
      
      // Ensure applyEdit succeeds
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);
      const results = await applyPatch(WELL_FORMED_DIFF, { autoStage: true, preview: false });
      
      // Verify patch was applied successfully
      expect(results[0].status).toBe('applied');
      
      // Should have auto-staged the file
      expect(autoStageFiles).toHaveBeenCalledWith(['src/file.ts']);
    });

    it('should detect file modification during patch application when mtimeCheck is enabled', async () => {
        // Reset mocks first
        jest.clearAllMocks();
        
        // Setup to capture all fs.stat calls
        const mockStatFunction = jest.fn();
        
        // First call (in resolveWorkspaceFile) - file exists
        mockStatFunction.mockResolvedValueOnce({ type: vscode.FileType.File });
        
        // Second call (our initial mtime check) - initial timestamp 
        mockStatFunction.mockResolvedValueOnce({ mtime: 1000 });
        
        // Third call (our verification check) - changed timestamp
        mockStatFunction.mockResolvedValueOnce({ mtime: 2000 });
        
        // Override the vscode.workspace.fs.stat mock
        (vscode.workspace.fs.stat as jest.Mock) = mockStatFunction;
        
        // Mock UI to simulate user cancelling the overwrite
        (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Cancel');
        
        // Mock patch application
        (PatchStrategyFactory.createDefaultStrategy as jest.Mock)().apply.mockReturnValue({
          success: true,
          patched: 'patched content',
          strategy: 'test-strategy'
        });
        
        const PatchParser = require('../../patch/PatchParser');
        PatchParser.parsePatch.mockReturnValue([createMockParsedPatch()]);
        PatchParser.extractFilePath.mockReturnValue('src/file.ts');
        PatchParser.resolveWorkspaceFile.mockResolvedValue({ uri: fileUri, isNew: false });
        
        // Apply with mtimeCheck enabled
        const results = await applyPatch(WELL_FORMED_DIFF, { 
          preview: false,
          mtimeCheck: true 
        });
        
        // Verify stat was called exactly 3 times (resolveFile, initial check, changed check)
        // Note: resolveWorkspaceFile is mocked in PatchParser, so we only see 2 calls here
        expect(mockStatFunction).toHaveBeenCalledTimes(2);
        
        // Should have failed due to mtime change
        expect(results[0]).toMatchObject({
          file: 'src/file.ts',
          status: 'failed',
          reason: 'File modified externally, update aborted'
        });
      });
    
    it('should handle error when creating new file fails', async () => {
      // Setup: File does not exist in workspace (fuzzy search fails)
      const PatchParser = require('../../patch/PatchParser');
      PatchParser.extractFilePath.mockReturnValue('src/file.ts');
      PatchParser.resolveWorkspaceFile.mockResolvedValue({ uri: fileUri, isNew: true });
      
      // Setup: createDirectory fails
      (vscode.workspace.fs.createDirectory as jest.Mock).mockRejectedValue(new Error('Permission denied'));
      
      const results = await applyPatch(WELL_FORMED_DIFF, { preview: false });
      
      // Should have one failed result
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        file: 'src/file.ts',
        status: 'failed',
        reason: 'Permission denied'
      });
    });
    
    it('should handle patch application failure', async () => {
      // Make the strategy fail for this test only
      const failStrategy = {
        apply: jest.fn().mockReturnValue({ 
          success: false, 
          patched: 'original',
          strategy: undefined
        })
      };
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock).mockReturnValue(failStrategy);
      
      
      const results = await applyPatch(WELL_FORMED_DIFF);
      
      // Should have one failed result
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        file: 'src/file.ts',
        status: 'failed',
        reason: 'Patch could not be applied'
      });
    });
    
    it('should handle workspace edit failure', async () => {
      // Mock successful patch strategy
      const mockStrategy = {
        apply: jest.fn().mockReturnValue({ 
          success: true, 
          patched: 'patched content',
          strategy: 'test-strategy'
        })
      };
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock).mockReturnValue(mockStrategy);
      
      
      // Make applyEdit fail for this test only
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(false);
      
      // User confirms the preview
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Apply');
      const results = await applyPatch(WELL_FORMED_DIFF, { preview: false });
      
      // Should have one failed result
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        file: 'src/file.ts',
        status: 'failed',
        reason: 'Workspace edit failed'
      });
    });
    
    it('should throw an error for invalid patch', async () => {
      // Make parsePatch return empty array for this test only
      const PatchParser = require('../../patch/PatchParser');
      PatchParser.parsePatch.mockReturnValueOnce([]);
      
      await expect(applyPatch('not a valid patch')).rejects
        .toThrow('No valid patches found in the provided text.');
    });
    
    it('should save dirty documents after patching', async () => {
      // Set up a mock document that's marked as dirty after editing
      const mockDirtyDoc = createMockDocument(SAMPLE_FILE_CONTENT, fileUri);
      Object.defineProperty(mockDirtyDoc, 'isDirty', {
        get: jest.fn().mockReturnValue(true)
      });
      mockDirtyDoc.save = jest.fn().mockResolvedValue(true);
      
      // Return our dirty document mock
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDirtyDoc);
      
      // Mock successful patch and other requirements
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock)().apply.mockReturnValue({
        success: true,
        patched: 'patched content',
        strategy: 'test-strategy'
      });
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);
      
      // Apply the patch without preview
      await applyPatch(WELL_FORMED_DIFF, { preview: false });
      
      // The document should have been saved
      expect(mockDirtyDoc.save).toHaveBeenCalled();
    });
  });
  
  describe('Integration with different diff types', () => {
    // Setup for these tests
    beforeEach(() => {
      const PatchParser = require('../../patch/PatchParser');
      PatchParser.parsePatch.mockReturnValue([createMockParsedPatch()]);
      PatchParser.extractFilePath.mockReturnValue('src/file.ts');
      PatchParser.resolveWorkspaceFile.mockResolvedValue({ uri: fileUri, isNew: false });
      
      // Mock patch application to always succeed
      (PatchStrategyFactory.createDefaultStrategy as jest.Mock)().apply.mockReturnValue({
        success: true,
        patched: 'patched content',
        strategy: 'test-strategy'
      });
      
      // Mock editor operations
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);
    });
    
    it('should correctly process a well-formed diff', async () => {
      await applyPatch(WELL_FORMED_DIFF, { preview: false });
      
      // Verify the diff was parsed with DiffLib
      const PatchParser = require('../../patch/PatchParser');
      expect(PatchParser.parsePatch).toHaveBeenCalled();
      
      // Should have succeeded
      expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    });
    
    it('should correctly process a diff with missing headers', async () => {
      await applyPatch(MISSING_HEADER_DIFF, { preview: false });
      
      // Should still succeed
      expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    });
    
    it('should correctly process a diff with missing spaces', async () => {
      await applyPatch(MISSING_SPACES_DIFF, { preview: false });
      
      // Should still succeed
      expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    });
    
    it('should correctly process a diff with shifted context', async () => {
      await applyPatch(SHIFTED_CONTEXT_DIFF, { preview: false });
      
      // Should still succeed
      expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    });
  });
});