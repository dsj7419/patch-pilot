// src/fileSystem.ts

import * as vscode from 'vscode';

/**
 * Options for file modification check
 */
export interface FileModificationOptions {
  /** Whether to check file modification time */
  mtimeCheck: boolean;
  
  /** Whether to prompt user for confirmation if file has changed */
  promptOnModification: boolean;
  
  /** Message to show when prompting for confirmation */
  promptMessage?: string;
}

/**
 * Result of a file modification check
 */
export interface FileModificationResult {
  /** Whether the file has been modified */
  modified: boolean;
  
  /** Whether the operation should proceed */
  proceed: boolean;
  
  /** Original file stats */
  originalStats?: vscode.FileStat;
  
  /** Current file stats */
  currentStats?: vscode.FileStat;
}

/**
 * Logs a message to VS Code output channel if possible
 * This is a supplementary logging method used alongside console methods
 * @param message The message to log
 */
function logToVSCode(message: string): void {
  try {
    const output = vscode.window.createOutputChannel('PatchPilot');
    if (output && output.appendLine) {
      output.appendLine(message);
    }
  } catch (_e) {
    // Silently fail if VS Code API is not available
  }
}

/**
 * Checks if a file has been modified since the given stats were collected
 * @param fileUri The URI of the file to check
 * @param originalStats The original file stats
 * @param options Options for the check
 * @returns A result object indicating if the file was modified and if the operation should proceed
 */
export async function checkFileModification(
  fileUri: vscode.Uri,
  originalStats: vscode.FileStat,
  options: FileModificationOptions
): Promise<FileModificationResult> {
  // If mtimeCheck is disabled, always proceed
  if (!options.mtimeCheck) {
    return { modified: false, proceed: true, originalStats };
  }
  
  try {
    // Get current file stats
    const currentStats = await vscode.workspace.fs.stat(fileUri);
    
    // Check if the file has been modified
    const modified = originalStats.mtime !== currentStats.mtime;
    
    // If not modified, proceed
    if (!modified) {
      return { modified: false, proceed: true, originalStats, currentStats };
    }
    
    // If modified and we should prompt, ask the user
    if (options.promptOnModification) {
      // FIXED: properly check if fileUri is defined before calling toString
      const fileName = fileUri ? vscode.workspace.asRelativePath(fileUri) : 'file';
      const message = options.promptMessage || 
        `File ${fileName} has been modified since it was read. Proceed anyway?`;
      
      const choice = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Proceed Anyway',
        'Cancel'
      );
      
      return { 
        modified: true, 
        proceed: choice === 'Proceed Anyway',
        originalStats,
        currentStats
      };
    }
    
    // If modified and we shouldn't prompt, don't proceed
    return { modified: true, proceed: false, originalStats, currentStats };
  } catch (error) {
    // If there's an error checking the file, log it and proceed
    const filePathString = fileUri ? fileUri.toString() : 'unknown file';
    const errorMessage = `Error checking file modification for ${filePathString}: ${error}`;
    
    // Log to console for test compatibility - this must be called directly
    console.warn(errorMessage);
    
    // Also try to log to VS Code output channel
    logToVSCode(errorMessage);
    
    return { modified: false, proceed: true, originalStats };
  }
}

/**
 * Wrapper for file operations that need modification checking
 * @param fileUri The URI of the file to operate on
 * @param operation The operation to perform
 * @param options Options for the modification check
 * @returns The result of the operation
 */
export async function withModificationCheck<T>(
  fileUri: vscode.Uri,
  operation: (currentStats: vscode.FileStat) => Promise<T>,
  options: FileModificationOptions
): Promise<T | undefined> {
  try {
    // Get initial stats
    const originalStats = await vscode.workspace.fs.stat(fileUri);
    
    // Perform the operation
    const result = await operation(originalStats);
    
    // Check modification after operation
    const modificationResult = await checkFileModification(fileUri, originalStats, options);
    
    // If the file was modified and we shouldn't proceed, return undefined
    if (modificationResult.modified && !modificationResult.proceed) {
      return undefined;
    }
    
    // Otherwise, return the result
    return result;
  } catch (error) {
    // If there's an error, log it and re-throw
    const errorMessage = `Error performing operation with modification check: ${error}`;
    
    // Log to console for test compatibility - this must be called directly
    console.error(errorMessage);
    
    // Also try to log to VS Code output channel
    logToVSCode(errorMessage);
    
    throw error;
  }
}