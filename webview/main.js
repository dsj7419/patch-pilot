"use strict";
/* --------------------------------------------------------------------------
 *  PatchPilot — Webview Client Script
 * ----------------------------------------------------------------------- */
// Get the VS Code API
const vscode = acquireVsCodeApi();
// Global state
let currentPatchText = '';
// Using underscore prefix to indicate this variable is initialized but only used by event handlers
let _currentSettings = {
    autoStage: false,
    fuzzFactor: 2
};
// Main initialization function
function initialize() {
    // Get DOM elements with proper type casting
    const patchInput = document.getElementById('patch-input');
    const previewArea = document.getElementById('preview-area');
    const fileList = document.getElementById('file-list');
    const previewBtn = document.getElementById('preview-btn');
    const applyBtn = document.getElementById('apply-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const statusMessage = document.getElementById('status-message');
    // Restore any cached state from VS Code API
    const state = vscode.getState();
    if (state && state.patchText) {
        patchInput.value = state.patchText;
        currentPatchText = state.patchText;
    }
    // Focus the input
    patchInput.focus();
    // Request current settings from extension
    vscode.postMessage({ command: 'requestSettings' });
    // Check clipboard for diff content
    vscode.postMessage({ command: 'checkClipboard' });
    // Setup event listeners
    previewBtn.addEventListener('click', () => handlePreviewClick(patchInput, previewBtn, statusMessage));
    applyBtn.addEventListener('click', () => handleApplyClick(applyBtn, cancelBtn, statusMessage));
    cancelBtn.addEventListener('click', () => handleCancelClick(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage));
    // Listen for changes to save state
    patchInput.addEventListener('input', () => {
        const text = patchInput.value;
        if (text !== currentPatchText) {
            currentPatchText = text;
            vscode.setState({ patchText: text });
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
            vscode.setState({ patchText: currentPatchText });
        }
    });
    // Handle message events from the extension
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.command) {
            case 'patchPreview':
                if (message.fileInfo) {
                    handlePatchPreview(message.fileInfo, previewArea, fileList, previewBtn, applyBtn, cancelBtn, statusMessage);
                }
                break;
            case 'patchResults':
                if (message.results) {
                    handlePatchResults(message.results, previewArea, patchInput, applyBtn, cancelBtn, previewBtn, statusMessage);
                }
                break;
            case 'patchError':
                if (message.error) {
                    handlePatchError(message.error, previewBtn, statusMessage);
                }
                break;
            case 'updateSettings':
                if (message.config) {
                    _currentSettings = message.config;
                }
                break;
            case 'clipboardContent':
                if (patchInput.value === '' && message.patchText) {
                    patchInput.value = message.patchText;
                    currentPatchText = message.patchText;
                    vscode.setState({ patchText: currentPatchText });
                    setStatus(statusMessage, 'Patch detected in clipboard and pasted. Click "Preview" to continue.', 'normal');
                }
                break;
        }
    });
}
/**
 * Handles preview button click
 */
function handlePreviewClick(patchInput, previewBtn, statusMessage) {
    const patchText = patchInput.value.trim();
    if (!patchText) {
        setStatus(statusMessage, 'Please paste a unified diff to preview.', 'error');
        return;
    }
    // Save current patch text
    currentPatchText = patchText;
    vscode.setState({ patchText: patchText });
    // Show loading state
    setStatus(statusMessage, 'Parsing patch...', 'normal');
    previewBtn.disabled = true;
    // Request preview from extension
    vscode.postMessage({
        command: 'previewPatch',
        patchText
    });
}
/**
 * Handles apply button click
 */
function handleApplyClick(applyBtn, cancelBtn, statusMessage) {
    // Show loading state
    setStatus(statusMessage, 'Applying patch...', 'normal');
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    // Send patch to extension
    vscode.postMessage({
        command: 'applyPatch',
        patchText: currentPatchText
    });
}
/**
 * Handles cancel button click
 */
function handleCancelClick(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage) {
    // Reset UI
    resetUI(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage);
    // Send cancel to extension
    vscode.postMessage({
        command: 'cancelPatch'
    });
}
/**
 * Handles patch preview response
 * @param fileInfo Information about files in the patch
 */
