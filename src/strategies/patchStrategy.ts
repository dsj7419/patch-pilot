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
    
    const out = DiffLib.applyPatch(content, copy);
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
    const ctx = hunk.lines.filter((l: string) => l.startsWith(' ')).map((l: string) => l.slice(1));
    if (ctx.length === 0) {
      return hunk.oldStart;
    }

    // Calculate minimum number of matches needed based on fuzz
    // With higher fuzz, we need fewer exact matches
    const minMatchesNeeded = Math.max(1, Math.ceil(ctx.length / (fuzz + 1)));
    
    // Search in a wider range around the expected location
    const searchRadius = 100 + (fuzz * 20); // More fuzz = wider search
    const start = Math.max(0, hunk.oldStart - searchRadius);
    const end = Math.min(file.length, hunk.oldStart + searchRadius);

    let bestScore = 0, bestPos = -1;

    for (let i = start; i < end; i++) {
      let score = 0;
      for (let j = 0; j < ctx.length && i + j < file.length; j++) {
        if (file[i + j] === ctx[j]) {
          score++;
        }
      }
      
      if (score > bestScore) {
        bestScore = score; 
        bestPos = i;
        if (score === ctx.length) {
          break; // perfect match
        }
      }
    }
    
    // The key fix: use minMatchesNeeded instead of a hardcoded value
    if (bestScore >= minMatchesNeeded) {
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
            if (fileLines[i + j] === contextLines[j]) {
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
        // Instead of just filtering lines that don't match, we're more aggressive
        // Keep additions/removals and only context lines that actually do match
        const keptLines: string[] = [];
        
        for (const line of h.lines) {
          if (line.startsWith('+')) {
            // Always keep additions
            keptLines.push(line);
          } else if (line.startsWith('-')) {
            // Keep removals
            keptLines.push(line);
          } else if (line.startsWith(' ')) {
            // For context, only keep if it's in the file
            const content = line.slice(1);
            if (fileLines.includes(content)) {
              keptLines.push(line);
            }
          }
        }
        
        h.lines = keptLines;
      } else {
        // Traditional approach as fallback
        h.lines = h.lines.filter((l: string) => {
          return !(l.startsWith(' ') && !fileLines.includes(l.slice(1)));
        });
      }
      
      // Adjust hunk line counts
      const newCount = h.lines.filter((l: string) => l.startsWith('+') || l.startsWith(' ')).length;
      const oldCount = h.lines.filter((l: string) => l.startsWith('-') || l.startsWith(' ')).length;
      
      h.newLines = newCount;
      h.oldLines = oldCount;
    });

    const out = DiffLib.applyPatch(content, copy);
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
    for (const strategy of this.strategies) {
      const result = strategy.apply(content, patch);
      if (result.success) {
        return result;
      }
    }
    
    return { patched: content, success: false };
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
      new GreedyStrategy()
    ]);
  }
}