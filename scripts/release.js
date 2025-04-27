const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { simpleGit } = require('simple-git');

const git = simpleGit();
const packageJsonPath = path.resolve(__dirname, '..', 'package.json');

// Helper function to ask yes/no questions
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes');
  }));
}

async function main() {
  try {
    console.log('🚀 Starting PatchPilot Release Process...');

    // --- Read Version ---
    console.log('📦 Reading package version...');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version;
    if (!version) {
      console.error('❌ Error: Version not found in package.json');
      process.exit(1);
    }
    const tagName = `v${version}`;
    console.log(`🔖 Version found: ${version} (Tag: ${tagName})`);

    // --- Checks ---
    console.log('🔍 Performing checks...');
    
    // Check current branch (optional but recommended: release only from main)
    const status = await git.status();
    if (status.current !== 'main') {
      const proceed = await askQuestion(`⚠️ Warning: You are not on the 'main' branch (current: ${status.current}). Release anyway? (y/N): `);
      if (!proceed) {
        console.log('🚫 Release cancelled.');
        process.exit(0);
      }
    } else {
       console.log('✅ On main branch.');
    }

    // Check if tag already exists locally or remotely
    const tags = await git.tags();
    if (tags.all.includes(tagName)) {
       console.error(`❌ Error: Tag '${tagName}' already exists locally.`);
       process.exit(1);
    }
    console.log('✅ Tag does not exist locally.');

    // --- Check for changes ---
    const hasChanges = !status.isClean();
    if (hasChanges) {
      console.log('📝 Uncommitted changes detected. These will be included in the release commit.');
    } else {
      console.log('📝 No uncommitted changes detected.');
    }

    // --- Confirmation ---
    console.log('\nRelease Summary:');
    console.log(`  - Version: ${version}`);
    console.log(`  - Tag:     ${tagName}`);
    console.log(`  - Branch:  ${status.current}`);
    console.log('\nThis will perform:');
    console.log('  1. git add .');
    console.log(`  2. git commit -m "Release ${tagName}"`);
    console.log(`  3. git tag ${tagName}`);
    console.log(`  4. git push origin ${status.current}`);
    console.log(`  5. git push origin ${tagName}`);

    const confirm = await askQuestion('\n❓ Proceed with release? (y/N): ');
    if (!confirm) {
      console.log('🚫 Release cancelled by user.');
      process.exit(0);
    }

    // --- Execution ---
    console.log('\n🚀 Executing release commands...');

    // 1. Stage any final changes (like updated CHANGELOG/README/version)
    console.log('  ⏳ Staging changes...');
    await git.add('.');
    console.log('  ✅ Changes staged.');

    // 2. Commit
    const commitMessage = `Release ${tagName}`;
    console.log(`  ⏳ Committing with message: "${commitMessage}"...`);
    await git.commit(commitMessage);
    console.log('  ✅ Commit created.');

    // 3. Tag
    console.log(`  ⏳ Creating tag '${tagName}'...`);
    await git.addTag(tagName);
    console.log('  ✅ Tag created.');

    // 4. Push commit
    console.log(`  ⏳ Pushing commit to origin/${status.current}...`);
    await git.push('origin', status.current);
    console.log('  ✅ Commit pushed.');

    // 5. Push tag
    console.log(`  ⏳ Pushing tag '${tagName}' to origin...`);
    await git.push('origin', tagName);
    console.log('  ✅ Tag pushed.');

    console.log(`\n🎉 Release ${tagName} process completed successfully!`);
    console.log('CI/CD pipeline should now trigger the publish job.');

  } catch (error) {
    console.error('\n❌ Release process failed:');
    console.error(error);
    process.exit(1);
  }
}

main();