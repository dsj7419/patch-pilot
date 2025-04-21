/* --------------------------------------------------------------------------
 *  PatchPilot — Optimized strategy patterns for patch application
 * ----------------------------------------------------------------------- */

import * as DiffLib from 'diff';
import { DiffParsedPatch, DiffHunk } from '../types/patchTypes';
import {
  PatchStrategy,
  PatchResult,
  StrictStrategy,
  ShiftedHeaderStrategy} from './patchStrategy';

/**
 * Optimized Greedy strategy that uses memoization and indexing to
 * efficiently handle large diffs, especially when context lines
 * don't match the source content.
 */
export class OptimizedGreedyStrategy implements PatchStrategy {
  readonly name = 'optimized-greedy';
  
  apply(content: string, patch: DiffParsedPatch): PatchResult {
    // Clone the patch to avoid modifying the original
    const copy = this.clonePatch(patch);
    const fileLines = content.split('\n');
    
    // Build a line index for faster lookups - O(n) upfront cost
    // but O(1) lookups later instead of O(n) scanning
    const lineIndex = this.buildLineIndex(fileLines);
    
    // Process each hunk
    for (const hunk of copy.hunks) {
      this.optimizeHunk(hunk, fileLines, lineIndex);
    }
    
    // Try to apply the modified patch
    const out = DiffLib.applyPatch(content, copy);
    return { 
      patched: out === false ? content : out, 
      success: out !== false,
      strategy: out !== false ? this.name : undefined
    };
  }
  
  /**
   * Creates a deep clone of the patch object to avoid modifying the original
   */
  private clonePatch(patch: DiffParsedPatch): DiffParsedPatch {
    return JSON.parse(JSON.stringify(patch));
  }
  
  /**
   * Builds an index of all lines in the file for O(1) lookups
   * Use a Map for better performance with large string keys
   */
  private buildLineIndex(fileLines: string[]): Map<string, number[]> {
    const index = new Map<string, number[]>();
    
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      
      if (!index.has(line)) {
        index.set(line, []);
      }
      
      index.get(line)!.push(i);
    }
    
    return index;
  }
  
  /**
   * Optimizes a hunk by filtering or preserving lines based on content matching
   */
  private optimizeHunk(hunk: DiffHunk, fileLines: string[], lineIndex: Map<string, number[]>): void {
    // Find context lines that need verification
    const contextLines = hunk.lines
      .filter(l => l.startsWith(' '))
      .map(l => l.slice(1)); // Remove the leading space
    
    // If there are any context lines to check
    if (contextLines.length > 0) {
      const keptLines: string[] = [];
      
      // Two-pass optimization:
      // 1. First collect all add/remove lines (always preserved)
      // 2. Then determine which context lines to keep
      
      // Pass 1: Always keep additions and removals
      for (const line of hunk.lines) {
        if (line.startsWith('+') || line.startsWith('-')) {
          keptLines.push(line);
        }
      }
      
      // Pass 2: Only keep context lines that actually match
      const preservedContext = new Set<string>();
      
      for (const contextContent of contextLines) {
        if (lineIndex.has(contextContent)) {
          preservedContext.add(contextContent);
          
          // Add the context line with proper prefix
          keptLines.push(` ${contextContent}`);
        }
      }
      
      // Update the hunk lines
      hunk.lines = keptLines;
      
      // Adjust hunk line counts
      this.updateHunkLineCounts(hunk);
    }
  }
  
  /**
   * Updates the line count fields of a hunk based on its current lines
   */
  private updateHunkLineCounts(hunk: DiffHunk): void {
    const newCount = hunk.lines.filter(l => l.startsWith('+') || l.startsWith(' ')).length;
    const oldCount = hunk.lines.filter(l => l.startsWith('-') || l.startsWith(' ')).length;
    
    hunk.newLines = newCount;
    hunk.oldLines = oldCount;
  }
}

/**
 * Optimized version of the chained strategy that intelligently
 * selects which strategies to try based on heuristics
 */
export class OptimizedChainedStrategy implements PatchStrategy {
  readonly name = 'optimized-chained';
  private strategies: PatchStrategy[];
  
  constructor(strategies: PatchStrategy[]) {
    this.strategies = strategies;
  }
  
  /**
   * Apply the optimal strategy based on the characteristics of the patch
   */
  apply(content: string, patch: DiffParsedPatch): PatchResult {
    // For small patches, try all strategies in sequence
    if (this.isSmallPatch(patch)) {
      return this.applyAllStrategies(content, patch);
    }
    
    // For large patches with multiple hunks, try an adaptive approach
    return this.applyAdaptiveStrategy(content, patch);
  }
  
  /**
   * Traditional approach: try all strategies in sequence until one succeeds
   */
  private applyAllStrategies(content: string, patch: DiffParsedPatch): PatchResult {
    for (const strategy of this.strategies) {
      const result = strategy.apply(content, patch);
      if (result.success) {
        return result;
      }
    }
    
    return { patched: content, success: false };
  }
  
