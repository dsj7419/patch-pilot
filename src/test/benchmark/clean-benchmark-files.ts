/* --------------------------------------------------------------------------
 *  PatchPilot — Benchmark cleanup utility
 * ----------------------------------------------------------------------- */

import * as fs from 'fs';
import * as path from 'path';

// Directory to look in (project root)
const projectRoot = path.join(__dirname, '..', '..', '..');

// Function to clean up benchmark files
async function cleanBenchmarkFiles(): Promise<void> {
  console.log('Cleaning benchmark result files...');
  console.log('==========================================');
  
  let filesRemoved = 0;
  let totalSizeBytes = 0;
  
  // Find all JSON files that contain "benchmark" or "performance" in their names
  try {
    const files = fs.readdirSync(projectRoot);
    const benchmarkFiles = files.filter(file => 
      file.endsWith('.json') && 
      (file.toLowerCase().includes('benchmark') || 
       file.toLowerCase().includes('performance') ||
       file === 'large-diff-benchmark-results.json' ||
       file === 'performance-results.json' ||
       file === 'benchmark-report.json' ||
       file === 'comparison-benchmark-results.json' ||
       file === 'enhanced-benchmark-results.json' ||
       file === 'optimized-benchmark-results.json')
    );
    
    // Delete each benchmark file
    for (const file of benchmarkFiles) {
      const filePath = path.join(projectRoot, file);
      
      try {
        // Get file size before deleting
        const stats = fs.statSync(filePath);
        totalSizeBytes += stats.size;
        
        // Delete the file
        fs.unlinkSync(filePath);
        filesRemoved++;
        
        console.log(`✓ Removed: ${file} (${formatBytes(stats.size)})`);
      } catch (err) {
        console.error(`× Error removing ${file}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.error(`× Error scanning directory: ${(err as Error).message}`);
  }
  
  console.log('==========================================');
  console.log(`Cleaned up ${filesRemoved} files (${formatBytes(totalSizeBytes)})`);
  
  // Check for any custom benchmark output directories
  const benchmarkDir = path.join(projectRoot, 'benchmark-results');
  if (fs.existsSync(benchmarkDir) && fs.statSync(benchmarkDir).isDirectory()) {
    console.log('\nFound benchmark-results directory. To remove it and all contents, run:');
    console.log(`rm -rf "${benchmarkDir}"`);
  }
}

// Format bytes to human-readable size
function formatBytes(bytes: number): string {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) {
    return 'Invalid size';
  }
  
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  
  while (value > 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

// Run the cleanup
cleanBenchmarkFiles().catch(err => console.error('Error cleaning benchmark files:', err));