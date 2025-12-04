// src/test/setup/test-utils.ts
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { DiffParsedPatch } from '../../types/patchTypes';

/**
 * Test fixture helper - loads a file from the fixtures directory
 */
export function loadFixture(filename: string): string {
  const fixturePath = path.join(__dirname, '..', 'fixtures', filename);
  return fs.readFileSync(fixturePath, 'utf8');
}

/**
 * Creates a mock TextDocument
 */
export function createMockDocument(
    content: string, 
    uri?: vscode.Uri
  ): vscode.TextDocument {
    const lines = content.split('\n');
    
    // Create a default URI if none provided with fsPath property
    let documentUri: vscode.Uri;
    if (!uri) {
      documentUri = vscode.Uri.file('/test/file.ts');
    } else {
      documentUri = uri;
    }
    
    return {
      uri: documentUri,
      fileName: documentUri.fsPath,
      isUntitled: false,
      languageId: 'typescript',
      version: 1,
      isDirty: false,
      isClosed: false,
      save: jest.fn(() => Promise.resolve(true)),
      lineCount: lines.length,
      lineAt: jest.fn((line: number) => {
        const text = lines[line] || '';
        return {
          lineNumber: line,
          text,
          range: new vscode.Range(line, 0, line, text.length),
          rangeIncludingLineBreak: new vscode.Range(line, 0, line, text.length + 1),
          firstNonWhitespaceCharacterIndex: text.search(/\S|$/),
          isEmptyOrWhitespace: text.trim().length === 0
        };
      }),
      offsetAt: jest.fn(({ line, character }) => {
        let offset = 0;
        for (let i = 0; i < line; i++) {
          offset += (lines[i] || '').length + 1; // +1 for newline
        }
        return offset + character;
      }),
      positionAt: jest.fn((offset: number) => {
        let currentOffset = 0;
        for (let line = 0; line < lines.length; line++) {
          const lineLength = (lines[line] || '').length + 1; // +1 for newline
          if (currentOffset + lineLength > offset) {
            return new vscode.Position(line, offset - currentOffset);
          }
          currentOffset += lineLength;
        }
        return new vscode.Position(
          lines.length - 1, 
          (lines[lines.length - 1] || '').length
        );
      }),
      getText: jest.fn((range?: vscode.Range) => {
        if (!range) {
          return content;
        }
        
        // Extract text from the specified range
        let result = '';
        for (let i = range.start.line; i <= range.end.line; i++) {
          const line = lines[i] || '';
          if (i === range.start.line && i === range.end.line) {
            result += line.substring(range.start.character, range.end.character);
          } else if (i === range.start.line) {
            result += line.substring(range.start.character) + '\n';
          } else if (i === range.end.line) {
            result += line.substring(0, range.end.character);
          } else {
            result += line + '\n';
          }
        }
        return result;
      }),
      getWordRangeAtPosition: jest.fn(),
      validateRange: jest.fn(range => range),
      validatePosition: jest.fn(position => position)
    } as unknown as vscode.TextDocument;
  }

/**
 * Creates a mock WorkspaceEdit and tracks operations performed on it
 */
export function createMockWorkspaceEdit(): { edit: vscode.WorkspaceEdit, calls: any[] } {
  const calls: any[] = [];
  
  const edit = new vscode.WorkspaceEdit();
  
  // Override methods to track calls
  const originalReplace = edit.replace;
  edit.replace = jest.fn((uri, range, newText) => {
    calls.push({ type: 'replace', uri, range, newText });
    return originalReplace.call(edit, uri, range, newText);
  });
  
  const originalInsert = edit.insert;
  edit.insert = jest.fn((uri, position, newText) => {
    calls.push({ type: 'insert', uri, position, newText });
    return originalInsert.call(edit, uri, position, newText);
  });
  
  const originalDelete = edit.delete;
  edit.delete = jest.fn((uri, range) => {
    calls.push({ type: 'delete', uri, range });
    return originalDelete.call(edit, uri, range);
  });
  
  return { edit, calls };
}

/**
 * Helper to wait for async operations
 */
export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a sample diff
 */
export function createSampleDiff(options: {
  oldFileName?: string;
  newFileName?: string;
  oldStart?: number;
  newStart?: number;
  oldLines?: number;
  newLines?: number;
  lines?: string[];
} = {}): string {
  const {
    oldFileName = 'a/src/file.ts',
    newFileName = 'b/src/file.ts',
    oldStart = 10,
    newStart = 10,
    oldLines = 7,
    newLines = 7,
    lines = [
      ' import React from \'react\';',
      ' import ReactDOM from \'react-dom\';',
      ' import \'./index.css\';',
      '-import App from \'./App\';',
      '+import { App } from \'./App\';',
      ' import reportWebVitals from \'./reportWebVitals\';',
      ' '
    ]
  } = options;

  return [
    `diff --git ${oldFileName} ${newFileName}`,
    `--- ${oldFileName}`,
    `+++ ${newFileName}`,
    `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
    ...lines
  ].join('\n');
}

/**
 * Mocks the workspace findFiles function
 */
export function mockFindFiles(files: string[]): void {
  (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(
    files.map(file => vscode.Uri.file(file))
  );
}

/**
 * Creates a mock diff-parsed patch object
 */
export function createMockParsedPatch(options: {
  oldFileName?: string;
  newFileName?: string;
  hunks?: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
} = {}): DiffParsedPatch {
  const {
    oldFileName = 'a/src/file.ts',
    newFileName = 'b/src/file.ts',
    hunks = [{
      oldStart: 10,
      oldLines: 7,
      newStart: 10,
      newLines: 7,
      lines: [
        ' import React from \'react\';',
        ' import ReactDOM from \'react-dom\';',
        ' import \'./index.css\';',
        '-import App from \'./App\';',
        '+import { App } from \'./App\';',
        ' import reportWebVitals from \'./reportWebVitals\';',
        ' '
      ]
    }]
  } = options;

  return {
    oldFileName,
    newFileName,
    hunks,
    oldHeader: '', // Add default empty values to satisfy the type
    newHeader: ''
  };
}

/**
 * Creates a full mocked VS Code environment for testing
 */
export function setupVSCodeMocks(): void {
  // Setup workspace folders
  (vscode.workspace.workspaceFolders as any) = [
    { uri: vscode.Uri.file('/test-workspace'), index: 0, name: 'test' }
  ];
  
  // Setup configuration
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: jest.fn().mockImplementation((key, defaultValue) => {
      if (key === 'autoStage') {return false;}
      if (key === 'fuzzFactor') {return 2;}
      return defaultValue;
    }),
    update: jest.fn().mockResolvedValue(undefined)
  });
  
  // Setup information message mocks
  (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('OK');
  (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Yes');
  (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue('OK');
  
  // Setup output channel
  (vscode.window.createOutputChannel as jest.Mock).mockReturnValue({
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn()
  });
}