/* --------------------------------------------------------------------------
 *  PatchPilot — Unit tests for HunkManager
 * ----------------------------------------------------------------------- */

import { HunkManager } from '../../../patch/HunkManager';

describe('HunkManager', () => {
  const originalText = [
    'line 1',
    'line 2',
    'line 3',
    'line 4'
  ].join('\n');

  const modifiedText = [
    'line 1',
    'line 2 modified', // Change 1
    'line 3',
    'line 4 modified', // Change 2
    'line 5 added'     // Change 2 continued
  ].join('\n');

  let manager: HunkManager;

  beforeEach(() => {
    manager = new HunkManager();
  });

  it('should identify changed hunks', () => {
    const hunks = manager.compare(originalText, modifiedText);
    
    // Should find 2 hunks
    expect(hunks.length).toBe(2);
    
    // First hunk: line 2 modified
    // Note: line numbers are 0-based
    expect(hunks[0].originalStart).toBe(1);
    expect(hunks[0].originalLength).toBe(1);
    expect(hunks[0].modifiedStart).toBe(1);
    expect(hunks[0].modifiedLength).toBe(1);
    
    // Second hunk: line 4 modified + line 5 added
    expect(hunks[1].originalStart).toBe(3);
    expect(hunks[1].originalLength).toBe(1);
    expect(hunks[1].modifiedStart).toBe(3);
    expect(hunks[1].modifiedLength).toBe(2);
  });

  it('should revert a specific hunk', () => {
    const hunks = manager.compare(originalText, modifiedText);
    
    // Revert the first hunk (line 2)
    const revertedText = manager.revertHunk(originalText, modifiedText, hunks[0]);
    
    const expectedText = [
      'line 1',
      'line 2',          // Reverted to original
      'line 3',
      'line 4 modified', // Kept modified
      'line 5 added'     // Kept modified
    ].join('\n');

    expect(revertedText).toBe(expectedText);
  });

  it('should revert an addition hunk', () => {
    const orig = 'AB';
    const mod = 'ANewB';
    
    const hunks = manager.compare(orig, mod);
    expect(hunks.length).toBe(1);
    
    const reverted = manager.revertHunk(orig, mod, hunks[0]);
    expect(reverted).toBe(orig);
  });

  it('should detect changes involving only whitespace/newline characters in string literals', () => {
    // Scenario from Issue #2
    const orig = [
      "    'line 3',",
      "    'line 4'",
      "  ].join('');",
      "",
      "const modifiedText = ["
    ].join('');

    const mod = [
      "    'line 3',",
      "    'line 4'",
      "  ].join('\\n');", // Changed from '' to ''
      "",
      "const modifiedText = ["
    ].join('');

    const hunks = manager.compare(orig, mod);
    
    // Should detect 1 changed hunk (the line with .join)
    expect(hunks.length).toBe(1);
    expect(hunks[0].originalLength).toBe(1);
    expect(hunks[0].modifiedLength).toBe(1);
    
    // Verify we can revert it
    const reverted = manager.revertHunk(orig, mod, hunks[0]);
    expect(reverted).toBe(orig);
  });
});
