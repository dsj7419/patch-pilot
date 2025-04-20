# Change Log

All notable changes to the "PatchPilot" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added Unreleased

- Support for detecting clipboard content containing patches
- Keyboard shortcut (`Ctrl+Alt+P`) for quicker access
- Enhanced error reporting with more specific error messages
- Strategy information in the results panel

### Changed

- Improved UI with better responsive design
- Enhanced status reporting for each patch strategy

## [0.1.0] - 2025-04-18

### Added 0.1.0

- Initial release
- Paste diff interface with preview panel
- Three-tier unified diff parsing and application:
  - Strict matching
  - Shifted line headers with configurable fuzz factor
  - Greedy context line matching
- Context fixing for common AI output issues:
  - Missing leading spaces on context lines
  - Mixed CRLF/LF line endings
  - Missing diff headers
- Multi-file support
- Preview diff before applying
- Git integration for auto-staging files
- Configurable fuzz factor for context matching
- Optional telemetry
- Programmatic API for use by other extensions or AI assistants
- Command for applying selected diff text
- Context menu integration
