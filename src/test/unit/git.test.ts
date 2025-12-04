// src/test/unit/git.test.ts

import * as vscode from 'vscode';
import {
  detectGit,
  isGitAvailable,
  autoStageFiles,
  createTempBranch,
  getGitStatus,
  hasUncommittedChanges,
  getCurrentBranch,
  createCommit,
  getLastCommitFiles,
  GitError,
} from '../../git';

// Set up mock flags - even these need to be before jest.mock calls
let mockDetachedHead = false;

// Mock imports - use an inline approach for all mocks
jest.mock('vscode');

jest.mock('simple-git', () => {
  // Create a mock instance with the expected methods
  const mockGitInstance = {
    checkIsRepo: jest.fn().mockResolvedValue(true),
    status: jest.fn().mockResolvedValue({
      current: 'feature-branch',
      staged: ['staged.txt'],
      modified: ['modified.txt'],
      created: ['created.txt'],
      deleted: ['deleted.txt'],
      renamed: [],
      isClean: function() { return false; }
    }),
    raw: jest.fn().mockImplementation((args) => {
      if (args[0] === '--version') {
        return Promise.resolve('git version 2.30.0');
      }
      if (args[0] === 'symbolic-ref' && args[1] === '-q' && args[2] === 'HEAD') {
        // We can directly use mockDetachedHead here as it's defined above
        if (mockDetachedHead) {
          return Promise.resolve('');
        }
        else {
          return Promise.resolve('refs/heads/main');
        }
      }
      return Promise.resolve('');
    }),
    add: jest.fn().mockResolvedValue({}),
    checkoutLocalBranch: jest.fn().mockResolvedValue({}),
    commit: jest.fn().mockResolvedValue({ commit: 'abcdef123456' }),
    diff: jest.fn().mockResolvedValue('file1.txt\nfile2.txt')
  };

  // Create the simpleGit function that returns the mock instance
  const mockSimpleGit = jest.fn().mockReturnValue(mockGitInstance);

  return {
    simpleGit: mockSimpleGit,
    // Export the mock instance for tests that need to modify it
    _mockInstance: mockGitInstance
  };
});

jest.mock('../../telemetry', () => ({
  trackEvent: jest.fn()
}));

// Inline the entire mock implementation instead of using a separate variable
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, cb) => {
    if (cmd.includes('--version')) {
      cb(null, { stdout: 'git version 2.30.0', stderr: '' });
    } else if (cmd.includes('rev-parse')) {
      cb(null, { stdout: 'true', stderr: '' });
    } else if (cmd.includes('add')) {
      cb(null, { stdout: '', stderr: '' });
    } else if (cmd.includes('checkout -b')) {
      cb(null, { stdout: '', stderr: '' });
    } else if (cmd.includes('status --porcelain')) {
      // Make sure to include BOTH modified and staged files in proper format:
      // XY format where X=staged status, Y=working tree status
      // M in first column = staged modification, M in second column = unstaged modification
      cb(null, { stdout: 'M  staged-modified.txt\n M modified.txt\nMM both-modified.txt\nA  staged.txt', stderr: '' });
    } else if (cmd.includes('symbolic-ref -q HEAD')) {
      cb(null, { stdout: 'refs/heads/main', stderr: '' });
    } else if (cmd.includes('symbolic-ref --short HEAD')) {
      cb(null, { stdout: 'main', stderr: '' });
    } else if (cmd.includes('commit -m')) {
      cb(null, { stdout: '[main abcdef123456] Test commit', stderr: '' });
    } else if (cmd.includes('diff --name-only')) {
      cb(null, { stdout: 'file1.txt\nfile2.txt', stderr: '' });
    } else {
      cb(new Error('Command not mocked'), { stdout: '', stderr: 'Command failed' });
    }
  })
}));

// Mock util.promisify
jest.mock('util', () => ({
  promisify: jest.fn((fn) => {
    return (...args) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err, result) => {
          if (err) {reject(err);}
          else {resolve(result);}
        });
      });
    };
  })
}));

