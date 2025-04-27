/* --------------------------------------------------------------------------
 *  PatchPilot — Webview Client Script
 * ----------------------------------------------------------------------- */

// Make this file a module by adding an export
export {};

// Define the VS Code API type
interface VSCodeAPI {
  getState(): WebviewState | undefined;
  setState(state: WebviewState): void;
  postMessage(message: WebviewMessage): void;
}

// Define the VS Code API function
declare function acquireVsCodeApi(): VSCodeAPI;

// File information interface
interface FileInfo {
  filePath: string;
  exists: boolean;
  hunks: number;
  changes: { additions: number; deletions: number };
}

// Result interface
interface PatchResult {
  file: string;
  status: 'applied' | 'failed';
  reason?: string;
  strategy?: string;
}

// Extension settings interface
interface ExtensionSettings {
  autoStage: boolean;
  fuzzFactor: number;
}

// State interface
interface WebviewState {
  patchText: string;
}

// All possible message types that can be sent between webview and extension
interface WebviewMessage {
  command: 'applyPatch' | 'previewPatch' | 'cancelPatch' | 'requestSettings' | 'checkClipboard';
  patchText?: string;
  data?: unknown;
}

interface ExtensionMessage {
  command: 'patchPreview' | 'patchResults' | 'patchError' | 'updateSettings' | 'clipboardContent';
  fileInfo?: FileInfo[];
  results?: PatchResult[];
  error?: string;
  config?: ExtensionSettings;
  patchText?: string;
  data?: unknown;
}

// Get the VS Code API
let vscode: VSCodeAPI | undefined;
try {
  vscode = acquireVsCodeApi();
} catch (error) {
  // API not available - could happen in tests
}

// Global state
let currentPatchText = '';
let _currentSettings: ExtensionSettings = {
  autoStage: false,
  fuzzFactor: 2
};

/**
 * Main initialization function
 */
function initialize() {
  // Get DOM elements with proper type casting
  const patchInput = document.getElementById('patch-input') as HTMLTextAreaElement;
  const previewArea = document.getElementById('preview-area') as HTMLDivElement;
  const fileList = document.getElementById('file-list') as HTMLDivElement;
  const previewBtn = document.getElementById('preview-btn') as HTMLButtonElement;
  const applyBtn = document.getElementById('apply-btn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
  const statusMessage = document.getElementById('status-message') as HTMLDivElement;

  // Validate DOM elements are found
  if (!patchInput || !previewArea || !fileList || !previewBtn || !applyBtn || !cancelBtn || !statusMessage) {
    return;
  }

  // Restore any cached state from VS Code API
  if (vscode) {
    const state = vscode.getState();
    if (state && state.patchText) {
      patchInput.value = state.patchText;
      currentPatchText = state.patchText;
    }
  }
  
  // Focus the input
  patchInput.focus();
  
  // Request current settings from extension
  if (vscode) {
    vscode.postMessage({ command: 'requestSettings' });
  
    // Check clipboard for diff content
    vscode.postMessage({ command: 'checkClipboard' });
  }
  
  // Setup event listeners
  previewBtn.addEventListener('click', () => {
    handlePreviewClick(patchInput, previewBtn, statusMessage);
  });
  
  applyBtn.addEventListener('click', () => {
    handleApplyClick(applyBtn, cancelBtn, statusMessage);
  });
  
  cancelBtn.addEventListener('click', () => {
    handleCancelClick(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage);
  });
  
  // Listen for changes to save state
  patchInput.addEventListener('input', () => {
    const text = patchInput.value;
    if (text !== currentPatchText) {
      currentPatchText = text;
      if (vscode) {
        vscode.setState({ patchText: text });
      }
      
      // Reset UI if text changes
      resetUI(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage);
    }
  });
  
  // Handle keyboard shortcuts
  patchInput.addEventListener('keydown', (e) => {
    // Ctrl+Enter or Cmd+Enter to preview
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handlePreviewClick(patchInput, previewBtn, statusMessage);
    }
    
    // Tab key handling for better editing experience
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = patchInput.selectionStart;
      const end = patchInput.selectionEnd;
      
      // Insert tab character
      patchInput.value = patchInput.value.substring(0, start) + '  ' + patchInput.value.substring(end);
      
      // Set cursor position after the inserted tab
      patchInput.selectionStart = patchInput.selectionEnd = start + 2;
      
      // Update state
      currentPatchText = patchInput.value;
      if (vscode) {
        vscode.setState({ patchText: currentPatchText });
      }
    }
  });
}

