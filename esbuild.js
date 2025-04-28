// esbuild.js
const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch:extension] build started'); // Log prefix clarifies which watch
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch:extension] build finished'); // Log prefix clarifies which watch
		});
	},
};

async function buildExtension() {
	console.log('Building extension using esbuild...'); // Add start log
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts' // Your main entry point
		],
		bundle: true,                      // ESSENTIAL: This bundles dependencies like 'diff'
		outfile: 'out/extension.js',       // CORRECTED: Output to 'out/' folder
		external: ['vscode'],              // ESSENTIAL: Keep vscode external
		format: 'cjs',                     // Required format for VS Code extensions
		platform: 'node',                  // Target Node.js runtime
		sourcemap: !production,            // Generate sourcemaps for development
		minify: production,                // Minify code for production builds
		logLevel: 'info',                  // Provide more build info
		plugins: watch ? [esbuildProblemMatcherPlugin] : [], // Only use plugin in watch mode
		// sourcesContent: false,          // Optional: Exclude source content from source maps
	});

	if (watch) {
		await ctx.watch();
		console.log('[watch:extension] Watching for extension changes...');
	} else {
		await ctx.rebuild();
		await ctx.dispose();
		console.log('✅ Extension build complete!'); // Add success log
	}
}

buildExtension().catch(e => {
	console.error("❌ Extension build failed:", e); // Enhanced error log
	process.exit(1);
});