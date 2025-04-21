/* --------------------------------------------------------------------------
 *  PatchPilot — Performance benchmarks for large diff processing
 * ----------------------------------------------------------------------- */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { applyPatchToContent } from '../../applyPatch';
import { 
  StrictStrategy, 
  ShiftedHeaderStrategy, 
  GreedyStrategy, 
  ChainedPatchStrategy,
  PatchStrategyFactory
} from '../../strategies/patchStrategy';
import { DiffParsedPatch } from '../../types/patchTypes';
import * as DiffLib from 'diff';

/**
 * Measures execution time of a function
 * @param fn Function to measure
 * @returns Execution time in milliseconds and return value
 */
export async function measureExecution<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  const duration = Number(end - start) / 1_000_000; // Convert ns to ms
  return [duration, result];
}

/**
 * Formats a number as a human-readable size string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  
  while (value > 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Safely generates a random string
 * @param length Desired length of the string
 * @returns Random hex string
 */
function safeRandomString(length: number): string {
  try {
    return crypto.randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .substring(0, length);
  } catch (e) {
    // Fallback to Math.random in case crypto fails
    return Math.random().toString(36).substring(2, 2 + length);
  }
}

/**
 * Generates a large synthetic diff of specified size
 * @param sizeKb Approximate size in kilobytes
 * @param contextRatio Ratio of context lines to changed lines (0-1)
 * @param shifts Number of line shifts to simulate
 * @returns A parsed patch object and source content
 */
