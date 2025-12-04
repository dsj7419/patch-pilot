// src/test/setup/jest.setup.ts
// Configure test timeouts
jest.setTimeout(15000);

// Import vscode types for TypeScript (this won't be used at runtime)
import * as vscodeTypes from 'vscode';

// Mock VS Code API since we can't import it directly in tests
const mockVSCode: any = {
  // VS Code enums
  ExtensionKind: {
    UI: 1,
    Workspace: 2
  },
  
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64
  },

  // Mocking the basic VS Code classes
  Range: class {
    constructor(
      startLineOrPosition: any,
      startCharacterOrEndPosition: any,
      endLine?: any,
      endCharacter?: any
    ) {
      let startLine;
      let startCharacter;

      if (typeof startLineOrPosition === 'number') {
        startLine = startLineOrPosition;
        startCharacter = startCharacterOrEndPosition;
        this.start = { line: startLine, character: startCharacter };
        this.end = { line: endLine, character: endCharacter };
      } else {
        this.start = startLineOrPosition;
        this.end = startCharacterOrEndPosition;
      }
    }

    start: any;
    end: any;

    isEmpty = false;
    isSingleLine = false;

    contains(position: any) {
      return true;
    }

    isEqual(other: any) {
      return false;
    }

    intersection(range: any) {
      return new mockVSCode.Range(0, 0, 0, 0);
    }

    union(other: any) {
      return new mockVSCode.Range(0, 0, 0, 0);
    }

    with(start: any, end?: any) {
      if (arguments.length === 1) {
        const change = start;
        return new mockVSCode.Range(
          change.start || this.start,
          change.end || this.end
        );
      }
      return new mockVSCode.Range(start || this.start, end || this.end);
    }

    get startLine() {
      return this.start.line;
    }

    get startCharacter() {
      return this.start.character;
    }

    get endLine() {
      return this.end.line;
    }

    get endCharacter() {
      return this.end.character;
    }
  },

  Position: class {
    constructor(line: number, character: number) {
      this.line = line;
      this.character = character;
    }

    line: number;
    character: number;

    isBefore(other: any) {
      return false;
    }

    isBeforeOrEqual(other: any) {
      return false;
    }

    isAfter(other: any) {
      return false;
    }

    isAfterOrEqual(other: any) {
      return false;
    }

    isEqual(other: any) {
      return false;
    }

    compareTo(other: any) {
      return 0;
    }

    translate(lineDelta?: number, characterDelta?: number) {
      return new mockVSCode.Position(
        this.line + (lineDelta || 0),
        this.character + (characterDelta || 0)
      );
    }

    with(line?: number, character?: number) {
      return new mockVSCode.Position(
        line === undefined ? this.line : line,
        character === undefined ? this.character : character
      );
    }
  },

  CodeLens: class {
    constructor(range: any, command?: any) {
      this.range = range;
      this.command = command;
    }
    isResolved = true;
  },

  Uri: {
    file: jest.fn((path) => {
      const uri = {
        fsPath: path,
        path: path,
        scheme: 'file',
        authority: '',
        query: '',
        fragment: '',
        with: jest.fn(function(change) {
          const newUri = { ...this };
          if (change.scheme) {newUri.scheme = change.scheme;}
          if (change.authority) {newUri.authority = change.authority;}
          if (change.path) {
            newUri.path = change.path;
            newUri.fsPath = change.path;
          }
          if (change.query) {newUri.query = change.query;}
          if (change.fragment) {newUri.fragment = change.fragment;}
          
          // Keep the with method in the new object
          newUri.with = this.with;
          newUri.toString = this.toString;
          
          return newUri;
        }),
        toString: jest.fn(() => `file://${path}`)
      };
      return uri;
    }),
    parse: jest.fn((uriString) => {
      const schemeMatch = uriString.match(/^([a-z]+):/);
      const scheme = schemeMatch ? schemeMatch[1] : 'file';
      const path = uriString.replace(/^([a-z]+):\/\//, '');
      
      return {
        fsPath: path,
        path: path,
        scheme: scheme,
        authority: '',
        query: '',
        fragment: '',
        with: jest.fn(function(change) {
          const newUri = { ...this };
          if (change.scheme) {newUri.scheme = change.scheme;}
          if (change.authority) {newUri.authority = change.authority;}
          if (change.path) {
            newUri.path = change.path;
            newUri.fsPath = change.path;
          }
          if (change.query) {newUri.query = change.query;}
          if (change.fragment) {newUri.fragment = change.fragment;}
          
          // Keep the with method in the new object
          newUri.with = this.with;
          newUri.toString = this.toString;
          
          return newUri;
        }),
        toString: jest.fn(() => uriString)
      };
    }),
    joinPath: jest.fn((baseUri, ...pathSegments): any => {
      // Get the base path, handling the case where baseUri could be a string or URI object
      const basePath = typeof baseUri === 'string' 
        ? baseUri 
        : baseUri.fsPath || baseUri.path || '';
      
      // Join the paths, handling different path separators
      const joinedPath = [basePath, ...pathSegments].join('/').replace(/\/+/g, '/');
      
      // Create a new URI with the joined path
      return mockVSCode.Uri.file(joinedPath);
    })
  },

  MarkdownString: class {
    constructor(value: string) {
      this.value = value || '';
    }
    
    value: string;
    isTrusted = false;
    supportThemeIcons = false;
    supportHtml = false;
    baseUri = undefined;
    
    appendText(value: string) {
      this.value += value;
      return this;
    }
    
    appendMarkdown(value: string) {
      this.value += value;
      return this;
    }
    
    appendCodeblock(code: string, language?: string) {
      this.value += '\n```' + (language || '') + '\n' + code + '\n```\n';
      return this;
    }
  },

  Disposable: {
    from: jest.fn((...disposables: any[]) => ({
      dispose: jest.fn(() => {
        for (const disposable of disposables) {
          disposable?.dispose?.();
        }
      })
    }))
  },

  EventEmitter: class {
    constructor() {
      this.listeners = [];
    }
    
    listeners: any[] = [];
    
    event = jest.fn((listener) => {
      this.listeners.push(listener);
      return { dispose: jest.fn(() => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) {
          this.listeners.splice(idx, 1);
        }
      })};
    });
    
    fire = jest.fn((event) => {
      this.listeners.forEach(listener => listener(event));
    });
    
    dispose = jest.fn(() => {
      this.listeners = [];
    });
  },

  window: {
    showInformationMessage: jest.fn(() => Promise.resolve('Yes')),
    showWarningMessage: jest.fn(() => Promise.resolve('Yes')),
    showErrorMessage: jest.fn(() => Promise.resolve('Yes')),
    showQuickPick: jest.fn((items) => Promise.resolve(items[0])),
    showInputBox: jest.fn(() => Promise.resolve('')),
    createOutputChannel: jest.fn(() => ({
      append: jest.fn(),
      appendLine: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    })),
    createStatusBarItem: jest.fn(() => ({
      text: '',
      tooltip: '',
      command: '',
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    })),
    createWebviewPanel: jest.fn(() => ({
      webview: {
        html: '',
        onDidReceiveMessage: jest.fn(),
        postMessage: jest.fn(),
        asWebviewUri: jest.fn(uri => uri),
        cspSource: 'https://test-host'
      },
      onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
      onDidChangeViewState: jest.fn(() => ({ dispose: jest.fn() })),
      reveal: jest.fn(),
      dispose: jest.fn()
    })),
    activeTextEditor: undefined
  },

  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn((key, defaultValue) => defaultValue),
      update: jest.fn().mockResolvedValue(undefined),
      has: jest.fn(() => false)
    })),
    registerTextDocumentContentProvider: jest.fn(() => ({
        dispose: jest.fn()
      })),
    openTextDocument: jest.fn(() => Promise.resolve({
      getText: jest.fn(() => ''),
      save: jest.fn(() => Promise.resolve(true)),
      isDirty: false,
      lineCount: 0,
      lineAt: jest.fn(() => ({
        text: '',
        range: new mockVSCode.Range(0, 0, 0, 0),
        rangeIncludingLineBreak: new mockVSCode.Range(0, 0, 0, 0),
        firstNonWhitespaceCharacterIndex: 0,
        isEmptyOrWhitespace: true
      }))
    })),
    saveAll: jest.fn(() => Promise.resolve(true)),
    applyEdit: jest.fn(() => Promise.resolve(true)),
    findFiles: jest.fn(() => Promise.resolve([])),
    workspaceFolders: [{ uri: { fsPath: '/test-workspace' }, name: 'test', index: 0 }],
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    fs: {
      readFile: jest.fn(() => Promise.resolve(Buffer.from(''))),
      writeFile: jest.fn(() => Promise.resolve()),
      createDirectory: jest.fn(() => Promise.resolve()),
      stat: jest.fn(() => Promise.resolve({ type: 1 }))
    },
    asRelativePath: jest.fn(p => typeof p === 'string' ? p : p.fsPath || ''),
    createFileSystemWatcher: jest.fn(() => ({
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
      onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
      onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
      dispose: jest.fn()
    })),
    onDidCloseTextDocument: jest.fn(() => ({ dispose: jest.fn() }))
  },

  commands: {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
    executeCommand: jest.fn(),
    getCommands: jest.fn(() => Promise.resolve([]))
  },

  languages: {
    registerCodeLensProvider: jest.fn(() => ({ dispose: jest.fn() }))
  },

  extensions: {
    all: [],
    getExtension: jest.fn(() => undefined)
  },

  env: {
    clipboard: {
      readText: jest.fn(() => Promise.resolve('')),
      writeText: jest.fn(() => Promise.resolve())
    },
    openExternal: jest.fn(() => Promise.resolve(true)),
    language: 'en'
  },

  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3
  },

  StatusBarAlignment: {
    Left: 1,
    Right: 2
  },

  ProgressLocation: {
    Window: 10,
    Notification: 15
  },

  ThemeColor: class {
    constructor(id: string) {
      this.id = id;
    }
    id: string;
  },

  QuickInputButtons: {
    Back: { iconPath: 'back' }
  },

  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },

  WorkspaceEdit: class {
    constructor() {
      this._edits = [];
    }
    
    // Store edits as any because we don't need the exact type for testing
    _edits: any[] = [];
    
    replace(uri: any, range: any, newText: any) {
      this._edits.push({ type: 'replace', uri, range, newText });
    }
    
    insert(uri: any, position: any, newText: any) {
      this._edits.push({ type: 'insert', uri, position, newText });
    }
    
    delete(uri: any, range: any) {
      this._edits.push({ type: 'delete', uri, range });
    }
    
    has(uri: any) {
      return this._edits.some(edit => edit.uri === uri);
    }
    
    size() {
      return this._edits.length;
    }
    
    // For testing
    getEdits() {
      return this._edits;
    }
  }
};

