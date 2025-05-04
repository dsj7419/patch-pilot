/* --------------------------------------------------------------------------
 *  PatchPilot — Hunk Header Corrector Service Tests
 * ----------------------------------------------------------------------- */

import { DiffParsedPatch, DiffHunk } from '../../../types/patchTypes';
import { 
  correctHunkHeaders,
  HunkCorrection,
  CorrectionReport 
} from '../../../services/hunkCorrectorService';

// Mock the extractFilePath function from applyPatch
jest.mock('../../../applyPatch', () => ({
  extractFilePath: jest.fn((patch: DiffParsedPatch) => 
    patch.newFileName?.replace(/^b\//, '') || 
    patch.oldFileName?.replace(/^a\//, '') || 
    'mock-file'
  )
}));

describe('HunkCorrectorService', () => {
  // Helper function to create a hunk with specified properties
  function createHunk(
    oldStart = 1,
    oldLines = 3,
    newStart = 1,
    newLines = 3,
    lines = [' line 1', ' line 2', ' line 3']
  ): DiffHunk {
    return {
      oldStart,
      oldLines,
      newLines,
      newStart,
      lines
    };
  }

  // Helper function to create a patch with the given hunks
  function createPatch(
    hunks: DiffHunk[] = [],
    oldFileName = 'a/test-file.ts',
    newFileName = 'b/test-file.ts'
  ): DiffParsedPatch {
    return {
      oldFileName,
      newFileName,
      hunks
    };
  }

  describe('correctHunkHeaders', () => {
    it('should return an empty array and no corrections for empty input', () => {
      const patches: DiffParsedPatch[] = [];
      const result = correctHunkHeaders(patches);

      expect(result.correctedPatches).toEqual([]);
      expect(result.correctionDetails.correctionsMade).toBe(false);
      expect(result.correctionDetails.corrections).toEqual([]);
    });

    it('should not modify patches with correct line counts', () => {
      // Hunk with 3 context lines - counts are already correct
      const hunk = createHunk(1, 3, 1, 3, [' line 1', ' line 2', ' line 3']);
      const patch = createPatch([hunk]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(false);
      expect(result.correctionDetails.corrections).toEqual([]);
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
    });

    it('should correct incorrect oldLines', () => {
      // Hunk with 3 context lines, but oldLines is incorrectly set to 5
      const hunk = createHunk(1, 5, 1, 3, [' line 1', ' line 2', ' line 3']);
      const patch = createPatch([hunk]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(true);
      expect(result.correctionDetails.corrections.length).toBe(1);
      expect(result.correctionDetails.corrections[0].originalOld).toBe(5);
      expect(result.correctionDetails.corrections[0].correctedOld).toBe(3);
      expect(result.correctionDetails.corrections[0].originalNew).toBe(3);
      expect(result.correctionDetails.corrections[0].correctedNew).toBe(3);
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
    });

    it('should correct incorrect newLines', () => {
      // Hunk with 3 context lines, but newLines is incorrectly set to 5
      const hunk = createHunk(1, 3, 1, 5, [' line 1', ' line 2', ' line 3']);
      const patch = createPatch([hunk]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(true);
      expect(result.correctionDetails.corrections.length).toBe(1);
      expect(result.correctionDetails.corrections[0].originalOld).toBe(3);
      expect(result.correctionDetails.corrections[0].correctedOld).toBe(3);
      expect(result.correctionDetails.corrections[0].originalNew).toBe(5);
      expect(result.correctionDetails.corrections[0].correctedNew).toBe(3);
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
    });

    it('should correct both oldLines and newLines when incorrect', () => {
      // Hunk with 3 context lines, but both oldLines and newLines are incorrect
      const hunk = createHunk(1, 5, 1, 7, [' line 1', ' line 2', ' line 3']);
      const patch = createPatch([hunk]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(true);
      expect(result.correctionDetails.corrections.length).toBe(1);
      expect(result.correctionDetails.corrections[0].originalOld).toBe(5);
      expect(result.correctionDetails.corrections[0].correctedOld).toBe(3);
      expect(result.correctionDetails.corrections[0].originalNew).toBe(7);
      expect(result.correctionDetails.corrections[0].correctedNew).toBe(3);
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
    });

    it('should count context lines toward both old and new line counts', () => {
      // Hunk with only context lines
      const hunk = createHunk(1, 0, 1, 0, [' line 1', ' line 2', ' line 3']);
      const patch = createPatch([hunk]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(true);
      expect(result.correctionDetails.corrections.length).toBe(1);
      expect(result.correctionDetails.corrections[0].correctedOld).toBe(3);
      expect(result.correctionDetails.corrections[0].correctedNew).toBe(3);
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
    });

    it('should count addition lines toward only new line count', () => {
      // Hunk with only addition lines
      const hunk = createHunk(1, 1, 1, 0, ['+line 1', '+line 2', '+line 3']);
      const patch = createPatch([hunk]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(true);
      expect(result.correctionDetails.corrections.length).toBe(1);
      expect(result.correctionDetails.corrections[0].correctedOld).toBe(0);
      expect(result.correctionDetails.corrections[0].correctedNew).toBe(3);
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(0);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
    });

    it('should count deletion lines toward only old line count', () => {
      // Hunk with only deletion lines
      const hunk = createHunk(1, 0, 1, 1, ['-line 1', '-line 2', '-line 3']);
      const patch = createPatch([hunk]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(true);
      expect(result.correctionDetails.corrections.length).toBe(1);
      expect(result.correctionDetails.corrections[0].correctedOld).toBe(3);
      expect(result.correctionDetails.corrections[0].correctedNew).toBe(0);
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(0);
    });

    it('should handle mixed line types correctly', () => {
        // Hunk with mix of context, addition, and deletion lines
        // Original: oldLines=3, newLines=3 (already correct!)
        // Fixed: Set incorrect oldLines=4, newLines=2 to trigger correction
        const hunk = createHunk(1, 4, 1, 2, [' line 1', '-line 2', '+line 2a', ' line 3']);
        const patch = createPatch([hunk]);
        const patches = [patch];
      
        const result = correctHunkHeaders(patches);
      
        expect(result.correctionDetails.correctionsMade).toBe(true);
        expect(result.correctionDetails.corrections.length).toBe(1);
        expect(result.correctionDetails.corrections[0].correctedOld).toBe(3); // 2 context + 1 deletion
        expect(result.correctionDetails.corrections[0].correctedNew).toBe(3); // 2 context + 1 addition
        expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
        expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
      });

    it('should ignore "No newline at end of file" markers', () => {
      // Hunk with "No newline at end of file" marker
      const hunk = createHunk(1, 3, 1, 3, [
        ' line 1', 
        ' line 2', 
        ' line 3',
        '\\ No newline at end of file'
      ]);
      const patch = createPatch([hunk]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(false); // no correction needed
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3); // marker doesn't count
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3); // marker doesn't count
    });

    it('should handle "No newline" markers after different line types', () => {
        // Hunk with "No newline at end of file" markers after different line types
        // Original: oldLines=3, newLines=3 (already correct!)
        // Fixed: Set incorrect oldLines=4, newLines=2 to trigger correction
        const hunk = createHunk(1, 4, 1, 2, [
          ' line 1', 
          '+line 2a',
          '\\ No newline at end of file',
          '-line 2',
          '\\ No newline at end of file',
          ' line 3',
          '\\ No newline at end of file'
        ]);
        const patch = createPatch([hunk]);
        const patches = [patch];
      
        const result = correctHunkHeaders(patches);
      
        expect(result.correctionDetails.correctionsMade).toBe(true);
        expect(result.correctionDetails.corrections.length).toBe(1);
        expect(result.correctionDetails.corrections[0].correctedOld).toBe(3); // 2 context + 1 deletion
        expect(result.correctionDetails.corrections[0].correctedNew).toBe(3); // 2 context + 1 addition
        expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
        expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
      });

    it('should handle multiple hunks in a patch', () => {
      // Patch with multiple hunks, some with correct and some with incorrect line counts
      const hunk1 = createHunk(1, 3, 1, 3, [' line 1', ' line 2', ' line 3']); // correct
      const hunk2 = createHunk(10, 5, 10, 3, [' line 10', ' line 11', ' line 12']); // incorrect oldLines
      const hunk3 = createHunk(20, 3, 20, 6, [' line 20', ' line 21', ' line 22']); // incorrect newLines
      const patch = createPatch([hunk1, hunk2, hunk3]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(true);
      expect(result.correctionDetails.corrections.length).toBe(2); // two corrections needed
      
      // First hunk doesn't need correction
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
      
      // Second hunk needs oldLines corrected
      expect(result.correctedPatches[0].hunks[1].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[1].newLines).toBe(3);
      
      // Third hunk needs newLines corrected
      expect(result.correctedPatches[0].hunks[2].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[2].newLines).toBe(3);
      
      // Check correction details for specific hunks
      const hunk1Correction = result.correctionDetails.corrections.find(c => c.hunkIndex === 0);
      const hunk2Correction = result.correctionDetails.corrections.find(c => c.hunkIndex === 1);
      const hunk3Correction = result.correctionDetails.corrections.find(c => c.hunkIndex === 2);
      
      expect(hunk1Correction).toBeUndefined(); // No correction for first hunk
      expect(hunk2Correction).toBeDefined();
      expect(hunk2Correction?.originalOld).toBe(5);
      expect(hunk2Correction?.correctedOld).toBe(3);
      expect(hunk3Correction).toBeDefined();
      expect(hunk3Correction?.originalNew).toBe(6);
      expect(hunk3Correction?.correctedNew).toBe(3);
    });

    it('should handle multiple patches with different files', () => {
      // Multiple patches representing different files
      const hunk1 = createHunk(1, 5, 1, 3, [' line 1', ' line 2', ' line 3']); // incorrect oldLines
      const hunk2 = createHunk(1, 3, 1, 5, [' line 1', ' line 2', ' line 3']); // incorrect newLines
      
      const patch1 = createPatch([hunk1], 'a/file1.ts', 'b/file1.ts');
      const patch2 = createPatch([hunk2], 'a/file2.ts', 'b/file2.ts');
      
      const patches = [patch1, patch2];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(true);
      expect(result.correctionDetails.corrections.length).toBe(2);
      
      // First patch correction
      expect(result.correctionDetails.corrections[0].filePath).toBe('file1.ts');
      expect(result.correctionDetails.corrections[0].originalOld).toBe(5);
      expect(result.correctionDetails.corrections[0].correctedOld).toBe(3);
      
      // Second patch correction
      expect(result.correctionDetails.corrections[1].filePath).toBe('file2.ts');
      expect(result.correctionDetails.corrections[1].originalNew).toBe(5);
      expect(result.correctionDetails.corrections[1].correctedNew).toBe(3);
    });

    it('should handle patches with empty hunks array', () => {
      const patch = createPatch([]); // patch with empty hunks array
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      expect(result.correctionDetails.correctionsMade).toBe(false);
      expect(result.correctionDetails.corrections).toEqual([]);
      expect(result.correctedPatches[0].hunks).toEqual([]);
    });

    it('should not mutate the original patches', () => {
      // Deep copy test
      const hunk = createHunk(1, 5, 1, 7, [' line 1', ' line 2', ' line 3']);
      const patch = createPatch([hunk]);
      const patches = [patch];
      
      // Create a deep copy of the input for comparison
      const originalHunkOldLines = hunk.oldLines;
      const originalHunkNewLines = hunk.newLines;
      const originalHunkLines = [...hunk.lines];

      const result = correctHunkHeaders(patches);

      // The original should remain unchanged
      expect(hunk.oldLines).toBe(originalHunkOldLines);
      expect(hunk.newLines).toBe(originalHunkNewLines);
      expect(hunk.lines).toEqual(originalHunkLines);
      
      // But the corrected version should be updated
      expect(result.correctedPatches[0].hunks[0].oldLines).toBe(3);
      expect(result.correctedPatches[0].hunks[0].newLines).toBe(3);
    });

    it('should preserve equality of identical lines arrays when making copies', () => {
      // Create a hunk with identical line references
      const linesList = [' line 1', ' line 2', ' line 3'];
      const hunk1 = createHunk(1, 3, 1, 3, linesList);
      const hunk2 = createHunk(10, 3, 10, 3, linesList);  // Same lines reference
      const patch = createPatch([hunk1, hunk2]);
      const patches = [patch];

      const result = correctHunkHeaders(patches);

      // The returned hunks should have deep copies of the lines arrays
      expect(result.correctedPatches[0].hunks[0].lines).not.toBe(linesList);
      expect(result.correctedPatches[0].hunks[1].lines).not.toBe(linesList);
      
      // But the copied arrays should contain the same content
      expect(result.correctedPatches[0].hunks[0].lines).toEqual(linesList);
      expect(result.correctedPatches[0].hunks[1].lines).toEqual(linesList);
    });
  });
});