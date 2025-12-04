/* --------------------------------------------------------------------------
 *  PatchPilot — Path Sanitization and Validation
 * ----------------------------------------------------------------------- */

import * as path from 'node:path';

/**
 * Sanitizes a file path by removing control characters and normalizing separators.
 * Useful for cleaning paths extracted from diffs or user input.
 * 
 * @param rawPath The raw path string to sanitize
 * @returns The sanitized path string
 */
export function sanitizePath(rawPath: string): string {
  if (!rawPath) {return '';}
  
  return rawPath
    // Remove actual control characters (0-31 and 127)
    .replaceAll(/[\x00-\x1F\x7F]+/g, '')
    // Remove escaped control sequences often found in diffs (\r, \n)
    .replaceAll(/\\r|\\n/g, '')
    // Normalize slashes to forward slashes for consistency during processing
    .replaceAll(/\\/g, '/')
    .trim();
}

/**
 * Validates if a path is safe to use within a workspace.
 * Prevents path traversal and absolute paths.
 * 
 * @param filePath The path to validate
 * @returns True if the path is safe
 */
export function isSafePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  try {
    // Check for null bytes
    if (filePath.includes('\0')) {
      return false;
    }

    // Check for extremely long paths
    if (filePath.length > 1000) {
      return false;
    }

    // Reject absolute paths
    if (path.isAbsolute(filePath)) {
      return false;
    }

    // Normalize path to resolve '..' segments
    const normalizedPath = path.normalize(filePath);

    // Check for path traversal (escaping root)
    if (normalizedPath.startsWith('..') || normalizedPath.includes('..')) {
      // Note: path.normalize resolves 'a/../b' to 'b', so '..' check is mainly for leading '..'
      // or cases where it couldn't be resolved.
      // However, simple string check for '..' after normalization is a good safety net.
      // But we must be careful: '..foo' is valid file name.
      // Better check: segments equal to '..'
      const segments = normalizedPath.split(/[/\\]/);
      if (segments.some(s => s === '..')) {
        return false;
      }
    }

    // Additional safety checks for malicious patterns
    // Reject paths with Windows drive letters or UNC paths if they survived isAbsolute check
    if (/^([a-zA-Z]:|[\\/]{2})/.test(normalizedPath)) {
      return false;
    }

    // Check for control characters (redundant if sanitized, but good for validation)
    if (/[\x00-\x1F\x7F]/.test(normalizedPath)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}