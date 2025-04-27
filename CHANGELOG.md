# Changelog

All notable changes to the PatchPilot extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2025-04-26

### Fixed

- Fixed linting error with empty try catch
- Improved CI/CD pipeline for GitHub releases

## [1.0.3] - 2025-04-26

### Added

- Initial public release
- Support for fuzzy matching of patches
- Multi-file diff handling
- Git integration

[0.3.0] - 2025-04-26
Added

    Enhanced documentation with better in-code comments

Changed

    Improved code organization and readability across multiple modules
    Replaced console.log statements with proper VS Code output channel logging
    Optimized webview client script for better performance

Fixed

    Resolved potential memory leaks from debug panels
    Addressed edge cases in telemetry initialization
    Improved webview focus management and accessibility

Removed

    Eliminated debugging infrastructure from webview client script
    Removed development-only diagnostic panels and CSS styles
    Cleaned up obsolete test-related comments in telemetry module

Security

    Enhanced security by removing debug panels that could potentially expose sensitive information
    Improved error handling to prevent information leakage

## [0.2.0] - 2025-04-26

### Added 0.2

- **Custom Branch Names:** Added ability to provide an optional custom name when using the `PatchPilot: Create Branch for Patch` command via the Command Palette. A prompt now appears allowing users to input a name or accept the default timestamped name. (Addresses Issue/Feature Request from Test 10 feedback).
- **Improved Git Error Handling:** Specific detection and user-friendly error message for Git's "dubious ownership" error, guiding the user on how to resolve it using `git config --global --add safe.directory`. (Addresses Issue/Feature Request from Test 9 feedback).
- Telemetry tracking for custom branch name usage and Git errors.

### Fixed 0.2

- **Apply Button State:** Fixed issue where the "Apply Patch" button in the webview remained enabled even when the preview showed all target files were missing. The button is now correctly disabled in this scenario. (Fixes Test 12 bug).
- *(Partial)* Improved filename handling for diffs with unusual characters or line endings in headers, resolving most Test 4 scenarios. *(Note: A known issue might persist specifically with CRLF on headers).*

### Removed 0.2

- Removed the "Create Branch" button and input field from the webview UI. Branch creation is now handled exclusively via the Command Palette (`PatchPilot: Create Branch for Patch`) for a cleaner UI and more consistent workflow.

## [0.1.0] - 2025-04-18 *(Assumed Initial Release Date)*

### Added 0.1

- Initial release of PatchPilot.
- Webview panel for pasting unified diffs (`PatchPilot: Paste Diff` command & `Ctrl+Alt+P` shortcut).
- Core multi-file patch parsing and application logic.
- Three-tier fuzzy matching system (Strict, Shifted Header, Greedy strategies).
- Configurable `patchPilot.fuzzFactor` setting.
- Automatic normalization for common AI diff issues (missing leading spaces on context lines, mixed line endings, missing `diff --git` headers).
- Interactive diff preview before applying patches.
- Basic Git integration: `patchPilot.autoStage` setting for automatic staging.
- Programmatic API commands: `patchPilot.applyPatch`, `patchPilot.parsePatch`.
- Context menu command `PatchPilot: Apply Selected Diff` for applying diff text selected in an editor.
- Basic anonymous telemetry (opt-out via `patchPilot.enableTelemetry`).
