/* --------------------------------------------------------------------------
 *  PatchPilot — Unit tests for PatchCodeLensProvider
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { PatchCodeLensProvider } from '../../../patch/PatchCodeLensProvider';
import { pendingPatches } from '../../../patch/PatchSession';
import { HunkManager } from '../../../patch/HunkManager';

// Mock dependencies
jest.mock('vscode');
jest.mock('../../../patch/PatchSession', () => ({
  pendingPatches: new Map()
}));

// Mock HunkManager
const mockCompare = jest.fn();
jest.mock('../../../patch/HunkManager', () => {
  return {
    HunkManager: jest.fn().mockImplementation(() => {
      return {
        compare: mockCompare,
        revertHunk: jest.fn()
      };
    })
  };
});

describe('PatchCodeLensProvider', () => {
  let provider: PatchCodeLensProvider;
  let mockDocument: any;
  let mockToken: any;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PatchCodeLensProvider();
    
    mockDocument = {
      uri: {
        scheme: 'patchpilot-mod',
        toString: () => 'patchpilot-mod://test'
      },
      getText: jest.fn().mockReturnValue('modified content')
    };
    
    mockToken = {};
    
    // Setup pending patches
    (pendingPatches as any).get = jest.fn();
    
    // Setup fs mocks
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: 1 });
    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('original content'));
  });

  it('should return empty array for non-patchpilot documents', async () => {
    mockDocument.uri.scheme = 'file';
    const lenses = await provider.provideCodeLenses(mockDocument, mockToken);
    expect(lenses).toEqual([]);
  });

  it('should return empty array if no pending patch found', async () => {
    (pendingPatches.get as jest.Mock).mockReturnValue(undefined);
    const lenses = await provider.provideCodeLenses(mockDocument, mockToken);
    expect(lenses).toEqual([]);
  });

  it('should generate code lenses for hunks', async () => {
    // Setup pending patch
    (pendingPatches.get as jest.Mock).mockReturnValue({
      targetUri: { fsPath: '/test/file.ts' },
      patchedContent: 'modified content'
    });

    // Setup HunkManager to return one hunk
    mockCompare.mockReturnValue([{
      originalStart: 0,
      originalLength: 1,
      modifiedStart: 5,
      modifiedLength: 1
    }]);

    const lenses = await provider.provideCodeLenses(mockDocument, mockToken);

    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toContain('Reject Change');
    expect(lenses[0].command?.command).toBe('patchPilot.discardHunk');
    expect(lenses[0].range.start.line).toBe(5);
  });

  it('should handle file read errors gracefully', async () => {
    (pendingPatches.get as jest.Mock).mockReturnValue({
      targetUri: { fsPath: '/test/new-file.ts' },
      patchedContent: 'new content'
    });

    // Simulate file not found (new file)
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('File not found'));
    
    mockCompare.mockReturnValue([]);

    await provider.provideCodeLenses(mockDocument, mockToken);

    // Should have called compare with empty string as original
    expect(mockCompare).toHaveBeenCalledWith('', 'modified content');
  });
});
