/* --------------------------------------------------------------------------
 *  PatchPilot — Hunk Manager for partial patch application
 * ----------------------------------------------------------------------- */

import * as DiffLib from 'diff';
import { Change } from 'diff';

export interface HunkRange {
  originalStart: number;
  originalLength: number;
  modifiedStart: number;
  modifiedLength: number;
}

export class HunkManager {
  /**
   * Compares two texts and returns a list of changed hunks.
   * Line numbers are 0-based.
   */
  public compare(original: string, modified: string): HunkRange[] {
    // Explicitly disable ignoreWhitespace to ensure we catch changes like .join('') -> .join('')
    const changes: Change[] = DiffLib.diffLines(original, modified, { ignoreWhitespace: false });
    const hunks: HunkRange[] = [];

    let originalLine = 0;
    let modifiedLine = 0;

    let currentHunk: HunkRange | null = null;

    for (const change of changes) {
      const lineCount = change.count || 0;

      if (change.added || change.removed) {
        currentHunk ??= {
          originalStart: originalLine,
          originalLength: 0,
          modifiedStart: modifiedLine,
          modifiedLength: 0
        };

        if (change.removed) {
          currentHunk.originalLength += lineCount;
          originalLine += lineCount;
        }
        if (change.added) {
          currentHunk.modifiedLength += lineCount;
          modifiedLine += lineCount;
        }
      } else {
        // Unchanged block - close current hunk if exists
        if (currentHunk) {
          hunks.push(currentHunk);
          currentHunk = null;
        }
        originalLine += lineCount;
        modifiedLine += lineCount;
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  /**
   * Reverts a specific hunk in the modified text to its state in the original text.
   */
  public revertHunk(original: string, modified: string, hunk: HunkRange): string {
    const eol = /\r\n/.test(modified) ? '\r\n' : '\n';
    const splitRegex = /\r\n|\r|\n/;
    
    const originalLines = original.split(splitRegex);
    const modifiedLines = modified.split(splitRegex);

    const originalContent = originalLines.slice(hunk.originalStart, hunk.originalStart + hunk.originalLength);

    modifiedLines.splice(hunk.modifiedStart, hunk.modifiedLength, ...originalContent);

    return modifiedLines.join(eol);
  }
}
