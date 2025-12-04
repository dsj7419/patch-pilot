// src/test/unit/git/dubiousOwnership.test.ts

import * as vscode from 'vscode';
import {
  autoStageFiles,
  createTempBranch,
  getGitStatus,
  createCommit,
  getLastCommitFiles,
  GitError
} from '../../../git';

// Mock vscode
jest.mock('vscode');

// Mock simple-git with inline error definitions to avoid variable reference issues
jest.mock('simple-git', () => {
  return {
    simpleGit: jest.fn().mockReturnValue({
      checkIsRepo: jest.fn().mockRejectedValue(
        new Error('fatal: detected dubious ownership in repository at \'/path/to/workspace\'')
      ),
      status: jest.fn().mockRejectedValue(
        new Error('fatal: detected dubious ownership in repository at \'/path/to/workspace\'')
      ),
      raw: jest.fn().mockRejectedValue(
        new Error('fatal: detected dubious ownership in repository at \'/path/to/workspace\'')
      ),
      add: jest.fn().mockRejectedValue(
        new Error('fatal: detected dubious ownership in repository at \'/path/to/workspace\'')
      ),
      checkoutLocalBranch: jest.fn().mockRejectedValue(
        new Error('fatal: detected dubious ownership in repository at \'/path/to/workspace\'')
      ),
      commit: jest.fn().mockRejectedValue(
        new Error('fatal: detected dubious ownership in repository at \'/path/to/workspace\'')
      ),
      diff: jest.fn().mockRejectedValue(
        new Error('fatal: detected dubious ownership in repository at \'/path/to/workspace\'')
      )
    })
  };
});

// Mock telemetry
// Mock logger
jest.mock('../../../logger', () => ({
  getGitOutputChannel: jest.fn(),
  getMainOutputChannel: jest.fn(),
  log: jest.fn()
}));

jest.mock('../../../telemetry', () => ({
  trackEvent: jest.fn()
}));

// Mock file validation
jest.mock('../../../security/gitValidation', () => ({
  isValidBranchName: jest.fn().mockReturnValue(true),
  sanitizeBranchName: jest.fn(name => name),
  validateFilePaths: jest.fn(paths => paths),
  isValidCommitMessage: jest.fn().mockReturnValue(true),
  sanitizeCommitMessage: jest.fn(msg => msg)
}));

// Mock logger
jest.mock('../../../logger', () => ({
  getGitOutputChannel: jest.fn(),
  getMainOutputChannel: jest.fn(),
  log: jest.fn()
}));

// Helper to set up workspace folders for tests
function setupWorkspaceFolders(exists: boolean = true, outputChannel?: any) {
  if (exists) {
    // Set up workspace folders
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/path/to/workspace' } }
    ];
  } else {
    // Remove workspace folders
    (vscode.workspace as any).workspaceFolders = undefined;
    
    // Setup logger mock
    const logger = require('../../../logger');
    if (outputChannel) {
      logger.getGitOutputChannel.mockReturnValue(outputChannel);
    }
  }
}

