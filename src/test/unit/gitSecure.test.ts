/* --------------------------------------------------------------------------
 *  PatchPilot — Unit tests for secured Git operations
 * ----------------------------------------------------------------------- */

import * as cp from 'child_process';
import * as simpleGit from 'simple-git';
import * as vscode from 'vscode';
import {
  isGitAvailable,
  autoStageFiles,
  createTempBranch,
  hasUncommittedChanges,
  getCurrentBranch,
  createCommit,
  getLastCommitFiles,
  getGitStatus,
  detectGit,
  GitError
} from '../../gitSecure';
import { trackEvent } from '../../telemetry';

// Mock dependencies
jest.mock('vscode');
jest.mock('simple-git');
jest.mock('child_process');
jest.mock('../../telemetry', () => ({
  trackEvent: jest.fn()
}));

describe('Enhanced Git Module', () => {
  let mockGit: any;
  let mockOutputChannel: any;
  let mockExec: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    
    // Setup mock workspace folders
    (vscode.workspace.workspaceFolders as any) = [
      { uri: { fsPath: '/test-workspace' } }
    ];
    
    // Create a mock for the simple-git instance
    mockGit = {
      checkIsRepo: jest.fn().mockResolvedValue(true),
      add: jest.fn().mockResolvedValue(undefined),
      status: jest.fn().mockResolvedValue({
        isClean: jest.fn().mockReturnValue(true),
        staged: [],
        modified: [],
        created: [],
        deleted: [],
        renamed: [],
        current: 'main'
      }),
      checkoutLocalBranch: jest.fn().mockResolvedValue(undefined),
      raw: jest.fn().mockImplementation((args) => {
        if (args[0] === 'symbolic-ref' && args[1] === '-q' && args[2] === 'HEAD') {
          return Promise.resolve('refs/heads/main'); // Not in detached HEAD
        }
        if (args[0] === '--version') {
          return Promise.resolve('git version 2.34.1');
        }
        return Promise.resolve('');
      }),
      commit: jest.fn().mockResolvedValue({ commit: 'abcd1234' }),
      diff: jest.fn().mockResolvedValue('file1.ts\nfile2.ts')
    };
    
    // Setup simple-git default export mock
    (simpleGit.default as jest.Mock).mockReturnValue(mockGit);
    
    // Setup child_process.exec mock for CLI fallbacks
    mockExec = jest.fn().mockImplementation((command, options, callback) => {
        // Handle different git commands
        let stdout = '';
        let stderr = '';
        
        if (command.includes('git --version')) {
          stdout = 'git version 2.34.1';
        } else if (command.includes('rev-parse --is-inside-work-tree')) {
          stdout = 'true';
        } else if (command.includes('status --porcelain')) {
          stdout = '';
        } else if (command.includes('symbolic-ref')) {
          stdout = 'refs/heads/main';
        } else if (command.includes('diff --name-only')) {
          stdout = 'file1.ts\nfile2.ts';
        } else if (command.includes('add')) {
          stdout = '';
        } else if (command.includes('checkout -b')) {
          stdout = 'Switched to a new branch';
        } else if (command.includes('commit -m')) {
          stdout = '[main abcd1234] Test commit';
        }
        
        // If callback is provided, call it
        if (callback) {
          callback(null, { stdout, stderr });
        }
        
        // Return a mock child process
        return {
          stdout: {
            on: jest.fn().mockImplementation((event, handler) => {
              if (event === 'data') {
                handler(stdout);
              }
            })
          },
          stderr: {
            on: jest.fn().mockImplementation((event, handler) => {
              if (event === 'data') {
                handler(stderr);
              }
            })
          },
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'close') {
              handler(0); // Exit code 0
            }
          })
        };
      });
      // Use proper typing for the mock - cast to 'unknown' first
      (cp.exec as unknown) = mockExec;
    
    // Setup vscode window mock
    mockOutputChannel = {
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn()
    };
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mockOutputChannel);
    
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Yes');
  });

  describe('detectGit', () => {
    it('should detect Git when available', async () => {
      const result = await detectGit();
      
      expect(result.isGitRepo).toBe(true);
      expect(result.workspacePath).toBe('/test-workspace');
      expect(result.gitVersion).toBeDefined();
    });
    
    it('should report Git not available when not a repository', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);
      
      const result = await detectGit();
      
      expect(result.isGitRepo).toBe(false);
      expect(result.workspacePath).toBe('/test-workspace');
    });
    
    it('should use CLI fallback when SimpleGit fails', async () => {
      // Make SimpleGit fail
      mockGit.checkIsRepo.mockRejectedValue(new Error('SimpleGit error'));
      
      const result = await detectGit({ useFallbacks: true });
      
      // Should still detect git via CLI fallback
      expect(result.isGitRepo).toBe(true);
      expect(mockExec).toHaveBeenCalled();
      expect(result.gitVersion).toBeDefined();
    });
    
    it('should fail gracefully when no git available', async () => {
      // Make both SimpleGit and CLI fail
      mockGit.checkIsRepo.mockRejectedValue(new Error('SimpleGit error'));
      mockExec.mockImplementation((cmd, opts, cb) => {
        if (cb) { cb(new Error('Command failed'), { stdout: '', stderr: 'Not found' }); }
        return { on: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });
      
      const result = await detectGit({ useFallbacks: true });
      
      // Should report no git
      expect(result.isGitRepo).toBe(false);
      expect(mockExec).toHaveBeenCalled();
    });
  });

  describe('isGitAvailable', () => {
    it('should return true when git repository is found', async () => {
      const result = await isGitAvailable();
      
      expect(result).toBe(true);
      expect(mockGit.checkIsRepo).toHaveBeenCalled();
    });
    
    it('should return false when git repository is not found', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);
      
      const result = await isGitAvailable();
      
      expect(result).toBe(false);
    });
    
    it('should return false and log error when exception occurs', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('Git error'));
      
      const result = await isGitAvailable();
      
      expect(result).toBe(false);
      expect(mockOutputChannel.appendLine).toHaveBeenCalled();
    });
    
    it('should return false when no workspace folders exist', async () => {
      // Mock no workspace folders
      (vscode.workspace.workspaceFolders as any) = undefined;
      
      const result = await isGitAvailable();
      
      expect(result).toBe(false);
    });
    
    it('should attempt CLI fallback when option is enabled', async () => {
      // Make SimpleGit fail
      mockGit.checkIsRepo.mockRejectedValue(new Error('Git error'));
      
      const result = await isGitAvailable({ useFallbacks: true });
      
      // Should try CLI fallback
      expect(mockExec).toHaveBeenCalled();
    });
  });

  describe('autoStageFiles', () => {
    it('should validate and sanitize file paths', async () => {
      // Include some invalid paths
      const filePaths = [
        'valid.txt',
        '../outside.txt',
        'nested/valid.txt',
        '/etc/passwd'
      ];
      
      await autoStageFiles(filePaths);
      
      // Should only stage valid paths
      expect(mockGit.add).toHaveBeenCalledWith(['valid.txt', 'nested/valid.txt']);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Staged 2 file(s) to Git.'
      );
    });
    
    it('should throw GitError when no valid paths provided', async () => {
      const filePaths = ['../outside.txt', '/etc/passwd'];
      
      await expect(autoStageFiles(filePaths)).rejects.toThrow(GitError);
      expect(mockGit.add).not.toHaveBeenCalled();
    });
    
    it('should track telemetry', async () => {
      await autoStageFiles(['file.txt']);
      
      expect(trackEvent).toHaveBeenCalledWith('git_action', {
        action: 'autoStage',
        fileCount: 1
      });
    });
    
    it('should use CLI fallback when SimpleGit fails', async () => {
      // Make SimpleGit fail
      mockGit.add.mockRejectedValue(new Error('SimpleGit error'));
      
      await autoStageFiles(['file.txt'], { useFallbacks: true });
      
      // Should try CLI fallback
      expect(mockExec).toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Staged 1 file(s) to Git.'
      );
    });
    
    it('should throw GitError when both SimpleGit and CLI fail', async () => {
      // Make both SimpleGit and CLI fail
      mockGit.add.mockRejectedValue(new Error('SimpleGit error'));
      mockExec.mockImplementation((cmd, opts, cb) => {
        if (cb) { cb(new Error('CLI error'), { stdout: '', stderr: 'Failed' }); }
        return { on: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });
      
      await expect(autoStageFiles(['file.txt'], { useFallbacks: true })).rejects.toThrow(GitError);
      expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(2); // Both errors logged
    });
  });

  describe('createTempBranch', () => {
    it('should sanitize invalid branch names', async () => {
      // Create with invalid branch name
      await createTempBranch('invalid branch; rm -rf /');
      
      // Should use sanitized name
      expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith('invalid-branch-rm--rf--');
    });
    
    it('should generate a timestamp-based name when none provided', async () => {
      // Mock Date.now() to get a consistent timestamp
      const originalToISOString = Date.prototype.toISOString;
      Date.prototype.toISOString = jest.fn(() => '2023-04-19T12:00:00.000Z');
      
      await createTempBranch();
      
      expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith(
        'patchpilot/2023-04-19T12-00-00-000Z'
      );
      
      // Restore original Date method
      Date.prototype.toISOString = originalToISOString;
    });
    
    it('should warn when in detached HEAD state', async () => {
      // Mock detached HEAD state
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === 'symbolic-ref' && args[1] === '-q' && args[2] === 'HEAD') {
          return Promise.resolve(''); // Empty result for detached HEAD
        }
        return Promise.resolve('');
      });
      
      // Mock user choosing to continue
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Create From Here');
      
      await createTempBranch('test-branch');
      
      // Should show warning
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('detached HEAD state'),
        expect.anything(),
        'Create From Here',
        'Cancel'
      );
      
      // Should create branch anyway
      expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith('test-branch');
    });
    
    it('should cancel if user chooses not to proceed in detached HEAD', async () => {
      // Mock detached HEAD state
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === 'symbolic-ref' && args[1] === '-q' && args[2] === 'HEAD') {
          return Promise.resolve(''); // Empty result for detached HEAD
        }
        return Promise.resolve('');
      });
      
      // Mock user choosing to cancel
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Cancel');
      
      await expect(createTempBranch('test-branch')).rejects.toThrow(GitError);
      expect(mockGit.checkoutLocalBranch).not.toHaveBeenCalled();
    });
    
    it('should use CLI fallback when SimpleGit fails', async () => {
      // Make SimpleGit fail
      mockGit.checkoutLocalBranch.mockRejectedValue(new Error('SimpleGit error'));
      
      await createTempBranch('test-branch', { useFallbacks: true });
      
      // Should try CLI fallback
      expect(mockExec).toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Created and switched to branch')
      );
    });
  });

  describe('getGitStatus', () => {
    it('should return comprehensive git status information', async () => {
      // Mock status with changes
      mockGit.status.mockResolvedValue({
        isClean: jest.fn().mockReturnValue(false),
        staged: ['staged.txt'],
        modified: ['modified.txt'],
        created: ['created.txt'],
        deleted: ['deleted.txt'],
        renamed: ['renamed.txt'],
        current: 'feature-branch'
      });
      
      const status = await getGitStatus();
      
      expect(status).toEqual({
        isClean: false,
        staged: ['staged.txt'],
        modified: ['modified.txt'],
        created: ['created.txt'],
        deleted: ['deleted.txt'],
        renamed: ['renamed.txt'],
        isDetachedHead: false,
        currentBranch: 'feature-branch'
      });
    });
    
    it('should detect detached HEAD state', async () => {
      // Mock detached HEAD state
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === 'symbolic-ref' && args[1] === '-q' && args[2] === 'HEAD') {
          return Promise.resolve(''); // Empty result for detached HEAD
        }
        return Promise.resolve('');
      });
      
      const status = await getGitStatus();
      
      expect(status.isDetachedHead).toBe(true);
    });
    
    it('should use CLI fallback when SimpleGit fails', async () => {
      // Make SimpleGit fail
      mockGit.status.mockRejectedValue(new Error('SimpleGit error'));
      
      const status = await getGitStatus({ useFallbacks: true });
      
      // Should try CLI fallback
      expect(mockExec).toHaveBeenCalled();
      expect(status).toBeDefined();
    });
    
    it('should return empty status when both SimpleGit and CLI fail', async () => {
      // Make both SimpleGit and CLI fail
      mockGit.status.mockRejectedValue(new Error('SimpleGit error'));
      mockExec.mockImplementation((cmd, opts, cb) => {
        if (cb) { cb(new Error('CLI error'), { stdout: '', stderr: 'Failed' }); }
        return { on: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });
      
      const status = await getGitStatus({ useFallbacks: true });
      
      // Should return default clean status
      expect(status).toEqual({
        isClean: true,
        staged: [],
        modified: [],
        created: [],
        deleted: [],
        renamed: [],
        isDetachedHead: false
      });
    });
  });

  describe('createCommit', () => {
    it('should sanitize dangerous commit messages', async () => {
      // Create with dangerous commit message
      await createCommit('Update readme; rm -rf /');
      
      // Should use sanitized message
      expect(mockGit.commit).toHaveBeenCalledWith('Update readme rm -rf /');
    });
    
    it('should throw GitError when no staged changes exist', async () => {
      // Mock status with no staged changes
      mockGit.status.mockResolvedValue({
        isClean: jest.fn().mockReturnValue(true),
        staged: []
      });
      
      await expect(createCommit('Empty commit')).rejects.toThrow(GitError);
      expect(mockGit.commit).not.toHaveBeenCalled();
    });
    
    it('should warn when in detached HEAD state', async () => {
      // Mock status with staged changes
      mockGit.status.mockResolvedValue({
        isClean: jest.fn().mockReturnValue(false),
        staged: ['file.txt']
      });
      
      // Mock detached HEAD state
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === 'symbolic-ref' && args[1] === '-q' && args[2] === 'HEAD') {
          return Promise.resolve(''); // Empty result for detached HEAD
        }
        return Promise.resolve('');
      });
      
      // Mock user choosing to continue
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Commit Anyway');
      
      await createCommit('Detached commit');
      
      // Should show warning
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('detached HEAD state'),
        expect.anything(),
        'Commit Anyway',
        'Cancel'
      );
      
      // Should commit anyway
      expect(mockGit.commit).toHaveBeenCalled();
    });
    
    it('should track telemetry', async () => {
      // Mock status with staged changes
      mockGit.status.mockResolvedValue({
        isClean: jest.fn().mockReturnValue(false),
        staged: ['file.txt']
      });
      
      await createCommit('Test commit');
      
      expect(trackEvent).toHaveBeenCalledWith('git_action', {
        action: 'commit'
      });
    });
    
    it('should use CLI fallback when SimpleGit fails', async () => {
      // Mock status with staged changes
      mockGit.status.mockResolvedValue({
        isClean: jest.fn().mockReturnValue(false),
        staged: ['file.txt']
      });
      
      // Make SimpleGit commit fail
      mockGit.commit.mockRejectedValue(new Error('SimpleGit error'));
      
      const commitHash = await createCommit('Test commit', { useFallbacks: true });
      
      // Should try CLI fallback
      expect(mockExec).toHaveBeenCalled();
      expect(commitHash).toBeDefined();
    });
  });

  describe('getLastCommitFiles', () => {
    it('should return files from the last commit', async () => {
      const files = await getLastCommitFiles();
      
      expect(files).toEqual(['file1.ts', 'file2.ts']);
      expect(mockGit.diff).toHaveBeenCalledWith(['--name-only', 'HEAD~1', 'HEAD']);
    });
    
    it('should use CLI fallback when SimpleGit fails', async () => {
      // Make SimpleGit diff fail
      mockGit.diff.mockRejectedValue(new Error('SimpleGit error'));
      
      const files = await getLastCommitFiles({ useFallbacks: true });
      
      // Should try CLI fallback
      expect(mockExec).toHaveBeenCalled();
      expect(files).toEqual(['file1.ts', 'file2.ts']);
    });
    
    it('should return empty array when both SimpleGit and CLI fail', async () => {
      // Make both SimpleGit and CLI fail
      mockGit.diff.mockRejectedValue(new Error('SimpleGit error'));
      mockExec.mockImplementation((cmd, opts, cb) => {
        if (cb) { cb(new Error('CLI error'), { stdout: '', stderr: 'Failed' }); }
        return { on: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });
      
      const files = await getLastCommitFiles({ useFallbacks: true });
      
      // Should return empty array
      expect(files).toEqual([]);
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true when there are modified files', async () => {
      // Mock status with changes
      mockGit.status.mockResolvedValue({
        isClean: jest.fn().mockReturnValue(false),
        modified: ['modified.txt']
      });
      
      const result = await hasUncommittedChanges();
      
      expect(result).toBe(true);
    });
    
    it('should return false when there are no changes', async () => {
      // Mock status with no changes
      mockGit.status.mockResolvedValue({
        isClean: jest.fn().mockReturnValue(true),
        modified: [],
        created: [],
        deleted: [],
        renamed: [],
        staged: []
      });
      
      const result = await hasUncommittedChanges();
      
      expect(result).toBe(false);
    });
    
    it('should use CLI fallback when SimpleGit fails', async () => {
      // Make SimpleGit status fail
      mockGit.status.mockRejectedValue(new Error('SimpleGit error'));
      
      // Mock CLI to show clean status
      mockExec.mockImplementation((cmd, opts, cb) => {
        if (cmd.includes('status --porcelain')) {
          if (cb) { cb(null, { stdout: '', stderr: '' }); }
        }
        return { on: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });
      
      const result = await hasUncommittedChanges({ useFallbacks: true });
      
      // Should try CLI fallback
      expect(mockExec).toHaveBeenCalled();
      expect(result).toBe(false); // CLI reports clean
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', async () => {
      // Mock status with branch name
      mockGit.status.mockResolvedValue({
        current: 'feature-branch'
      });
      
      const branch = await getCurrentBranch();
      
      expect(branch).toBe('feature-branch');
    });
    
    it('should return undefined when in detached HEAD state', async () => {
      // Mock detached HEAD state
      mockGit.raw.mockImplementation((args) => {
        if (args[0] === 'symbolic-ref' && args[1] === '-q' && args[2] === 'HEAD') {
          return Promise.resolve(''); // Empty result for detached HEAD
        }
        return Promise.resolve('');
      });
      
      // Mock status with undefined current branch
      mockGit.status.mockResolvedValue({
        current: undefined
      });
      
      const branch = await getCurrentBranch();
      
      expect(branch).toBeUndefined();
    });
    
    it('should use CLI fallback when SimpleGit fails', async () => {
      // Make SimpleGit fail
      mockGit.status.mockRejectedValue(new Error('SimpleGit error'));
      
      const branch = await getCurrentBranch({ useFallbacks: true });
      
      // Should try CLI fallback
      expect(mockExec).toHaveBeenCalled();
      expect(branch).toBeDefined();
    });
  });
});