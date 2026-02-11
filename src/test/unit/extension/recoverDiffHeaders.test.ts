import * as vscode from 'vscode';
import { recoverDiffHeaders } from '../../../extension';

jest.mock('vscode');
jest.mock('../../../telemetry', () => ({
  trackEvent: jest.fn(),
  initTelemetry: jest.fn().mockResolvedValue(undefined)
}));

describe('recoverDiffHeaders', () => {
  function makeDoc(text: string): vscode.TextDocument {
    return {
      getText: (range?: vscode.Range) => {
        if (!range) { return text; }
        const lines = text.split('\n');
        // Simple: return lines from start to end line
        return lines.slice(range.start.line, range.end.line).join('\n');
      },
    } as unknown as vscode.TextDocument;
  }

  function makeSel(startLine: number, endLine: number): vscode.Selection {
    return {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 0 },
      isEmpty: false,
    } as unknown as vscode.Selection;
  }

  it('returns text unchanged if headers already present', () => {
    const selected = '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n-old\n+new\n';
    const doc = makeDoc(selected);
    const sel = makeSel(0, 5);
    expect(recoverDiffHeaders(doc, sel, selected)).toBe(selected);
  });

  it('returns text unchanged if it does not look like a diff', () => {
    const selected = 'just some random text\nno diff here\n';
    const doc = makeDoc(selected);
    const sel = makeSel(0, 2);
    expect(recoverDiffHeaders(doc, sel, selected)).toBe(selected);
  });

  it('recovers headers from above the selection', () => {
    const fullDoc = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,3 @@',
      '-old line',
      '+new line',
      ' context',
    ].join('\n');

    const selected = '@@ -1,3 +1,3 @@\n-old line\n+new line\n context\n';
    const doc = makeDoc(fullDoc);
    const sel = makeSel(3, 7);

    const result = recoverDiffHeaders(doc, sel, selected);
    expect(result).toContain('--- a/src/foo.ts');
    expect(result).toContain('+++ b/src/foo.ts');
    expect(result).toContain('diff --git a/src/foo.ts b/src/foo.ts');
    expect(result).toContain('@@ -1,3 +1,3 @@');
  });

  it('recovers headers without diff --git line', () => {
    const fullDoc = [
      '--- a/src/bar.ts',
      '+++ b/src/bar.ts',
      '@@ -10,3 +10,4 @@',
      '-removed',
      '+added',
      '+another',
      ' ctx',
    ].join('\n');

    const selected = '@@ -10,3 +10,4 @@\n-removed\n+added\n+another\n ctx\n';
    const doc = makeDoc(fullDoc);
    const sel = makeSel(2, 7);

    const result = recoverDiffHeaders(doc, sel, selected);
    expect(result).toContain('--- a/src/bar.ts');
    expect(result).toContain('+++ b/src/bar.ts');
    expect(result).not.toContain('diff --git');
  });

  it('returns unchanged if no headers found above', () => {
    const selected = '@@ -1,3 +1,3 @@\n-old\n+new\n';
    const doc = makeDoc(selected);
    const sel = makeSel(0, 3);

    const result = recoverDiffHeaders(doc, sel, selected);
    expect(result).toBe(selected);
  });
});
