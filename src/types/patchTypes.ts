/* --------------------------------------------------------------------------
 *  PatchPilot — Types for patch operations
 * ----------------------------------------------------------------------- */

/**
 * Represents a hunk in a diff
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Represents a parsed patch with hunks
 */
export interface DiffParsedPatch {
  oldFileName?: string;
  newFileName?: string;
  hunks: DiffHunk[];
}

/**
 * Options for applying a patch
 */
export interface ApplyOptions {
  /** Show preview before applying (default: true) */
  preview?: boolean;
  
  /** Auto-stage files to Git after applying (default: from config) */
  autoStage?: boolean;
  
  /** Fuzz factor for context matching (default: from config) */
  fuzz?: 0 | 1 | 2 | 3;
  
  /** Check file modification time before applying (default: from config) */
  mtimeCheck?: boolean;
  
  /** Whether to prompt on file modification */
  mtimePrompt?: boolean;
}

/**
 * Result of applying a patch to a file
 */
export interface ApplyResult {
  /** The file path */
  file: string;
  
  /** Whether the patch was applied successfully */
  status: 'applied' | 'failed';
  
  /** If the patch failed, the reason why */
  reason?: string;
  
  /** The strategy that was used to apply the patch, if successful */
  strategy?: string;
}

/**
 * Information about a file in a patch
 */
export interface FileInfo {
  /** Path to the file */
  filePath: string;
  
  /** Whether the file exists in the workspace */
  exists: boolean;
  
  /** Number of hunks in the patch for this file */
  hunks: number;
  
  /** Changes statistics */
  changes: { 
    additions: number; 
    deletions: number; 
  };
}