/* --------------------------------------------------------------------------
 *  PatchPilot — Unit tests for path sanitizer
 * ----------------------------------------------------------------------- */

import { sanitizePath, isSafePath } from '../../../security/pathSanitizer';
import * as path from 'path';

describe('Path Sanitizer', () => {
  describe('sanitizePath', () => {
    it('should remove control characters', () => {
      expect(sanitizePath('path\x00with\x1Fcontrol')).toBe('pathwithcontrol');
    });

    it('should remove escaped control sequences', () => {
      expect(sanitizePath('path\\r\\nwith\\nescaped')).toBe('pathwithescaped');
    });

    it('should normalize backslashes to forward slashes', () => {
      expect(sanitizePath('path\\to\\file')).toBe('path/to/file');
    });

    it('should trim whitespace', () => {
      expect(sanitizePath('  path/to/file  ')).toBe('path/to/file');
    });

    it('should handle empty input', () => {
      expect(sanitizePath('')).toBe('');
    });
  });

  describe('isSafePath', () => {
    it('should accept safe relative paths', () => {
      expect(isSafePath('file.txt')).toBe(true);
      expect(isSafePath('dir/file.txt')).toBe(true);
      expect(isSafePath('dir/subdir/file.txt')).toBe(true);
    });

    it('should reject absolute paths', () => {
      expect(isSafePath('/etc/passwd')).toBe(false);
      if (process.platform === 'win32') {
        expect(isSafePath('C:\\Windows\\System32')).toBe(false);
      }
    });

    it('should reject path traversal', () => {
      expect(isSafePath('../file.txt')).toBe(false);
      // dir/../file.txt resolves to file.txt which is safe (stays inside root)
      expect(isSafePath('dir/../file.txt')).toBe(true); 
      // dir/../../file.txt resolves to ../file.txt which is unsafe (goes outside root)
      expect(isSafePath('dir/../../file.txt')).toBe(false);
      expect(isSafePath('dir/../../../../../file.txt')).toBe(false);
      expect(isSafePath('..')).toBe(false);
      expect(isSafePath('../../etc/passwd')).toBe(false);
    });

    it('should reject null bytes', () => {
      expect(isSafePath('file\0.txt')).toBe(false);
    });

    it('should reject extremely long paths', () => {
      expect(isSafePath('a'.repeat(1001))).toBe(false);
    });

    it('should reject paths with control characters', () => {
      expect(isSafePath('file\x01.txt')).toBe(false);
    });
    
    it('should handle non-string input', () => {
      expect(isSafePath(null as any)).toBe(false);
      expect(isSafePath(undefined as any)).toBe(false);
      expect(isSafePath(123 as any)).toBe(false);
    });
  });
});