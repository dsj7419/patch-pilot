/* --------------------------------------------------------------------------
 *  PatchPilot — Patch Parsing Logic
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as DiffLib from 'diff';
import { DiffParsedPatch } from '../types/patchTypes';
import { sanitizePath, isSafePath } from '../security/pathSanitizer';

/**
 * Parses a unified diff string into structured patch objects.
 * @param patchText The unified diff text.
 * @returns An array of parsed patch objects.
 */
export function parsePatch(patchText: string): DiffParsedPatch[] {
  return DiffLib.parsePatch(patchText) as DiffParsedPatch[];
}

/**
 * Extracts the relative file path from a parsed patch object.
 * Handles git prefixes (a/, b/) and cleans control characters.
 * @param p The parsed patch object.
 * @returns The extracted relative file path or undefined if not found.
 */
export function extractFilePath(p: DiffParsedPatch): string | undefined {
  if (p.newFileName && p.newFileName !== '/dev/null') {
    return sanitizePath(p.newFileName.replace(/^b\//, ''));
  }
  if (p.oldFileName && p.oldFileName !== '/dev/null') {
    return sanitizePath(p.oldFileName.replace(/^a\//, ''));
  }
  return undefined;
}

/**
 * Resolves a relative file path from a patch to a workspace URI.
 * Uses fuzzy search if the exact path doesn't exist.
 * @param relPath The relative path from the patch.
 * @returns An object containing the resolved URI and a flag indicating if it's a new file.
 */
export async function resolveWorkspaceFile(
  relPath: string,
  isNewFileFromPatch: boolean,
): Promise<{ uri: vscode.Uri, isNew: boolean }> {

  const config = vscode.workspace.getConfiguration('patchPilot');
  const strictSearch = config.get<boolean>('strictFileSearch', false);

  const roots = vscode.workspace.workspaceFolders;
  if (!roots?.length) {throw new Error('No workspace folder open.');}

  // If the patch explicitly marks this as a new file, skip all searching.
  if (isNewFileFromPatch) {
    const newFileUri = vscode.Uri.joinPath(roots[0].uri, relPath);
    return { uri: newFileUri, isNew: true };
  }

  // Security improvement: Validate the relative path
  if (!isSafePath(relPath)) {
    throw new Error(`Invalid file path: ${relPath}`);
  }

  // 1. Try exact match in each workspace folder
  for (const r of roots) {
    const uri = vscode.Uri.joinPath(r.uri, relPath);
    try {
      await vscode.workspace.fs.stat(uri);
      return { uri, isNew: false };
    } catch {
      /* ignore */
    }
  }

  // 2. Fuzzy search for an existing file (only if not in strict mode).
  if (!strictSearch) {
    const fname = relPath.split('/').pop() ?? relPath;
    if (fname && fname !== '' && fname !== '..' && fname !== '.') {
      const found = await vscode.workspace.findFiles(
        `**/${fname}`,
        '**/node_modules/**',
        10
      );
  
      console.debug("DEBUG: found: ", found);
  
      if (found.length === 1) { return { uri: found[0], isNew: false }; }
      if (found.length > 1) {
          // Logic for multiple matches could be here, but for now let's default to creation 
          // or just return the first one to keep signature simple, or assume new.
          // To keep behavior close to original but safe:
          return { uri: found[0], isNew: false };
      }
    }
  }

  // 3. Not found -> Assume new file in the first workspace root
  // We default to the first root for creation
  const newFileUri = vscode.Uri.joinPath(roots[0].uri, relPath);
  return { uri: newFileUri, isNew: true };
}
