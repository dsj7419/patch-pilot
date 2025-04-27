# Contributing to PatchPilot

Thank you for considering contributing to PatchPilot! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

- Check if the bug has already been reported in the [Issues](https://github.com/dsj7419/patch-pilot/issues)
- If not, create a new issue using the bug report template
- Include as many details as possible: steps to reproduce, expected behavior, actual behavior, and screenshots if applicable

### Suggesting Features

- Check if the feature has already been suggested in the [Issues](https://github.com/dsj7419/patch-pilot/issues)
- If not, create a new issue using the feature request template
- Describe the feature in detail and explain why it would be valuable

### Pull Requests

1. Fork the repository
2. Create a new branch: `git checkout -b my-feature-branch`
3. Make your changes
4. Run tests: `yarn test`
5. Commit your changes: `git commit -m "Add new feature"`
6. Push to the branch: `git push origin my-feature-branch`
7. Open a Pull Request

## Development Setup

### Prerequisites

- Node.js (version 16 or later)
- Yarn

### Installation

1. Clone the repository: `git clone https://github.com/dsj7419/patch-pilot.git`
2. Navigate to the directory: `cd patch-pilot`
3. Install dependencies: `yarn install`
4. Start the development mode: `yarn watch:dev`

## Testing

- Run all tests: `yarn test`
- Run unit tests: `yarn test:unit`
- Run integration tests: `yarn test:integration`

## Style Guide

- Follow the existing code style
- Use meaningful variable names
- Comment your code when necessary, especially for complex logic
- Write clear commit messages

## License

By contributing to PatchPilot, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
