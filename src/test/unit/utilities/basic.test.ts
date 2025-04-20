/**
 * Basic test to verify setup
 */
import { normalizeDiff, isUnifiedDiff } from '../../../utilities';
import * as vscode from 'vscode';

describe('Basic Test for Setup Verification', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.resetAllMocks();
    
    // Mock URI file method specifically for this test
    (vscode.Uri.file as jest.Mock).mockReturnValue({
      fsPath: '/test/path',
      path: '/test/path',
      scheme: 'file',
      with: jest.fn(),
      toString: jest.fn(() => '/test/path')
    });
  });

  it('should import VS Code mocks correctly', () => {
    expect(vscode).toBeDefined();
    expect(vscode.window).toBeDefined();
    expect(vscode.workspace).toBeDefined();
    expect(vscode.Range).toBeDefined();
    expect(vscode.Position).toBeDefined();
  });

  it('should create VS Code objects correctly', () => {
    const vscode = require('vscode');
    
    // Create a Range
    const range = new vscode.Range(1, 2, 3, 4);
    expect(range.start.line).toBe(1);
    expect(range.start.character).toBe(2);
    expect(range.end.line).toBe(3);
    expect(range.end.character).toBe(4);
    
    // Create a Position
    const position = new vscode.Position(5, 6);
    expect(position.line).toBe(5);
    expect(position.character).toBe(6);
    
    // Create a URI
    const uri = vscode.Uri.file('/test/path');
    expect(uri.fsPath).toBe('/test/path');
  });

  it('should be able to test actual code from the project', () => {
    // Simple test for normalizeDiff
    const input = 'line1\r\nline2\r\n@@ -1,2 +1,2 @@';
    const output = normalizeDiff(input);
    
    // Output should be normalized to LF
    expect(output).not.toContain('\r\n');
    
    // Should detect unified diffs
    expect(isUnifiedDiff('@@ -1,2 +1,2 @@\n-line1\n+line2')).toBe(true);
    expect(isUnifiedDiff('not a diff')).toBe(false);
  });
});