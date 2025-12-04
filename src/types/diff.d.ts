/* --------------------------------------------------------------------------
 *  PatchPilot — Type definitions for diff library
 * ----------------------------------------------------------------------- */

declare module 'diff' {
  export interface Hunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }

  export interface ParsedPatch {
    oldFileName: string;
    newFileName: string;
    oldHeader: string;
    newHeader: string;
    hunks: Hunk[];
  }

  export interface Change {
    value: string;
    count?: number;
    added?: boolean;
    removed?: boolean;
  }

  // Function to build diff programmatically
  export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: { context?: number }
  ): ParsedPatch;

  // Functions from the diff library that we use
  export function parsePatch(text: string): ParsedPatch[];
  export function applyPatch(content: string, patch: string | ParsedPatch): string | false;
  export function diffLines(oldStr: string, newStr: string, options?: any): Change[];
}