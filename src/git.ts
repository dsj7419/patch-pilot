/* --------------------------------------------------------------------------
 *  PatchPilot — Git integration services
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as simpleGit from 'simple-git';
import { trackEvent } from './telemetry';

/**
 * Error class for Git-related errors
 */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Gets the Git instance for the workspace
 * @returns SimpleGit instance or throws if not a Git repository
 */
async function getGitInstance(): Promise<simpleGit.SimpleGit> {
  // Get workspace folders
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new GitError('No workspace folder open');
  }
  
  // Initialize Git in the first workspace folder
  const git = simpleGit.default(workspaceFolders[0].uri.fsPath);
  
  // Check if this is a Git repository
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new GitError('Git repository not found in workspace');
  }
  
  return git;
}

/**
 * Checks if the current workspace is a Git repository
 * @returns Promise resolving to whether Git is available
 */
export async function isGitAvailable(): Promise<boolean> {
  try {
    await getGitInstance();
    return true;
  } catch (error) {
    // Create output channel for logging errors
    const output = vscode.window.createOutputChannel('PatchPilot Git');
    output.appendLine(`Error checking Git availability: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Auto-stages files to Git
 * @param filePaths Paths to the files to stage
 * @returns Promise resolving when the operation is complete
 */
export async function autoStageFiles(filePaths: string[]): Promise<void> {
  trackEvent('git_action', { action: 'autoStage', fileCount: filePaths.length });
  
  try {
    const git = await getGitInstance();
    
    // Stage the files
    await git.add(filePaths);
    
    // Confirm with message
    vscode.window.showInformationMessage(`Staged ${filePaths.length} file(s) to Git.`);
  } catch (error) {
    const output = vscode.window.createOutputChannel('PatchPilot Git');
    output.appendLine(`Error staging files: ${error instanceof Error ? error.message : String(error)}`);
    throw new GitError(`Failed to stage files: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Creates a temporary branch for the patch
 * @param branchName Optional branch name, defaults to patchpilot/<timestamp>
 * @returns Promise resolving to the created branch name
 */
export async function createTempBranch(branchName?: string): Promise<string> {
  trackEvent('git_action', { action: 'createBranch' });
  
  try {
    const git = await getGitInstance();
    
    // Check for uncommitted changes
    const status = await git.status();
    const hasChanges = status.modified.length > 0 || 
                      status.created.length > 0 || 
                      status.deleted.length > 0;
    
    if (hasChanges) {
      const shouldProceed = await vscode.window.showWarningMessage(
        'You have uncommitted changes. Creating a new branch will carry these changes over. Continue?',
        { modal: true },
        'Yes',
        'No'
      );
      
      if (shouldProceed !== 'Yes') {
        throw new GitError('Branch creation cancelled due to uncommitted changes');
      }
    }
    
    // Generate branch name if not provided
    const branch = branchName || `patchpilot/${new Date().toISOString().replace(/[:.]/g, '-')}`;
    
    // Create and checkout the branch
    await git.checkoutLocalBranch(branch);
    
    // Confirm with message
    vscode.window.showInformationMessage(`Created and switched to branch '${branch}'.`);
    
    return branch;
  } catch (error) {
    const output = vscode.window.createOutputChannel('PatchPilot Git');
    output.appendLine(`Error creating branch: ${error instanceof Error ? error.message : String(error)}`);
    throw new GitError(`Failed to create branch: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Checks if there are uncommitted changes in the repository
 * @returns Promise resolving to whether there are changes
 */
export async function hasUncommittedChanges(): Promise<boolean> {
  try {
    const git = await getGitInstance();
    
    // Check for changes
    const status = await git.status();
    
    return (
      status.staged.length > 0 ||
      status.modified.length > 0 ||
      status.created.length > 0 ||
      status.deleted.length > 0 ||
      status.renamed.length > 0
    );
  } catch (error) {
    const output = vscode.window.createOutputChannel('PatchPilot Git');
    output.appendLine(`Error checking for uncommitted changes: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Gets the current branch name
 * @returns Promise resolving to the current branch name
 */
export async function getCurrentBranch(): Promise<string | undefined> {
  try {
    const git = await getGitInstance();
    
    // Get current branch
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    
    return branch;
  } catch (error) {
    const output = vscode.window.createOutputChannel('PatchPilot Git');
    output.appendLine(`Error getting current branch: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Creates a commit with the staged changes
 * @param message Commit message
 * @returns Promise resolving to the commit hash
 */
export async function createCommit(message: string): Promise<string | undefined> {
  trackEvent('git_action', { action: 'commit' });
  
  try {
    const git = await getGitInstance();
    
    // Check if there are staged changes
    const status = await git.status();
    if (status.staged.length === 0) {
      throw new GitError('No staged changes to commit');
    }
    
    // Create the commit
    const result = await git.commit(message);
    
    // Show confirmation message
    vscode.window.showInformationMessage(`Created commit: ${message}`);
    
    return result.commit;
  } catch (error) {
    const output = vscode.window.createOutputChannel('PatchPilot Git');
    output.appendLine(`Error creating commit: ${error instanceof Error ? error.message : String(error)}`);
    throw new GitError(`Failed to create commit: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gets a list of files modified in the last commit
 * @returns Promise resolving to an array of modified file paths
 */
export async function getLastCommitFiles(): Promise<string[]> {
  try {
    const git = await getGitInstance();
    
    // Get the files from the last commit
    const result = await git.diff(['--name-only', 'HEAD~1', 'HEAD']);
    
    return result.split('\n').filter(line => line.trim() !== '');
  } catch (error) {
    const output = vscode.window.createOutputChannel('PatchPilot Git');
    output.appendLine(`Error getting last commit files: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}