/**
 * Handles preview button click
 */
function handlePreviewClick(
  patchInput: HTMLTextAreaElement,
  previewBtn: HTMLButtonElement,
  statusMessage: HTMLDivElement
): void {
  const patchText = patchInput.value.trim();
  if (!patchText) {
    setStatus(statusMessage, 'Please paste a unified diff to preview.', 'error');
    return;
  }
  
  // Save current patch text
  currentPatchText = patchText;
  if (vscode) {
    vscode.setState({ patchText: patchText });
  
    // Show loading state
    setStatus(statusMessage, 'Parsing patch...', 'normal');
    previewBtn.disabled = true;
    previewBtn.setAttribute('aria-disabled', 'true');
    
    // Request preview from extension
    vscode.postMessage({
      command: 'previewPatch',
      patchText
    });
  } else {
    setStatus(statusMessage, 'VS Code API not available', 'error');
  }
}

/**
 * Handles apply button click
 */
function handleApplyClick(
  applyBtn: HTMLButtonElement,
  cancelBtn: HTMLButtonElement,
  statusMessage: HTMLDivElement
): void {
  // Show loading state
  setStatus(statusMessage, 'Applying patch...', 'normal');
  applyBtn.disabled = true;
  applyBtn.setAttribute('aria-disabled', 'true');
  cancelBtn.disabled = true;
  cancelBtn.setAttribute('aria-disabled', 'true');
  
  // Send patch to extension
  if (vscode) {
    vscode.postMessage({
      command: 'applyPatch',
      patchText: currentPatchText
    });
  } else {
    setStatus(statusMessage, 'VS Code API not available', 'error');
  }
}

/**
 * Handles cancel button click
 */
function handleCancelClick(
  previewArea: HTMLDivElement,
  previewBtn: HTMLButtonElement,
  applyBtn: HTMLButtonElement,
  cancelBtn: HTMLButtonElement,
  statusMessage: HTMLDivElement
): void {
  // Reset UI
  resetUI(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage);
  
  // Send cancel to extension
  if (vscode) {
    vscode.postMessage({
      command: 'cancelPatch'
    });
  }
  
  // Return focus to the textarea after cancellation
  const patchInput = document.getElementById('patch-input') as HTMLTextAreaElement;
  patchInput.focus();
}

/**
 * Handles patch preview response
 */