export function generateLargeDiff(
  sizeKb: number,
  contextRatio: number = 0.7,
  shifts: number = 5
): { patch: DiffParsedPatch, source: string } {
  // Safety check - limit max size to prevent OOM
  const actualSizeKb = Math.min(sizeKb, 10000);
  
  // Target size in bytes
  const targetBytes = actualSizeKb * 1024;
  
  // Generate a source file with randomized content
  // Typical line is ~50 bytes, so estimate lines needed
  const estimatedLines = Math.ceil(targetBytes / 50);
  let sourceLines: string[] = [];
  
  // A template for generating code-like content
  const templates = [
    'function ${name}(${params}) {',
    '  const ${var} = ${value};',
    '  if (${condition}) {',
    '    return ${expr};',
    '  }',
    '  return ${fallback};',
    '}',
    '',
    'class ${className} {',
    '  constructor(${params}) {',
    '    this.${prop} = ${value};',
    '  }',
    '',
    '  ${methodName}() {',
    '    // Implementation for ${purpose}',
    '    ${code}',
    '  }',
    '}',
    '',
    'const ${obj} = {',
    '  ${key}: ${value},',
    '  ${method}(${params}) {',
    '    return ${expr};',
    '  }',
    '};',
    ''
  ];
  
  try {
    // Generate source content
    for (let i = 0; i < estimatedLines; i++) {
      const templateIdx = i % templates.length;
      let line = templates[templateIdx];
      
      try {
        // Replace placeholders with random values - with error handling
        line = line.replace(/\${(\w+)}/g, (_, placeholder) => {
          try {
            switch (placeholder) {
              case 'name': return `func_${safeRandomString(6)}`;
              case 'params': return i % 3 === 0 ? '' : `arg_${i % 100}`;
              case 'var': return `var_${i % 200}`;
              case 'value': return `"value_${safeRandomString(4)}"`;
              case 'condition': return `${i % 2 === 0 ? '!' : ''}condition_${i % 50}`;
              case 'expr': return `result_${i % 100}`;
              case 'fallback': return `default_${i % 20}`;
              case 'className': return `Class${i % 50}`;
              case 'prop': return `property${i % 30}`;
              case 'methodName': return `method${i % 40}`;
              case 'purpose': return `purpose ${i % 10}`;
              case 'code': return `code_line_${i}`;
              case 'obj': return `object${i % 60}`;
              case 'key': return `key${i % 25}`;
              case 'method': return `method${i % 35}`;
              default: return placeholder;
            }
          } catch (e) {
            // Fallback for any placeholder that fails
            return `placeholder_${i}`;
          }
        });
      } catch (e) {
        // If replace fails, use a simple fallback line
        line = `// Line ${i}`;
      }
      
      sourceLines.push(line);
    }
    
    const source = sourceLines.join('\n');
    
    // Now create a patch by introducing changes
    const modifiedLines = [...sourceLines];
    
    // Determine how many changes to make (add/modify/delete)
    // Limit changes to avoid excessive processing for very large diffs
    const maxChanges = Math.min(5000, Math.floor(modifiedLines.length * 0.1));
    const changeIndices = new Set<number>();
    
    // Generate unique random indices for changes
    while (changeIndices.size < maxChanges && changeIndices.size < modifiedLines.length / 2) {
      const idx = Math.floor(Math.random() * modifiedLines.length);
      changeIndices.add(idx);
    }
    
    // Apply the changes to generated source
    for (const idx of changeIndices) {
      if (idx >= modifiedLines.length) {continue;} // Safety check
      
      const changeType = Math.random();
      
      if (changeType < 0.33) {
        // Add a line
        try {
          modifiedLines.splice(idx, 0, `// New line ${safeRandomString(8)}`);
        } catch (e) {
          // Skip this change if it fails
          continue;
        }
      } else if (changeType < 0.66 && modifiedLines[idx]) {
        // Modify a line - with safety check
        try {
          modifiedLines[idx] = modifiedLines[idx].replace(/\w+/g, (match) => {
            return Math.random() < 0.3 ? `modified_${match}` : match;
          });
        } catch (e) {
          // If replace fails, just overwrite the line
          modifiedLines[idx] = `// Modified line ${idx}`;
        }
      } else if (modifiedLines.length > 10) {
        // Delete a line (ensure we keep at least 10 lines)
        try {
          modifiedLines.splice(idx, 1);
        } catch (e) {
          // Skip this change if it fails
          continue;
        }
      }
    }
    
    const modified = modifiedLines.join('\n');
    
    let genPatch: DiffParsedPatch;
    
    try {
      // Generate a synthetic patch
      genPatch = DiffLib.structuredPatch(
        'a/source.ts',
        'b/source.ts',
        source,
        modified,
        '',
        '',
        { context: Math.ceil(contextRatio * 10) } // Context lines based on ratio
      );
      
      // If we need to simulate line shifts
      if (shifts > 0 && genPatch.hunks.length > 0) {
        // Randomly adjust line numbers in some hunks to simulate shifted context
        for (let i = 0; i < Math.min(shifts, genPatch.hunks.length); i++) {
          const hunkIdx = Math.floor(Math.random() * genPatch.hunks.length);
          if (hunkIdx >= genPatch.hunks.length) {continue;} // Safety check
          
          const shift = Math.floor(Math.random() * 5) + 1; // Shift by 1-5 lines
          
          // Apply the shift (50% chance up or down)
          if (Math.random() < 0.5) {
            genPatch.hunks[hunkIdx].oldStart = Math.max(1, genPatch.hunks[hunkIdx].oldStart - shift);
            genPatch.hunks[hunkIdx].newStart = Math.max(1, genPatch.hunks[hunkIdx].newStart - shift);
          } else {
            genPatch.hunks[hunkIdx].oldStart += shift;
            genPatch.hunks[hunkIdx].newStart += shift;
          }
        }
      }
    } catch (e) {
      // Fallback to a simpler patch if structuredPatch fails
      genPatch = {
        oldFileName: 'a/source.ts',
        newFileName: 'b/source.ts',
        hunks: [{
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: [
            ' // Context line',
            '-// Old line',
            '+// New line'
          ]
        }]
      };
    }
    
    return { patch: genPatch, source };
  } catch (e) {
    // Fallback with minimal diff if anything goes wrong
    console.error('Error generating large diff:', e);
    
    // Return minimal valid diff
    return {
      source: '// Fallback source\nfunction test() {\n  return true;\n}\n',
      patch: {
        oldFileName: 'a/source.ts',
        newFileName: 'b/source.ts',
        hunks: [{
          oldStart: 1,
          oldLines: 3,
          newStart: 1, 
          newLines: 3,
          lines: [
            ' // Fallback source', 
            ' function test() {', 
            '-  return true;',
            '+  return false;',
            ' }'
          ]
        }]
      }
    };
  }
}

/**
 * Benchmark all patch strategies with a large diff
 * @param sizeKb Size of the test diff in kilobytes
 * @param iterations Number of iterations to run
 */