function handlePatchPreview(fileInfo, previewArea, fileList, previewBtn, applyBtn, cancelBtn, statusMessage) {
    if (!fileInfo || fileInfo.length === 0) {
        setStatus(statusMessage, 'No valid patches found in the provided text.', 'error');
        previewBtn.disabled = false;
        return;
    }
    // Clear file list
    fileList.innerHTML = '';
    // Count totals
    let totalAdditions = 0;
    let totalDeletions = 0;
    let missingFiles = 0;
    // Add file entries
    fileInfo.forEach(file => {
        const fileEntry = document.createElement('div');
        fileEntry.className = 'file-entry';
        // Track missing files
        if (!file.exists) {
            missingFiles++;
        }
        // Track totals
        totalAdditions += file.changes.additions;
        totalDeletions += file.changes.deletions;
        // Create file icon (checkmark or warning)
        const fileIcon = document.createElement('span');
        fileIcon.className = `file-icon ${file.exists ? 'success-icon' : 'warning-icon'}`;
        fileIcon.textContent = file.exists ? '✓' : '⚠️';
        // Create file path
        const filePath = document.createElement('span');
        filePath.className = 'file-path';
        filePath.textContent = file.filePath;
        // Create file stats
        const fileStats = document.createElement('span');
        fileStats.className = 'file-stats';
        // Add the changes info
        const additionSpan = document.createElement('span');
        additionSpan.className = 'addition';
        additionSpan.textContent = `+${file.changes.additions}`;
        const deletionSpan = document.createElement('span');
        deletionSpan.className = 'deletion';
        deletionSpan.textContent = ` -${file.changes.deletions}`;
        fileStats.appendChild(document.createTextNode(`(${file.hunks} hunks, `));
        fileStats.appendChild(additionSpan);
        fileStats.appendChild(deletionSpan);
        fileStats.appendChild(document.createTextNode(')'));
        // Add tooltip
        if (!file.exists) {
            fileEntry.title = 'File not found in workspace';
        }
        // Append elements
        fileEntry.appendChild(fileIcon);
        fileEntry.appendChild(filePath);
        fileEntry.appendChild(fileStats);
        fileList.appendChild(fileEntry);
    });
    // Add summary row
    const summaryEntry = document.createElement('div');
    summaryEntry.className = 'file-entry summary-entry';
    const summaryIcon = document.createElement('span');
    summaryIcon.className = 'file-icon';
    summaryIcon.textContent = '📊';
    const summaryText = document.createElement('span');
    summaryText.className = 'file-path';
    summaryText.textContent = `Total: ${fileInfo.length} files${missingFiles > 0 ? ` (${missingFiles} missing)` : ''}`;
    const summaryStats = document.createElement('span');
    summaryStats.className = 'file-stats';
    const totalAddSpan = document.createElement('span');
    totalAddSpan.className = 'addition';
    totalAddSpan.textContent = `+${totalAdditions}`;
    const totalDelSpan = document.createElement('span');
    totalDelSpan.className = 'deletion';
    totalDelSpan.textContent = ` -${totalDeletions}`;
    summaryStats.appendChild(document.createTextNode('('));
    summaryStats.appendChild(totalAddSpan);
    summaryStats.appendChild(totalDelSpan);
    summaryStats.appendChild(document.createTextNode(')'));
    summaryEntry.appendChild(summaryIcon);
    summaryEntry.appendChild(summaryText);
    summaryEntry.appendChild(summaryStats);
    fileList.appendChild(summaryEntry);
    // Update UI
    previewArea.style.display = 'block';
    previewBtn.disabled = false;
    applyBtn.disabled = false;
    cancelBtn.disabled = false;
    // Set status
    if (missingFiles > 0) {
        setStatus(statusMessage, `Ready to apply patch to ${fileInfo.length - missingFiles} files. ${missingFiles} files not found.`, 'warning');
    }
    else {
        setStatus(statusMessage, `Ready to apply patch to ${fileInfo.length} files.`, 'success');
    }
}
/**
 * Handles patch results
 * @param results Results of applying the patch
 */
function handlePatchResults(results, previewArea, patchInput, applyBtn, cancelBtn, previewBtn, statusMessage) {
    if (!results || results.length === 0) {
        setStatus(statusMessage, 'No results returned from patch operation.', 'error');
        resetUI(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage);
        return;
    }
    // Count success and failures
    const successCount = results.filter(r => r.status === 'applied').length;
    const failCount = results.length - successCount;
    // Group results by strategy
    const strategyCount = {};
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
    }
    else {
        setStatus(statusMessage, `Applied ${successCount} patch(es), ${failCount} failed. Check output for details.`, 'warning');
    }
    // Reset UI
    previewArea.style.display = 'none';
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    previewBtn.disabled = false;
    // Clear input if successful
    if (failCount === 0) {
        patchInput.value = '';
        currentPatchText = '';
        vscode.setState({ patchText: '' });
    }
}
/**
 * Handles patch errors
 * @param error Error message
 */
function handlePatchError(error, previewBtn, statusMessage) {
    setStatus(statusMessage, `Error: ${error}`, 'error');
    previewBtn.disabled = false;
}
/**
 * Sets the status message
 * @param message The message to display
 * @param type The type of message
 */
function setStatus(statusElement, message, type = 'normal') {
    statusElement.textContent = message;
    // Reset classes
    statusElement.className = '';
    // Add class based on type
    if (type === 'success') {
        statusElement.classList.add('success-icon');
    }
    else if (type === 'warning') {
        statusElement.classList.add('warning-icon');
    }
    else if (type === 'error') {
        statusElement.classList.add('error-icon');
    }
}
/**
 * Resets the UI to the initial state
 */
function resetUI(previewArea, previewBtn, applyBtn, cancelBtn, statusMessage) {
    previewArea.style.display = 'none';
    previewBtn.disabled = false;
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    setStatus(statusMessage, 'Ready to parse your unified diff.', 'normal');
}
// Run initialization when DOM is loaded
document.addEventListener('DOMContentLoaded', initialize);
//# sourceMappingURL=main.js.map