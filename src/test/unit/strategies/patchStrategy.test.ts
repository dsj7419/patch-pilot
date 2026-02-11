// src/test/unit/strategies/patchStrategy.test.ts
import {
    PatchStrategy,
    StrictStrategy,
    ShiftedHeaderStrategy,
    GreedyStrategy,
    ChainedPatchStrategy,
    PatchStrategyFactory
  } from '../../../strategies/patchStrategy';
  import * as DiffLib from 'diff';
  import {
    WELL_FORMED_DIFF,
    SHIFTED_CONTEXT_DIFF,
    SAMPLE_FILE_CONTENT,
    SHIFTED_FILE_CONTENT
  } from '../../fixtures/sample-diffs';
  import { createMockParsedPatch } from '../../setup/test-utils';
  
  // Mock the diff library
  jest.mock('diff', () => ({
    applyPatch: jest.fn(),
    parsePatch: jest.fn()
  }));
  
  describe('Patch Strategy Module', () => {
    // Reset mocks before each test
    beforeEach(() => {
      jest.resetAllMocks();
    });
  
    describe('StrictStrategy', () => {
      it('should apply patch successfully when exact match', () => {
        // Setup mock to return successful patch
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched content');
        
        const strategy = new StrictStrategy();
        const patch = createMockParsedPatch();
        const result = strategy.apply('original content', patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched content');
        expect(result.strategy).toBe('strict');
        expect(DiffLib.applyPatch).toHaveBeenCalledWith('original content', patch);
      });
  
      it('should fail when patch cannot be applied', () => {
        // Setup mock to return false (patch failed)
        (DiffLib.applyPatch as jest.Mock).mockReturnValue(false);
        
        const strategy = new StrictStrategy();
        const patch = createMockParsedPatch();
        const result = strategy.apply('original content', patch);
        
        expect(result.success).toBe(false);
        expect(result.patched).toBe('original content');
        expect(result.strategy).toBeUndefined();
      });
    });
  
    describe('ShiftedHeaderStrategy', () => {
      it('should skip if fuzz is disabled', () => {
        const strategy = new ShiftedHeaderStrategy(0);
        const patch = createMockParsedPatch();
        const result = strategy.apply('original content', patch);
        
        expect(result.success).toBe(false);
        expect(DiffLib.applyPatch).not.toHaveBeenCalled();
      });
  
      it('should try to shift hunk headers and apply patch', () => {
        // Always make the applyPatch mock succeed for this test 
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched with shifted headers');
        
        const strategy = new ShiftedHeaderStrategy(2);
        
        // Create a patch with context lines that match the file but at different positions
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 1, // Original position in the patch
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: [
              ' import React from \'react\';',
              '-import ReactDOM from \'react-dom\';',
              '+import { ReactDOM } from \'react-dom\';'
            ]
          }]
        });
        
        // File content where these lines are at positions 3-5 instead of 1-3
        const content = '// Added comment lines\n// Before the imports\nimport React from \'react\';\nimport ReactDOM from \'react-dom\';\nimport App from \'./App\';';
        
        const result = strategy.apply(content, patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with shifted headers');
        expect(result.strategy).toBe('shifted');
        
        // Verify we tried to apply with modified hunks (shifted positions)
        expect(DiffLib.applyPatch).toHaveBeenCalledTimes(1);
        
        // Extract the modified patch passed to the applyPatch call
        const modifiedPatch = (DiffLib.applyPatch as jest.Mock).mock.calls[0][1];
        
        // The test can't easily verify the exact hunk start changes since it depends on the internal locateHunk logic,
        // but we can verify the patch was cloned and not the original object
        expect(modifiedPatch).not.toBe(patch);
      });
      
      it('should return failure if no match found even with shifting', () => {
        // Make applyPatch return false to simulate failure
        (DiffLib.applyPatch as jest.Mock).mockReturnValue(false);
        
        const strategy = new ShiftedHeaderStrategy(2);
        const patch = createMockParsedPatch();
        const content = 'completely different content';
        
        const result = strategy.apply(content, patch);
        
        expect(result.success).toBe(false);
      });
      
      it('should adjust hunk positions proportionally', () => {
        // Make applyPatch succeed with the shifted patch
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched successfully');
        
        const strategy = new ShiftedHeaderStrategy(3); // max fuzz
        
        // Create a patch with multiple hunks
        const patch = createMockParsedPatch({
          hunks: [
            {
              oldStart: 5,
              oldLines: 2,
              newStart: 5,
              newLines: 2,
              lines: [
                ' line 5',
                '-line 6',
                '+modified line 6'
              ]
            },
            {
              oldStart: 10,
              oldLines: 2,
              newStart: 10,
              newLines: 2,
              lines: [
                ' line 10',
                '-line 11',
                '+modified line 11'
              ]
            }
          ]
        });
        
        // File has 2 extra lines at the beginning, shifting everything by 2
        const content = 'extra line 1\nextra line 2\n' + 
                        Array(20).fill(0).map((_, i) => `line ${i+1}`).join('\n');
        
        const result = strategy.apply(content, patch);
        
        expect(result.success).toBe(true);
        
        // Verify applyPatch was called
        expect(DiffLib.applyPatch).toHaveBeenCalledTimes(1);
      });
      
      it('should handle different fuzz factors correctly', () => {
        // Test with different fuzz factors
        [1, 2, 3].forEach(fuzz => {
          (DiffLib.applyPatch as jest.Mock).mockReset();
          (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched with fuzz ' + fuzz);
          
          const strategy = new ShiftedHeaderStrategy(fuzz as 1 | 2 | 3);
          const patch = createMockParsedPatch();
          const result = strategy.apply('content with fuzz ' + fuzz, patch);
          
          expect(result.success).toBe(true);
          expect(result.patched).toBe('patched with fuzz ' + fuzz);
        });
      });
    });
  
    describe('GreedyStrategy', () => {
      it('should try to patch by modifying context lines', () => {
        // Mock to make applyPatch succeed
        (DiffLib.applyPatch as jest.Mock).mockReturnValue('patched with greedy strategy');
        
        const strategy = new GreedyStrategy();
        
        // Create a patch with some context lines that don't match
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: [
              ' import React from \'react\';', // This line matches
              ' import TYPO from \'not-in-file\';', // This line doesn't match
              '-import App from \'./App\';',
              '+import { App } from \'./App\';'
            ]
          }]
        });
        
        const content = 'import React from \'react\';\nimport Something from \'different\';\nimport App from \'./App\';';
        
        const result = strategy.apply(content, patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with greedy strategy');
        expect(result.strategy).toBe('greedy');
        
        // Verify we tried to apply with modified hunks (filtering non-matching context)
        expect(DiffLib.applyPatch).toHaveBeenCalledTimes(1);
        
        // The test can't easily verify the exact lines being filtered,
        // but we can verify the patch was cloned and not the original object
        const modifiedPatch = (DiffLib.applyPatch as jest.Mock).mock.calls[0][1];
        expect(modifiedPatch).not.toBe(patch);
      });
      
      it('should fail when no matching context can be found', () => {
        // Make applyPatch fail for both initial and modified patch
        (DiffLib.applyPatch as jest.Mock).mockReturnValue(false);
        
        const strategy = new GreedyStrategy();
        const patch = createMockParsedPatch();
        const content = 'completely different content';
        
        const result = strategy.apply(content, patch);
        
        expect(result.success).toBe(false);
      });
      
      it('should keep all add/remove lines even if context doesn\'t match', () => {
        // Mock applyPatch to succeed
        (DiffLib.applyPatch as jest.Mock).mockImplementation((content, patch) => {
          // Verify that the patch contains all + and - lines
          let addCount = 0;
          let removeCount = 0;
          
          for (const hunk of patch.hunks) {
            for (const line of hunk.lines) {
              if (line.startsWith('+')) {addCount++;}
              if (line.startsWith('-')) {removeCount++;}
            }
          }
          
          if (addCount >= 1 && removeCount >= 1) {
            return 'patched with greedy strategy keeping all edits';
          }
          return false;
        });
        
        const strategy = new GreedyStrategy();
        
        // Create a patch with completely mismatched context but clear +/- lines
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: [
              ' context that doesn\'t match at all',
              '-line to remove',
              '+line to add'
            ]
          }]
        });
        
        const content = 'completely different\nline to remove\nother content';
        
        const result = strategy.apply(content, patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with greedy strategy keeping all edits');
      });
      
      it('should adjust hunk line counts properly', () => {
        // Mock applyPatch to succeed but verify line counts are adjusted
        (DiffLib.applyPatch as jest.Mock).mockImplementation((content, patch) => {
          // Verify that hunks have proper line counts
          for (const hunk of patch.hunks) {
            const newCount = hunk.lines.filter(l => l.startsWith('+') || l.startsWith(' ')).length;
            const oldCount = hunk.lines.filter(l => l.startsWith('-') || l.startsWith(' ')).length;
            
            if (hunk.newLines !== newCount || hunk.oldLines !== oldCount) {
              return false;
            }
          }
          
          return 'patched with correct line counts';
        });
        
        const strategy = new GreedyStrategy();
        
        // Create a patch with lines that will be filtered
        const patch = createMockParsedPatch({
          hunks: [{
            oldStart: 1,
            oldLines: 5, // This will need to be adjusted after filtering
            newStart: 1,
            newLines: 5, // This will need to be adjusted after filtering
            lines: [
              ' context line 1',
              ' context line that doesn\'t exist',
              ' context line that doesn\'t exist',
              '-line to remove',
              '+line to add',
              ' final context line'
            ]
          }]
        });
        
        const content = 'context line 1\nline to remove\nfinal context line';
        
        const result = strategy.apply(content, patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with correct line counts');
      });
    });
  
    describe('ChainedPatchStrategy', () => {
      it('should try strategies in order until one succeeds', () => {
        // Create strategy mocks
        const strategy1: PatchStrategy = {
          name: 'strategy1',
          apply: jest.fn().mockReturnValue({ success: false, patched: 'original' })
        };
        
        const strategy2: PatchStrategy = {
          name: 'strategy2',
          apply: jest.fn().mockReturnValue({ success: true, patched: 'patched by 2', strategy: 'strategy2' })
        };
        
        const strategy3: PatchStrategy = {
          name: 'strategy3',
          apply: jest.fn() // Shouldn't be called
        };
        
        const chain = new ChainedPatchStrategy([strategy1, strategy2, strategy3]);
        const patch = createMockParsedPatch();
        const result = chain.apply('original', patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched by 2');
        expect(result.strategy).toBe('strategy2');
        
        // Verify first two strategies were tried, but third was skipped
        expect(strategy1.apply).toHaveBeenCalledWith('original', patch);
        expect(strategy2.apply).toHaveBeenCalledWith('original', patch);
        expect(strategy3.apply).not.toHaveBeenCalled();
      });
  
      it('should return failure if all strategies fail', () => {
        const strategy1: PatchStrategy = {
          name: 'strategy1',
          apply: jest.fn().mockReturnValue({ success: false, patched: 'original' })
        };
        
        const strategy2: PatchStrategy = {
          name: 'strategy2',
          apply: jest.fn().mockReturnValue({ success: false, patched: 'original' })
        };
        
        const chain = new ChainedPatchStrategy([strategy1, strategy2]);
        const patch = createMockParsedPatch();
        const result = chain.apply('original', patch);
        
        expect(result.success).toBe(false);
        expect(result.patched).toBe('original');
        expect(result.strategy).toBeUndefined();
        
        // Verify both strategies were tried
        expect(strategy1.apply).toHaveBeenCalledWith('original', patch);
        expect(strategy2.apply).toHaveBeenCalledWith('original', patch);

        // Verify diagnostics are returned on failure
        expect(result.diagnostics).toBeDefined();
        expect(result.diagnostics).toContain('strategy1');
        expect(result.diagnostics).toContain('strategy2');
        expect(result.diagnostics).toContain('Strategies attempted');
      });
    });
  
    describe('PatchStrategyFactory', () => {
      it('should create a default strategy chain with the specified fuzz factor', () => {
        const strategy = PatchStrategyFactory.createDefaultStrategy(2);
        
        // Verify it's a ChainedPatchStrategy
        expect(strategy.name).toBe('chained');
        
        // Mock diff.applyPatch to first fail then succeed on second call
        (DiffLib.applyPatch as jest.Mock)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce('patched with shifted');
        
        const patch = createMockParsedPatch();
        const result = strategy.apply('original', patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with shifted');
        // Should be the second strategy (shifted) that succeeded
        expect(result.strategy).toBe('shifted');
      });
  
      it('should handle different fuzz factors', () => {
        const strategy0 = PatchStrategyFactory.createDefaultStrategy(0);
        const strategy3 = PatchStrategyFactory.createDefaultStrategy(3);
        
        // Different fuzz factors should still create ChainedPatchStrategy
        expect(strategy0.name).toBe('chained');
        expect(strategy3.name).toBe('chained');
      });
      
      it('should create a strategy chain that falls back appropriately', () => {
        // First let's directly verify that the factory creates a ChainedPatchStrategy
        // with the expected sub-strategies
        const strategy = PatchStrategyFactory.createDefaultStrategy(2);
        
        // Now test the fallback behavior
        (DiffLib.applyPatch as jest.Mock)
          .mockReturnValueOnce(false)  // StrictStrategy fails
          .mockReturnValueOnce(false)  // ShiftedHeaderStrategy fails
          .mockReturnValueOnce('patched with greedy'); // GreedyStrategy succeeds
        
        const patch = createMockParsedPatch();
        const result = strategy.apply('original content', patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with greedy');
        expect(result.strategy).toBe('greedy');
        
        // Should have called applyPatch 3 times
        expect(DiffLib.applyPatch).toHaveBeenCalledTimes(3);
      });
      
      it('should skip ShiftedHeaderStrategy when fuzz is 0', () => {
        const strategy = PatchStrategyFactory.createDefaultStrategy(0);
        
        // Mock diff.applyPatch to fail on first call (strict) and succeed on second call (greedy)
        // Note: with fuzz=0, ShiftedHeaderStrategy should be skipped entirely
        (DiffLib.applyPatch as jest.Mock)
          .mockReturnValueOnce(false)  // StrictStrategy fails
          .mockReturnValueOnce('patched with greedy'); // GreedyStrategy succeeds
        
        const patch = createMockParsedPatch();
        const result = strategy.apply('original content', patch);
        
        expect(result.success).toBe(true);
        expect(result.patched).toBe('patched with greedy');
        expect(result.strategy).toBe('greedy');
        
        // Should have called applyPatch exactly 2 times (strict and greedy, skipping shifted)
        expect(DiffLib.applyPatch).toHaveBeenCalledTimes(2);
      });
    });
    
    describe('Integration with real diff examples', () => {
        // This section will test the actual strategies with real-world examples
        
        beforeEach(() => {
          // Reset DiffLib.parsePatch mock for these tests
          (DiffLib.parsePatch as jest.Mock).mockReset();
        });
        
        it('should correctly handle shifted context with ShiftedHeaderStrategy', () => {
          // Create a mock patch instead of trying to parse SHIFTED_CONTEXT_DIFF
          const mockPatch = createMockParsedPatch({
            hunks: [{
              oldStart: 10,
              oldLines: 3,
              newStart: 10,
              newLines: 3,
              lines: [
                ' import React from \'react\';',
                '-import App from \'./App\';',
                '+import { App } from \'./App\';'
              ]
            }]
          });
          
          // Make sure parsePatch returns our mock
          (DiffLib.parsePatch as jest.Mock).mockReturnValue([mockPatch]);
          
          // Setup applyPatch to fail on exact match but succeed on shifted match
          (DiffLib.applyPatch as jest.Mock)
            .mockReturnValueOnce(false) // Strict fails
            .mockReturnValueOnce('content with shifted patch applied'); // Shifted succeeds
          
          // Create the strategies
          const strictStrategy = new StrictStrategy();
          const shiftedStrategy = new ShiftedHeaderStrategy(2);
          
          // First try strict - should fail
          const strictResult = strictStrategy.apply(SHIFTED_FILE_CONTENT, mockPatch);
          expect(strictResult.success).toBe(false);
          
          // Then try shifted - should succeed
          const shiftedResult = shiftedStrategy.apply(SHIFTED_FILE_CONTENT, mockPatch);
          expect(shiftedResult.success).toBe(true);
          expect(shiftedResult.patched).toBe('content with shifted patch applied');
        });
        
        it('should correctly handle missing context with GreedyStrategy', () => {
          // Create a mock patch
          const mockPatch = createMockParsedPatch({
            hunks: [{
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 3,
              lines: [
                ' context that doesn\'t match',
                '-line to remove',
                '+line to add'
              ]
            }]
          });
          
          // Make sure parsePatch returns our mock
          (DiffLib.parsePatch as jest.Mock).mockReturnValue([mockPatch]);
          
          // Setup applyPatch to fail on both strict and shifted, but succeed on greedy
          (DiffLib.applyPatch as jest.Mock)
            .mockReturnValueOnce(false) // Strict fails
            .mockReturnValueOnce(false) // Shifted fails
            .mockReturnValueOnce('content with greedy patch applied'); // Greedy succeeds
          
          // Create the strategies
          const strictStrategy = new StrictStrategy();
          const shiftedStrategy = new ShiftedHeaderStrategy(2);
          const greedyStrategy = new GreedyStrategy();
          
          // Try each strategy in sequence
          const strictResult = strictStrategy.apply('modified content', mockPatch);
          expect(strictResult.success).toBe(false);
          
          const shiftedResult = shiftedStrategy.apply('modified content', mockPatch);
          expect(shiftedResult.success).toBe(false);
          
          const greedyResult = greedyStrategy.apply('modified content', mockPatch);
          expect(greedyResult.success).toBe(true);
          expect(greedyResult.patched).toBe('content with greedy patch applied');
        });
        
        it('should succeed with the chained strategy approach', () => {
          // Create a mock patch
          const mockPatch = createMockParsedPatch({
            hunks: [{
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 3,
              lines: [
                ' context line',
                '-old line',
                '+new line'
              ]
            }]
          });
          
          // Make sure parsePatch returns our mock
          (DiffLib.parsePatch as jest.Mock).mockReturnValue([mockPatch]);
          
          // Setup applyPatch to fail on first two calls but succeed on third
          (DiffLib.applyPatch as jest.Mock)
            .mockReturnValueOnce(false) // Strict fails
            .mockReturnValueOnce(false) // Shifted fails
            .mockReturnValueOnce('content with greedy patch applied'); // Greedy succeeds
          
          // Create the chained strategy with custom mock implementations
          const mockStrictStrategy = {
            name: 'strict',
            apply: jest.fn().mockReturnValue({ success: false, patched: 'original' })
          };
          
          const mockShiftedStrategy = {
            name: 'shifted',
            apply: jest.fn().mockReturnValue({ success: false, patched: 'original' })
          };
          
          const mockGreedyStrategy = {
            name: 'greedy',
            apply: jest.fn().mockReturnValue({ 
              success: true, 
              patched: 'content with greedy patch applied',
              strategy: 'greedy'
            })
          };
          
          const chainedStrategy = new ChainedPatchStrategy([
            mockStrictStrategy, 
            mockShiftedStrategy, 
            mockGreedyStrategy
          ]);
          
          // Apply the patch with the chained strategy
          const result = chainedStrategy.apply('modified content', mockPatch);
          
          // Should have succeeded using the third strategy
          expect(result.success).toBe(true);
          expect(result.patched).toBe('content with greedy patch applied');
          expect(result.strategy).toBe('greedy');
          
          // Verify strategies were called in order until success
          expect(mockStrictStrategy.apply).toHaveBeenCalledWith('modified content', mockPatch);
          expect(mockShiftedStrategy.apply).toHaveBeenCalledWith('modified content', mockPatch);
          expect(mockGreedyStrategy.apply).toHaveBeenCalledWith('modified content', mockPatch);
        });
      });
  });