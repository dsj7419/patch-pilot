// Temporary test file to validate setup 
import * as vscode from 'vscode'; 
 
describe('Test Setup Validation', () => {
  it('should have a working test environment', () => {
    expect(true).toBe(true); 
  }); 
 
  it('should mock vscode API correctly', () => {
    expect(vscode).toBeDefined(); 
    expect(vscode.window).toBeDefined(); 
    expect(vscode.window.showInformationMessage).toBeDefined(); 
  }); 
});