/* --------------------------------------------------------------------------
 *  PatchPilot — Unit tests for PatchParser
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as DiffLib from 'diff';
import { parsePatch, extractFilePath, resolveWorkspaceFile } from '../../../patch/PatchParser';
import { createMockParsedPatch } from '../../setup/test-utils';
import { MULTI_FILE_DIFF, WELL_FORMED_DIFF } from '../../fixtures/sample-diffs';

// Mock dependencies
jest.mock('vscode');
jest.mock('diff');

describe('PatchParser Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup workspace folders
    (vscode.workspace.workspaceFolders as any) = [
      { uri: vscode.Uri.file('/workspace') }
    ];
    
    // Mock fs.stat
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
    
    // Mock findFiles
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
    
    // Mock URI joinPath
    (vscode.Uri.joinPath as jest.Mock).mockImplementation((base, ...paths) => {
      return vscode.Uri.file(`${base.fsPath}/${paths.join('/')}`);
    });
  });

  describe('parsePatch', () => {
    it('should delegate to DiffLib.parsePatch', () => {
      const mockResult = [createMockParsedPatch()];
      (DiffLib.parsePatch as jest.Mock).mockReturnValue(mockResult);
      
      const result = parsePatch(WELL_FORMED_DIFF);
      
      expect(DiffLib.parsePatch).toHaveBeenCalledWith(WELL_FORMED_DIFF);
      expect(result).toBe(mockResult);
    });
  });

  describe('extractFilePath', () => {
    it('should extract the new file path if available', () => {
      const patch = createMockParsedPatch({
        oldFileName: 'a/src/old.ts',
        newFileName: 'b/src/new.ts'
      });
      
      expect(extractFilePath(patch)).toBe('src/new.ts');
    });

    it('should extract the old file path if new is /dev/null', () => {
      const patch = createMockParsedPatch({
        oldFileName: 'a/src/file.ts',
        newFileName: '/dev/null'
      });
      
      expect(extractFilePath(patch)).toBe('src/file.ts');
    });

    it('should return undefined if both paths are missing or /dev/null', () => {
      const patch = createMockParsedPatch({
        oldFileName: '/dev/null',
        newFileName: '/dev/null'
      });
      
      expect(extractFilePath(patch)).toBeUndefined();
    });

    it('should handle git prefixes correctly', () => {
      const patch = createMockParsedPatch({
        oldFileName: 'a/long/path/to/file.ts',
        newFileName: 'b/long/path/to/file.ts'
      });
      
      expect(extractFilePath(patch)).toBe('long/path/to/file.ts');
    });
  });

  describe('resolveWorkspaceFile', () => {
    it('should resolve exact path match', async () => {
      const result = await resolveWorkspaceFile('src/file.ts', false);
      
      expect(result.isNew).toBe(false);
      expect(result.uri.fsPath).toContain('/workspace/src/file.ts');
    });

    it('should use fuzzy search if exact match fails', async () => {
      // Fail exact match
      (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('File not found'));
      
      // Succeed fuzzy search
      const fuzzyUri = vscode.Uri.file('/workspace/src/fuzzy/file.ts');
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([fuzzyUri]);
      
      const result = await resolveWorkspaceFile('src/file.ts', false);
      
      expect(result.isNew).toBe(false);
      expect(result.uri).toBe(fuzzyUri);
    });

    it('should return new file if not found', async () => {
      (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('File not found'));
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
      
      const result = await resolveWorkspaceFile('src/new-file.ts', false);
      
      expect(result.isNew).toBe(true);
      expect(result.uri.fsPath).toContain('/workspace/src/new-file.ts');
    });

    it('should correctly resolve path for a new file from patch without searching', async () => {
      // Simulate file not found
      (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('File not found'));
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

      const newFilePath = 'src/components/NewFile.ts';
      // The `true` flag indicates the caller knows this is a new file from the patch.
      const result = await resolveWorkspaceFile(newFilePath, true);

      expect(result.isNew).toBe(true);
      // The path should be correctly joined with the workspace root
      expect(result.uri.fsPath).toBe(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, newFilePath).fsPath);
    });

    it('should use fuzzy search when strictFileSearch is false (default)', async () => {
      // Mock config to return false for strict search
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(false),
      });

      // Simulate exact path not found
      (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('File not found'));

      // Simulate fuzzy search finding the file
      const correctUri = vscode.Uri.file('/workspace/src/actual/path/file.ts');
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([correctUri]);

      // Use a slightly incorrect path that would fail an exact match
      const incorrectPath = 'src/path/file.ts';
      const result = await resolveWorkspaceFile(incorrectPath, false);

      expect(result.isNew).toBe(false);
      expect(result.uri).toBe(correctUri);
      expect(vscode.workspace.findFiles).toHaveBeenCalled();
    });

    it('should NOT use fuzzy search when strictFileSearch is true', async () => {
      // Mock config to return true for strict search
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(true),
      });

      // Simulate exact path not found
      (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('File not found'));

      // This mock should not be called
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

      const incorrectPath = 'src/path/file.ts';
      const result = await resolveWorkspaceFile(incorrectPath, false);

      // Since fuzzy search is off, it should treat this as a new file
      expect(result.isNew).toBe(true);
      // The URI should be based on the provided (incorrect) path, relative to the workspace root
      expect(result.uri.fsPath).toBe(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, incorrectPath).fsPath);
      // Verify fuzzy search was not attempted
      expect(vscode.workspace.findFiles).not.toHaveBeenCalled();
    });
  });
});
