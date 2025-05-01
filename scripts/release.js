#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { simpleGit } = require('simple-git');
const semver = require('semver');

// Configuration - can be overridden with command line args or config file
const defaultConfig = {
  mainBranch: 'main',
  versionFiles: ['package.json'],
  changelogPath: 'CHANGELOG.md',
  releasePrefix: 'v',
  dryRun: false,
  commitMessageTemplate: 'release: {tag} - {summary}',
  requireCleanWorkingDir: false,
  publishToMarketplace: true,
  releaseType: 'feature', // 'feature', 'infrastructure', 'developer'
  hooks: {
    beforeRelease: null,
    afterRelease: null
  }
};

// Load config from .releaserc.json if it exists
let config = { ...defaultConfig };
const configPath = path.resolve(process.cwd(), '.releaserc.json');
if (fs.existsSync(configPath)) {
  try {
    const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...userConfig };
    console.log('📄 Loaded configuration from .releaserc.json');
  } catch (error) {
    console.warn(`⚠️ Warning: Failed to parse .releaserc.json: ${error.message}`);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let releaseType = null;
let customVersion = null;
let customMessage = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--major' || arg === '-M') {
    releaseType = 'major';
  } else if (arg === '--minor' || arg === '-m') {
    releaseType = 'minor';
  } else if (arg === '--patch' || arg === '-p') {
    releaseType = 'patch';
  } else if (arg === '--prerelease' || arg === '-pre') {
    releaseType = 'prerelease';
    if (args[i + 1] && !args[i + 1].startsWith('-')) {
      config.prereleaseId = args[++i];
    }
  } else if (arg === '--version' || arg === '-v') {
    if (args[i + 1] && !args[i + 1].startsWith('-')) {
      customVersion = args[++i];
    } else {
      console.error('❌ Error: --version requires a version argument');
      process.exit(1);
    }
  } else if (arg === '--message' || arg === '-msg') {
    if (args[i + 1]) {
      customMessage = args[++i];
    } else {
      console.error('❌ Error: --message requires a message argument');
      process.exit(1);
    }
  } else if (arg === '--category' || arg === '-c') {
    if (args[i + 1] && ['feature', 'infrastructure', 'developer'].includes(args[i + 1])) {
      config.releaseType = args[++i];
    } else {
      console.error('❌ Error: --category requires one of: feature, infrastructure, developer');
      process.exit(1);
    }
  } else if (arg === '--skip-marketplace' || arg === '-s') {
    config.publishToMarketplace = false;
  } else if (arg === '--dry-run' || arg === '-d') {
    config.dryRun = true;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

function printHelp() {
  console.log(`
🚀 PatchPilot Release Script

Usage:
  yarn release [options]

Options:
  --major, -M                Bump major version (1.0.0 -> 2.0.0)
  --minor, -m                Bump minor version (1.0.0 -> 1.1.0)
  --patch, -p                Bump patch version (1.0.0 -> 1.0.1)
  --prerelease, -pre [id]    Create prerelease version (1.0.0 -> 1.0.0-beta.0)
  --version, -v <version>    Use specific version number
  --message, -msg <msg>      Custom release message
  --category, -c <type>      Release category: feature, infrastructure, developer
  --skip-marketplace, -s     Skip publishing to VS Code Marketplace
  --dry-run, -d              Show what would happen without making changes
  --help, -h                 Show this help message

Examples:
  yarn release                           # Interactive mode
  yarn release --patch                   # Automatic patch release
  yarn release -m --msg "New UI"         # Minor release with custom message
  yarn release -v 2.0.0                  # Release specific version
  yarn release -c developer              # Mark as developer-focused release
  yarn release -p -c infrastructure -s   # Infrastructure patch without marketplace publish
  `);
}

// Helper function to create readline interface
function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

// Helper function to ask yes/no questions
async function askYesNo(query) {
  const rl = createInterface();
  return new Promise(resolve => rl.question(`${query} (y/N): `, ans => {
    rl.close();
    resolve(ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes');
  }));
}

// Helper function for text questions
async function askQuestion(query) {
  const rl = createInterface();
  return new Promise(resolve => rl.question(`${query}: `, ans => {
    rl.close();
    resolve(ans);
  }));
}

// Helper function for multiple choice questions
async function askChoice(query, choices) {
  console.log(`\n${query}`);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice}`);
  });
  
  const rl = createInterface();
  const result = await new Promise(resolve => rl.question('\nEnter choice number: ', ans => {
    rl.close();
    const choice = parseInt(ans.trim());
    if (isNaN(choice) || choice < 1 || choice > choices.length) {
      resolve(null);
    } else {
      resolve(choice - 1);
    }
  }));
  
  if (result === null) {
    console.log('❌ Invalid choice. Please try again.');
    return askChoice(query, choices);
  }
  
  return result;
}

// Helper function to update version in a file
function updateVersionInFile(filePath, newVersion) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  
  // For package.json or similar JSON files
  if (filePath.endsWith('.json')) {
    try {
      const json = JSON.parse(content);
      if (!json.version) {
        throw new Error(`No version field found in ${filePath}`);
      }
      json.version = newVersion;
      if (!config.dryRun) {
        fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
      }
      return true;
    } catch (error) {
      throw new Error(`Failed to update version in ${filePath}: ${error.message}`);
    }
  }
  
  // For other file types, you could add specific parsers here
  throw new Error(`Unsupported file type: ${filePath}`);
}

// Helper function to extract recent changes from CHANGELOG.md
function getChangelogEntry(version) {
  if (!fs.existsSync(config.changelogPath)) {
    return null;
  }
  
  try {
    const changelog = fs.readFileSync(config.changelogPath, 'utf8');
    
    // Look for the section matching this version
    const versionHeader = `## [${version}]`;
    const versionRegex = new RegExp(`${versionHeader}[^#]*`, 'g');
    const match = changelog.match(versionRegex);
    
    if (match && match[0]) {
      return match[0].trim();
    }
    
    // If not found, try to get the first section (unreleased)
    const firstSection = changelog.split(/## \[[^\]]+\]/)[1];
    if (firstSection) {
      return firstSection.trim();
    }
    
    return null;
  } catch (error) {
    console.warn(`⚠️ Warning: Failed to extract changelog entry: ${error.message}`);
    return null;
  }
}

// Update changelog with new version
async function updateChangelog(version, date = new Date()) {
  if (!fs.existsSync(config.changelogPath)) {
    console.log(`📝 Creating new CHANGELOG.md file`);
    if (!config.dryRun) {
      fs.writeFileSync(config.changelogPath, `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n`, 'utf8');
    }
  }
  
  const changelog = fs.existsSync(config.changelogPath) 
    ? fs.readFileSync(config.changelogPath, 'utf8')
    : '';
  
  // Check if there's an Unreleased section
  const unreleasedSection = changelog.match(/## \[Unreleased\][^#]*/);
  
  if (!unreleasedSection) {
    console.log('ℹ️ No unreleased section found in CHANGELOG.md');
    const createEntry = await askYesNo('Do you want to create a new changelog entry?');
    
    if (createEntry) {
      const releaseDate = date.toISOString().split('T')[0]; // YYYY-MM-DD
      let newEntry = '';
      
      if (customMessage) {
        newEntry = `## [${version}] - ${releaseDate}\n\n${customMessage}\n\n`;
      } else {
        console.log('\n📝 Enter changelog entries (leave empty line to finish):');
        const changes = [];
        const rl = createInterface();
        
        let line;
        do {
          line = await new Promise(resolve => rl.question('> ', resolve));
          if (line.trim()) {
            changes.push(line);
          }
        } while (line.trim());
        
        rl.close();
        
        if (changes.length > 0) {
          newEntry = `## [${version}] - ${releaseDate}\n\n${changes.map(c => `- ${c}`).join('\n')}\n\n`;
        } else {
          newEntry = `## [${version}] - ${releaseDate}\n\n- Release version ${version}\n\n`;
        }
      }
      
      if (!config.dryRun) {
        // Add the new entry after the header but before any existing versions
        const headerEnd = changelog.indexOf('\n\n') + 2;
        const newChangelog = changelog.substring(0, headerEnd) + newEntry + changelog.substring(headerEnd);
        fs.writeFileSync(config.changelogPath, newChangelog, 'utf8');
      }
      
      console.log(`✅ Added new changelog entry for version ${version}`);
      return newEntry.trim();
    }
    
    return null;
  } else {
    // Convert Unreleased section to this version
    const releaseDate = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const newHeading = `## [${version}] - ${releaseDate}`;
    
    if (!config.dryRun) {
      const newChangelog = changelog.replace('## [Unreleased]', newHeading);
      fs.writeFileSync(config.changelogPath, newChangelog, 'utf8');
    }
    
    console.log(`✅ Updated CHANGELOG.md: converted Unreleased to ${version}`);
    return unreleasedSection[0].replace('## [Unreleased]', newHeading).trim();
  }
}

// Get release category label
function getReleaseTypeLabel() {
  switch (config.releaseType) {
    case 'feature':
      return '';
    case 'infrastructure':
      return '[INFRA] ';
    case 'developer':
      return '[DEV] ';
    default:
      return '';
  }
}

// --- Main function ---
async function main() {
  try {
    if (config.dryRun) {
      console.log('🧪 Running in DRY RUN mode - no changes will be committed\n');
    }
    
    console.log('🚀 Starting PatchPilot Release Process...');
    const git = simpleGit();

    await git.fetch('origin', config.mainBranch);
    const status2 = await git.status();
    if (status2.behind > 0) {
      console.error(`❌ Your branch is ${status2.behind} commit(s) behind origin/${config.mainBranch}. git pull --ff-only first.`);
      process.exit(1);
    }
    
    // --- Checks ---
    console.log('\n🔍 Performing checks...');
    
    // Git checks
    console.log('  ⏳ Checking git status...');
    
    // Check if git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      console.error('❌ Error: Not a git repository');
      process.exit(1);
    }
    
    // Check current branch
    const status = await git.status();
    if (status.current !== config.mainBranch) {
      console.log(`⚠️ Warning: You are not on the '${config.mainBranch}' branch (current: ${status.current})`);
      const proceed = await askYesNo(`Continue with release on ${status.current} branch?`);
      if (!proceed) {
        console.log('🚫 Release cancelled.');
        process.exit(0);
      }
    } else {
      console.log(`✅ On ${config.mainBranch} branch.`);
    }
    
    // Check working directory
    if (config.requireCleanWorkingDir && !status.isClean()) {
      console.error('❌ Error: Working directory is not clean. Please commit or stash changes.');
      process.exit(1);
    }
    
    if (!status.isClean()) {
      console.log('📝 Uncommitted changes detected. These will be included in the release commit.');
    }
    
    // --- Read current version ---
    console.log('\n📦 Reading current version...');
    const mainVersionFile = config.versionFiles[0];
    if (!fs.existsSync(mainVersionFile)) {
      console.error(`❌ Error: Version file not found: ${mainVersionFile}`);
      process.exit(1);
    }
    
    // Read current version from package.json
    const packageJson = JSON.parse(fs.readFileSync(mainVersionFile, 'utf8'));
    const currentVersion = packageJson.version;
    if (!currentVersion) {
      console.error(`❌ Error: No version field in ${mainVersionFile}`);
      process.exit(1);
    }
    console.log(`  Current version: ${currentVersion}`);
    
    // --- Determine new version ---
    let newVersion;
    
    if (customVersion) {
      // Use specified version
      newVersion = customVersion;
      console.log(`  Using specified version: ${newVersion}`);
    } else if (releaseType) {
      // Bump version based on release type
      newVersion = semver.inc(currentVersion, releaseType, config.prereleaseId);
      console.log(`  Bumping ${releaseType} version: ${currentVersion} → ${newVersion}`);
    } else {
      // Interactive version selection
      console.log('  No version specified. Determining next version...');
      
      const suggestedPatch = semver.inc(currentVersion, 'patch');
      const suggestedMinor = semver.inc(currentVersion, 'minor');
      const suggestedMajor = semver.inc(currentVersion, 'major');
      const suggestedPrerelease = semver.inc(currentVersion, 'prerelease', 'beta');
      
      const choices = [
        `Patch (${suggestedPatch})`,
        `Minor (${suggestedMinor})`,
        `Major (${suggestedMajor})`,
        `Prerelease (${suggestedPrerelease})`,
        'Custom version'
      ];
      
      const choice = await askChoice('Select release type:', choices);
      
      switch (choice) {
        case 0:
          newVersion = suggestedPatch;
          break;
        case 1:
          newVersion = suggestedMinor;
          break;
        case 2:
          newVersion = suggestedMajor;
          break;
        case 3:
          newVersion = suggestedPrerelease;
          break;
        case 4:
          newVersion = await askQuestion('Enter custom version');
          if (!semver.valid(newVersion)) {
            console.error(`❌ Error: Invalid version format: ${newVersion}`);
            process.exit(1);
          }
          break;
      }
      
      console.log(`  Selected version: ${newVersion}`);
    }
    
    // Validate new version
    if (!semver.valid(newVersion)) {
      console.error(`❌ Error: Invalid version format: ${newVersion}`);
      process.exit(1);
    }
    
    if (!semver.gt(newVersion, currentVersion)) {
      console.warn(`⚠️ Warning: New version ${newVersion} is not greater than current version ${currentVersion}`);
      const proceed = await askYesNo('Do you still want to proceed?');
      if (!proceed) {
        console.log('🚫 Release cancelled.');
        process.exit(0);
      }
    }
    
    // --- Select release category if not already set ---
    if (!args.some(arg => arg === '--category' || arg === '-c')) {
      console.log('\n📋 Select release category:');
      const categoryChoices = [
        'Feature (user-facing changes)',
        'Infrastructure (CI/CD, build system, etc.)',
        'Developer (developer tools, docs, etc.)'
      ];
      
      const categoryChoice = await askChoice('What type of release is this?', categoryChoices);
      
      switch (categoryChoice) {
        case 0:
          config.releaseType = 'feature';
          break;
        case 1:
          config.releaseType = 'infrastructure';
          break;
        case 2:
          config.releaseType = 'developer';
          break;
      }
      
      // Only ask about marketplace publishing for non-feature releases
      if (config.releaseType !== 'feature' && config.publishToMarketplace) {
        const skipMarketplace = await askYesNo('Skip publishing to VS Code Marketplace?');
        if (skipMarketplace) {
          config.publishToMarketplace = false;
        }
      }
    }
    
    // Check if tag already exists
    const tagName = `${config.releasePrefix}${newVersion}`;
    const tags = await git.tags();
    if (tags.all.includes(tagName)) {
      console.error(`❌ Error: Tag '${tagName}' already exists`);
      process.exit(1);
    }

    const remoteTags = await git.listRemote(['--tags', 'origin']);
    if (remoteTags.includes(tagName)) {
      console.error(`❌ Remote already has tag ${tagName}. Bump version or delete it first.`);
      process.exit(1);
    }
    
    // --- Get release message ---
    console.log('\n✍️ Preparing release message...');
    let message = customMessage;
    let changelogEntry = null;

    if (!message) {
      // Always prompt for a message in interactive mode
      message = await askQuestion('Enter release message');
      if (!message) {
        message = `Release version ${newVersion}`;
      }
      
      // Now try to extract/update changelog
      changelogEntry = getChangelogEntry(newVersion);
      
      if (!changelogEntry) {
        console.log('ℹ️ No existing changelog entry found');
        const useMessage = await askYesNo('Use the release message for changelog entry?');
        
        if (useMessage) {
          // Create changelog entry using the provided message
          changelogEntry = await updateChangelog(newVersion, undefined, message);
        } else {
          // Create a custom changelog entry
          changelogEntry = await updateChangelog(newVersion);
        }
      }
    }
    
    // --- Update version in files ---
    console.log('\n📝 Updating version in files...');
    for (const file of config.versionFiles) {
      console.log(`  ⏳ Updating ${file}...`);
      if (!config.dryRun) {
        updateVersionInFile(file, newVersion);
      }
      console.log(`  ✅ Updated ${file} to version ${newVersion}`);
    }
    
    // --- Run hooks ---
    if (config.hooks.beforeRelease) {
      console.log('\n🔄 Running pre-release hook...');
      if (!config.dryRun) {
        try {
          const { execSync } = require('child_process');
          execSync(config.hooks.beforeRelease, { stdio: 'inherit' });
        } catch (error) {
          console.error(`❌ Pre-release hook failed: ${error.message}`);
          const proceed = await askYesNo('Continue anyway?');
          if (!proceed) {
            process.exit(1);
          }
        }
      }
    }
    
    // --- Prepare commit message with release type ---
    const typePrefix = getReleaseTypeLabel();
    const commitMessage = `${typePrefix}${config.commitMessageTemplate
      .replace('{tag}', tagName)
      .replace('{version}', newVersion)
      .replace('{summary}', message)}`;
    
    // Prepare environment variables for CI/CD
    const ciEnvVars = {
      RELEASE_VERSION: newVersion,
      RELEASE_TYPE: config.releaseType,
      PUBLISH_MARKETPLACE: config.publishToMarketplace ? 'true' : 'false',
      MISSING_PATS: config.publishToMarketplace && !process.env.VSCODE_MARKETPLACE_PAT ? 'true' : 'false'
    };
    
    // --- Confirmation ---
    console.log('\n📋 Release Summary:');
    console.log(`  - Current version: ${currentVersion}`);
    console.log(`  - New version: ${newVersion}`);
    console.log(`  - Tag: ${tagName}`);
    console.log(`  - Branch: ${status.current}`);
    console.log(`  - Release type: ${config.releaseType}`);
    console.log(`  - Publish to marketplace: ${config.publishToMarketplace ? 'Yes' : 'No'}`);
    console.log(`  - Commit message: "${commitMessage}"`);
    
    if (changelogEntry) {
      console.log('\n📒 Changelog Entry:');
      console.log('  ' + changelogEntry.split('\n').join('\n  '));
    }
    
    console.log('\n🔍 This will perform:');
    console.log('  1. Create a release branch');
    console.log('  2. git add .');
    console.log(`  3. git commit -m "${commitMessage}"`);
    console.log(`  4. git tag ${tagName}`);
    console.log(`  5. Push branch and tag to origin`);
    console.log(`  6. Set CI/CD variables for marketplace publishing: ${config.publishToMarketplace ? 'Yes' : 'No'}`);
    
    if (config.dryRun) {
      console.log('\n🧪 DRY RUN SUMMARY - no changes have been made');
      process.exit(0);
    }
    
    const confirm = await askYesNo('\n❓ Proceed with release?');
    if (!confirm) {
      console.log('🚫 Release cancelled by user.');
      process.exit(0);
    }
    
    // --- Execution ---
    console.log('\n🚀 Executing release commands...');
    
    // Save current branch to return to later
    const originalBranch = status.current;
    
    // 1. Create a release branch
    const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const releaseBranchName = `release-${newVersion.replace(/\./g, '-')}-${currentDate}`;
    console.log(`  ⏳ Creating release branch '${releaseBranchName}'...`);
    
    try {
      // Create and checkout release branch
      await git.checkoutBranch(releaseBranchName, originalBranch);
      console.log(`  ✅ Created and switched to new branch '${releaseBranchName}'.`);
      
      // 2. Stage changes
      console.log('  ⏳ Staging changes...');
      await git.add('.');
      console.log('  ✅ Changes staged.');
      
      // 3. Commit
      console.log(`  ⏳ Committing with message: "${commitMessage}"...`);
      await git.commit(commitMessage);
      console.log('  ✅ Commit created.');
      
      // 4. Tag
      console.log(`  ⏳ Creating tag '${tagName}'...`);
      
      // Include CI/CD variables in tag message
      const tagMessage = JSON.stringify(ciEnvVars);
      const tmp = path.join(require('os').tmpdir(), `${tagName}.json`);
      fs.writeFileSync(tmp, tagMessage, 'utf8');
      await git.tag(['-a', tagName, '-F', tmp]);
      fs.unlinkSync(tmp);
      console.log('  ✅ Tag created with CI/CD metadata.');

      const head = (await git.revparse(['HEAD'])).trim();
      const tip  = (await git.revparse([tagName])).trim();
      if (head !== tip) {
        throw new Error(`Tag ${tagName} is not on HEAD – did you commit the version bump?`);
      }

      console.log(`\n🔔 Tag ${tagName} pushed – the CI/CD pipeline will now run automatically on GitHub.`);
      
      // 5. Fetch latest changes
      console.log('  ⏳ Fetching latest changes from remote...');
      try {
        await git.fetch('origin');
        console.log('  ✅ Fetched latest changes.');
      } catch (fetchError) {
        console.warn(`  ⚠️ Warning: Could not fetch from remote: ${fetchError.message}`);
        const proceedAfterFetch = await askYesNo('Continue with push anyway?');
        if (!proceedAfterFetch) {
          console.log(`\n🔄 Returning to original branch '${originalBranch}'...`);
          await git.checkout(originalBranch);
          console.log('🚫 Release canceled. Your changes are on local branch.');
          process.exit(0);
        }
      }
      
      // 6. Push release branch **with tags**
      console.log(`  ⏳ Pushing '${releaseBranchName}' (and tags) to origin…`);
      try {
        await git.push('origin', releaseBranchName, {
          '--set-upstream': null,
          '--follow-tags': null        // ensures vX.Y.Z goes up with the branch
        });
        console.log(`  ✅ Branch '${releaseBranchName}' and all tags pushed.`);
      } catch (pushError) {
        console.error(`  ❌ Push failed: ${pushError.message}`);
        const proceed = await askYesNo('Try to continue anyway? You may need to push manually later.');
        if (!proceed) {
          console.log(`\n🔄 Returning to original branch '${originalBranch}'…`);
          await git.checkout(originalBranch);
          console.log('🚫 Release aborted; your changes remain on the release branch locally.');
          process.exit(1);
        }
      }
      
      // --- Run post-release hook ---
      if (config.hooks.afterRelease) {
        console.log('\n🔄 Running post-release hook...');
        try {
          const { execSync } = require('child_process');
          execSync(config.hooks.afterRelease, { stdio: 'inherit' });
        } catch (hookError) {
          console.error(`⚠️ Warning: Post-release hook failed: ${hookError.message}`);
        }
      }
      
      // 8. Extract repo details for PR link
      let repoUrl = '';
      try {
        if (packageJson.repository && packageJson.repository.url) {
          const urlMatch = packageJson.repository.url.match(/github\.com[/:]([\w-]+\/[\w-]+)(?:\.git)?/);
          if (urlMatch && urlMatch[1]) {
            repoUrl = urlMatch[1];
          }
        }
      } catch (parseError) {
        // Ignore parsing errors
      }
      
      // 9. Provide PR creation instructions
      console.log('\n🔍 Next steps:');
      if (repoUrl) {
        console.log(`  1. Go to: https://github.com/${repoUrl}/pull/new/${releaseBranchName}`);
      } else {
        console.log('  1. Go to your GitHub repository and create a new pull request');
      }
      console.log(`  2. Create a pull request from '${releaseBranchName}' to '${config.mainBranch}'`);
      console.log('  3. Wait for CI/CD to complete and approve the PR');
      
      // 10. Return to original branch
      console.log(`\n🔄 Returning to original branch '${originalBranch}'...`);
      await git.checkout(originalBranch);
      console.log(`  ✅ Switched back to '${originalBranch}'.`);
      
      console.log(`\n🎉 Release ${tagName} process completed successfully!`);
      if (config.publishToMarketplace) {
        console.log('After merging the PR, CI/CD pipeline will trigger the publish job for VS Code Marketplace.');
      } else {
        console.log('After merging the PR, GitHub release will be created, but this version will not be published to VS Code Marketplace.');
      }
    
    } catch (error) {
      console.error('\n❌ Release process failed:');
      console.error(error);
      
      // Try to return to original branch on error
      try {
        await git.checkout(originalBranch);
        console.log(`\n🔄 Returned to original branch '${originalBranch}'.`);
      } catch (checkoutError) {
        console.error(`\n⚠️ Could not return to original branch: ${checkoutError.message}`);
      }
      
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Release process failed:');
    console.error(error);
    process.exit(1);
  }
}

// Start the release process
main();