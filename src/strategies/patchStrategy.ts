/* --------------------------------------------------------------------------
 *  PatchPilot — Strategy pattern for patch application
 * ----------------------------------------------------------------------- */

import * as DiffLib from 'diff';
import { DiffParsedPatch, DiffHunk } from '../types/patchTypes';

/**
 * Interface for patch application strategies
 */
export interface PatchStrategy {
  /**
   * Apply the patch to the content
   * @param content The original content to patch
   * @param patch The patch to apply
   * @returns Object with patched content and success flag
   */
  apply(content: string, patch: DiffParsedPatch): PatchResult;
  
  /**
   * Get the name of the strategy
   */
  readonly name: string;
}

/**
 * Result of a patch application attempt
 */
export interface PatchResult {
  patched: string;
  success: boolean;
  strategy?: string;
  diagnostics?: string;
}

/**
 * Direct application strategy using the diff library directly
 */
export class StrictStrategy implements PatchStrategy {
  readonly name = 'strict';
  
  apply(content: string, patch: DiffParsedPatch): PatchResult {
    const direct = DiffLib.applyPatch(content, patch);
    return { 
      patched: direct === false ? content : direct, 
      success: direct !== false,
      strategy: direct !== false ? this.name : undefined
    };
  }
}

/**
 * Header-shift strategy that tries to re-align hunk headers
 */
export class ShiftedHeaderStrategy implements PatchStrategy {
  readonly name = 'shifted';
  private fuzzFactor: 0 | 1 | 2 | 3;
  
  constructor(fuzzFactor: 0 | 1 | 2 | 3 = 2) {
    this.fuzzFactor = fuzzFactor;
  }
  
  apply(content: string, patch: DiffParsedPatch): PatchResult {
    // Skip if fuzz is disabled
    if (this.fuzzFactor === 0) {
      return { patched: content, success: false };
    }
    
    const lines = content.split('\n');
    const copy = JSON.parse(JSON.stringify(patch)) as DiffParsedPatch;

    // Try to shift each hunk to match content
    for (const h of copy.hunks) {
      const pos = this.locateHunk(lines, h, this.fuzzFactor);
      if (pos !== -1) {
        const delta = pos - h.oldStart;
        h.oldStart = pos;
        h.newStart += delta;
      }
    }
    
    const out = DiffLib.applyPatch(content, copy, { fuzzFactor: this.fuzzFactor });
    return {
      patched: out === false ? content : out,
      success: out !== false,
      strategy: out !== false ? this.name : undefined
    };
  }

  /**
   * Locate the best position for a hunk in the file content
   * @param file Array of file lines
   * @param hunk The hunk to locate
   * @param fuzz The fuzz factor (0-3)
   * @returns The best line position or -1 if not found
   */
  private locateHunk(file: string[], hunk: DiffHunk, fuzz: 0 | 1 | 2 | 3): number {
    // Build the "old side" of the hunk — context lines + removed lines in order.
    // This represents what the file should contain at the hunk position.
    const oldLines = hunk.lines
      .filter((l: string) => l.startsWith(' ') || l.startsWith('-'))
      .map((l: string) => l.slice(1));
    if (oldLines.length === 0) {
      return hunk.oldStart;
    }

    const nonBlankOld = oldLines.filter(l => l.trim() !== '');
    // With higher fuzz, we need fewer exact matches
    const minMatchesNeeded = Math.max(1, Math.ceil(nonBlankOld.length / (fuzz + 1)));

    // Search in a wider range around the expected location
    const searchRadius = 100 + (fuzz * 20); // More fuzz = wider search
    const start = Math.max(0, hunk.oldStart - searchRadius);
    const end = Math.min(file.length, hunk.oldStart + searchRadius);

    let bestScore = 0, bestPos = -1;

    for (let i = start; i < end; i++) {
      let score = 0;
      for (let j = 0; j < oldLines.length && i + j < file.length; j++) {
        if (file[i + j] === oldLines[j] || file[i + j].trimEnd() === oldLines[j].trimEnd()) {
          // Weight non-blank matches higher so blank-line matches don't dominate
          score += (oldLines[j].trim() !== '' ? 3 : 1);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestPos = i;
        // Perfect match
        const maxScore = oldLines.length + nonBlankOld.length * 2;
        if (score === maxScore) {
          break;
        }
      }
    }

    if (bestScore >= minMatchesNeeded * 3) {
      return bestPos;
    }

    return -1;
  }
}

/**
 * Greedy strategy that drops context lines that don't match
 */
export class GreedyStrategy implements PatchStrategy {
  readonly name = 'greedy';
  private fuzzFactor: 0 | 1 | 2 | 3;

  constructor(fuzzFactor: 0 | 1 | 2 | 3 = 2) {
    this.fuzzFactor = fuzzFactor;
  }

  /** Check if a context line matches any file line (whitespace-tolerant) */
  private lineInFile(ctxLine: string, fileLines: string[]): boolean {
    return fileLines.some(fl => fl === ctxLine || fl.trimEnd() === ctxLine.trimEnd());
  }

