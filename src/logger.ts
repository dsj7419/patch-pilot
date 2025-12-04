/* --------------------------------------------------------------------------
 *  PatchPilot — Shared Output Channel (Singleton)
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | undefined;

let _mainChannel: vscode.OutputChannel | undefined;
let _gitChannel: vscode.OutputChannel | undefined;

export function registerLoggers(context: vscode.ExtensionContext): void {
  _mainChannel = vscode.window.createOutputChannel('PatchPilot');
  _gitChannel = vscode.window.createOutputChannel('PatchPilot Git');
  context.subscriptions.push(_mainChannel, _gitChannel);
}

export function getMainOutputChannel(): vscode.OutputChannel {
  if (!_mainChannel) {
    _mainChannel = vscode.window.createOutputChannel('PatchPilot');
  }
  return _mainChannel;
}

export function getGitOutputChannel(): vscode.OutputChannel {
  if (!_gitChannel) {
    _gitChannel = vscode.window.createOutputChannel('PatchPilot Git');
  }
  return _gitChannel;
}

export function getOutputChannel(): vscode.OutputChannel {
  return getMainOutputChannel();
}

export function log(message: string): void {
  getMainOutputChannel().appendLine(message);
}
