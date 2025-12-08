const { exec } = require('child_process');

// Get full path to the current folder
const cwd = process.cwd();

// Formcommand with full paths
// Disable all extensions except this the develping one
const command = `code --disable-extensions --extensionDevelopmentPath="${cwd}"`;

// Run VS Code 
exec(command);