// Mock vscode
jest.mock('vscode', () => mockVSCode, { virtual: true });

// Create a reference to mockVSCode as vscode for use in the setup file
const vscode = mockVSCode;

// Set up clipboard mock
if (!vscode.env) {
  (vscode as any).env = {};
}
if (!vscode.env.clipboard) {
  (vscode.env as any).clipboard = {
    readText: jest.fn().mockResolvedValue(''),
    writeText: jest.fn().mockResolvedValue(undefined)
  };
}

// Add resetAllMocks helper
global.resetAllMocks = () => {
  jest.resetAllMocks();
};

// Set up fake timers for debounce/throttle tests
jest.useFakeTimers();

// Quiet console.log in tests but keep errors
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

// Add global helper to mock a VS Code API function
global.mockVSCodeFunction = (namespace: string, functionName: string, implementation: (...args: any[]) => any) => {
  if (mockVSCode[namespace] && typeof mockVSCode[namespace][functionName] === 'function') {
    const original = mockVSCode[namespace][functionName];
    mockVSCode[namespace][functionName] = jest.fn(implementation);
    return {
      restore: () => {
        mockVSCode[namespace][functionName] = original;
      }
    };
  }
  throw new Error(`Function ${namespace}.${functionName} not found in VS Code API mock`);
};

// Type augmentation for global
declare global {
  function resetAllMocks(): void;
  function mockVSCodeFunction(
    namespace: string,
    functionName: string, 
    implementation: (...args: any[]) => any
  ): { restore: () => void };
  
  namespace NodeJS {
    interface Global {
      resetAllMocks: typeof resetAllMocks;
      mockVSCodeFunction: typeof mockVSCodeFunction;
    }
  }
}

// Adding this empty export makes this file a module
export {};