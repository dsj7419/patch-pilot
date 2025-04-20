/* --------------------------------------------------------------------------
 *  PatchPilot — Webview build script
 * ----------------------------------------------------------------------- */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Determine if we're running in production mode
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Define paths
const srcDir = path.join(__dirname, 'webview');
const outDir = path.join(__dirname, 'out', 'webview');

// Create output directory if it doesn't exist
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Copy static assets
fs.copyFileSync(
  path.join(srcDir, 'index.html'),
  path.join(outDir, 'index.html')
);

// Copy styles
fs.copyFileSync(
  path.join(srcDir, 'style.css'),
  path.join(outDir, 'style.css')
);

// esbuild problem matcher plugin for watch mode
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

// Build webview script
async function buildWebview() {
  try {
    const ctx = await esbuild.context({
      entryPoints: [path.join(srcDir, 'main.ts')],
      bundle: true,
      minify: production,
      sourcemap: !production,
      format: 'iife',
      target: ['es2020'],
      outfile: path.join(outDir, 'main.js'),
      logLevel: 'info',
      plugins: [esbuildProblemMatcherPlugin],
    });

    if (watch) {
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      await ctx.rebuild();
      await ctx.dispose();
      console.log('Webview build complete!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildWebview();