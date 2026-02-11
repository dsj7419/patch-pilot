# Changelog

All notable changes to the PatchPilot extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.6] - 2026-02-11

### Fixed
- "Apply Selected Diff" now recovers missing diff headers from document context when only hunks are selected (#17)
- Informative message when running "Apply Selected Diff" from a diff preview view instead of a regular editor (#17)

## [1.2.5] - 2026-02-11

### Fixed
- Patches with trailing whitespace now apply correctly (#19)

### Improved
- Better error diagnostics when patch application fails — shows strategies attempted, file path, hunk count, and whitespace-only change detection

## [1.2.2] - 2025-05-4

### Infrastructure 1.2.4

- **CI/CD**  
  - Revert of major patch that was causing issues

## [1.0.14] - 2025-04-28

### Infrastructure 1.0.14

- **Docs**  
  - Removal of preview tag in marketplace.

## [1.0.13] - 2025-04-29

### Infrastructure 1.0.13

- **CI/CD**
  - Live diff highlighting & context-menu action

## [1.0.12] - 2025-04-28

### Infrastructure 1.0.12

- **Docs**  
  - README gains *Installation*, *Commands & Keybindings*, *Changelog* and *Contributing* sections.  
  - Shields badges use `cacheSeconds=7200` to avoid Marketplace rate-limits.  
  - Demo image switched to a resizable `<img width="600">` tag.
- **Release type:** *infrastructure only* – **not** published to the Marketplace.

## [1.0.11] - 2025-04-28

### Infrastructure 1.0.11

- **CI/CD**  
  - Publish job now verifies Marketplace/Open VSX PAT secrets before running.  
  - Single `git push --follow-tags` ensures branch *and* tag are uploaded atomically.
- **Release script** (`scripts/release.js`)  
  - Fast-forward guard: aborts if `main` is behind `origin/main`.  
  - Early exit when PATs are missing while `--skip-marketplace` is *not* set.  
  - Pushes release branch with `--set-upstream --follow-tags` in one step.
- **Release type:** *infrastructure only* – **not** published to the Marketplace.

---

## [1.0.10] - 2025-04-27

### Infrastructure 1.0.10

- Split CI into **build** and **publish** jobs; publish runs only on `v*` tags.  
- Added secret-presence check step before publishing.  
- Release script now annotates tags with JSON (`PUBLISH_MARKETPLACE`, `RELEASE_TYPE`).  
- *No functional changes – Marketplace not updated.*

---

## [1.0.9] - 2025-04-27

### Fixed 1.0.9

- Webview Content-Security-Policy warnings during packaging.  
- CommonJS/ESM export warning in `applyPatch.ts`.

### Added

- Rate-limit-friendly shields.io badges (`cacheSeconds=7200`).

---

## [1.0.7] - 2025-04-26

### Added 1.0.7

- Modified commit script to be more robust; integrated **semver**.

## [1.0.6] - 2025-04-26

### Added 1.0.6

- GitHub issue templates.

## [1.0.5] - 2025-04-26

### Added / Fixed 1.0.5

- Fixed linting error with empty `try … catch`.
- Improved CI/CD pipeline for GitHub Releases.

## [1.0.4] - 2025-04-26

### Fixed 1.0.4

- Fixed linting error with empty try catch
- Improved CI/CD pipeline for GitHub releases

## [1.0.3] - 2025-04-26

### Added 1.0.3

- Initial public release
- Support for fuzzy matching of patches
- Multi-file diff handling
- Git integration

## [0.3.0] - 2025-04-26

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
