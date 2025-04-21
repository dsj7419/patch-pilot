/* --------------------------------------------------------------------------
 *  PatchPilot — Enhanced Git integration with security and fallbacks
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { simpleGit, SimpleGit } from 'simple-git';
import * as cp from 'child_process';
import { promisify } from 'util';
import { trackEvent } from './telemetry';
import {
  isValidBranchName,
  sanitizeBranchName,
  validateFilePaths,
  isValidCommitMessage,
  sanitizeCommitMessage
} from './security/gitValidation';

// Promisify exec for CLI fallback
const execPromise = promisify(cp.exec);

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
 * Git repository detection result
 */
export interface GitDetectionResult {
  isGitRepo: boolean;
  workspacePath?: string;
  gitPath?: string;
  gitVersion?: string;
}

/**
 * Status of the Git repository
 */
export interface GitStatus {
  isClean: boolean;
  staged: string[];
  modified: string[];
  created: string[];
  deleted: string[];
  renamed: unknown[] | string[];
  isDetachedHead: boolean;
  currentBranch?: string;
}

/**
 * Options for Git operations
 */
export interface GitOptions {
  /**
   * If true, use command line fallbacks when SimpleGit fails
   */
  useFallbacks?: boolean;
  
  /**
   * Output channel for detailed operation logs
   */
  outputChannel?: vscode.OutputChannel;
}

/**
 * Gets the Git instance for the workspace with validation
 * @param options Configuration options
 * @returns SimpleGit instance or throws if not a Git repository
 */