function handlePatchPreview(
  fileInfo: FileInfo[],
  previewArea: HTMLDivElement,
  fileList: HTMLDivElement,
  previewBtn: HTMLButtonElement,
  applyBtn: HTMLButtonElement,
  cancelBtn: HTMLButtonElement,
  statusMessage: HTMLDivElement
): void {
  if (!fileInfo || fileInfo.length === 0) {
    setStatus(statusMessage, 'No valid patches found in the provided text.', 'error');
    previewBtn.disabled = false;
    previewBtn.setAttribute('aria-disabled', 'false');
    return;
  }

  fileList.innerHTML = '';

  let totalAdditions = 0;
  let totalDeletions = 0;
  let missingFiles = 0;

  fileInfo.forEach((file) => {
    if (!file.exists) {missingFiles++;}

    totalAdditions += file.changes.additions;
    totalDeletions += file.changes.deletions;

    const entry = document.createElement('div');
    entry.className = 'file-entry';
    entry.setAttribute('role', 'listitem');

    const icon = document.createElement('span');
    icon.className = `file-icon ${file.exists ? 'success-icon' : 'warning-icon'}`;
    icon.textContent = file.exists ? '✓' : '⚠️';

    const pathSpan = document.createElement('span');
    pathSpan.className = 'file-path';
    pathSpan.textContent = file.filePath;

    const stats = document.createElement('span');
    stats.className = 'file-stats';
    stats.textContent = `(${file.hunks} hunks, +${file.changes.additions} -${file.changes.deletions})`;

    entry.append(icon, pathSpan, stats);
    fileList.appendChild(entry);
  });

  // Add summary row
  const summary = document.createElement('div');
  summary.className = 'file-entry summary-entry';
  summary.textContent = `📊 Total: ${fileInfo.length} files (${missingFiles} missing)  (+${totalAdditions} -${totalDeletions})`;
  fileList.appendChild(summary);

  // Enable/disable apply button
  const applyShouldBeEnabled = fileInfo.some(f => f.exists); // at least one file can be patched
  applyBtn.disabled = !applyShouldBeEnabled;
  applyBtn.setAttribute('aria-disabled', applyShouldBeEnabled ? 'false' : 'true');

  previewArea.classList.remove('hidden');
  previewArea.classList.add('visible');

  previewBtn.disabled = false;
  previewBtn.setAttribute('aria-disabled', 'false');
  cancelBtn.disabled = false;
  cancelBtn.setAttribute('aria-disabled', 'false');

  if (!applyShouldBeEnabled) {
    setStatus(statusMessage, 'Error: All target files not found. Cannot apply patch.', 'error');
    previewBtn.focus();
  } else if (missingFiles > 0) {
    setStatus(statusMessage,
      `Ready: ${fileInfo.length - missingFiles} file${fileInfo.length - missingFiles === 1 ? '' : 's'} will be patched; ${missingFiles} missing.`,
      'warning');
    applyBtn.focus();
  } else {
    setStatus(statusMessage,
      `Ready: ${fileInfo.length} file${fileInfo.length === 1 ? '' : 's'} will be patched.`,
      'success');
    applyBtn.focus();
  }
}


/**
 * Handles patch results
 */
function handlePatchResults(
  results: PatchResult[],
  previewArea: HTMLDivElement,
  patchInput: HTMLTextAreaElement,
  applyBtn: HTMLButtonElement,
  cancelBtn: HTMLButtonElement,
  previewBtn: HTMLButtonElement,
  statusMessage: HTMLDivElement
): void {
  if (!results || results.length === 0) {
    setStatus(statusMessage, 'No results returned from patch operation.', 'error');
    resetUI(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage);
    return;
  }
  
  // Count success and failures
  const successCount = results.filter(r => r.status === 'applied').length;
  const failCount = results.length - successCount;
  
  // Group results by strategy
  const strategyCount: Record<string, number> = {};
  results.forEach(r => {
    if (r.status === 'applied' && r.strategy) {
      strategyCount[r.strategy] = (strategyCount[r.strategy] || 0) + 1;
    }
  });
  
  // Create strategy info text
  let strategyText = '';
  if (Object.keys(strategyCount).length > 0) {
    const strategies = Object.entries(strategyCount)
      .map(([strategy, count]) => `${count} using ${strategy}`)
      .join(', ');
    strategyText = ` (${strategies})`;
  }
  
  // Set status based on results
  if (failCount === 0) {
    setStatus(statusMessage, `Successfully applied patches to ${successCount} file(s)${strategyText}.`, 'success');
  } else {
    setStatus(statusMessage, `Applied ${successCount} patch(es), ${failCount} failed. Check output for details.`, 'warning');
  }
  
  // Reset UI
  previewArea.classList.add('hidden');
  previewArea.classList.remove('visible');
  
  applyBtn.disabled = true;
  applyBtn.setAttribute('aria-disabled', 'true');
  cancelBtn.disabled = true;
  cancelBtn.setAttribute('aria-disabled', 'true');
  previewBtn.disabled = false;
  previewBtn.setAttribute('aria-disabled', 'false');
  
  // Clear input if successful
  if (failCount === 0) {
    patchInput.value = '';
    currentPatchText = '';
    if (vscode) {
      vscode.setState({ patchText: '' });
    }
  }
  
  // Return focus to the textarea or preview button based on results
  if (failCount === 0) {
    patchInput.focus();
  } else {
    previewBtn.focus();
  }
}

