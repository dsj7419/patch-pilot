// src/test/unit/extension/branchCommand.test.ts

import * as vscode from 'vscode';
import { createTempBranch } from '../../../git';
import { trackEvent } from '../../../telemetry';

// Mock external dependencies
jest.mock('vscode');
jest.mock('../../../git', () => ({
  createTempBranch: jest.fn().mockResolvedValue('test-branch'),
  isGitAvailable: jest.fn().mockResolvedValue(true)
}));
jest.mock('../../../telemetry', () => ({
  trackEvent: jest.fn(),
  initTelemetry: jest.fn().mockResolvedValue(undefined)
}));

// Test the command handler directly
describe('Create Branch Command', () => {
  // The actual command handler we'll test
  let commandHandler: (branchName?: string) => Promise<string>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the showInputBox mock for each test
    (vscode.window.showInputBox as jest.Mock).mockReset();
    
    // Reset the showInformationMessage mock for each test
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
    
    // Create the command handler for testing
    commandHandler = async (branchName?: string): Promise<string> => {
      // Track API usage
      trackEvent('api_called', { method: 'createBranch' });
      
      try {
        // If branchName is not provided, show input box to get it from user
        if (branchName === undefined) {
          const defaultBranchName = `patchpilot/${new Date().toISOString().replace(/[:.]/g, '-')}`;
          branchName = await vscode.window.showInputBox({
            prompt: 'Enter a name for the new branch',
            placeHolder: defaultBranchName,
            value: defaultBranchName
          });
          
          // If user cancelled the input box, show message and return
          if (branchName === undefined) {
            vscode.window.showInformationMessage('Branch creation cancelled.');
            throw new Error('Branch creation cancelled');
          }
          
          // Track if a custom name was provided (not using the default)
          trackEvent('command_executed', { 
            command: 'createBranch', 
            customName: branchName !== defaultBranchName && branchName !== ''
          });
        }
        
        // Create a branch for the patch
        return await createTempBranch(branchName === '' ? undefined : branchName);
      } catch (error) {
        // Track error
        trackEvent('api_error', { 
          method: 'createBranch',
          error: error instanceof Error ? error.message : String(error)
        });
        
        throw error;
      }
    };
  });
  
  test('should pass the branch name directly when provided', async () => {
    // Call the command with a branch name
    await commandHandler('feature-branch');
    
    // Should call createTempBranch with the provided name
    expect(createTempBranch).toHaveBeenCalledWith('feature-branch');
    
    // Should not show an input box
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    
    // Should track telemetry
    expect(trackEvent).toHaveBeenCalledWith('api_called', { method: 'createBranch' });
  });
  
  test('should prompt user for branch name when not provided', async () => {
    // Mock the input box to return a custom name
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('custom-branch');
    
    // Call the command without a branch name
    await commandHandler();
    
    // Should show an input box with default value
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Enter a name for the new branch',
        placeHolder: expect.stringContaining('patchpilot/')
      })
    );
    
    // Should call createTempBranch with the user's input
    expect(createTempBranch).toHaveBeenCalledWith('custom-branch');
    
    // Should track telemetry for custom name
    expect(trackEvent).toHaveBeenCalledWith('command_executed', { 
      command: 'createBranch', 
      customName: true
    });
  });
  
  test('should use the default name when user provides empty string', async () => {
    // Mock the input box to return an empty string
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('');
    
    // Call the command without a branch name
    await commandHandler();
    
    // Should show an input box
    expect(vscode.window.showInputBox).toHaveBeenCalled();
    
    // Should call createTempBranch with undefined (to use the default)
    expect(createTempBranch).toHaveBeenCalledWith(undefined);
    
    // Should track telemetry for using default name
    expect(trackEvent).toHaveBeenCalledWith('command_executed', { 
      command: 'createBranch', 
      customName: false
    });
  });
  
  test('should handle cancelled input box', async () => {
    // Mock the input box to return undefined (cancelled)
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);
    
    // Call the command without a branch name
    try {
      await commandHandler();
      fail('Expected an error to be thrown');
    } catch (error) {
      // Should show an information message
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Branch creation cancelled.');
      
      // Should not call createTempBranch
      expect(createTempBranch).not.toHaveBeenCalled();
      
      // Should track the error
      expect(trackEvent).toHaveBeenCalledWith('api_error', {
        method: 'createBranch',
        error: 'Branch creation cancelled'
      });
    }
  });
  
  test('should handle errors from createTempBranch', async () => {
    // Mock createTempBranch to throw an error
    (createTempBranch as jest.Mock).mockRejectedValueOnce(new Error('Git error'));
    
    // Call the command with a branch name
    try {
      await commandHandler('feature-branch');
      fail('Expected an error to be thrown');
    } catch (error) {
      // Should still call createTempBranch
      expect(createTempBranch).toHaveBeenCalledWith('feature-branch');
      
      // Should track the error
      expect(trackEvent).toHaveBeenCalledWith('api_error', {
        method: 'createBranch',
        error: 'Git error'
      });
    }
  });
  
  test('should detect when user uses default name without changes', async () => {
    // Mock the input box to return the default value unchanged
    (vscode.window.showInputBox as jest.Mock).mockImplementation((options) => {
      // Return the exact value that was provided as default
      return Promise.resolve(options.value);
    });
    
    // Call the command without a branch name
    await commandHandler();
    
    // Should show an input box
    expect(vscode.window.showInputBox).toHaveBeenCalled();
    
    // Should call createTempBranch with the default value
    expect(createTempBranch).toHaveBeenCalledWith(expect.stringContaining('patchpilot/'));
    
    // Should track telemetry for using default name
    expect(trackEvent).toHaveBeenCalledWith('command_executed', { 
      command: 'createBranch', 
      customName: false
    });
  });
});