// File: src/telemetry.ts

/* --------------------------------------------------------------------------
 *  PatchPilot — Telemetry services (privacy-first, offline-friendly)
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as crypto from 'crypto';

/** Module‑level state */
let telemetryEnabled = false;
let ctx: vscode.ExtensionContext | undefined;
let anonymousUserId: string | undefined;

type TelemetryProperty = string | number | boolean | null | undefined;
type TelemetryProperties = Record<string, TelemetryProperty>;

interface TelemetryEvent {
  eventName: string;
  properties?: TelemetryProperties;
  measurements?: Record<string, number>;
  timestamp: string;
}

/**
 * Initializes the telemetry system.
 * - Generates/stores a deterministic user ID under Jest.
 * - Initializes the events buffer.
 * - Prompts once per user for opt‑in.
 */
export async function initTelemetry(context: vscode.ExtensionContext): Promise<void> {
  ctx = context;

  const config = vscode.workspace.getConfiguration('patchPilot');
  telemetryEnabled = config.get<boolean>('enableTelemetry', false);

  // Ensure events buffer exists
  if (!ctx.globalState.get<TelemetryEvent[]>('telemetryEvents', [])) {
    await ctx.globalState.update('telemetryEvents', []);
  }

  // Generate or retrieve anonymousUserId
  const existingId = ctx.globalState.get<string>('anonymousUserId');
  if (!existingId) {
    anonymousUserId = generateAnonymousId();
    await ctx.globalState.update('anonymousUserId', anonymousUserId);
  } else {
    anonymousUserId = existingId;
  }

  // Prompt on first run only
  const prompted = ctx.globalState.get<boolean>('hasPromptedTelemetry', false);
  if (!prompted) {
    await promptForTelemetry();
    await ctx.globalState.update('hasPromptedTelemetry', true);
  }

  // Listen for changes to the enableTelemetry setting
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('patchPilot.enableTelemetry')) {
        telemetryEnabled = vscode.workspace
          .getConfiguration('patchPilot')
          .get<boolean>('enableTelemetry', false);
        const status = telemetryEnabled ? 'enabled' : 'disabled';
        vscode.window.showInformationMessage(`PatchPilot telemetry is now ${status}.`);
      }
    })
  );
}

/**
 * Track a named event with optional properties and measurements.
 */
export function trackEvent(
  eventName: string,
  properties?: TelemetryProperties,
  measurements?: Record<string, number>
): void {
  if (!telemetryEnabled || !ctx) {return;}

  const buffer = ctx.globalState.get<TelemetryEvent[]>('telemetryEvents', []);
  buffer.push({ eventName, properties, measurements, timestamp: new Date().toISOString() });
  ctx.globalState.update('telemetryEvents', buffer);
}

/**
 * Returns whether telemetry is currently enabled.
 */
export function isTelemetryEnabled(): boolean {
  return telemetryEnabled;
}

/**
 * Clears all stored telemetry events.
 */
export async function clearTelemetryData(): Promise<void> {
  if (!ctx) {return;}
  await ctx.globalState.update('telemetryEvents', []);
  vscode.window.showInformationMessage('All telemetry data has been cleared.');
}

/** Prompt the user to opt into anonymous telemetry. */
async function promptForTelemetry(): Promise<void> {
  const msg =
    'Would you like to help improve PatchPilot by sending anonymous usage data? ' +
    'No personal or project information is collected.';
  const choice = await vscode.window.showInformationMessage(
    msg,
    { modal: true },
    'Yes, I\'ll help',
    'No thanks'
  );
  const approved = choice === 'Yes, I\'ll help';
  telemetryEnabled = approved;
  await vscode.workspace
    .getConfiguration('patchPilot')
    .update('enableTelemetry', approved, vscode.ConfigurationTarget.Global);
}

/** Generates a stable anonymous ID (deterministic under Jest). */
function generateAnonymousId(): string {
  // deterministic for Jest
  if (process.env.JEST_WORKER_ID) {
    return 'mock-user-id-hash';
  }
  // otherwise secure random
  return (crypto.randomBytes(18) as Buffer).toString('base64url').slice(0, 24);
}
