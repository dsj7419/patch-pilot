// src/test/unit/utilities/utilities.test.ts
import {
    normalizeLineEndings,
    autoFixSpaces,
    addMissingHeaders,
    normalizeDiff,
    isUnifiedDiff,
    extractFileNamesFromHeader,
    getNonce,
    throttle,
    debounce
  } from '../../../utilities';
  import {
    WELL_FORMED_DIFF,
    MISSING_HEADER_DIFF,
    MISSING_SPACES_DIFF,
    MIXED_LINE_ENDINGS_DIFF
  } from '../../fixtures/sample-diffs';
  
  describe('Utilities Module', () => {
    describe('getNonce', () => {
      it('should generate a unique nonce string', () => {
        const nonce1 = getNonce();
        const nonce2 = getNonce();
        
        expect(nonce1).toBeDefined();
        expect(typeof nonce1).toBe('string');
        expect(nonce1.length).toBeGreaterThan(10);
        
        // Two nonces should be different
        expect(nonce1).not.toBe(nonce2);
      });
    });
    
    describe('normalizeLineEndings', () => {
      it('should normalize CRLF to LF', () => {
        const input = 'line1\r\nline2\r\nline3';
        const expected = 'line1\nline2\nline3';
        expect(normalizeLineEndings(input)).toBe(expected);
      });
  
      it('should normalize CR to LF', () => {
        const input = 'line1\rline2\rline3';
        const expected = 'line1\nline2\nline3';
        expect(normalizeLineEndings(input)).toBe(expected);
      });
  
      it('should leave LF endings unchanged', () => {
        const input = 'line1\nline2\nline3';
        expect(normalizeLineEndings(input)).toBe(input);
      });
  
      it('should handle mixed line endings', () => {
        const input = 'line1\nline2\r\nline3\rline4';
        const expected = 'line1\nline2\nline3\nline4';
        expect(normalizeLineEndings(input)).toBe(expected);
      });
      
      it('should handle empty strings', () => {
        expect(normalizeLineEndings('')).toBe('');
      });
    });
  
    describe('autoFixSpaces', () => {
      it('should add spaces to context lines without prefixes', () => {
        const input = '@@ -1,3 +1,3 @@\n line with space\nline without space\n+added line';
        const expected = '@@ -1,3 +1,3 @@\n line with space\n line without space\n+added line';
        expect(autoFixSpaces(input)).toBe(expected);
      });
  
      it('should not modify lines that already have prefixes', () => {
        const input = '@@ -1,4 +1,4 @@\n line with space\n+added line\n-removed line\n line with space';
        expect(autoFixSpaces(input)).toBe(input);
      });
  
      it('should not modify empty lines', () => {
        const input = '@@ -1,3 +1,3 @@\n line with space\n\n+added line';
        expect(autoFixSpaces(input)).toBe(input);
      });
  
      it('should not modify diff headers', () => {
        const input = 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts';
        expect(autoFixSpaces(input)).toBe(input);
      });
  
      it('should not modify hunk headers', () => {
        const input = '@@ -1,3 +1,3 @@\n line1\n line2\n line3';
        expect(autoFixSpaces(input)).toBe(input);
      });
  
      it('should handle a realistic diff with missing spaces', () => {
        const result = autoFixSpaces(MISSING_SPACES_DIFF);
        // Each context line should start with a space
        const contextLines = result
          .split('\n')
          .filter(line => !line.startsWith('@@ ') && 
                           !line.startsWith('diff') && 
                           !line.startsWith('---') && 
                           !line.startsWith('+++') && 
                           !line.startsWith('+') && 
                           !line.startsWith('-') && 
                           line.trim() !== '');
                           
        const allHaveLeadingSpace = contextLines.every(line => line.startsWith(' '));
        expect(allHaveLeadingSpace).toBe(true);
      });
      
      it('should handle empty strings', () => {
        expect(autoFixSpaces('')).toBe('');
      });
    });
  
    describe('addMissingHeaders', () => {
      it('should add headers to a headerless diff', () => {
        const result = addMissingHeaders(MISSING_HEADER_DIFF);
        // Should start with diff --git
        expect(result.startsWith('diff --git')).toBe(true);
        // Should have --- and +++ lines
        expect(result).toContain('--- a/');
        expect(result).toContain('+++ b/');
      });
  
      it('should not modify a diff that already has headers', () => {
        expect(addMissingHeaders(WELL_FORMED_DIFF)).toBe(WELL_FORMED_DIFF);
      });
  
      it('should add missing --- line if only +++ exists', () => {
        const partial = '+++ b/file.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2 modified';
        const result = addMissingHeaders(partial);
        expect(result).toContain('diff --git');
        expect(result).toContain('--- a/file.ts');
        expect(result).toContain('+++ b/file.ts');
      });
  
      it('should extract file path from +++ line when possible', () => {
        const partial = '@@ -1,3 +1,3 @@\n line1\n-line2\n+line2 modified\n+++ b/src/specific/file.ts';
        const result = addMissingHeaders(partial);
        expect(result).toContain('diff --git a/src/specific/file.ts b/src/specific/file.ts');
      });
  
      it('should use a default filename when path cannot be extracted', () => {
        const partial = '@@ -1,3 +1,3 @@\n line1\n-line2\n+line2 modified';
        const result = addMissingHeaders(partial);
        expect(result).toContain('unknown-file');
      });
      
      it('should handle empty strings', () => {
        expect(addMissingHeaders('')).not.toBe('');
        // Should add default headers
        expect(addMissingHeaders('')).toContain('diff --git a/unknown-file b/unknown-file');
      });
    });
  
    describe('normalizeDiff', () => {
      it('should normalize line endings, fix spaces, and add headers', () => {
        // Mix issues into a single diff
        const problematicDiff = 'line without space\r\n@@ -1,3 +1,3 @@\r\nline missing space\r\n-removed\r\n+added';
        
        const result = normalizeDiff(problematicDiff);
        
        // Check line endings
        expect(result).not.toContain('\r\n');
        // Check space prefixes
        expect(result).toContain(' line without space');
        expect(result).toContain(' line missing space');
        // Check headers
        expect(result.startsWith('diff --git')).toBe(true);
      });
  
      it('should handle a well-formed diff without changes', () => {
        const result = normalizeDiff(WELL_FORMED_DIFF);
        // Should be mostly the same, except for potential line ending normalization
        expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(WELL_FORMED_DIFF));
      });
  
      it('should handle mixed line endings', () => {
        const result = normalizeDiff(MIXED_LINE_ENDINGS_DIFF);
        expect(result).not.toContain('\r\n');
        expect(result).not.toContain('\r');
      });
      
      it('should handle empty strings', () => {
        expect(normalizeDiff('')).not.toBe('');
        // Should add default headers
        expect(normalizeDiff('')).toContain('diff --git a/unknown-file b/unknown-file');
      });
      
      it('should correctly handle a complete pipeline of fixes', () => {
        // Create a diff with multiple issues
        const problematicDiff = '@@ -1,3 +1,3 @@\r\ncontext line without space\r\n-removed line\r\n+added line';
        
        const result = normalizeDiff(problematicDiff);
        
        // Check that all issues are fixed
        expect(result.startsWith('diff --git')).toBe(true); // Has header
        expect(result).toContain(' context line without space'); // Has space prefix
        expect(result).not.toContain('\r\n'); // No CRLF
        
        // Original content is preserved
        expect(result).toContain('-removed line');
        expect(result).toContain('+added line');
      });
    });
  
    describe('isUnifiedDiff', () => {
      it('should identify a well-formed diff', () => {
        expect(isUnifiedDiff(WELL_FORMED_DIFF)).toBe(true);
      });
  
      it('should identify a diff with only hunk headers', () => {
        expect(isUnifiedDiff(MISSING_HEADER_DIFF)).toBe(true);
      });
  
      it('should identify a diff with missing spaces', () => {
        expect(isUnifiedDiff(MISSING_SPACES_DIFF)).toBe(true);
      });
  
      it('should reject non-diff text', () => {
        expect(isUnifiedDiff('This is just regular text.')).toBe(false);
        expect(isUnifiedDiff('function example() {\n  return "not a diff";\n}')).toBe(false);
      });
  
      it('should reject empty string', () => {
        expect(isUnifiedDiff('')).toBe(false);
      });
      
      it('should identify a diff by the presence of @@ markers', () => {
        expect(isUnifiedDiff('@@ -1,3 +1,3 @@')).toBe(true);
      });
      
      it('should identify a diff by the presence of +/- line markers', () => {
        expect(isUnifiedDiff('some content\n+added line\n-removed line')).toBe(true);
      });
      
      it('should handle complex mixed cases correctly', () => {
        // A diff with git headers but no hunk markers (still valid)
        expect(isUnifiedDiff('diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n+new line')).toBe(true);
        
        // Just +/- lines without any headers (still valid)
        expect(isUnifiedDiff('-old\n+new')).toBe(true);
        
        // Too few markers to be reliable
        expect(isUnifiedDiff('Text with a single +marker but nothing else')).toBe(false);
      });
    });
  
    describe('extractFileNamesFromHeader', () => {
      it('should extract file names from a git diff header', () => {
        const header = 'diff --git a/src/file.ts b/src/file.ts';
        const { oldFile, newFile } = extractFileNamesFromHeader(header);
        expect(oldFile).toBe('src/file.ts');
        expect(newFile).toBe('src/file.ts');
      });
  
      it('should handle different file names', () => {
        const header = 'diff --git a/old-name.ts b/new-name.ts';
        const { oldFile, newFile } = extractFileNamesFromHeader(header);
        expect(oldFile).toBe('old-name.ts');
        expect(newFile).toBe('new-name.ts');
      });
  
      it('should handle paths with spaces', () => {
        const header = 'diff --git a/path with spaces/file.ts b/path with spaces/file.ts';
        const { oldFile, newFile } = extractFileNamesFromHeader(header);
        expect(oldFile).toBe('path with spaces/file.ts');
        expect(newFile).toBe('path with spaces/file.ts');
      });
  
      it('should return undefined for non-git diff headers', () => {
        const header = '--- a/file.ts\n+++ b/file.ts';
        const { oldFile, newFile } = extractFileNamesFromHeader(header);
        expect(oldFile).toBeUndefined();
        expect(newFile).toBeUndefined();
      });
      
      it('should handle complex paths with dots and special characters', () => {
        const header = 'diff --git a/src/components/ui/Button.tsx b/src/components/ui/Button.test.tsx';
        const { oldFile, newFile } = extractFileNamesFromHeader(header);
        expect(oldFile).toBe('src/components/ui/Button.tsx');
        expect(newFile).toBe('src/components/ui/Button.test.tsx');
      });
      
      it('should handle empty or invalid headers', () => {
        const { oldFile, newFile } = extractFileNamesFromHeader('');
        expect(oldFile).toBeUndefined();
        expect(newFile).toBeUndefined();
      });

      it('should handle headers with escaped control character sequences', () => {
        const header = 'diff --git a/src/file.ts\\r\\n b/src/file.ts\\r\\n';
        const { oldFile, newFile } = extractFileNamesFromHeader(header);
        expect(oldFile).toBe('src/file.ts');
        expect(newFile).toBe('src/file.ts');
      });
    });
  
    describe('debounce', () => {
      jest.useFakeTimers();
      
      it('should debounce function calls', () => {
        const mockFn = jest.fn();
        const debounced = debounce(mockFn, 100);
        
        // Call multiple times
        debounced();
        debounced();
        debounced();
        
        // Fast-forward time
        jest.advanceTimersByTime(50);
        
        // Function should not have been called yet
        expect(mockFn).not.toHaveBeenCalled();
        
        // Fast-forward to just after the debounce time
        jest.advanceTimersByTime(51);
        
        // Function should have been called exactly once
        expect(mockFn).toHaveBeenCalledTimes(1);
      });
      
      it('should reset timer on subsequent calls', () => {
        const mockFn = jest.fn();
        const debounced = debounce(mockFn, 100);
        
        // Call once
        debounced();
        
        // Fast-forward half the time
        jest.advanceTimersByTime(50);
        
        // Call again, which should reset the timer
        debounced();
        
        // Fast-forward past the first timer, but not the second
        jest.advanceTimersByTime(51);
        
        // Function should not have been called yet
        expect(mockFn).not.toHaveBeenCalled();
        
        // Fast-forward to complete the second timer
        jest.advanceTimersByTime(50);
        
        // Function should now have been called
        expect(mockFn).toHaveBeenCalledTimes(1);
      });
      
      it('should pass arguments to the debounced function', () => {
        const mockFn = jest.fn();
        const debounced = debounce(mockFn, 100);
        
        // Call with arguments
        debounced('test', 123);
        
        // Fast-forward past the debounce time
        jest.advanceTimersByTime(101);
        
        // Function should have been called with the arguments
        expect(mockFn).toHaveBeenCalledWith('test', 123);
      });
      
      it('should preserve the context (this) when called', () => {
        const context = { value: 'test' };
        const mockFn = jest.fn(function(this: typeof context) {
          return this.value;
        });
        
        const debounced = debounce(mockFn, 100);
        
        // Call with context
        debounced.call(context);
        
        // Fast-forward past the debounce time
        jest.advanceTimersByTime(101);
        
        // Function should have been called with the context
        expect(mockFn).toHaveBeenCalled();
        expect(mockFn.mock.instances[0]).toBe(context);
      });
    });
    
    describe('throttle', () => {
      jest.useFakeTimers();
      
      it('should throttle function calls', () => {
        const mockFn = jest.fn();
        const throttled = throttle(mockFn, 100);
        
        // Call multiple times
        throttled();
        throttled();
        throttled();
        
        // Function should have been called once immediately
        expect(mockFn).toHaveBeenCalledTimes(1);
        
        // Fast-forward time
        jest.advanceTimersByTime(101);
        
        // Call again after the throttle period
        throttled();
        
        // Function should have been called twice now
        expect(mockFn).toHaveBeenCalledTimes(2);
      });
      
      it('should ignore calls during throttle period', () => {
        const mockFn = jest.fn();
        const throttled = throttle(mockFn, 100);
        
        // First call
        throttled();
        expect(mockFn).toHaveBeenCalledTimes(1);
        
        // Call during the throttle period
        jest.advanceTimersByTime(50);
        throttled();
        
        // Should still only have been called once
        expect(mockFn).toHaveBeenCalledTimes(1);
        
        // Call after the throttle period
        jest.advanceTimersByTime(51);
        throttled();
        
        // Should now have been called twice
        expect(mockFn).toHaveBeenCalledTimes(2);
      });
      
      it('should pass arguments to the throttled function', () => {
        const mockFn = jest.fn();
        const throttled = throttle(mockFn, 100);
        
        // Call with arguments
        throttled('test', 123);
        
        // Function should have been called with the arguments
        expect(mockFn).toHaveBeenCalledWith('test', 123);
      });
      
      it('should preserve the context (this) when called', () => {
        const context = { value: 'test' };
        const mockFn = jest.fn(function(this: typeof context) {
          return this.value;
        });
        
        const throttled = throttle(mockFn, 100);
        
        // Call with context
        throttled.call(context);
        
        // Function should have been called with the context
        expect(mockFn).toHaveBeenCalled();
        expect(mockFn.mock.instances[0]).toBe(context);
      });
    });
  });