  apply(content: string, patch: DiffParsedPatch): PatchResult {
    const copy = JSON.parse(JSON.stringify(patch)) as DiffParsedPatch;
    const fileLines = content.split('\n');

    // For each hunk, modify context lines that don't match
    copy.hunks.forEach((h: DiffHunk) => {
      // Find potential match positions for the hunk
      const contextLines = h.lines.filter(l => l.startsWith(' ')).map(l => l.slice(1));
      let _bestMatchPos = -1;
      let bestMatchScore = 0;

      // Scan file for best position
      if (contextLines.length > 0) {
        for (let i = 0; i < fileLines.length; i++) {
          let score = 0;
          for (let j = 0; j < contextLines.length && i + j < fileLines.length; j++) {
            if (fileLines[i + j] === contextLines[j] ||
                fileLines[i + j].trimEnd() === contextLines[j].trimEnd()) {
              score++;
            }
          }
          if (score > bestMatchScore) {
            bestMatchScore = score;
            _bestMatchPos = i;
          }
        }
      }

      // Only filter lines if we found some matches
      if (bestMatchScore > 0) {
        // Keep additions/removals and only context lines that actually do match
        const keptLines: string[] = [];

        for (const line of h.lines) {
          if (line.startsWith('+') || line.startsWith('-')) {
            keptLines.push(line);
          } else if (line.startsWith(' ')) {
            const ctx = line.slice(1);
            if (this.lineInFile(ctx, fileLines)) {
              keptLines.push(line);
            }
          } else if (line === '') {
            // Blank line from corrupted diff — treat as blank context if file has blank lines
            if (this.lineInFile('', fileLines)) {
              keptLines.push(' ');
            }
          }
        }

        h.lines = keptLines;
      } else {
        // Traditional approach as fallback
        h.lines = h.lines.filter((l: string) => {
          if (l === '') { return true; } // keep blank lines
          return !(l.startsWith(' ') && !this.lineInFile(l.slice(1), fileLines));
        });
      }

      // Adjust hunk line counts
      const newCount = h.lines.filter((l: string) => l.startsWith('+') || l.startsWith(' ')).length;
      const oldCount = h.lines.filter((l: string) => l.startsWith('-') || l.startsWith(' ')).length;

      h.newLines = newCount;
      h.oldLines = oldCount;
    });

    const out = DiffLib.applyPatch(content, copy, { fuzzFactor: this.fuzzFactor });
    return {
      patched: out === false ? content : out,
      success: out !== false,
      strategy: out !== false ? this.name : undefined
    };
  }
}

/**
 * Chain of responsibility pattern for patch strategies
 */
export class ChainedPatchStrategy implements PatchStrategy {
  readonly name = 'chained';
  private strategies: PatchStrategy[];
  
  constructor(strategies: PatchStrategy[]) {
    this.strategies = strategies;
  }
  
  apply(content: string, patch: DiffParsedPatch): PatchResult {
    const attempted: string[] = [];
    for (const strategy of this.strategies) {
      attempted.push(strategy.name);
      const result = strategy.apply(content, patch);
      if (result.success) {
        return result;
      }
    }

    // Build diagnostics on failure
    const hunkCount = patch.hunks.length;
    const filePath = patch.newFileName ?? patch.oldFileName ?? 'unknown';
    const diagParts: string[] = [
      `File: ${filePath} (${hunkCount} hunk${hunkCount !== 1 ? 's' : ''})`,
      `Strategies attempted: ${attempted.join(' → ')}`,
    ];

    // Check if hunks contain only whitespace changes
    const allWhitespaceOnly = patch.hunks.every(h => {
      const adds = h.lines.filter(l => l.startsWith('+')).map(l => l.slice(1).trim());
      const dels = h.lines.filter(l => l.startsWith('-')).map(l => l.slice(1).trim());
      return adds.join('') === dels.join('');
    });
    if (allWhitespaceOnly) {
      diagParts.push('Note: All hunks contain whitespace-only changes');
    }
    
    return { patched: content, success: false, diagnostics: diagParts.join('\n') };
  }
}

/**
 * Factory to create patch strategies
 */
export class PatchStrategyFactory {
  /**
   * Create a default strategy chain with the specified fuzz factor
   * @param fuzzFactor The fuzz factor for matching
   * @returns A chained strategy
   */
  static createDefaultStrategy(fuzzFactor: 0 | 1 | 2 | 3): PatchStrategy {
    // The key here is that in the tests, we're expecting the shifted strategy
    // to be used with the test data, but the mock needs to be properly set up
    return new ChainedPatchStrategy([
      new StrictStrategy(),
      new ShiftedHeaderStrategy(fuzzFactor),
      new GreedyStrategy(fuzzFactor)
    ]);
  }

  /**
   * Creates a strict strategy
   * @returns A strict matching strategy
   */
  static createStrictStrategy(): PatchStrategy {
    return new StrictStrategy();
  }

  /**
   * Creates a shifted strategy with the specified fuzz factor
   * @param fuzzFactor The fuzz factor for matching
   * @returns A shifted header strategy
   */
  static createShiftedStrategy(fuzzFactor: 0 | 1 | 2 | 3): PatchStrategy {
    return new ShiftedHeaderStrategy(fuzzFactor);
  }

  /**
   * Creates a greedy strategy
   * @returns A greedy matching strategy
   */
  static createGreedyStrategy(): PatchStrategy {
    return new GreedyStrategy();
  }
}