// Fix file validation
jest.mock('../../security/gitValidation', () => {
  return {
    isValidBranchName: jest.fn().mockReturnValue(true),
    sanitizeBranchName: jest.fn(name => name === 'branch;rm -rf /' ? 'branch-rm--rf--' : name),
    validateFilePaths: jest.fn(paths => paths), // Return the paths as valid
    isValidCommitMessage: jest.fn().mockReturnValue(true),
    sanitizeCommitMessage: jest.fn(msg => msg.includes('<script>') ? 'Sanitized message' : msg)
  };
});

// Create a consistent warning message responder that works for all tests
const createWarningResponder = () => {
  return (message, options, ...items) => {
    // Specific test cases need specific responses
    if (message.includes('detached HEAD state. Creating a branch')) {
      return Promise.resolve('Create From Here');
    }
    if (message.includes('detached HEAD state. Commits here')) {
      return Promise.resolve('Commit Anyway');
    }
    if (message.includes('uncommitted changes')) {
      return Promise.resolve('Yes');
    }
    // Default response for other warnings
    return Promise.resolve('Proceed Anyway');
  };
};

// Setup mock access after all jest.mock() calls are completed
beforeAll(() => {
  // Fix the vscode mocks
  const mockWorkspaceFolders = [
    { uri: { fsPath: '/path/to/workspace' } }
  ];
  
  // Setup vscode.workspace
  (vscode.workspace as any).workspaceFolders = mockWorkspaceFolders;
  (vscode.workspace.getConfiguration as jest.Mock) = jest.fn(() => ({
    get: jest.fn().mockImplementation((key, defaultValue) => defaultValue)
  }));
  
  // Mock fs methods
  (vscode.workspace.fs as any) = {
    stat: jest.fn().mockResolvedValue({ mtime: Date.now() }),
    readFile: jest.fn().mockResolvedValue(new Uint8Array()),
    writeFile: jest.fn().mockResolvedValue(undefined)
  };
  
  // Mock window functions with proper message responses
  (vscode.window.showInformationMessage as jest.Mock) = jest.fn().mockResolvedValue('Apply');
  (vscode.window.showWarningMessage as jest.Mock) = jest.fn(createWarningResponder());
  (vscode.window.createOutputChannel as jest.Mock) = jest.fn(() => ({
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn()
  }));
});

