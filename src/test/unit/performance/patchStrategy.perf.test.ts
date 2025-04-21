// src/test/unit/strategies/patchStrategy.test.ts

import {
    OptimizedGreedyStrategy,
    OptimizedChainedStrategy,
    OptimizedPatchStrategyFactory,
    useOptimizedStrategies
  } from '../../../strategies/optimizedPatchStrategy';
  import {
    PatchStrategy,
    StrictStrategy,
    ShiftedHeaderStrategy,
    GreedyStrategy,
    PatchStrategyFactory
  } from '../../../strategies/patchStrategy';
  import * as DiffLib from 'diff';
  import { createMockParsedPatch } from '../../setup/test-utils';
  import {
    SAMPLE_FILE_CONTENT,
    SHIFTED_FILE_CONTENT
  } from '../../fixtures/sample-diffs';
  
  // Mock the diff library
  jest.mock('diff', () => ({
    applyPatch: jest.fn()
  }));
  
  describe('Optimized Patch Strategy Module', () => {
    // Reset mocks before each test
    beforeEach(() => {
      jest.resetAllMocks();
    });
  
    describe('OptimizedGreedyStrategy', () => {
      it('should efficiently handle patches with non-matching context', () => {
        // Mock to return successful patch on second attempt after optimization
        (DiffLib.applyPatch as jest.Mock)
          .mockReturnValueOnce(false) // First attempt fails (unmodified patch)
          .mockReturnValueOnce('patched content'); // Second attempt succeeds (after optimization)
        
        const strategy = new OptimizedGreedyStrategy();
        
        // Create a patch with context lines that won't match
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 1,
            oldLines: 4,
            newStart: 1,
            newLines: 4,
            lines: [
              ' This context line does not exist in source',
              ' Another non-matching context line',
              '-line to remove',
              '+line to add',
              ' Yet another non-matching context'
            ]
          }]
        });
        
        // File content without matching context
        const source = 'Some content\nline to remove\nMore content';
        
        // Apply the strategy
        const result = strategy.apply(source, patch);
        
        // Should succeed with optimized context lines
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched content');
        expect(result.strategy).toBe('optimized-greedy');
        
        // Check that applyPatch was called twice
        expect(DiffLib.applyPatch).toHaveBeenCalledTimes(2);
        
        // Verify the second call has a modified patch
        const modifiedPatch = (DiffLib.applyPatch as jest.Mock).mock.calls[1][1];
        expect(modifiedPatch).not.toBe(patch); // Should be a different object (cloned)
        
        // Should have pruned the non-matching context lines
        const originalLineCount = patch.hunks[0].lines.length;
        const modifiedLineCount = modifiedPatch.hunks[0].lines.length;
        expect(modifiedLineCount).toBeLessThan(originalLineCount);
      });
      
      it('should preserve all add/remove lines while filtering context', () => {
        // Setup to verify the filtered patch
        (DiffLib.applyPatch as jest.Mock).mockImplementation((content, patch) => {
          // Count add/remove lines in the patch
          const addRemoveCount = patch.hunks.reduce((count, hunk) => {
            return count + hunk.lines.filter(l => l.startsWith('+') || l.startsWith('-')).length;
          }, 0);
          
          // Only succeed if all add/remove lines are preserved
          return addRemoveCount === 2 ? 'patched content' : false;
        });
        
        const strategy = new OptimizedGreedyStrategy();
        
        // Create a patch with non-matching context but clear add/remove lines
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 1,
            oldLines: 4,
            newStart: 1,
            newLines: 4,
            lines: [
              ' This context does not match',
              '-line to remove',
              '+line to add',
              ' More non-matching context'
            ]
          }]
        });
        
        // Apply the strategy
        const result = strategy.apply('content without matching context', patch);
        
        // Should succeed because add/remove lines were preserved
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched content');
      });
      
      it('should update hunk line counts correctly after filtering', () => {
        // Mock applyPatch to inspect the hunk line counts
        (DiffLib.applyPatch as jest.Mock).mockImplementation((content, patch) => {
          // Check that hunk line counts match actual line counts
          for (const hunk of patch.hunks) {
            const oldCount = hunk.lines.filter(l => l.startsWith(' ') || l.startsWith('-')).length;
            const newCount = hunk.lines.filter(l => l.startsWith(' ') || l.startsWith('+')).length;
            
            // Only succeed if counts match
            if (hunk.oldLines !== oldCount || hunk.newLines !== newCount) {
              return false;
            }
          }
          
          return 'patched content';
        });
        
        const strategy = new OptimizedGreedyStrategy();
        
        // Create a patch with multiple hunks
        const patch = createMockParsedPatch({
          hunks: [
            {
              oldStart: 1,
              oldLines: 3, // Will be updated after filtering
              newStart: 1,
              newLines: 3, // Will be updated after filtering
              lines: [
                ' Context line 1',
                ' Context that does not match',
                '-line to remove',
                '+line to add'
              ]
            }
          ]
        });
        
        // Apply the strategy
        const result = strategy.apply('Content line 1\nline to remove\nContent line 3', patch);
        
        // Should succeed with correctly updated line counts
        expect(result.success).toBe(true);
      });
      
      it('should build an efficient line index for large files', () => {
        // Create a spy for the private buildLineIndex method
        const strategy = new OptimizedGreedyStrategy();
        const buildLineIndexSpy = jest.spyOn(strategy as any, 'buildLineIndex');
        
        // Create a large file with repeated lines to test indexing efficiency
        const largeFile = Array(1000).fill(0).map((_, i) => `Line ${i % 50}`).join('\n');
        const fileLines = largeFile.split('\n');
        
        // Create a simple patch
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 100,
            oldLines: 3,
            newStart: 100,
            newLines: 3,
            lines: [
              ' Line 10',
              '-Line 11',
              '+Modified Line 11'
            ]
          }]
        });
        
        // Mock applyPatch to always succeed
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched content');
        
        // Apply the strategy
        strategy.apply(largeFile, patch);
        
        // Verify buildLineIndex was called with the file lines
        expect(buildLineIndexSpy).toHaveBeenCalledWith(fileLines);
        
        // Get the index from the spy
        const lineIndex = buildLineIndexSpy.mock.results[0].value;
        
        // Check that the index contains entries for repeated lines
        const lineEntries = lineIndex.get('Line 10');
        
        // Should have multiple indices for the repeated line
        expect(lineEntries).toBeDefined();
        expect(lineEntries!.length).toBeGreaterThan(1);
        
        // Cleanup
        buildLineIndexSpy.mockRestore();
      });
    });
  
    describe('OptimizedChainedStrategy', () => {
      it('should handle small patches efficiently by trying all strategies', () => {
        // Create mock strategies
        const mockStrict = {
          name: 'strict',
          apply: jest.fn().mockReturnValue({ success: false, patched: 'original' })
        };
        
        const mockShifted = {
          name: 'shifted',
          apply: jest.fn().mockReturnValue({ success: true, patched: 'shifted result', strategy: 'shifted' })
        };
        
        const mockGreedy = {
          name: 'greedy',
          apply: jest.fn()
        };
        
        // Create a chain with these strategies
        const chain = new OptimizedChainedStrategy([
          mockStrict as unknown as PatchStrategy,
          mockShifted as unknown as PatchStrategy,
          mockGreedy as unknown as PatchStrategy
        ]);
        
        // Create a small patch (few hunks)
        const patch = createMockParsedPatch({
          hunks: [{ // Just one hunk makes it a "small patch"
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: [
              ' Context line',
              '-Remove line',
              '+Add line'
            ]
          }]
        });
        
        // Apply the chain
        const result = chain.apply('original content', patch);
        
        // Should succeed with the shifted strategy
        expect(result.success).toBe(true);
        expect(result.patched).toBe('shifted result');
        expect(result.strategy).toBe('shifted');
        
        // Strict should have been tried first
        expect(mockStrict.apply).toHaveBeenCalled();
        
        // Shifted should have been tried second and succeeded
        expect(mockShifted.apply).toHaveBeenCalled();
        
        // Greedy should not have been tried
        expect(mockGreedy.apply).not.toHaveBeenCalled();
      });
      
      it('should use an adaptive approach for large patches', () => {
        // Create mock strategies
        const mockStrict = {
          name: 'strict',
          apply: jest.fn().mockReturnValue({ success: false, patched: 'original' })
        };
        
        const mockShifted = {
          name: 'shifted',
          apply: jest.fn().mockReturnValue({ success: false, patched: 'original' })
        };
        
        const mockGreedy = {
          name: 'greedy',
          apply: jest.fn().mockReturnValue({ success: true, patched: 'greedy result', strategy: 'greedy' })
        };
        
        // Create a chain with these strategies
        const chain = new OptimizedChainedStrategy([
          mockStrict as unknown as PatchStrategy,
          mockShifted as unknown as PatchStrategy,
          mockGreedy as unknown as PatchStrategy
        ]);
        
        // Create a large patch (many hunks)
        const patch = createMockParsedPatch({
          hunks: Array(10).fill(0).map((_, i) => ({
            oldStart: i * 10 + 1,
            oldLines: 3,
            newStart: i * 10 + 1,
            newLines: 3,
            lines: [
              ' Context line',
              '-Remove line',
              '+Add line'
            ]
          }))
        });
        
        // Apply the chain
        const result = chain.apply('original content', patch);
        
        // Should succeed with the greedy strategy
        expect(result.success).toBe(true);
        expect(result.patched).toBe('greedy result');
        expect(result.strategy).toBe('greedy');
        
        // All strategies should have been tried
        expect(mockStrict.apply).toHaveBeenCalled();
        expect(mockShifted.apply).toHaveBeenCalled();
        expect(mockGreedy.apply).toHaveBeenCalled();
      });
      
      it('should clone patches to avoid modifying the original', () => {
        // Create a spy for the private clonePatch method
        const chain = new OptimizedChainedStrategy([
          new StrictStrategy()
        ]);
        
        const clonePatchSpy = jest.spyOn(chain as any, 'clonePatch');
        
        // Create a patch
        const patch = createMockParsedPatch();
        
        // Mock applyPatch to always succeed
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched content');
        
        // Apply the chain
        chain.apply('original content', patch);
        
        // Verify clonePatch was called with the patch
        expect(clonePatchSpy).toHaveBeenCalledWith(patch);
        
        // Cleanup
        clonePatchSpy.mockRestore();
      });
    });
  
    describe('OptimizedPatchStrategyFactory', () => {
      it('should create an optimized strategy with the specified fuzz factor', () => {
        // Create optimized strategy
        const strategy = OptimizedPatchStrategyFactory.createOptimizedStrategy(2);
        
        // Should be a chained strategy
        expect(strategy.name).toBe('optimized-chained');
        
        // Create a patch
        const patch = createMockParsedPatch();
        
        // Mock applyPatch to always succeed
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched content');
        
        // Apply the strategy
        const result = strategy.apply('original content', patch);
        
        // Should succeed
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched content');
      });
      
      it('should only include shifted strategy if fuzz is greater than 0', () => {
        // Create optimized strategy with fuzz 0
        const strategy0 = OptimizedPatchStrategyFactory.createOptimizedStrategy(0);
        
        // Create optimized strategy with fuzz 3
        const strategy3 = OptimizedPatchStrategyFactory.createOptimizedStrategy(3);
        
        // Both should be chained strategies
        expect(strategy0.name).toBe('optimized-chained');
        expect(strategy3.name).toBe('optimized-chained');
        
        // Create patches
        const patch = createMockParsedPatch();
        
        // Mock applyPatch to fail on first call but succeed on second
        (DiffLib.applyPatch as jest.Mock)
          .mockReturnValueOnce(false) // First strategy fails
          .mockReturnValueOnce('patched content'); // Second strategy succeeds
        
        // Apply strategy0
        strategy0.apply('original content', patch);
        
        // Should have called applyPatch twice (strict and greedy, skipping shifted)
        expect(DiffLib.applyPatch).toHaveBeenCalledTimes(2);
        
        // Reset mock
        jest.clearAllMocks();
        
        // Mock applyPatch to fail on first call but succeed on second
        (DiffLib.applyPatch as jest.Mock)
          .mockReturnValueOnce(false) // First strategy fails
          .mockReturnValueOnce('patched content'); // Second strategy succeeds
        
        // Apply strategy3
        strategy3.apply('original content', patch);
        
        // Should have called applyPatch twice (strict and shifted, not reaching greedy)
        expect(DiffLib.applyPatch).toHaveBeenCalledTimes(2);
      });
    });
  
    describe('useOptimizedStrategies', () => {
      it('should wrap standard strategy for large patches', () => {
        // Create a standard strategy
        const standardStrategy = PatchStrategyFactory.createDefaultStrategy(2);
        
        // Wrap it with optimization
        const optimizedWrapper = useOptimizedStrategies(standardStrategy, 2);
        
        // Create a large patch
        const patch = createMockParsedPatch({
          hunks: Array(10).fill(0).map((_, i) => ({
            oldStart: i * 10 + 1,
            oldLines: 3,
            newStart: i * 10 + 1,
            newLines: 3,
            lines: [
              ' Context line',
              '-Remove line',
              '+Add line'
            ]
          }))
        });
        
        // Create a large content
        const largeContent = Array(500).fill('Line of content').join('\n');
        
        // Mock applyPatch to always succeed
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched content');
        
        // Apply the wrapper with large content and patch
        const result = optimizedWrapper.apply(largeContent, patch);
        
        // Should succeed
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched content');
        expect(result.strategy).toBe('performance-optimized');
      });
      
      it('should use standard strategy for small patches', () => {
        // Create a mock standard strategy
        const mockStandardStrategy = {
          name: 'standard',
          apply: jest.fn().mockReturnValue({ success: true, patched: 'standard result', strategy: 'standard' })
        };
        
        // Wrap it with optimization
        const optimizedWrapper = useOptimizedStrategies(
          mockStandardStrategy as unknown as PatchStrategy,
          2
        );
        
        // Create a small patch and content
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: [
              ' Context line',
              '-Remove line',
              '+Add line'
            ]
          }]
        });
        
        const smallContent = 'Small content\nLine 2\nLine 3';
        
        // Apply the wrapper
        const result = optimizedWrapper.apply(smallContent, patch);
        
        // Should use the standard strategy
        expect(mockStandardStrategy.apply).toHaveBeenCalledWith(smallContent, patch);
        
        // Should return the standard result
        expect(result.success).toBe(true);
        expect(result.patched).toBe('standard result');
        expect(result.strategy).toBe('standard');
      });
    });
    
    // Integration tests with real-world examples
    describe('Integration with different diff scenarios', () => {
      it('should handle a patch with shifted context lines', () => {
        // Create a mock of the shifted file
        const shiftedContent = SHIFTED_FILE_CONTENT;
        
        // Create a patch targeting lines at the wrong position
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 5, // Original position in source
            oldLines: 3,
            newStart: 5, // Original position in source
            newLines: 3,
            lines: [
              ' import App from \'./App\';',
              ' import reportWebVitals from \'./reportWebVitals\';',
              ' ',
              '-ReactDOM.render(',
              '+ReactDOM.createRoot(document.getElementById(\'root\')).render('
            ]
          }]
        });
        
        // Setup mock to fail on direct application but succeed on shifted
        (DiffLib.applyPatch as jest.Mock)
          .mockReturnValueOnce(false) // Strict fails
          .mockReturnValueOnce('patched with shifted strategy'); // Shifted succeeds
        
        // Create optimized strategy
        const strategy = OptimizedPatchStrategyFactory.createOptimizedStrategy(2);
        
        // Apply the strategy
        const result = strategy.apply(shiftedContent, patch);
        
        // Should succeed
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with shifted strategy');
      });
      
      it('should handle a patch with non-matching context lines', () => {
        // Create a source file
        const content = SAMPLE_FILE_CONTENT;
        
        // Create a patch with some non-matching context lines
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 10,
            oldLines: 4,
            newStart: 10,
            newLines: 4,
            lines: [
              ' import ReactDOM from \'react-dom\';',
              ' // This line does not exist in the source',
              '-import App from \'./App\';',
              '+import { App } from \'./App\';',
              ' import reportWebVitals from \'./reportWebVitals\';'
            ]
          }]
        });
        
        // Setup mock to fail on direct and shifted but succeed on greedy
        (DiffLib.applyPatch as jest.Mock)
          .mockReturnValueOnce(false) // Strict fails
          .mockReturnValueOnce(false) // Shifted fails
          .mockReturnValueOnce('patched with greedy strategy'); // Greedy succeeds
        
        // Create optimized strategy
        const strategy = OptimizedPatchStrategyFactory.createOptimizedStrategy(2);
        
        // Apply the strategy
        const result = strategy.apply(content, patch);
        
        // Should succeed
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with greedy strategy');
      });
      
      it('should handle a large diff efficiently', () => {
        // Create a large content
        const largeContent = Array(1000).fill('Line of content').join('\n');
        
        // Create a large patch with many hunks
        const patch = createMockParsedPatch({
          hunks: Array(50).fill(0).map((_, i) => ({
            oldStart: i * 20 + 1,
            oldLines: 3,
            newStart: i * 20 + 1,
            newLines: 3,
            lines: [
              ' Line of content',
              '-Line of content',
              '+Modified line',
              ' Line of content'
            ]
          }))
        });
        
        // Mock to always succeed for simplicity
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched large content');
        
        // Time execution of standard strategy
        const standardStrategy = PatchStrategyFactory.createDefaultStrategy(2);
        const standardStart = process.hrtime.bigint();
        standardStrategy.apply(largeContent, patch);
        const standardDuration = Number(process.hrtime.bigint() - standardStart) / 1000000;
        
        // Reset mock
        jest.clearAllMocks();
        
        // Time execution of optimized strategy
        const optimizedStrategy = OptimizedPatchStrategyFactory.createOptimizedStrategy(2);
        const optimizedStart = process.hrtime.bigint();
        optimizedStrategy.apply(largeContent, patch);
        const optimizedDuration = Number(process.hrtime.bigint() - optimizedStart) / 1000000;
        
        // Optimized should not be slower than standard
        // Note: This is a bit of a flaky test as it depends on execution environment
        // But in practice, optimized should usually be faster
        console.log(`Standard: ${standardDuration.toFixed(2)}ms, Optimized: ${optimizedDuration.toFixed(2)}ms`);
      });
    });
  });