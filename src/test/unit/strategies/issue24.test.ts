// src/test/unit/strategies/issue24.test.ts
// Integration test for GitHub issue #24:
// PatchPilot fails to apply a valid unified diff that git apply --check accepts.
//
// This test uses the REAL diff library (no mocks) to verify the full pipeline.
// The bugs: (1) normalizeDiff destroys blank context lines, (2) shifted and
// greedy strategies don't pass fuzzFactor, (3) locateHunk uses only context
// lines instead of old-side lines.

import * as RealDiffLib from 'diff';
import { normalizeDiff } from '../../../utilities';
import {
  StrictStrategy,
  ShiftedHeaderStrategy,
  GreedyStrategy,
  ChainedPatchStrategy,
} from '../../../strategies/patchStrategy';
import { DiffParsedPatch } from '../../../types/patchTypes';

// ---------- helpers ----------

function parsePatch(diffText: string): DiffParsedPatch {
  const patches = RealDiffLib.parsePatch(diffText);
  if (patches.length === 0) {
    throw new Error('parsePatch returned no patches');
  }
  return patches[0] as unknown as DiffParsedPatch;
}

// ---------- fixtures ----------

// A realistic multi-hunk diff that exercises all the fixed bugs:
// - Blank context lines between functions (blank lines in diff = empty string)
// - Hunks at line 50+ so shifting is required against a shorter file
// - Two hunks targeting two different functions

const MULTI_HUNK_DIFF = [
  'diff --git a/app.py b/app.py',
  '--- a/app.py',
  '+++ b/app.py',
  '@@ -50,17 +50,17 @@ def helper():',
  '     return (local, -1)',
  '',         // blank context line (common from AI tools — missing the space prefix)
  '',         // blank context line
  '-def find_header(lines):',
  '+def find_header_v2(lines):',
  '     """',
  '-    Find the header line.',
  '+    Find the header line (v2).',
  '     """',
  '     for i, line in enumerate(lines):',
  '-        if "Header" in line:',
  '+        if "HeaderV2" in line:',
  '             return i',
  '-    raise ValueError("Header not found")',
  '+    raise ValueError("Header not found v2")',
  '',         // blank context line
  '',         // blank context line
  ' def parse_output(text):',
  '@@ -70,10 +70,9 @@ def parse_output(text):',
  '     """Parse output."""',
  '     lines = text.splitlines()',
  '-    idx = find_header(lines)',
  '-    header = lines[idx]',
  '-    LOG.debug("header: %s", header)',
  '+    idx = find_header_v2(lines)',
  '+    LOG.debug("data starts at: %s", lines[idx])',
  '',         // blank context line
  '     rows = []',
  '-    for ln in lines[idx + 1:]:',
  '+    for ln in lines[idx:]:',
  '         line = ln.strip()',
  '         if not line:',
  '             continue',
].join('\n');

// File content — lines match the diff's old side but at different positions
// (starting around line 10, not line 50 as the diff claims).
const FILE_CONTENT = [
  '# app.py',
  'import logging',
  '',
  'LOG = logging.getLogger(__name__)',
  '',
  '',
  'def helper():',
  '    pass',
  '',
  '    return (local, -1)',    // line 9
  '',                           // line 10 - blank
  '',                           // line 11 - blank
  'def find_header(lines):',   // line 12
  '    """',
  '    Find the header line.',
  '    """',
  '    for i, line in enumerate(lines):',
  '        if "Header" in line:',
  '            return i',
  '    raise ValueError("Header not found")',
  '',                           // line 20 - blank
  '',                           // line 21 - blank
  'def parse_output(text):',   // line 22
  '    """Parse output."""',
  '    lines = text.splitlines()',
  '    idx = find_header(lines)',
  '    header = lines[idx]',
  '    LOG.debug("header: %s", header)',
  '',                           // line 28 - blank
  '    rows = []',
  '    for ln in lines[idx + 1:]:',
  '        line = ln.strip()',
  '        if not line:',
  '            continue',
].join('\n');

// ---------- tests ----------