describe('Enhanced Git Module', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetachedHead = false;
    
    // Reset simpleGit mock for each test
    const simpleGitMock = require('simple-git');
    const mockGitInstance = simpleGitMock._mockInstance;
    
    // Reset mock implementations
    mockGitInstance.checkIsRepo.mockResolvedValue(true);
    mockGitInstance.status.mockResolvedValue({
      current: 'feature-branch',
      staged: ['staged.txt'],
      modified: ['modified.txt'],
      created: ['created.txt'],
      deleted: ['deleted.txt'],
      renamed: [],
      isClean: function() { return false; }
    });
    
    // Configure window mocks with default values - use the same consistent responder
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Apply');
    (vscode.window.showWarningMessage as jest.Mock).mockImplementation(createWarningResponder());
  });

  describe('detectGit', () => {
    test('should detect Git when available', async () => {
      const result = await detectGit();
      expect(result.isGitRepo).toBe(true);
    });
    
    test('should report Git not available when not a repository', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock._mockInstance.checkIsRepo.mockResolvedValueOnce(false);
      
      const result = await detectGit();
      expect(result.isGitRepo).toBe(false);
    });
    
    test('should use CLI fallback when SimpleGit fails', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        throw new Error('SimpleGit failed');
      });
      
      const result = await detectGit({ useFallbacks: true });
      expect(result.isGitRepo).toBe(true);
    });
    
    test('should fail gracefully when no git available', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        throw new Error('SimpleGit failed');
      });
      
      // Get access to child_process.exec mock
      const childProcess = require('child_process');
      childProcess.exec.mockImplementationOnce((cmd, cb) => {
        cb(new Error('Git not found'), null);
      });
      
      const result = await detectGit({ useFallbacks: true });
      expect(result.isGitRepo).toBe(false);
    });
  });
  
  describe('isGitAvailable', () => {
    test('should return true when git repository is found', async () => {
      const result = await isGitAvailable();
      expect(result).toBe(true);
    });
    
    test('should return false when git repository is not found', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock._mockInstance.checkIsRepo.mockResolvedValueOnce(false);
      
      const result = await isGitAvailable();
      expect(result).toBe(false);
    });
    
    test('should return false and log error when exception occurs', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      const result = await isGitAvailable();
      expect(result).toBe(false);
    });
    
    test('should return false when no workspace folders exist', async () => {
      // Temporarily override the workspace folders
      const originalFolders = vscode.workspace.workspaceFolders;
      (vscode.workspace as any).workspaceFolders = undefined;
      
      const result = await isGitAvailable();
      expect(result).toBe(false);
      
      // Restore the original value
      (vscode.workspace as any).workspaceFolders = originalFolders;
    });
    
    test('should attempt CLI fallback when option is enabled', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      const result = await isGitAvailable({ useFallbacks: true });
      expect(result).toBe(true);
    });
  });
  
  describe('autoStageFiles', () => {
    test('should validate and sanitize file paths', async () => {
      const files = ['file1.txt', 'file2.txt'];
      await autoStageFiles(files);
      
      const simpleGitMock = require('simple-git');
      expect(simpleGitMock._mockInstance.add).toHaveBeenCalledWith(files);
    });
    
    test('should throw GitError when no valid paths provided', async () => {
      // Override the mock to return empty array for this test
      const gitValidation = require('../../security/gitValidation');
      gitValidation.validateFilePaths.mockReturnValueOnce([]);
      
      const invalidFiles: string[] = [];
      
      await expect(autoStageFiles(invalidFiles)).rejects.toThrow(GitError);
    });
    
    test('should track telemetry', async () => {
      const telemetry = require('../../telemetry');
      await autoStageFiles(['file1.txt']);
      
      expect(telemetry.trackEvent).toHaveBeenCalledWith('git_action', expect.objectContaining({
        action: 'autoStage'
      }));
    });
    
    test('should use CLI fallback when SimpleGit fails', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        const mockInstance = {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          add: jest.fn().mockRejectedValue(new Error('SimpleGit add failed'))
        };
        return mockInstance;
      });
      
      await autoStageFiles(['file1.txt'], { useFallbacks: true });
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });
    
    test('should throw GitError when both SimpleGit and CLI fail', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        const mockInstance = {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          add: jest.fn().mockRejectedValue(new Error('SimpleGit add failed'))
        };
        return mockInstance;
      });
      
      // Get access to child_process.exec mock
      const childProcess = require('child_process');
      childProcess.exec.mockImplementationOnce((cmd, cb) => {
        cb(new Error('CLI failed'), { stdout: '', stderr: 'Command failed' });
      });
      
      await expect(autoStageFiles(['file1.txt'], { useFallbacks: true })).rejects.toThrow(GitError);
    });
  });
  
  describe('createTempBranch', () => {
    test('should sanitize invalid branch names', async () => {
      // Force the validation to return false for this test
      const gitValidation = require('../../security/gitValidation');
      gitValidation.isValidBranchName.mockReturnValueOnce(false);
      
      const invalidName = 'branch;rm -rf /';
      await createTempBranch(invalidName);
      
      const simpleGitMock = require('simple-git');
      expect(simpleGitMock._mockInstance.checkoutLocalBranch).toHaveBeenCalledWith('branch-rm--rf--');
    });
    
    test('should generate a timestamp-based name when none provided', async () => {
      await createTempBranch();
      
      const simpleGitMock = require('simple-git');
      expect(simpleGitMock._mockInstance.checkoutLocalBranch).toHaveBeenCalledWith(expect.stringContaining('patchpilot/'));
    });
    
    test('should warn when in detached HEAD state', async () => {
      mockDetachedHead = true;
      
      await createTempBranch('test-branch');
      
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('detached HEAD'),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
    
    test('should cancel if user chooses not to proceed in detached HEAD', async () => {
      mockDetachedHead = true;
      // Override the warning mock for just this test to return 'Cancel'
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Cancel');
      
      await expect(createTempBranch('test-branch')).rejects.toThrow(GitError);
    });
    
    test('should use CLI fallback when SimpleGit fails', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        const mockInstance = {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          status: jest.fn().mockResolvedValue({
            current: 'main',
            staged: [],
            modified: [],
            created: [],
            deleted: [],
            renamed: [],
            isClean: function() { return true; }
          }),
          raw: jest.fn().mockResolvedValue('refs/heads/main'),
          checkoutLocalBranch: jest.fn().mockRejectedValue(new Error('SimpleGit checkout failed'))
        };
        return mockInstance;
      });
      
      const branchName = await createTempBranch('fallback-branch', { useFallbacks: true });
      expect(branchName).toBe('fallback-branch');
    });
  });
  
  describe('getGitStatus', () => {
    test('should return comprehensive git status information', async () => {
      const status = await getGitStatus();
      expect(status.isClean).toBe(false);
      expect(status.currentBranch).toBe('feature-branch');
      expect(status.staged).toContain('staged.txt');
      expect(status.modified).toContain('modified.txt');
    });
    
    test('should detect detached HEAD state', async () => {
      mockDetachedHead = true;
      
      const status = await getGitStatus();
      expect(status.isDetachedHead).toBe(true);
    });
    
    test('should use CLI fallback when SimpleGit fails', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        throw new Error('SimpleGit failed');
      });
      
      const status = await getGitStatus({ useFallbacks: true });
      
      // Now both of these should pass since we've updated the mock
      expect(status.staged.length).toBeGreaterThan(0);
      expect(status.modified.length).toBeGreaterThan(0);
    });
    
    test('should return empty status when both SimpleGit and CLI fail', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        throw new Error('SimpleGit failed');
      });
      
      // Get access to child_process.exec mock
      const childProcess = require('child_process');
      childProcess.exec.mockImplementationOnce((cmd, cb) => {
        cb(new Error('CLI failed'), { stdout: '', stderr: 'Command failed' });
      });
      
      const status = await getGitStatus({ useFallbacks: true });
      expect(status.isClean).toBe(true);
      expect(status.staged).toHaveLength(0);
    });
  });
  
  describe('createCommit', () => {
    test('should sanitize dangerous commit messages', async () => {
      // Force the validation to return false for this test
      const gitValidation = require('../../security/gitValidation');
      gitValidation.isValidCommitMessage.mockReturnValueOnce(false);
      
      const dangerousMessage = 'Commit <script>alert("XSS")</script>';
      await createCommit(dangerousMessage);
      
      const simpleGitMock = require('simple-git');
      expect(simpleGitMock._mockInstance.commit).toHaveBeenCalledWith('Sanitized message');
    });
    
    test('should throw GitError when no staged changes exist', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        return {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          status: jest.fn().mockResolvedValue({
            current: 'main',
            staged: [],
            modified: [],
            created: [],
            deleted: [],
            renamed: [],
            isClean: function() { return true; }
          }),
          raw: jest.fn().mockResolvedValue('refs/heads/main')
        };
      });
      
      await expect(createCommit('Test commit')).rejects.toThrow(GitError);
    });
    
    test('should warn when in detached HEAD state', async () => {
      mockDetachedHead = true;
      
      // This test will pass now because the window.showWarningMessage mock is configured
      // to return 'Commit Anyway' instead of 'Cancel' for detached HEAD warnings
      await createCommit('Test commit in detached HEAD');
      
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('detached HEAD'),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
    
    test('should track telemetry', async () => {
      const telemetry = require('../../telemetry');
      await createCommit('Test commit');
      
      expect(telemetry.trackEvent).toHaveBeenCalledWith('git_action', expect.objectContaining({
        action: 'commit'
      }));
    });
    
    test('should use CLI fallback when SimpleGit fails', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        return {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          status: jest.fn().mockResolvedValue({
            current: 'main',
            staged: ['staged.txt'],
            modified: [],
            created: [],
            deleted: [],
            renamed: [],
            isClean: function() { return false; }
          }),
          raw: jest.fn().mockResolvedValue('refs/heads/main'),
          commit: jest.fn().mockRejectedValue(new Error('SimpleGit commit failed'))
        };
      });
      
      const commitHash = await createCommit('Test commit', { useFallbacks: true });
      expect(commitHash).toBe('abcdef123456');
    });
  });
  
  describe('getLastCommitFiles', () => {
    test('should return files from the last commit', async () => {
      const files = await getLastCommitFiles();
      expect(files).toEqual(['file1.txt', 'file2.txt']);
    });
    
    test('should use CLI fallback when SimpleGit fails', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        return {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          diff: jest.fn().mockRejectedValue(new Error('SimpleGit diff failed'))
        };
      });
      
      const files = await getLastCommitFiles({ useFallbacks: true });
      expect(files).toEqual(['file1.txt', 'file2.txt']);
    });
    
    test('should return empty array when both SimpleGit and CLI fail', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        return {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          diff: jest.fn().mockRejectedValue(new Error('SimpleGit diff failed'))
        };
      });
      
      // Get access to child_process.exec mock
      const childProcess = require('child_process');
      childProcess.exec.mockImplementationOnce((cmd, cb) => {
        cb(new Error('CLI failed'), { stdout: '', stderr: 'Command failed' });
      });
      
      const files = await getLastCommitFiles({ useFallbacks: true });
      expect(files).toEqual([]);
    });
  });
  
  describe('hasUncommittedChanges', () => {
    test('should return true when there are modified files', async () => {
      const hasChanges = await hasUncommittedChanges();
      expect(hasChanges).toBe(true);
    });
    
    test('should return false when there are no changes', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        return {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          status: jest.fn().mockResolvedValue({
            current: 'main',
            staged: [],
            modified: [],
            created: [],
            deleted: [],
            renamed: [],
            isClean: function() { return true; }
          }),
          raw: jest.fn().mockResolvedValue('refs/heads/main')
        };
      });
      
      const hasChanges = await hasUncommittedChanges();
      expect(hasChanges).toBe(false);
    });
    
    test('should use CLI fallback when SimpleGit fails', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        throw new Error('SimpleGit failed');
      });
      
      const hasChanges = await hasUncommittedChanges({ useFallbacks: true });
      expect(hasChanges).toBe(true);
    });
  });
  
  describe('getCurrentBranch', () => {
    test('should return the current branch name', async () => {
      const branch = await getCurrentBranch();
      expect(branch).toBe('feature-branch');
    });
    
    test('should return undefined when in detached HEAD state', async () => {
      mockDetachedHead = true;
      
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        return {
          checkIsRepo: jest.fn().mockResolvedValue(true),
          status: jest.fn().mockResolvedValue({
            current: undefined,
            staged: [],
            modified: [],
            created: [],
            deleted: [],
            renamed: [],
            isClean: function() { return true; }
          }),
          raw: jest.fn().mockImplementation(() => Promise.resolve(''))
        };
      });
      
      const branch = await getCurrentBranch();
      expect(branch).toBeUndefined();
    });
    
    test('should use CLI fallback when SimpleGit fails', async () => {
      const simpleGitMock = require('simple-git');
      simpleGitMock.simpleGit.mockImplementationOnce(() => {
        throw new Error('SimpleGit failed');
      });
      
      const branch = await getCurrentBranch({ useFallbacks: true });
      expect(branch).toBe('main');
    });
  });
});