export async function benchmarkAllStrategies(
  sizeKb: number,
  iterations: number = 3
): Promise<Record<string, number>> {
  console.log(`\n=== Benchmarking ${sizeKb}KB diff (${iterations} iterations) ===`);
  
  const results: Record<string, number[]> = {
    'strict': [],
    'shifted': [],
    'greedy': [],
    'chained': []
  };
  
  // Create instances of all strategies
  const strictStrategy = new StrictStrategy();
  const shiftedStrategy = new ShiftedHeaderStrategy(2);
  const greedyStrategy = new GreedyStrategy();
  const chainedStrategy = PatchStrategyFactory.createDefaultStrategy(2);
  
  for (let i = 0; i < iterations; i++) {
    console.log(`\nIteration ${i + 1}/${iterations}`);
    
    // Generate a fresh diff for each iteration
    const { patch, source } = generateLargeDiff(sizeKb);
    const contentSize = formatBytes(Buffer.from(source).length);
    const patchSize = formatBytes(JSON.stringify(patch).length);
    
    console.log(`- Generated source: ${contentSize}, patch: ${patchSize}`);
    console.log(`- Hunks: ${patch.hunks.length}`);
    
    // Memory usage before tests
    const memBefore = process.memoryUsage();
    
    // Benchmark each strategy
    const strategies = [
      { name: 'strict', strategy: strictStrategy },
      { name: 'shifted', strategy: shiftedStrategy },
      { name: 'greedy', strategy: greedyStrategy },
      { name: 'chained', strategy: chainedStrategy }
    ];
    
    for (const { name, strategy } of strategies) {
      try {
        const [duration] = await measureExecution(async () => {
          return strategy.apply(source, patch);
        });
        
        results[name].push(duration);
        console.log(`- ${name.padEnd(8)}: ${duration.toFixed(2)} ms`);
      } catch (err) {
        console.error(`- Error in ${name} strategy:`, err);
        // Add a high value to indicate failure
        results[name].push(99999);
      }
    }
    
    // Check memory usage
    const memAfter = process.memoryUsage();
    const heapDiff = formatBytes(memAfter.heapUsed - memBefore.heapUsed);
    console.log(`- Memory delta: ${heapDiff}`);
  }
  
  // Calculate averages
  const averages: Record<string, number> = {};
  for (const [name, times] of Object.entries(results)) {
    // Filter out any error values (99999)
    const validTimes = times.filter(t => t < 99999);
    if (validTimes.length > 0) {
      averages[name] = validTimes.reduce((sum, time) => sum + time, 0) / validTimes.length;
      console.log(`Average ${name.padEnd(8)}: ${averages[name].toFixed(2)} ms`);
    } else {
      averages[name] = 0;
      console.log(`Average ${name.padEnd(8)}: Failed to complete`);
    }
  }
  
  // Identify the slowest strategy
  const slowest = Object.entries(averages).reduce(
    (prev, [name, time]) => time > prev.time ? { name, time } : prev,
    { name: '', time: 0 }
  );
  
  if (slowest.name) {
    console.log(`\nSlowest strategy: ${slowest.name} (${slowest.time.toFixed(2)} ms)`);
  }
  
  return averages;
}

/**
 * Runs a series of performance benchmarks for different diff sizes
 */
export async function runPerformanceSuite(): Promise<void> {
  // Reduce max size to avoid memory issues
  const sizes = [10, 100, 500, 1000, 2000];
  
  console.log('=== PatchPilot Performance Benchmark Suite ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Node version: ${process.version}`);
  
  // Record results for different sizes
  const results: Record<number, Record<string, number>> = {};
  
  for (const size of sizes) {
    try {
      const sizeResults = await benchmarkAllStrategies(size);
      results[size] = sizeResults;
    } catch (error) {
      console.error(`Error benchmarking ${size}KB:`, error);
      results[size] = { 
        strict: 0, 
        shifted: 0, 
        greedy: 0, 
        chained: 0 
      };
    }
  }
  
  // Output summary
  console.log('\n=== Summary ===');
  console.log('Size (KB) | Strict    | Shifted   | Greedy    | Chained');
  console.log('----------|-----------|-----------|-----------|----------');
  
  for (const size of sizes) {
    if (results[size]) {
      const row = `${String(size).padEnd(9)} | ` + 
                 `${results[size].strict.toFixed(2).padEnd(9)} | ` +
                 `${results[size].shifted.toFixed(2).padEnd(9)} | ` +
                 `${results[size].greedy.toFixed(2).padEnd(9)} | ` +
                 `${results[size].chained.toFixed(2)}`;
      console.log(row);
    } else {
      console.log(`${String(size).padEnd(9)} | Failed    | Failed    | Failed    | Failed`);
    }
  }
  
  // Save results to a file
  const resultsObj = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    sizes,
    metrics: results
  };
  
  const outputPath = path.join(__dirname, '..', '..', '..', 'performance-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(resultsObj, null, 2));
  
  console.log(`\nResults saved to ${outputPath}`);
}

// Can be run directly: node -r ts-node/register src/test/benchmark/largeDiffBenchmark.ts
if (require.main === module) {
  runPerformanceSuite().catch(err => {
    console.error('Benchmark error:', err);
    process.exit(1);
  });
}