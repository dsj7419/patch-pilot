// src/test/unit/fileSystem.test.ts

import * as vscode from 'vscode';
import {
  checkFileModification,
  withModificationCheck,
  FileModificationOptions
} from '../../fileSystem';

// Mock dependencies
jest.mock('vscode');

describe('File System Module', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('checkFileModification', () => {
    it('should return unmodified when mtimes match', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Create original stats
      const originalStats = { mtime: 1000 };
      
      // Mock fs.stat to return the same mtime
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ mtime: 1000 });
      
      // Check modification
      const result = await checkFileModification(fileUri, originalStats as vscode.FileStat, {
        mtimeCheck: true,
        promptOnModification: true
      });
      
      // Should not be modified and should proceed
      expect(result.modified).toBe(false);
      expect(result.proceed).toBe(true);
    });
    
    it('should skip check when mtimeCheck is disabled', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Create original stats
      const originalStats = { mtime: 1000 };
      
      // Don't mock fs.stat as it should not be called
      
      // Check modification with mtimeCheck disabled
      const result = await checkFileModification(fileUri, originalStats as vscode.FileStat, {
        mtimeCheck: false,
        promptOnModification: true
      });
      
      // Should not be modified and should proceed
      expect(result.modified).toBe(false);
      expect(result.proceed).toBe(true);
      
      // fs.stat should not have been called
      expect(vscode.workspace.fs.stat).not.toHaveBeenCalled();
    });
    
    it('should detect modification and prompt user when promptOnModification is true', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Create original stats
      const originalStats = { mtime: 1000 };
      
      // Mock fs.stat to return a different mtime
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ mtime: 2000 });
      
      // Mock showWarningMessage to return 'Proceed Anyway'
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('File'),
        expect.anything(),
        'Proceed Anyway',
        'Cancel'
      );;
      
      // Check modification
      const result = await checkFileModification(fileUri, originalStats as vscode.FileStat, {
        mtimeCheck: true,
        promptOnModification: true
      });
      
      // Should be modified and should proceed
      expect(result.modified).toBe(true);
      expect(result.proceed).toBe(true);
      
      // Should have called showWarningMessage
      expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    });
    
    it('should detect modification and not proceed when user cancels', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Create original stats
      const originalStats = { mtime: 1000 };
      
      // Mock fs.stat to return a different mtime
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ mtime: 2000 });
      
      // Mock showWarningMessage to return 'Cancel'
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Cancel');
      
      // Check modification
      const result = await checkFileModification(fileUri, originalStats as vscode.FileStat, {
        mtimeCheck: true,
        promptOnModification: true
      });
      
      // Should be modified and should not proceed
      expect(result.modified).toBe(true);
      expect(result.proceed).toBe(false);
    });
    
    it('should detect modification and not proceed when promptOnModification is false', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Create original stats
      const originalStats = { mtime: 1000 };
      
      // Mock fs.stat to return a different mtime
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ mtime: 2000 });
      
      // Check modification
      const result = await checkFileModification(fileUri, originalStats as vscode.FileStat, {
        mtimeCheck: true,
        promptOnModification: false
      });
      
      // Should be modified and should not proceed
      expect(result.modified).toBe(true);
      expect(result.proceed).toBe(false);
      
      // Should not have called showWarningMessage
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });
    
    it('should handle errors in stat and proceed', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Create original stats
      const originalStats = { mtime: 1000 };
      
      // Mock fs.stat to throw an error
      (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('Stat error'));
      
      // Create a spy for console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      // Check modification
      const result = await checkFileModification(fileUri, originalStats as vscode.FileStat, {
        mtimeCheck: true,
        promptOnModification: true
      });
      
      // Should not be modified and should proceed
      expect(result.modified).toBe(false);
      expect(result.proceed).toBe(true);
      
      // Should have logged a warning
      expect(consoleWarnSpy).toHaveBeenCalled();
      
      // Restore console.warn
      consoleWarnSpy.mockRestore();
    });
  });

  describe('withModificationCheck', () => {
    it('should perform the operation and return result when no modification', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Mock fs.stat to return the same mtime
      (vscode.workspace.fs.stat as jest.Mock)
        .mockResolvedValueOnce({ mtime: 1000 }) // Initial stat
        .mockResolvedValueOnce({ mtime: 1000 }); // After operation
      
      // Mock operation
      const operation = jest.fn().mockResolvedValue('operation result');
      
      // Perform operation with modification check
      const result = await withModificationCheck(fileUri, operation, {
        mtimeCheck: true,
        promptOnModification: true
      });
      
      // Should have called operation
      expect(operation).toHaveBeenCalled();
      
      // Should return operation result
      expect(result).toBe('operation result');
    });
    
    it('should return undefined when file is modified and user cancels', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Mock fs.stat to return different mtimes
      (vscode.workspace.fs.stat as jest.Mock)
        .mockResolvedValueOnce({ mtime: 1000 }) // Initial stat
        .mockResolvedValueOnce({ mtime: 2000 }); // After operation
      
      // Mock showWarningMessage to return 'Cancel'
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Cancel');
      
      // Mock operation
      const operation = jest.fn().mockResolvedValue('operation result');
      
      // Perform operation with modification check
      const result = await withModificationCheck(fileUri, operation, {
        mtimeCheck: true,
        promptOnModification: true
      });
      
      // Should have called operation
      expect(operation).toHaveBeenCalled();
      
      // Should return undefined
      expect(result).toBeUndefined();
    });
    
    it('should handle errors in operation', async () => {
      // Create file URI
      const fileUri = vscode.Uri.file('/test/file.txt');
      
      // Mock fs.stat to return the same mtime
      (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ mtime: 1000 });
      
      // Mock operation to throw an error
      const operation = jest.fn().mockRejectedValue(new Error('Operation error'));
      
      // Create a spy for console.error
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Perform operation with modification check
      await expect(withModificationCheck(fileUri, operation, {
        mtimeCheck: true,
        promptOnModification: true
      })).rejects.toThrow('Operation error');
      
      // Should have called operation
      expect(operation).toHaveBeenCalled();
      
      // Should have logged an error
      expect(consoleErrorSpy).toHaveBeenCalled();
      
      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
  });
});