/**
 * Mock for the telemetry module
 * This allows tests to control telemetry state directly
 */

import * as vscode from 'vscode';

// Mock telemetry state
let mockTelemetryEnabled = false;
let mockAnonymousUserId: string | undefined = 'test-user-id';
let mockEvents: any[] = [];

// Mock implementations
export const initTelemetry = jest.fn().mockImplementation(async (context: vscode.ExtensionContext) => {
  // Initialize from the provided config
  const config = vscode.workspace.getConfiguration('patchPilot');
  mockTelemetryEnabled = config.get<boolean>('enableTelemetry', false);
  return Promise.resolve();
});

export const trackEvent = jest.fn().mockImplementation((eventName: string, properties?: any) => {
  if (!mockTelemetryEnabled) {
    return;
  }
  
  const event = {
    eventName,
    properties,
    timestamp: new Date().toISOString()
  };
  
  mockEvents.push(event);
});

export const isTelemetryEnabled = jest.fn().mockImplementation(() => {
  return mockTelemetryEnabled;
});

export const clearTelemetryData = jest.fn().mockImplementation(async () => {
  mockEvents = [];
  return Promise.resolve();
});

// Helper methods for tests
export const __setTelemetryEnabled = (enabled: boolean) => {
  mockTelemetryEnabled = enabled;
};

export const __getEvents = () => {
  return [...mockEvents];
};

export const __clearEvents = () => {
  mockEvents = [];
};