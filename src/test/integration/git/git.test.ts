// src/test/integration/git/git.test.ts
import {
    isGitAvailable,
    autoStageFiles,
    createTempBranch,
    hasUncommittedChanges,
    getCurrentBranch,
    createCommit,
    getLastCommitFiles,
    GitError
  } from '../../../git';
  import * as simpleGit from 'simple-git';
  import * as vscode from 'vscode';
  
  // Mock dependencies
  jest.mock('vscode');
  jest.mock('simple-git');
  jest.mock('../../../telemetry', () => ({
    trackEvent: jest.fn()
  }));
  
  describe('Git Module', () => {
    let mockGit: any;
  
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
          staged: [],
          modified: [],
          created: [],
          deleted: [],
          renamed: []
        }),
        checkoutLocalBranch: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('main'),
        commit: jest.fn().mockResolvedValue({ commit: 'abcd1234' }),
        diff: jest.fn().mockResolvedValue('file1.ts\nfile2.ts')
      };
      
      // Setup simple-git default export mock
      (simpleGit.default as jest.Mock).mockReturnValue(mockGit);
      
      // Setup vscode window mock
      (vscode.window.createOutputChannel as jest.Mock).mockReturnValue({
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn()
      });
      
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Yes');
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
        expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('PatchPilot Git');
      });
      
      it('should return false when no workspace folders exist', async () => {
        // Mock no workspace folders
        (vscode.workspace.workspaceFolders as any) = undefined;
        
        const result = await isGitAvailable();
        
        expect(result).toBe(false);
      });
    });
  
    describe('autoStageFiles', () => {
      it('should stage files and show confirmation message', async () => {
        await autoStageFiles(['file1.ts', 'file2.ts']);
        
        expect(mockGit.add).toHaveBeenCalledWith(['file1.ts', 'file2.ts']);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'Staged 2 file(s) to Git.'
        );
      });
  
      it('should throw GitError when staging fails', async () => {
        mockGit.add.mockRejectedValue(new Error('Staging failed'));
        
        await expect(autoStageFiles(['file1.ts'])).rejects.toThrow(GitError);
        expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('PatchPilot Git');
      });
      
      it('should throw GitError when no Git repository is found', async () => {
        mockGit.checkIsRepo.mockResolvedValue(false);
        
        await expect(autoStageFiles(['file1.ts'])).rejects.toThrow(GitError);
      });
    });
  
    describe('createTempBranch', () => {
        it('should create a branch with the provided name', async () => {
          await createTempBranch('custom-branch');
          
          expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith('custom-branch');
          expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Created and switched to branch \'custom-branch\'.'
          );
        });
    
        it('should create a branch with generated name when name not provided', async () => {
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
    
        it('should warn when uncommitted changes exist', async () => {
          // Mock status to have uncommitted changes
          mockGit.status.mockResolvedValue({
            staged: [],
            modified: ['modified.ts'],
            created: [],
            deleted: [],
            renamed: []
          });
          
          await createTempBranch('with-changes');
          
          expect(vscode.window.showWarningMessage).toHaveBeenCalled();
          expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith('with-changes');
        });
    
        it('should cancel branch creation if user chooses not to proceed with uncommitted changes', async () => {
          // Mock status to have uncommitted changes
          mockGit.status.mockResolvedValue({
            staged: [],
            modified: ['modified.ts'],
            created: [],
            deleted: [],
            renamed: []
          });
          
          // Simulate user declining to proceed
          (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('No');
          
          await expect(createTempBranch('cancelled')).rejects.toThrow(GitError);
          expect(mockGit.checkoutLocalBranch).not.toHaveBeenCalled();
        });
        
        it('should throw GitError when no Git repository is found', async () => {
          mockGit.checkIsRepo.mockResolvedValue(false);
          
          await expect(createTempBranch('test-branch')).rejects.toThrow(GitError);
          expect(mockGit.checkoutLocalBranch).not.toHaveBeenCalled();
        });
      });
    
      describe('hasUncommittedChanges', () => {
        it('should return true when there are modified files', async () => {
          mockGit.status.mockResolvedValue({
            staged: [],
            modified: ['modified.ts'],
            created: [],
            deleted: [],
            renamed: []
          });
          
          const result = await hasUncommittedChanges();
          
          expect(result).toBe(true);
        });
    
        it('should return true when there are staged files', async () => {
          mockGit.status.mockResolvedValue({
            staged: ['staged.ts'],
            modified: [],
            created: [],
            deleted: [],
            renamed: []
          });
          
          const result = await hasUncommittedChanges();
          
          expect(result).toBe(true);
        });
    
        it('should return false when there are no changes', async () => {
          mockGit.status.mockResolvedValue({
            staged: [],
            modified: [],
            created: [],
            deleted: [],
            renamed: []
          });
          
          const result = await hasUncommittedChanges();
          
          expect(result).toBe(false);
        });
        
        it('should return false when Git repository is not found', async () => {
          mockGit.checkIsRepo.mockResolvedValue(false);
          
          const result = await hasUncommittedChanges();
          
          expect(result).toBe(false);
        });
        
        it('should return false and log error when status check fails', async () => {
          mockGit.status.mockRejectedValue(new Error('Status check failed'));
          
          const result = await hasUncommittedChanges();
          
          expect(result).toBe(false);
          expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('PatchPilot Git');
        });
      });
    
      describe('getCurrentBranch', () => {
        it('should return the current branch name', async () => {
          mockGit.revparse.mockResolvedValue('feature-branch');
          
          const result = await getCurrentBranch();
          
          expect(result).toBe('feature-branch');
          expect(mockGit.revparse).toHaveBeenCalledWith(['--abbrev-ref', 'HEAD']);
        });
    
        it('should return undefined on error', async () => {
          mockGit.revparse.mockRejectedValue(new Error('Git error'));
          
          const result = await getCurrentBranch();
          
          expect(result).toBeUndefined();
          expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('PatchPilot Git');
        });
        
        it('should return undefined when Git repository is not found', async () => {
          mockGit.checkIsRepo.mockResolvedValue(false);
          
          const result = await getCurrentBranch();
          
          expect(result).toBeUndefined();
        });
      });
    
      describe('createCommit', () => {
        it('should create a commit with the provided message', async () => {
          // Mock status to have staged changes
          mockGit.status.mockResolvedValue({
            staged: ['staged.ts']
          });
          
          const result = await createCommit('Test commit message');
          
          expect(result).toBe('abcd1234');
          expect(mockGit.commit).toHaveBeenCalledWith('Test commit message');
          expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Created commit: Test commit message'
          );
        });
    
        it('should throw GitError when no staged changes exist', async () => {
          // Mock status to have no staged changes
          mockGit.status.mockResolvedValue({
            staged: []
          });
          
          await expect(createCommit('No changes')).rejects.toThrow(GitError);
          expect(mockGit.commit).not.toHaveBeenCalled();
        });
        
        it('should throw GitError when Git repository is not found', async () => {
          mockGit.checkIsRepo.mockResolvedValue(false);
          
          await expect(createCommit('Test message')).rejects.toThrow(GitError);
        });
        
        it('should throw GitError when commit fails', async () => {
          // Mock status to have staged changes but commit fails
          mockGit.status.mockResolvedValue({
            staged: ['staged.ts']
          });
          mockGit.commit.mockRejectedValue(new Error('Commit failed'));
          
          await expect(createCommit('Failed commit')).rejects.toThrow(GitError);
          expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('PatchPilot Git');
        });
      });
    
      describe('getLastCommitFiles', () => {
        it('should return the list of files from the last commit', async () => {
          const result = await getLastCommitFiles();
          
          expect(result).toEqual(['file1.ts', 'file2.ts']);
          expect(mockGit.diff).toHaveBeenCalledWith(['--name-only', 'HEAD~1', 'HEAD']);
        });
    
        it('should return empty array on error', async () => {
          mockGit.diff.mockRejectedValue(new Error('Git error'));
          
          const result = await getLastCommitFiles();
          
          expect(result).toEqual([]);
          expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('PatchPilot Git');
        });
        
        it('should return empty array when Git repository is not found', async () => {
          mockGit.checkIsRepo.mockResolvedValue(false);
          
          const result = await getLastCommitFiles();
          
          expect(result).toEqual([]);
        });
        
        it('should handle empty diff output', async () => {
          mockGit.diff.mockResolvedValue('');
          
          const result = await getLastCommitFiles();
          
          expect(result).toEqual([]);
        });
        
        it('should properly split multi-line diff output', async () => {
          mockGit.diff.mockResolvedValue('file1.ts\nfile2.ts\nfile3.ts\n');
          
          const result = await getLastCommitFiles();
          
          expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
        });
      });
      
      describe('GitError', () => {
        it('should be an instance of Error', () => {
          const error = new GitError('Test error');
          
          expect(error).toBeInstanceOf(Error);
          expect(error.name).toBe('GitError');
          expect(error.message).toBe('Test error');
        });
      });
    });