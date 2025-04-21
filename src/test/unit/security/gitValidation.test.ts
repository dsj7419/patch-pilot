/* --------------------------------------------------------------------------
 *  PatchPilot — Unit tests for git security validators
 * ----------------------------------------------------------------------- */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  isValidBranchName,
  sanitizeBranchName,
  isValidFilePath,
  validateFilePaths,
  isValidCommitMessage,
  sanitizeCommitMessage
} from '../../../security/gitValidation';

describe('Git Security Validation', () => {
  describe('isValidBranchName', () => {
    it('should accept valid branch names', () => {
      const validNames = [
        'main',
        'feature/new-feature',
        'hotfix-123',
        'release-v1.0.0',
        'user/john.doe/bugfix-42',
        'dependabot/npm_and_yarn/lodash-4.17.21',
        'feat_user-authentication'
      ];
      
      for (const name of validNames) {
        expect(isValidBranchName(name)).toBe(true);
      }
    });
    
    it('should reject invalid branch names', () => {
      const invalidNames = [
        '',                      // Empty string
        '.invalid-start',        // Starts with dot
        '/invalid-start',        // Starts with slash
        '-invalid-start',        // Starts with dash
        'invalid with spaces',   // Contains spaces
        'invalid*chars',         // Contains invalid char *
        'invalid?chars',         // Contains invalid char ?
        'invalid~chars',         // Contains invalid char ~
        'invalid^chars',         // Contains invalid char ^
        'invalid:chars',         // Contains invalid char :
        'invalid[chars',         // Contains invalid char [
        'invalid\\chars',        // Contains invalid char \
        'invalid..chars',        // Contains double dot
        'invalid.lock'           // Ends with .lock
      ];
      
      for (const name of invalidNames) {
        expect(isValidBranchName(name)).toBe(false);
      }
    });
    
    it('should reject names that could enable command injection', () => {
      const dangerousNames = [
        'branch$(rm -rf /)',
        'branch;echo "pwned"',
        'branch|cat /etc/passwd',
        'branch>file.txt',
        'branch & malicious_command'
      ];
      
      for (const name of dangerousNames) {
        expect(isValidBranchName(name)).toBe(false);
      }
    });

    it('should handle null or undefined input', () => {
      expect(isValidBranchName(undefined as any)).toBe(false);
      expect(isValidBranchName(null as any)).toBe(false);
    });
    
    it('should handle non-string input', () => {
      expect(isValidBranchName(123 as any)).toBe(false);
      expect(isValidBranchName({} as any)).toBe(false);
      expect(isValidBranchName([] as any)).toBe(false);
    });
  });

  describe('sanitizeBranchName', () => {
    it('should convert invalid characters to hyphens', () => {
      expect(sanitizeBranchName('branch name')).toBe('branch-name');
      expect(sanitizeBranchName('branch*name')).toBe('branch-name');
      expect(sanitizeBranchName('branch?name')).toBe('branch-name');
      expect(sanitizeBranchName('branch:name')).toBe('branch-name');
    });
    
    it('should remove invalid starting characters', () => {
      expect(sanitizeBranchName('.branch')).toBe('branch');
      expect(sanitizeBranchName('/branch')).toBe('branch');
      expect(sanitizeBranchName('-branch')).toBe('branch');
      expect(sanitizeBranchName('..branch')).toBe('branch');
    });
    
    it('should replace double dots', () => {
      expect(sanitizeBranchName('branch..name')).toBe('branch-name');
    });
    
    it('should handle .lock suffix', () => {
      expect(sanitizeBranchName('branch.lock')).toBe('branch-lock');
    });
    
    it('should handle empty strings', () => {
      expect(sanitizeBranchName('')).toBe('unnamed-branch');
    });
    
    it('should handle null or undefined input', () => {
      expect(sanitizeBranchName(undefined as any)).toBe('unnamed-branch');
      expect(sanitizeBranchName(null as any)).toBe('unnamed-branch');
    });
    
    it('should handle non-string input', () => {
      expect(sanitizeBranchName(123 as any)).toBe('unnamed-branch');
      expect(sanitizeBranchName({} as any)).toBe('unnamed-branch');
    });
    
    it('should sanitize potentially dangerous strings', () => {
      expect(sanitizeBranchName('branch;rm -rf /')).toBe('branch-rm--rf--');
      expect(sanitizeBranchName('branch$(cat /etc/passwd)')).toBe('branch-cat--etc-passwd-');
    });

    it('should reject branch names with $ character', () => {
        expect(isValidBranchName('branch$name')).toBe(false);
      });
      
      it('should reject branch names with % character', () => {
        expect(isValidBranchName('branch%20name')).toBe(false);
      });
      
      it('should reject branch names ending with /', () => {
        expect(isValidBranchName('branch-name/')).toBe(false);
      });
      
      it('should reject branch names with control characters', () => {
        expect(isValidBranchName('branch\x01name')).toBe(false);
      });
      
      it('should properly sanitize branch names with $ character', () => {
        expect(sanitizeBranchName('branch$name')).toBe('branch-name');
      });
      
      it('should reject branch names with $ character', () => {
        expect(isValidBranchName('branch$name')).toBe(false);
      });
      
      it('should reject branch names with % character', () => {
        expect(isValidBranchName('branch%20name')).toBe(false);
      });
      
      it('should reject branch names ending with /', () => {
        expect(isValidBranchName('branch-name/')).toBe(false);
      });
      
      it('should reject branch names with control characters', () => {
        expect(isValidBranchName('branch\x01name')).toBe(false);
      });
      
      it('should properly sanitize branch names with $ character', () => {
        expect(sanitizeBranchName('branch$name')).toBe('branch-name');
      });
      
      it('should properly sanitize branch names with % character', () => {
        expect(sanitizeBranchName('branch%20name')).toBe('branch-20-name');
      });
      
      it('should properly sanitize branch names ending with /', () => {
        expect(sanitizeBranchName('branch-name/')).toBe('branch-name');
      });
      
      // Tests for enhanced file path validation
      it('should reject file paths with null bytes', () => {
        expect(isValidFilePath('file\0.txt', '/workspace')).toBe(false);
      });
      
      it('should reject overly long file paths', () => {
        const longPath = 'a'.repeat(1001) + '.txt';
        expect(isValidFilePath(longPath, '/workspace')).toBe(false);
      });
      
      // Tests for enhanced commit message validation
      it('should reject commit messages with URL encoding attacks', () => {
        expect(isValidCommitMessage('Fix bug %3Brm%20-rf%20/')).toBe(false);
      });
      
      it('should reject commit messages with shell metacharacters in brackets', () => {
        expect(isValidCommitMessage('Update code [rm -rf /]')).toBe(false);
      });
      
      it('should properly sanitize URL encoding attacks in commit messages', () => {
        expect(sanitizeCommitMessage('Fix bug %3Brm%20-rf%20/')).toBe('Fix bug rm-rf/');
      });
      
      // Tests for array input validation
      it('should return an empty array when validateFilePaths is called with non-array input', () => {
        // @ts-ignore - intentionally passing incorrect type
        expect(validateFilePaths('not-an-array')).toEqual([]);
      });
  });

  describe('isValidFilePath', () => {
    const testWorkspacePath = '/test/workspace';
    
    it('should accept paths within the workspace', () => {
      const validPaths = [
        'file.txt',
        'dir/file.txt',
        'deeply/nested/path/file.txt',
        '.dotfile',
        'file with spaces.txt',
        'file-with-special_chars.txt',
        'src/Çômpønènt.ts', // Unicode
        '名称.txt', // Non-Latin characters
      ];
      
      for (const p of validPaths) {
        expect(isValidFilePath(p, testWorkspacePath)).toBe(true);
      }
    });
    
    it('should reject paths outside the workspace', () => {
      const invalidPaths = [
        '../file.txt',
        '../../file.txt',
        '/etc/passwd',
        'C:\\Windows\\System32\\config.sys',
        'dir/../../file.txt'
      ];
      
      for (const p of invalidPaths) {
        expect(isValidFilePath(p, testWorkspacePath)).toBe(false);
      }
    });
    
    it('should handle null or undefined input', () => {
      expect(isValidFilePath(undefined as any, testWorkspacePath)).toBe(false);
      expect(isValidFilePath(null as any, testWorkspacePath)).toBe(false);
      expect(isValidFilePath('file.txt', undefined as any)).toBe(false);
    });
    
    it('should handle non-string input', () => {
      expect(isValidFilePath(123 as any, testWorkspacePath)).toBe(false);
      expect(isValidFilePath({} as any, testWorkspacePath)).toBe(false);
    });
    
    it('should normalize paths before validation', () => {
      // This path resolves to inside the workspace after normalization
      expect(isValidFilePath('dir/../file.txt', testWorkspacePath)).toBe(true);
      
      // This path resolves to outside the workspace after normalization
      expect(isValidFilePath('dir/../../file.txt', testWorkspacePath)).toBe(false);
    });
  });

  describe('validateFilePaths', () => {
    // Mock workspace folders for testing
    beforeEach(() => {
      (vscode.workspace.workspaceFolders as any) = [
        { uri: { fsPath: '/test/workspace' } }
      ];
    });
    
    it('should filter out invalid paths', () => {
      const paths = [
        'valid.txt',
        '../invalid.txt',
        'dir/valid.txt',
        '../../invalid.txt',
        '/etc/passwd'
      ];
      
      const result = validateFilePaths(paths);
      
      // Should only contain the valid paths
      expect(result).toEqual([
        path.normalize('valid.txt'),
        path.normalize('dir/valid.txt')
      ]);
    });
    
    it('should return empty array for all invalid paths', () => {
      const paths = [
        '../invalid.txt',
        '../../invalid.txt',
        '/etc/passwd'
      ];
      
      const result = validateFilePaths(paths);
      
      // Should be empty
      expect(result).toEqual([]);
    });
    
    it('should normalize paths', () => {
      const paths = [
        'dir/../file.txt',
        'dir/./subdir/../file.txt'
      ];
      
      const result = validateFilePaths(paths);
      
      // Should be normalized
      expect(result).toEqual([
        path.normalize('file.txt'),
        path.normalize('dir/file.txt')
      ]);
    });
    
    it('should handle empty array', () => {
      const result = validateFilePaths([]);
      expect(result).toEqual([]);
    });
    
    it('should handle invalid input in the array', () => {
      const paths = [
        'valid.txt',
        null as any,
        undefined as any,
        123 as any,
        {} as any,
        'other-valid.txt'
      ];
      
      const result = validateFilePaths(paths);
      
      // Should only contain the valid paths
      expect(result).toEqual([
        path.normalize('valid.txt'),
        path.normalize('other-valid.txt')
      ]);
    });
    
    it('should return empty array when no workspace folders', () => {
      // Mock no workspace folders
      (vscode.workspace.workspaceFolders as any) = undefined;
      
      const result = validateFilePaths(['valid.txt']);
      
      // Should be empty
      expect(result).toEqual([]);
    });
  });

  describe('isValidCommitMessage', () => {
    it('should accept valid commit messages', () => {
      const validMessages = [
        'Fix bug in login component',
        'Add new feature',
        'Resolve issue #123',
        'Update dependencies to latest versions',
        'Merge branch "feature/auth" into main',
        'Initial commit',
        'Refactor authentication flow for better security'
      ];
      
      for (const message of validMessages) {
        expect(isValidCommitMessage(message)).toBe(true);
      }
    });
    
    it('should reject potentially dangerous commit messages', () => {
      const invalidMessages = [
        'Update readme; rm -rf /',
        'Fix bug $(cat /etc/passwd)',
        'Update config > /etc/passwd',
        'Fix <script>alert("XSS")</script>',
        'Update <img src=x onerror=alert(1)>',
        'Fix ${process.env.SECRET}',
        'A'.repeat(5000), // Excessively long message
        'X'.repeat(51) // Long repetition
      ];
      
      for (const message of invalidMessages) {
        expect(isValidCommitMessage(message)).toBe(false);
      }
    });
    
    it('should handle null or undefined input', () => {
      expect(isValidCommitMessage(undefined as any)).toBe(false);
      expect(isValidCommitMessage(null as any)).toBe(false);
    });
    
    it('should handle non-string input', () => {
      expect(isValidCommitMessage(123 as any)).toBe(false);
      expect(isValidCommitMessage({} as any)).toBe(false);
    });
  });

  describe('sanitizeCommitMessage', () => {
    it('should remove shell metacharacters', () => {
      expect(sanitizeCommitMessage('Commit; rm -rf /')).toBe('Commit rm -rf /');
      expect(sanitizeCommitMessage('Commit && echo hacked')).toBe('Commit  echo hacked');
      expect(sanitizeCommitMessage('Commit | cat /etc/passwd')).toBe('Commit  cat /etc/passwd');
    });
    
    it('should remove HTML/script tags', () => {
      expect(sanitizeCommitMessage('Commit <script>alert("XSS")</script>')).toBe('Commit alert("XSS")');
      expect(sanitizeCommitMessage('Commit <img src=x onerror=alert(1)>')).toBe('Commit ');
    });
    
    it('should truncate excessively long messages', () => {
      const longMessage = 'A'.repeat(2000);
      const sanitized = sanitizeCommitMessage(longMessage);
      
      expect(sanitized.length).toBeLessThan(1100); // 1000 + '...'
      expect(sanitized.endsWith('...')).toBe(true);
    });
    
    it('should handle empty strings', () => {
      expect(sanitizeCommitMessage('')).toBe('Commit message');
      expect(sanitizeCommitMessage('   ')).toBe('Commit message');
    });
    
    it('should handle null or undefined input', () => {
      expect(sanitizeCommitMessage(undefined as any)).toBe('Commit message');
      expect(sanitizeCommitMessage(null as any)).toBe('Commit message');
    });
    
    it('should handle non-string input', () => {
      expect(sanitizeCommitMessage(123 as any)).toBe('Commit message');
      expect(sanitizeCommitMessage({} as any)).toBe('Commit message');
    });
    
    it('should preserve normal text content', () => {
      const message = 'This is a normal commit message';
      expect(sanitizeCommitMessage(message)).toBe(message);
    });
  });
});