describe('Dubious Ownership Error Handling', () => {
  let mockOutputChannel: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up workspace folders
    setupWorkspaceFolders(true, mockOutputChannel);
    
    // Create mock output channel
    mockOutputChannel = {
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn()
    };
    
    // Mock the output channel creation
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mockOutputChannel);
    
    // Mock the showErrorMessage function
    (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue('OK');
    
    // Setup logger mock
    const logger = require('../../../logger');
    logger.getGitOutputChannel.mockReturnValue(mockOutputChannel);
  });

  describe('handleDubiousOwnershipError', () => {
    test('should show a specific error message when dubious ownership error occurs', async () => {
      // Try to auto-stage files, which should trigger the error
      await expect(autoStageFiles(['file.txt'])).rejects.toThrow(GitError);
      
      // Check that the specific error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Git security check failed: Repository ownership mismatch detected'),
        expect.objectContaining({ modal: true })
      );
      
      // Check that the error message includes the workspace path
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('/path/to/workspace'),
        expect.anything()
      );
      
      // Check that the error message includes the fix instruction
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('git config --global --add safe.directory'),
        expect.anything()
      );
    });
    
    test('should handle dubious ownership errors in createTempBranch', async () => {
      // Try to create a branch, which should trigger the error
      await expect(createTempBranch('test-branch')).rejects.toThrow('Git repository ownership check failed');
      
      // Check that the specific error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Git security check failed'),
        expect.objectContaining({ modal: true })
      );
    });
    
    test('should handle dubious ownership errors in getGitStatus', async () => {
      // Get git status, which should handle the error and return empty status
      const status = await getGitStatus();
      
      // Should return a default empty status
      expect(status.isClean).toBe(true);
      expect(status.staged).toHaveLength(0);
      expect(status.modified).toHaveLength(0);
      expect(status.created).toHaveLength(0);
      expect(status.deleted).toHaveLength(0);
      
      // Check that the specific error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Git security check failed'),
        expect.objectContaining({ modal: true })
      );
    });
    
    test('should handle dubious ownership errors in createCommit', async () => {
      // Try to create a commit, which should trigger the error
      await expect(createCommit('Test commit')).rejects.toThrow('Git repository ownership check failed');
      
      // Check that the specific error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Git security check failed'),
        expect.objectContaining({ modal: true })
      );
    });
    
    test('should handle dubious ownership errors in getLastCommitFiles', async () => {
      // Get last commit files, which should handle the error and return empty array
      const files = await getLastCommitFiles();
      
      // Should return an empty array
      expect(files).toHaveLength(0);
      
      // Check that the specific error message was shown
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Git security check failed'),
        expect.objectContaining({ modal: true })
      );
    });
    
    test('should not show error message when no workspace folders exist', async () => {
      // Remove workspace folders
      setupWorkspaceFolders(false, mockOutputChannel);
      
      // Try to auto-stage files, which should throw a different error
      await expect(autoStageFiles(['file.txt'])).rejects.toThrow('No workspace folder open');
      
      // The dubious ownership error message should not be shown
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalledWith(
        expect.stringContaining('Git security check failed'),
        expect.anything()
      );
    });
    
    test('should not handle errors that are not dubious ownership errors', async () => {
      // Save the original simpleGit implementation
      const originalSimpleGit = require('simple-git').simpleGit;
      
      // Create a completely different error
      const otherError = new Error('Some other Git error');
      
      // Create a mock instance that throws our different error
      const mockGitInstance = {
        checkIsRepo: jest.fn().mockResolvedValue(true),
        add: jest.fn().mockRejectedValue(otherError)
      };
      
      // Override the mock implementation completely
      require('simple-git').simpleGit = jest.fn().mockReturnValue(mockGitInstance);
      
      // Clear any previous calls
      (vscode.window.showErrorMessage as jest.Mock).mockClear();
      
      try {
        // Try to auto-stage files
        await autoStageFiles(['file.txt']);
        fail('autoStageFiles should have thrown an error');
      } catch (error) {
        // The dubious ownership error message should not have been shown
        const showErrorCalls = (vscode.window.showErrorMessage as jest.Mock).mock.calls;
        const securityErrors = showErrorCalls.filter(call => 
          call[0] && typeof call[0] === 'string' && call[0].includes('Git security check failed')
        );
        expect(securityErrors.length).toBe(0);
      } finally {
        // Restore the original implementation
        require('simple-git').simpleGit = originalSimpleGit;
      }
    });
    
    test('should log details about the dubious ownership error', async () => {
      // Try to auto-stage files, which should trigger the error
      await expect(autoStageFiles(['file.txt'])).rejects.toThrow(GitError);
      
      // Check that the error was logged to the output channel
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Dubious ownership error detected for workspace:')
      );
    });
  });
});