  /**
   * Adaptive approach for large patches:
   * 1. Try the first hunk with strict strategy
   * 2. If it fails, try the first hunk with shifted strategy
   * 3. Based on which strategy works for the first hunk, apply that to all hunks
   * 4. If both fail, fall back to the optimized greedy strategy
   */
  private applyAdaptiveStrategy(content: string, patch: DiffParsedPatch): PatchResult {
    // No hunks or single hunk? Use the normal approach
    if (!patch.hunks || patch.hunks.length <= 1) {
      return this.applyAllStrategies(content, patch);
    }
    
    // Extract the first hunk to test strategies
    const firstHunkPatch = this.clonePatch(patch);
    firstHunkPatch.hunks = [firstHunkPatch.hunks[0]];
    
    // Try strict strategy on first hunk
    const strictResult = this.strategies[0].apply(content, firstHunkPatch);
    if (strictResult.success) {
      // First hunk worked with strict, likely all will
      return this.strategies[0].apply(content, patch);
    }
    
    // Try shifted strategy on first hunk if available
    if (this.strategies.length > 1) {
      const shiftedResult = this.strategies[1].apply(content, firstHunkPatch);
      if (shiftedResult.success) {
        // First hunk worked with shifted, likely all will
        return this.strategies[1].apply(content, patch);
      }
    }
    
    // If we have a greedy or optimized greedy strategy, use it as last resort
    const greedyStrategy = this.strategies.find(s => 
      s.name === 'greedy' || s.name === 'optimized-greedy'
    );
    
    if (greedyStrategy) {
      return greedyStrategy.apply(content, patch);
    }
    
    // If all else fails, try remaining strategies
    return this.applyAllStrategies(content, patch);
  }
  
  /**
   * Clone a patch to avoid modifying the original
   */
  private clonePatch(patch: DiffParsedPatch): DiffParsedPatch {
    return JSON.parse(JSON.stringify(patch));
  }
  
  /**
   * Determines if a patch is small enough for the simple approach
   * Heuristic: fewer than 5 hunks and fewer than 500 lines total
   */
  private isSmallPatch(patch: DiffParsedPatch): boolean {
    if (!patch.hunks || patch.hunks.length < 5) {
      const totalLines = patch.hunks.reduce(
        (sum, hunk) => sum + hunk.lines.length, 0
      );
      return totalLines < 500;
    }
    return false;
  }
}

/**
 * Updated factory to create optimal strategy chain based on
 * the fuzz factor and performance considerations
 */
export class OptimizedPatchStrategyFactory {
  /**
   * Create a strategy chain optimized for performance with the specified fuzz factor
   * @param fuzzFactor The fuzz factor for matching (0-3)
   * @returns A patch strategy optimized for the given parameters
   */
  static createOptimizedStrategy(fuzzFactor: 0 | 1 | 2 | 3): PatchStrategy {
    const strategies: PatchStrategy[] = [
      new StrictStrategy()
    ];
    
    // Only add shifted strategy if fuzz is enabled
    if (fuzzFactor > 0) {
      strategies.push(new ShiftedHeaderStrategy(fuzzFactor));
    }
    
    // Always use the optimized greedy strategy for better performance
    strategies.push(new OptimizedGreedyStrategy());
    
    // Use the optimized chained strategy for better performance
    return new OptimizedChainedStrategy(strategies);
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
   * @returns An optimized shifted header strategy
   */
  static createShiftedStrategy(fuzzFactor: 0 | 1 | 2 | 3): PatchStrategy {
    return new ShiftedHeaderStrategy(fuzzFactor);
  }

  /**
   * Creates a greedy strategy
   * @returns An optimized greedy matching strategy
   */
  static createGreedyStrategy(): PatchStrategy {
    return new OptimizedGreedyStrategy();
  }
}

/**
 * Integrates the optimized strategies into the main application
 * This function can be used to replace the standard strategies when performance is critical
 * 
 * @param standardStrategy The current patch strategy to replace
 * @param fuzzFactor The fuzz factor (0-3) to use for optimized strategies
 * @returns A patching function that uses optimized strategies
 */
export function useOptimizedStrategies(
  standardStrategy: PatchStrategy,
  fuzzFactor: 0 | 1 | 2 | 3 = 2
): PatchStrategy {
  // For small patches, the standard strategy works fine
  // For large patches, use the optimized strategy
  return {
    name: 'performance-optimized',
    apply: (content: string, patch: DiffParsedPatch): PatchResult => {
      // Heuristic: use optimized strategy for patches with many hunks or large files
      const isLargePatch = patch.hunks && (
        patch.hunks.length > 5 || 
        content.length > 100000 || // ~100KB
        patch.hunks.reduce((sum, h) => sum + h.lines.length, 0) > 500
      );
      
      if (isLargePatch) {
        // Use optimized strategy for large patches
        return OptimizedPatchStrategyFactory.createOptimizedStrategy(fuzzFactor)
          .apply(content, patch);
      } else {
        // Use standard strategy for small patches
        return standardStrategy.apply(content, patch);
      }
    }
  };
}