async function getGitInstance(options?: GitOptions): Promise<SimpleGit> {
  // Get workspace folders with validation
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new GitError('No workspace folder open');
  }
  
  // Create output channel if needed
  const outputChannel = options?.outputChannel || 
                        vscode.window.createOutputChannel('PatchPilot Git');
  
  try {
    // Initialize Git in the first workspace folder
    const workspacePath = workspaceFolders[0].uri.fsPath;
    
    // Log attempt to connect
    outputChannel.appendLine(`Initializing Git in ${workspacePath}`);
    
    // Configure simpleGit with appropriate options
    const git = simpleGit(workspacePath, {
        // Avoid binary file output issues with large diffs
        maxConcurrentProcesses: 1,
        // Use type assertion for non-standard options that are supported but not in types
        ...(({ 
          // Cap the output buffer to avoid OOM errors (10 MB)
          maxBufferLength: 10 * 1024 * 1024
        } as unknown) as object),
        // Provide a more secure binary option (with absolute path if available)
        binary: 'git'
      });
    
    // Check if this is a Git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new GitError('Git repository not found in workspace');
    }
    
    return git;
  } catch (error) {
    // Log the error with context
    outputChannel.appendLine(`Error initializing Git: ${error instanceof Error ? error.message : String(error)}`);
    outputChannel.show();
    
    throw new GitError(`Failed to initialize Git: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Detects Git in the workspace with extended information
 * @param options Configuration options
 * @returns Detection result with Git details
 */
export async function detectGit(options?: GitOptions): Promise<GitDetectionResult> {
  const outputChannel = options?.outputChannel || 
                        vscode.window.createOutputChannel('PatchPilot Git');
  
  // Get workspace folders
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { isGitRepo: false };
  }
  
  const workspacePath = workspaceFolders[0].uri.fsPath;
  
  try {
    // Try SimpleGit first
    const git = simpleGit(workspacePath);
    const isRepo = await git.checkIsRepo();
    
    if (isRepo) {
      // Get Git version info
      const versionResult = await git.raw(['--version']);
      const gitVersion = versionResult.trim();
      
      return {
        isGitRepo: true,
        workspacePath,
        gitPath: 'git', // Using default binary
        gitVersion
      };
    }
    
    return { isGitRepo: false, workspacePath };
  } catch (error) {
    // Log the error
    outputChannel.appendLine(`Error detecting Git: ${error instanceof Error ? error.message : String(error)}`);
    
    // Try CLI fallback if enabled
    if (options?.useFallbacks) {
      try {
        // Try using raw git command
        const { stdout } = await execPromise('git --version');
        const gitVersion = stdout.trim();
        
        // Check if the workspace is a git repo
        try {
          await execPromise('git -C ' + JSON.stringify(workspacePath) + ' rev-parse --is-inside-work-tree');
          return {
            isGitRepo: true,
            workspacePath,
            gitPath: 'git',
            gitVersion
          };
        } catch (e) {
          // Not a git repo
          return { isGitRepo: false, workspacePath, gitPath: 'git', gitVersion };
        }
      } catch (e) {
        // Git CLI not available
        return { isGitRepo: false, workspacePath };
      }
    }
    
    // Return failure without fallback
    return { isGitRepo: false, workspacePath };
  }
}

/**
 * Checks if the current workspace is a Git repository
 * @param options Configuration options
 * @returns Promise resolving to whether Git is available
 */
export async function isGitAvailable(options?: GitOptions): Promise<boolean> {
  try {
    const result = await detectGit(options);
    return result.isGitRepo;
  } catch (error) {
    // Create output channel for logging errors
    const outputChannel = options?.outputChannel || 
                          vscode.window.createOutputChannel('PatchPilot Git');
    outputChannel.appendLine(`Error checking Git availability: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Auto-stages files to Git with proper validation
 * @param filePaths Paths to the files to stage
 * @param options Configuration options
 * @returns Promise resolving when the operation is complete
 */
export async function autoStageFiles(
  filePaths: string[],
  options?: GitOptions
): Promise<void> {
  trackEvent('git_action', { action: 'autoStage', fileCount: filePaths.length });
  
  // Create output channel
  const outputChannel = options?.outputChannel || 
                        vscode.window.createOutputChannel('PatchPilot Git');
  
  // Validate and sanitize file paths
  const validPaths = validateFilePaths(filePaths);
  
  if (validPaths.length === 0) {
    throw new GitError('No valid file paths provided for staging');
  }
  
  if (validPaths.length < filePaths.length) {
    // Log warning about invalid paths
    outputChannel.appendLine(`Warning: ${filePaths.length - validPaths.length} invalid file paths were filtered out`);
  }
  
  try {
    const git = await getGitInstance({ ...options, outputChannel });
    
    // Stage the files
    await git.add(validPaths);
    
    // Confirm with message
    vscode.window.showInformationMessage(`Staged ${validPaths.length} file(s) to Git.`);
  } catch (error) {
    // Log the error
    outputChannel.appendLine(`Error staging files: ${error instanceof Error ? error.message : String(error)}`);
    
    // Try CLI fallback if enabled
    if (options?.useFallbacks) {
      try {
        // Get workspace path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          throw new GitError('No workspace folder open');
        }
        
        const workspacePath = workspaceFolders[0].uri.fsPath;
        
        // Use git command line to stage files
        const validPathsQuoted = validPaths.map(p => JSON.stringify(p)).join(' ');
        await execPromise(`git -C ${JSON.stringify(workspacePath)} add ${validPathsQuoted}`);
        
        // Confirm with message
        vscode.window.showInformationMessage(`Staged ${validPaths.length} file(s) to Git.`);
        return;
      } catch (cliError) {
        // Log CLI fallback error and continue to throw
        outputChannel.appendLine(`CLI fallback error: ${cliError instanceof Error ? cliError.message : String(cliError)}`);
      }
    }
    
    // Throw the original error
    throw new GitError(`Failed to stage files: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Creates a temporary branch for the patch with name validation
 * @param branchName Optional branch name, defaults to patchpilot/<timestamp>
 * @param options Configuration options
 * @returns Promise resolving to the created branch name
 */
export async function createTempBranch(
  branchName?: string,
  options?: GitOptions
): Promise<string> {
  trackEvent('git_action', { action: 'createBranch' });
  
  // Create output channel
  const outputChannel = options?.outputChannel || 
                        vscode.window.createOutputChannel('PatchPilot Git');
  
  // Generate or validate branch name
  let actualBranchName: string;
  
  if (branchName) {
    // If provided, validate and sanitize if needed
    if (!isValidBranchName(branchName)) {
      const sanitized = sanitizeBranchName(branchName);
      outputChannel.appendLine(`Branch name '${branchName}' is invalid, sanitized to '${sanitized}'`);
      actualBranchName = sanitized;
    } else {
      actualBranchName = branchName;
    }
  } else {
    // Generate a safe timestamp-based branch name
    actualBranchName = `patchpilot/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }
  
  try {
    const git = await getGitInstance({ ...options, outputChannel });
    
    // Check for uncommitted changes
    const status = await git.status();
    const hasChanges = status.modified.length > 0 || 
                      status.created.length > 0 || 
                      status.deleted.length > 0;
    
    // Check for detached HEAD state
    const headCheck = await git.raw(['symbolic-ref', '-q', 'HEAD']);
    const isDetachedHead = !headCheck;
    
    if (isDetachedHead) {
      const shouldProceed = await vscode.window.showWarningMessage(
        'You are in a detached HEAD state. Creating a branch from here may cause issues later.',
        { modal: true },
        'Create From Here',
        'Cancel'
      );
      
      if (shouldProceed !== 'Create From Here') {
        throw new GitError('Branch creation cancelled in detached HEAD state');
      }
    } else if (hasChanges) {
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
    
    // Create and checkout the branch
    await git.checkoutLocalBranch(actualBranchName);
    
    // Confirm with message
    vscode.window.showInformationMessage(`Created and switched to branch '${actualBranchName}'.`);
    
    return actualBranchName;
  } catch (error) {
    // Log the error
    outputChannel.appendLine(`Error creating branch: ${error instanceof Error ? error.message : String(error)}`);
    
    // Try CLI fallback if enabled
    if (options?.useFallbacks) {
      try {
        // Get workspace path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          throw new GitError('No workspace folder open');
        }
        
        const workspacePath = workspaceFolders[0].uri.fsPath;
        
        // Use git command line to create branch
        await execPromise(`git -C ${JSON.stringify(workspacePath)} checkout -b ${JSON.stringify(actualBranchName)}`);
        
        // Confirm with message
        vscode.window.showInformationMessage(`Created and switched to branch '${actualBranchName}'.`);
        return actualBranchName;
      } catch (cliError) {
        // Log CLI fallback error and continue to throw
        outputChannel.appendLine(`CLI fallback error: ${cliError instanceof Error ? cliError.message : String(cliError)}`);
      }
    }
    
    // Throw the original error
    throw new GitError(`Failed to create branch: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gets the status of the Git repository with enhanced info
 * @param options Configuration options
 * @returns Promise resolving to the repository status
 */
export async function getGitStatus(options?: GitOptions): Promise<GitStatus> {
  // Create output channel
  const outputChannel = options?.outputChannel || 
                        vscode.window.createOutputChannel('PatchPilot Git');
  
  try {
    const git = await getGitInstance({ ...options, outputChannel });
    
    // Check for changes
    const status = await git.status();
    
    // Check for detached HEAD state
    const headCheck = await git.raw(['symbolic-ref', '-q', 'HEAD']);
    const isDetachedHead = !headCheck;
    
    return {
      isClean: status.isClean(),
      staged: status.staged,
      modified: status.modified,
      created: status.created,
      deleted: status.deleted,
      renamed: status.renamed,
      isDetachedHead,
      currentBranch: status.current || undefined
    };
  } catch (error) {
    // Log the error
    outputChannel.appendLine(`Error getting Git status: ${error instanceof Error ? error.message : String(error)}`);
    
    // Try CLI fallback if enabled
    if (options?.useFallbacks) {
      try {
        // Get workspace path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          throw new GitError('No workspace folder open');
        }
        
        const workspacePath = workspaceFolders[0].uri.fsPath;
        
        // Use git command line to get status info
        const { stdout: statusOutput } = await execPromise(`git -C ${JSON.stringify(workspacePath)} status --porcelain`);
        const { stdout: branchOutput } = await execPromise(`git -C ${JSON.stringify(workspacePath)} symbolic-ref -q HEAD`);
        
        // Parse status output
        const staged: string[] = [];
        const modified: string[] = [];
        const created: string[] = [];
        const deleted: string[] = [];
        const renamed: string[] = [];
        
        const statusLines = statusOutput.split('\n').filter(Boolean);
        
        for (const line of statusLines) {
          const [status, ...pathParts] = line.trim().split(' ');
          const filePath = pathParts.join(' ');
          
          if (status?.charAt(0) !== ' ' && status?.charAt(0) !== '?') {
            // Staged changes
            if (status?.charAt(0) === 'A') {
              created.push(filePath);
            } else if (status?.charAt(0) === 'D') {
              deleted.push(filePath);
            } else if (status?.charAt(0) === 'M') {
              staged.push(filePath);
            } else if (status?.charAt(0) === 'R') {
              renamed.push(filePath);
            }
          }
          
          if (status?.charAt(1) === 'M') {
            // Modified files
            modified.push(filePath);
          }
        }
        
        // Determine if in detached HEAD state
        const isDetachedHead = !branchOutput;
        
        // Get current branch name
        let currentBranch: string | undefined;
        try {
          const { stdout: nameOutput } = await execPromise(`git -C ${JSON.stringify(workspacePath)} symbolic-ref --short HEAD`);
          currentBranch = nameOutput.trim();
        } catch {
          // In detached HEAD or other issue
          currentBranch = undefined;
        }
        
        return {
          isClean: statusLines.length === 0,
          staged,
          modified,
          created,
          deleted,
          renamed,
          isDetachedHead,
          currentBranch
        };
      } catch (cliError) {
        // Log CLI fallback error and continue to throw
        outputChannel.appendLine(`CLI fallback error: ${cliError instanceof Error ? cliError.message : String(cliError)}`);
      }
    }
    
    // Return an empty status object on error
    return {
      isClean: true,
      staged: [],
      modified: [],
      created: [],
      deleted: [],
      renamed: [],
      isDetachedHead: false
    };
  }
}

/**
 * Checks if there are uncommitted changes in the repository
 * @param options Configuration options
 * @returns Promise resolving to whether there are changes
 */
export async function hasUncommittedChanges(options?: GitOptions): Promise<boolean> {
  try {
    const status = await getGitStatus(options);
    return !status.isClean;
  } catch (error) {
    // Return false on error
    return false;
  }
}

/**
 * Gets the current branch name
 * @param options Configuration options
 * @returns Promise resolving to the current branch name
 */
export async function getCurrentBranch(options?: GitOptions): Promise<string | undefined> {
  try {
    const status = await getGitStatus(options);
    return status.currentBranch;
  } catch (error) {
    // Return undefined on error
    return undefined;
  }
}

/**
 * Creates a commit with the staged changes
 * @param message Commit message
 * @param options Configuration options
 * @returns Promise resolving to the commit hash
 */
export async function createCommit(
  message: string,
  options?: GitOptions
): Promise<string | undefined> {
  trackEvent('git_action', { action: 'commit' });
  
  // Create output channel
  const outputChannel = options?.outputChannel || 
                        vscode.window.createOutputChannel('PatchPilot Git');
  
  // Validate and sanitize commit message
  let safeMessage: string;
  
  if (!isValidCommitMessage(message)) {
    const sanitized = sanitizeCommitMessage(message);
    outputChannel.appendLine(`Commit message was sanitized for security reasons`);
    safeMessage = sanitized;
  } else {
    safeMessage = message;
  }
  
  try {
    const git = await getGitInstance({ ...options, outputChannel });
    
    // Check if there are staged changes
    const status = await git.status();
    if (status.staged.length === 0) {
      throw new GitError('No staged changes to commit');
    }
    
    // Check for detached HEAD state
    const headCheck = await git.raw(['symbolic-ref', '-q', 'HEAD']);
    const isDetachedHead = !headCheck;
    
    if (isDetachedHead) {
      const shouldProceed = await vscode.window.showWarningMessage(
        'You are in a detached HEAD state. Commits here may be lost if you switch branches.',
        { modal: true },
        'Commit Anyway',
        'Cancel'
      );
      
      if (shouldProceed !== 'Commit Anyway') {
        throw new GitError('Commit cancelled in detached HEAD state');
      }
    }
    
    // Create the commit
    const result = await git.commit(safeMessage);
    
    // Show confirmation message
    vscode.window.showInformationMessage(`Created commit: ${safeMessage}`);
    
    return result.commit;
  } catch (error) {
    // Log the error
    outputChannel.appendLine(`Error creating commit: ${error instanceof Error ? error.message : String(error)}`);
    
    // Try CLI fallback if enabled
    if (options?.useFallbacks) {
      try {
        // Get workspace path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          throw new GitError('No workspace folder open');
        }
        
        const workspacePath = workspaceFolders[0].uri.fsPath;
        
        // Use git command line to create commit
        const { stdout } = await execPromise(`git -C ${JSON.stringify(workspacePath)} commit -m ${JSON.stringify(safeMessage)}`);
        
        // Try to extract the commit hash
        const match = stdout.match(/\[[\w\s]+\s([a-f0-9]{7,40})\]/);
        const commitHash = match ? match[1] : undefined;
        
        // Show confirmation message
        vscode.window.showInformationMessage(`Created commit: ${safeMessage}`);
        
        return commitHash;
      } catch (cliError) {
        // Log CLI fallback error and continue to throw
        outputChannel.appendLine(`CLI fallback error: ${cliError instanceof Error ? cliError.message : String(cliError)}`);
      }
    }
    
    // Throw the original error
    throw new GitError(`Failed to create commit: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gets a list of files modified in the last commit
 * @param options Configuration options
 * @returns Promise resolving to an array of modified file paths
 */
export async function getLastCommitFiles(options?: GitOptions): Promise<string[]> {
  // Create output channel
  const outputChannel = options?.outputChannel || 
                        vscode.window.createOutputChannel('PatchPilot Git');
  
  try {
    const git = await getGitInstance({ ...options, outputChannel });
    
    // Get the files from the last commit
    const result = await git.diff(['--name-only', 'HEAD~1', 'HEAD']);
    
    return result.split('\n').filter(line => line.trim() !== '');
  } catch (error) {
    // Log the error
    outputChannel.appendLine(`Error getting last commit files: ${error instanceof Error ? error.message : String(error)}`);
    
    // Try CLI fallback if enabled
    if (options?.useFallbacks) {
      try {
        // Get workspace path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          throw new GitError('No workspace folder open');
        }
        
        const workspacePath = workspaceFolders[0].uri.fsPath;
        
        // Use git command line to get diff
        const { stdout } = await execPromise(`git -C ${JSON.stringify(workspacePath)} diff --name-only HEAD~1 HEAD`);
        
        return stdout.split('\n').filter(line => line.trim() !== '');
      } catch (cliError) {
        // Log CLI fallback error and continue to empty result
        outputChannel.appendLine(`CLI fallback error: ${cliError instanceof Error ? cliError.message : String(cliError)}`);
      }
    }
    
    // Return empty array on error
    return [];
  }
}