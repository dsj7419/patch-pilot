/* --------------------------------------------------------------------------
 *  PatchPilot — Utility functions
 * ----------------------------------------------------------------------- */

import * as crypto from 'crypto';

/**
 * Generates a cryptographically secure nonce string for Content Security Policy
 * @returns A random nonce string
 */
export function getNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Normalizes line endings to LF
 * @param text The text to normalize
 * @returns Text with normalized line endings
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

/**
 * Auto-fixes spaces in context lines of a diff
 * Missing leading spaces on context lines are added
 * @param diffText The diff text to fix
 * @returns Fixed diff text
 */
export function autoFixSpaces(diffText: string): string {
  return diffText
    .split('\n')
    .map(line => {
      // If line is neither a diff header, nor starts with '+', '-', ' ', or '@'
      // then it's likely a context line missing a leading space
      if (line.trim() !== '' && !/^(\+|-| |@|diff |index |---|\+\+\+|@@)/.test(line)) {
        return ' ' + line;
      }
      return line;
    })
    .join('\n');
}

/**
 * Adds missing diff headers if they don't exist
 * @param diffText The diff text to fix
 * @returns Diff text with headers
 */
export function addMissingHeaders(diffText: string): string {
  // If the diff doesn't start with a diff header, add dummy headers
  if (!diffText.trim().startsWith('diff ')) {
    // Extract file path from the first +++ line if possible
    const fileMatch = diffText.match(/\+\+\+ b\/(.+)/);
    const filePath = fileMatch ? fileMatch[1] : 'unknown-file';
    
    const header = [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`
    ].join('\n');
    
    // Check if we already have --- and +++ lines
    if (!diffText.includes('--- ') && !diffText.includes('+++ ')) {
      return header + '\n' + diffText;
    }
    
    // If we have +++ but no ---, add just the diff and --- lines
    if (!diffText.includes('--- ') && diffText.includes('+++ ')) {
      return `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n` + diffText;
    }
  }
  
  return diffText;
}

/**
 * Normalizes a diff by fixing common issues
 * @param diffText The raw diff text
 * @returns Normalized diff
 */
export function normalizeDiff(diffText: string): string {
  // First, normalize actual line endings
  let normalized = normalizeLineEndings(diffText);
  
  // Then handle escaped control characters that appear as literal strings
  normalized = normalized.replace(/\\r\\n|\\r|\\n/g, '');
  
  normalized = autoFixSpaces(normalized);
  normalized = addMissingHeaders(normalized);
  return normalized;
}

/**
 * Extracts file names from a diff header
 * @param diffHeader The diff header line
 * @returns Object with old and new file names
 */
export function extractFileNamesFromHeader(diffHeader: string): { oldFile?: string; newFile?: string } {
  // diff --git a/path/to/file.txt b/path/to/file.txt
  const gitHeaderMatch = diffHeader.match(/^diff --git a\/(.*) b\/(.*)$/);
  if (gitHeaderMatch) {
    // Clean both actual control characters and escaped character sequences
    const oldFile = gitHeaderMatch[1]
      .replace(/[\x00-\x1F\x7F]+/g, '') // Remove actual control characters
      .replace(/\\r|\\n/g, '')          // Remove escaped \r and \n sequences
      .trim();
    const newFile = gitHeaderMatch[2]
      .replace(/[\x00-\x1F\x7F]+/g, '') // Remove actual control characters
      .replace(/\\r|\\n/g, '')          // Remove escaped \r and \n sequences
      .trim();
    return { oldFile, newFile };
  }
  
  return { oldFile: undefined, newFile: undefined };
}

/**
 * Checks if a string is a valid unified diff
 * @param text Text to check
 * @returns True if the text appears to be a unified diff
 */
export function isUnifiedDiff(text: string): boolean {
  if (!text || text.trim() === '') {
    return false;
  }
  
  // Look for common diff markers
  const hasDiffMarker = text.includes('diff --git') || 
                       text.includes('--- ') || 
                       text.includes('+++ ');
  
  // Look for hunk headers with proper format
  const hasHunkHeader = /@@ -\d+,\d+ \+\d+,\d+ @@/.test(text);
  
  // Look for multiple lines starting with +/- to detect diff content
  // Count the number of lines that start with + or -
  const lines = text.split('\n');
  const plusMinusLines = lines.filter(line => /^[+\-]/.test(line.trim()));
  
  // If there are multiple +/- lines, it's likely a diff
  const hasMultiplePlusMinusLines = plusMinusLines.length >= 2;
  
  // Return true if any of these patterns match
  return hasDiffMarker || hasHunkHeader || hasMultiplePlusMinusLines;
}

/**
 * Creates a debounced function
 * @param func The function to debounce
 * @param wait Wait time in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return function(this: unknown, ...args: Parameters<T>): void {
    const context = this;
    const later = () => {
      timeout = null;
      func.apply(context, args);
    };
    
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttles a function to only execute at most once per specified interval
 * @param func The function to throttle
 * @param limit Limit in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return function(this: unknown, ...args: Parameters<T>): void {
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}