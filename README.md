# PatchPilot

## **Paste Fuzzy Unified Diffs & Apply with AI-Grade Smarts**

[![Version](https://img.shields.io/visual-studio-marketplace/v/patchpilot.patch-pilot)](https://marketplace.visualstudio.com/items?itemName=patchpilot.patch-pilot)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/patchpilot.patch-pilot)](https://marketplace.visualstudio.com/items?itemName=patchpilot.patch-pilot)
[![Ratings](https://img.shields.io/visual-studio-marketplace/r/patchpilot.patch-pilot)](https://marketplace.visualstudio.com/items?itemName=patchpilot.patch-pilot)
[![License](https://img.shields.io/github/license/dsj7419/patch-pilot)](LICENSE)
</div>

## Overview

PatchPilot is a VS Code extension that lets AI assistants (or humans) paste imperfect unified diffs and have them applied safely to your code, with intelligent fuzzy matching to handle common formatting issues.

![PatchPilot Demo](media/demo.gif)

## Features

- **AI-Friendly Patch Application**: Intelligently handles diffs from AI systems like Claude and ChatGPT, which often have minor formatting issues
- **Multi-File Support**: Apply changes across multiple files in a single operation
- **Interactive Preview**: See what will change before committing
- **Three-Tier Fuzzy Matching**: Smart algorithm adapts to slight context differences:
  1. **Strict Mode**: First tries exact matching
  2. **Shifted Mode**: Then tries to find the patch with shifted line numbers
  3. **Greedy Mode**: Finally tries matching by ignoring problematic context lines
- **Git Integration**: Auto-stage changes to Git after applying a patch
- **Completely Offline**: No network calls, works anywhere

## Common AI Assistant Diff Issues PatchPilot Fixes

- Missing leading spaces on context lines
- Mixed CRLF/LF line endings
- Missing diff headers
- Slight context drift when files have been edited

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "PatchPilot"
4. Click Install

## Usage

### Basic Usage

1. Copy a unified diff from your AI assistant or other source
2. Run the command "PatchPilot: Paste Diff" from the Command Palette (Ctrl+Shift+P) or use the keyboard shortcut `Ctrl+Alt+P` (`Cmd+Alt+P` on macOS)
3. Paste the diff into the input panel
4. Click "Preview" to see what will change
5. Click "Apply Patch" to apply the changes

### Keyboard Shortcuts

- Launch PatchPilot: `Ctrl+Alt+P` (`Cmd+Alt+P` on macOS)
- In the diff input panel, press `Ctrl+Enter` (or `Cmd+Enter` on macOS) to preview the patch

### Applying Selected Diff

You can also select a diff in any editor and apply it directly:

1. Select the diff text in your editor
2. Right-click and choose "PatchPilot: Apply Selected Diff" from the context menu
3. Preview and apply the patch

### Git Integration

Enable automatic staging of patched files by setting `patchPilot.autoStage` to `true` in your VS Code settings.

You can also create a temporary branch for your patch using the command "PatchPilot: Create Branch for Patch".

## Extension Settings

PatchPilot contributes the following settings:

- `patchPilot.autoStage`: Enable/disable automatic staging of changed files to Git (default: `false`)
- `patchPilot.fuzzFactor`: Set the fuzz factor for context matching (0-3, higher values allow more flexible matching, default: `2`)
- `patchPilot.enableTelemetry`: Enable/disable anonymous telemetry to help improve PatchPilot (default: `false`)

## For AI Assistants: Programmatic API

PatchPilot provides a command API that can be used programmatically by AI assistants or other extensions:

```javascript
// Apply a patch
const results = await vscode.commands.executeCommand('patchPilot.applyPatch', patchText, {
  preview: true,     // Show preview before applying (default: true)
  autoStage: false,  // Auto-stage changes to Git (default: from settings)
  fuzz: 2            // Fuzz factor for context matching (default: from settings)
});

// Parse a patch without applying
const fileInfo = await vscode.commands.executeCommand('patchPilot.parsePatch', patchText);

// Create a branch for the patch
const branchName = await vscode.commands.executeCommand('patchPilot.createBranch', 'custom-branch-name');
```

## Example: Patch Application Strategy

PatchPilot uses a sophisticated three-tier strategy for applying patches:

1. **First attempt**: Direct application with `diff.applyPatch()` for exact matches
2. **Second attempt**: If that fails, try to shift the hunk headers to match surrounding context
3. **Final attempt**: If shifting fails, try dropping problematic context lines using "greedy mode"

This approach ensures maximum compatibility with AI-generated patches while maintaining safety.

## Example: Fixing Common AI Patch Issues

Here's a real-world example of how PatchPilot fixes common issues in AI-generated patches:

**Original (broken) patch from AI:**

```diff
@@ -10,7 +10,7 @@
import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
-import App from './App';
+import { App } from './App';
import reportWebVitals from './reportWebVitals';
```

**Issues:**

- Missing diff headers
- Missing leading spaces on some context lines (the `import React` line)

PatchPilot automatically:

1. Adds the missing headers
2. Adds leading spaces to context lines
3. Finds the right location in your file even if line numbers have shifted

## Troubleshooting

### Patch Doesn't Apply

If a patch fails to apply, try:

1. Increasing the fuzz factor in settings (up to 3)
2. Ensuring the target files exist in your workspace
3. Checking if the patch is valid unified diff format

### Debugging

For more detailed error information, check the PatchPilot output channel in VS Code's Output panel.

## FAQ

**Q: Can PatchPilot handle patches for files that don't exist yet?**

A: No, PatchPilot requires the target files to exist in your workspace.

**Q: Does it work with binary files?**

A: No, PatchPilot only works with text files.

**Q: Can I use it with non-Git projects?**

A: Yes! The Git integration is optional. The core patch functionality works with any files.

**Q: How does the fuzzy matching work?**

A: PatchPilot uses a three-tier strategy:

1. First tries exact matching
2. Then tries to locate the right position by matching context lines within a window
3. Finally tries a "greedy" approach by ignoring problematic context lines

**Q: Is PatchPilot secure?**

A: Yes, PatchPilot operates completely offline without any network calls. It only modifies files after explicit user confirmation.

## Performance Considerations

- The extension is optimized for typical patch sizes (up to thousands of lines).
- For very large patches (10,000+ lines), the preview might take a moment to generate.
- Using a lower fuzz factor (0 or 1) can improve performance if you're dealing with exact matches.

## Privacy and Telemetry

PatchPilot collects anonymous usage data by default to help improve the extension. This can be disabled by setting `patchPilot.enableTelemetry` to `false`.

The data collected includes:

- Extension activation and basic VS Code info
- Patch statistics (number of files, success/failure rates)
- Which strategies were successful for applying patches

No file content, diff content, or personal information is ever collected.

## License

This extension is licensed under the [MIT License](LICENSE).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
# Clone the repository
git clone https://github.com/dsj7419/patch-pilot.git
cd patch-pilot

# Install dependencies
yarn install

# Compile
yarn compile

# Watch for changes during development
yarn watch

# Run tests
yarn test
```

## Acknowledgements

- This extension uses the excellent [diff](https://github.com/kpdecker/jsdiff) package for patch parsing and application
- Icon and design elements created with assistance from AI tools