describe('Issue #24 — multi-hunk diff regression', () => {

  describe('normalizeDiff blank context line preservation', () => {
    it('should convert empty lines inside hunks to blank context lines', () => {
      const normalized = normalizeDiff(MULTI_HUNK_DIFF);
      const lines = normalized.split('\n');

      // Empty lines inside hunks should become " " (single space = blank context)
      const blankContextLines = lines.filter(l => l === ' ');
      expect(blankContextLines.length).toBeGreaterThanOrEqual(2);
    });

    it('should NOT destroy a blank context line that already has a space', () => {
      const miniDiff = [
        'diff --git a/test.py b/test.py',
        '--- a/test.py',
        '+++ b/test.py',
        '@@ -1,5 +1,5 @@',
        ' line1',
        ' ',          // blank context line — must survive
        '-old',
        '+new',
        ' line4',
      ].join('\n');

      const normalized = normalizeDiff(miniDiff);
      const lines = normalized.split('\n');
      const idx = lines.indexOf(' line1');
      expect(idx).not.toBe(-1);
      expect(lines[idx + 1]).toBe(' ');
    });

    it('should produce a parseable diff after normalization', () => {
      const normalized = normalizeDiff(MULTI_HUNK_DIFF);
      const patches = RealDiffLib.parsePatch(normalized);
      expect(patches.length).toBe(1);
      expect(patches[0].hunks.length).toBe(2);
    });
  });

  describe('ShiftedHeaderStrategy with fuzz', () => {
    it('should relocate hunks and apply with fuzzFactor', () => {
      const normalized = normalizeDiff(MULTI_HUNK_DIFF);
      const patch = parsePatch(normalized);

      // The diff targets lines 50+, but the file has content at lines 9+.
      // ShiftedHeaderStrategy should find the correct position and apply with fuzz.
      const strategy = new ShiftedHeaderStrategy(2);
      const result = strategy.apply(FILE_CONTENT, patch);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('shifted');
      expect(result.patched).toContain('def find_header_v2(lines):');
      expect(result.patched).toContain('Find the header line (v2).');
      expect(result.patched).toContain('idx = find_header_v2(lines)');
      expect(result.patched).not.toContain('def find_header(lines):');
    });
  });

  describe('ChainedPatchStrategy full pipeline', () => {
    it('should apply multi-hunk diff via chained strategies', () => {
      const normalized = normalizeDiff(MULTI_HUNK_DIFF);
      const patch = parsePatch(normalized);

      const chain = new ChainedPatchStrategy([
        new StrictStrategy(),
        new ShiftedHeaderStrategy(2),
        new GreedyStrategy(2),
      ]);

      const result = chain.apply(FILE_CONTENT, patch);

      expect(result.success).toBe(true);
      expect(result.patched).toContain('def find_header_v2(lines):');
      expect(result.patched).toContain('for ln in lines[idx:]:');
      expect(result.patched).not.toContain('def find_header(lines):');
      expect(result.patched).not.toContain('for ln in lines[idx + 1:]:');
    });

    it('strict alone should fail (positions are wrong)', () => {
      const normalized = normalizeDiff(MULTI_HUNK_DIFF);
      const patch = parsePatch(normalized);

      const strategy = new StrictStrategy();
      const result = strategy.apply(FILE_CONTENT, patch);
      expect(result.success).toBe(false);
    });
  });

  describe('GreedyStrategy with fuzz', () => {
    it('should apply when context lines have minor whitespace differences', () => {
      // Build a diff where context lines have trailing whitespace that the file doesn't
      const diff = [
        'diff --git a/file.py b/file.py',
        '--- a/file.py',
        '+++ b/file.py',
        '@@ -1,5 +1,5 @@',
        ' def hello():',
        '     pass',
        ' ',
        '-def old_func():',
        '+def new_func():',
        '     return True',
      ].join('\n');

      const file = [
        'def hello():',
        '    pass',
        '',
        'def old_func():',
        '    return True',
      ].join('\n');

      const normalized = normalizeDiff(diff);
      const patch = parsePatch(normalized);

      const strategy = new GreedyStrategy(2);
      const result = strategy.apply(file, patch);

      expect(result.success).toBe(true);
      expect(result.patched).toContain('def new_func():');
    });
  });
});