/**
 * Handles patch errors
 */
function handlePatchError(
  error: string,
  previewBtn: HTMLButtonElement,
  statusMessage: HTMLDivElement
): void {
  setStatus(statusMessage, `Error: ${error}`, 'error');
  previewBtn.disabled = false;
  previewBtn.setAttribute('aria-disabled', 'false');
  previewBtn.focus(); // Return focus to the preview button
}

/**
 * Sets the status message
 */
function setStatus(
  statusElement: HTMLDivElement,
  message: string,
  type: 'normal' | 'success' | 'warning' | 'error' = 'normal'
): void {
  statusElement.textContent = message;
  
  // Reset classes
  statusElement.className = '';
  
  // Add class based on type
  if (type === 'success') {
    statusElement.classList.add('success-icon');
  } else if (type === 'warning') {
    statusElement.classList.add('warning-icon');
  } else if (type === 'error') {
    statusElement.classList.add('error-icon');
  }
}

/**
 * Resets the UI to the initial state
 */
function resetUI(
  previewArea: HTMLDivElement,
  previewBtn: HTMLButtonElement,
  applyBtn: HTMLButtonElement,
  cancelBtn: HTMLButtonElement,
  statusMessage: HTMLDivElement
): void {
  previewArea.classList.add('hidden');
  previewArea.classList.remove('visible');
  
  previewBtn.disabled = false;
  previewBtn.setAttribute('aria-disabled', 'false');
  applyBtn.disabled = true;
  applyBtn.setAttribute('aria-disabled', 'true');
  cancelBtn.disabled = true;
  cancelBtn.setAttribute('aria-disabled', 'true');
  setStatus(statusMessage, 'Ready to parse your unified diff.', 'normal');
}

// Handle message events from the extension
window.addEventListener('message', (event) => {
  const message = event.data as ExtensionMessage;
  
  // Get DOM elements
  const patchInput = document.getElementById('patch-input') as HTMLTextAreaElement;
  const previewArea = document.getElementById('preview-area') as HTMLDivElement;
  const fileList = document.getElementById('file-list') as HTMLDivElement;
  const previewBtn = document.getElementById('preview-btn') as HTMLButtonElement;
  const applyBtn = document.getElementById('apply-btn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
  const statusMessage = document.getElementById('status-message') as HTMLDivElement;
  
  switch (message.command) {
    case 'patchPreview':
      if (message.fileInfo && previewArea && fileList && previewBtn && applyBtn && cancelBtn && statusMessage) {
        handlePatchPreview(message.fileInfo, previewArea, fileList, previewBtn, applyBtn, cancelBtn, statusMessage);
      }
      break;
    case 'patchResults':
      if (message.results && previewArea && patchInput && applyBtn && cancelBtn && previewBtn && statusMessage) {
        handlePatchResults(message.results, previewArea, patchInput, applyBtn, cancelBtn, previewBtn, statusMessage);
      }
      break;
    case 'patchError':
      if (message.error && previewBtn && statusMessage) {
        handlePatchError(message.error, previewBtn, statusMessage);
      }
      break;
    case 'updateSettings':
      if (message.config) {
        _currentSettings = message.config;
      }
      break;
    case 'clipboardContent':
      if (patchInput && message.patchText && patchInput.value === '') {
        patchInput.value = message.patchText;
        currentPatchText = message.patchText;
        if (vscode) {
          vscode.setState({ patchText: currentPatchText });
        }
        setStatus(statusMessage, 'Patch detected in clipboard and pasted. Click "Preview" to continue.', 'normal');
      }
      break;
  }
});

// Run initialization when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initialize();
});