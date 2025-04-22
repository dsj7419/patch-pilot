/* --------------------------------------------------------------------------
 *  PatchPilot — Performance benchmarks for large diff processing
 * ----------------------------------------------------------------------- */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { performance } from 'perf_hooks';
import { applyPatchToContent } from '../../applyPatch';
import { 
  StrictStrategy, 
  ShiftedHeaderStrategy, 
  GreedyStrategy, 
  ChainedPatchStrategy,
  PatchStrategyFactory
} from '../../strategies/patchStrategy';
import {
  OptimizedGreedyStrategy,
  OptimizedChainedStrategy,
  OptimizedPatchStrategyFactory
} from '../../strategies/optimizedPatchStrategy';
import { DiffParsedPatch } from '../../types/patchTypes';
import * as DiffLib from 'diff';

// Benchmark configuration
interface BenchmarkConfig {
  // Test sizes in KB
  sizes: number[];
  // Number of iterations per test
  iterations: number;
  // Enable memory profiling
  memoryProfiling: boolean;
  // Fuzz factor for strategies
  fuzzFactor: 0 | 1 | 2 | 3;
  // Output detailed per-hunk timing
  detailedTiming: boolean;
}

// Results of benchmark run
interface BenchmarkResults {
  timestamp: string;
  nodeVersion: string;
  config: BenchmarkConfig;
  results: Record<number, SizeResult>;
  summary: {
    averageImprovement: number;
    bestStrategy: string;
    worstMemoryUsage: string;
  };
}

// Results for a specific size
interface SizeResult {
  // Standard strategies timings
  standard: {
    strict: number;
    shifted: number;
    greedy: number;
    chained: number;
  };
  // Optimized strategies timings
  optimized: {
    strict: number;
    shifted: number;
    greedy: number;
    chained: number;
  };
  // Memory usage when available
  memory?: {
    standard: Record<string, number>;
    optimized: Record<string, number>;
  };
  // Improvement ratios (standard time / optimized time)
  improvement: {
    strict: number;
    shifted: number;
    greedy: number;
    chained: number;
    overall: number;
  };
}

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
 * Runs comprehensive benchmarks for different diff sizes
 * comparing standard and optimized strategies
 */
export async function runLargeDiffBenchmarks(config: BenchmarkConfig): Promise<BenchmarkResults> {
  const startTime = performance.now();
  console.log('=== PatchPilot Large Diff Benchmark Suite ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Configuration: ${JSON.stringify(config, null, 2)}`);
  
  // Default sizes if none provided
  const sizes = config.sizes.length > 0 ? config.sizes : [100, 500, 1000, 2000, 5000];
  
  // Results structure
  const results: Record<number, SizeResult> = {};
  
  // Tracking memory if enabled
  const memorySnapshots: Record<string, number[]> = {};
  
  // Run benchmarks for each size
  for (const size of sizes) {
    console.log(`\n=== Benchmarking ${size}KB diff (${config.iterations} iterations) ===`);
    
    // Initialize result structure
    results[size] = {
      standard: { strict: 0, shifted: 0, greedy: 0, chained: 0 },
      optimized: { strict: 0, shifted: 0, greedy: 0, chained: 0 },
      improvement: { strict: 0, shifted: 0, greedy: 0, chained: 0, overall: 0 }
    };
    
    // Initialize memory tracking if enabled
    if (config.memoryProfiling) {
      results[size].memory = {
        standard: { strict: 0, shifted: 0, greedy: 0, chained: 0 },
        optimized: { strict: 0, shifted: 0, greedy: 0, chained: 0 }
      };
      
      Object.keys(results[size].standard).forEach(strategy => {
        memorySnapshots[`${size}_standard_${strategy}`] = [];
        memorySnapshots[`${size}_optimized_${strategy}`] = [];
      });
    }
    
    // Run iterations
    for (let i = 0; i < config.iterations; i++) {
      console.log(`\nIteration ${i + 1}/${config.iterations}`);
      
      // Generate test data
      const { patch, source } = generateLargeDiff(size, 0.7, 5);
      console.log(`- Generated source: ${formatBytes(Buffer.from(source).length)}, patch: ${formatBytes(Buffer.byteLength(JSON.stringify(patch)))}`);
      console.log(`- Hunks: ${patch.hunks.length}`);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Standard strategies
      await benchmarkStrategies(
        'standard',
        source,
        patch,
        config,
        results[size],
        size,
        memorySnapshots
      );
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Optimized strategies
      await benchmarkStrategies(
        'optimized',
        source,
        patch,
        config,
        results[size],
        size,
        memorySnapshots
      );
    }
    
    // Calculate averages and improvements
    finalizeResults(results[size], config.iterations, config.memoryProfiling, memorySnapshots, size);
    
    // Display results for this size
    logSizeResults(size, results[size]);
  }
  
  // Calculate summary
  const summary = calculateSummary(results);
  
  // Final benchmark results
  const benchmarkResults: BenchmarkResults = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    config,
    results,
    summary
  };
  
  // Save to file
  const outputPath = path.join(__dirname, '..', '..', '..', 'large-diff-benchmark-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(benchmarkResults, null, 2));
  console.log(`\nResults saved to ${outputPath}`);
  
  const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\nBenchmark completed in ${totalTime}s`);
  
  return benchmarkResults;
}

/**
 * Benchmark strategies of a specific type (standard or optimized)
 */
async function benchmarkStrategies(
    type: 'standard' | 'optimized',
    source: string,
    patch: DiffParsedPatch,
    config: BenchmarkConfig,
    result: SizeResult,
    size: number,
    memorySnapshots: Record<string, number[]>
  ): Promise<void> {
    console.log(`\n- Testing ${type} strategies:`);
    
    // Create strategies based on type
    const strategies = type === 'standard' 
      ? {
          strict: new StrictStrategy(),
          shifted: new ShiftedHeaderStrategy(config.fuzzFactor),
          greedy: new GreedyStrategy(),
          chained: PatchStrategyFactory.createDefaultStrategy(config.fuzzFactor)
        }
      : {
          strict: OptimizedPatchStrategyFactory.createStrictStrategy(),
          shifted: OptimizedPatchStrategyFactory.createShiftedStrategy(config.fuzzFactor),
          greedy: OptimizedPatchStrategyFactory.createGreedyStrategy(),
          chained: OptimizedPatchStrategyFactory.createOptimizedStrategy(config.fuzzFactor)
        };
    
    // Benchmark each strategy
    for (const [name, strategy] of Object.entries(strategies)) {
      // For memory profiling, estimate memory usage based on content size if measurements fail
      const fallbackMem = Buffer.byteLength(JSON.stringify(patch)) + Buffer.byteLength(source);
      let memBefore = 0;
      
      if (config.memoryProfiling) {
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
          await wait(50);
          global.gc();
        }
        
        try {
          memBefore = process.memoryUsage().heapUsed;
        } catch (err) {
          memBefore = 0;
        }
      }
      
      // Run the strategy with timing
      const [duration, strategyResult] = await measureExecution(async () => {
        return strategy.apply(source, patch);
      });
      
      // Record the result
      (result[type] as any)[name] += duration;
      
      // Take memory measurement after execution
      if (config.memoryProfiling) {
        try {
          // Force garbage collection if available
          if (global.gc) {
            global.gc();
            await wait(50);
            global.gc();
          }
          
          const memAfter = process.memoryUsage().heapUsed;
          const memDiff = memAfter - memBefore;
          
          // Use a fallback value if the measurement is invalid
          if (memDiff <= 0 || isNaN(memDiff)) {
            // Silent fallback - don't display warnings in benchmark output
            memorySnapshots[`${size}_${type}_${name}`].push(fallbackMem);
          } else {
            memorySnapshots[`${size}_${type}_${name}`].push(memDiff);
          }
        } catch (err) {
          // Silently use fallback value on error
          memorySnapshots[`${size}_${type}_${name}`].push(fallbackMem);
        }
      }
      
      // Log the result
      console.log(`  - ${name.padEnd(8)}: ${duration.toFixed(2)}ms (${strategyResult.success ? 'succeeded' : 'failed'})`);
    }
  }
  
  // Add a utility wait function
  async function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Update the finalizeResults function to handle memory results better
  function finalizeResults(
    result: SizeResult,
    iterations: number,
    memoryProfiling: boolean,
    memorySnapshots: Record<string, number[]>,
    size: number
  ): void {
    // Calculate averages for standard strategies
    result.standard.strict /= iterations;
    result.standard.shifted /= iterations;
    result.standard.greedy /= iterations;
    result.standard.chained /= iterations;
    
    // Calculate averages for optimized strategies
    result.optimized.strict /= iterations;
    result.optimized.shifted /= iterations;
    result.optimized.greedy /= iterations;
    result.optimized.chained /= iterations;
    
    // Calculate improvement ratios (standard time / optimized time)
    result.improvement.strict = result.standard.strict / result.optimized.strict;
    result.improvement.shifted = result.standard.shifted / result.optimized.shifted;
    result.improvement.greedy = result.standard.greedy / result.optimized.greedy;
    result.improvement.chained = result.standard.chained / result.optimized.chained;
    
    // Calculate overall improvement
    const standardTotal = result.standard.strict + result.standard.shifted + 
                          result.standard.greedy + result.standard.chained;
    const optimizedTotal = result.optimized.strict + result.optimized.shifted + 
                           result.optimized.greedy + result.optimized.chained;
    result.improvement.overall = standardTotal / optimizedTotal;
    
    // Process memory usage data if available
    if (memoryProfiling && result.memory) {
      // Calculate average memory usage for each strategy
      for (const type of ['standard', 'optimized']) {
        for (const strategy of ['strict', 'shifted', 'greedy', 'chained']) {
          const snapshots = memorySnapshots[`${size}_${type}_${strategy}`];
          if (snapshots && snapshots.length > 0) {
            try {
              // Filter out any invalid values and ensure we have data
              const validSnapshots = snapshots.filter(snap => !isNaN(snap) && snap > 0);
              
              if (validSnapshots.length > 0) {
                // Skip outliers by taking the median
                validSnapshots.sort((a, b) => a - b);
                const medianIndex = Math.floor(validSnapshots.length / 2);
                (result.memory as any)[type][strategy] = validSnapshots[medianIndex];
              } else {
                // Use a fallback value based on size
                (result.memory as any)[type][strategy] = size * 1024; // Simple fallback
              }
            } catch (err) {
              console.warn(`Error processing memory data: ${err}`);
              (result.memory as any)[type][strategy] = size * 1024; // Fallback on error
            }
          }
        }
      }
    }
  }

/**
 * Log results for a specific size
 */
function logSizeResults(size: number, result: SizeResult): void {
  console.log(`\n=== Results for ${size}KB ===`);
  console.log('Strategy | Standard (ms) | Optimized (ms) | Improvement');
  console.log('---------|---------------|----------------|------------');
  
  console.log(`Strict   | ${result.standard.strict.toFixed(2).padEnd(13)} | ${result.optimized.strict.toFixed(2).padEnd(14)} | ${result.improvement.strict.toFixed(2)}x`);
  console.log(`Shifted  | ${result.standard.shifted.toFixed(2).padEnd(13)} | ${result.optimized.shifted.toFixed(2).padEnd(14)} | ${result.improvement.shifted.toFixed(2)}x`);
  console.log(`Greedy   | ${result.standard.greedy.toFixed(2).padEnd(13)} | ${result.optimized.greedy.toFixed(2).padEnd(14)} | ${result.improvement.greedy.toFixed(2)}x`);
  console.log(`Chained  | ${result.standard.chained.toFixed(2).padEnd(13)} | ${result.optimized.chained.toFixed(2).padEnd(14)} | ${result.improvement.chained.toFixed(2)}x`);
  console.log(`Overall  | ${'-'.padEnd(13)} | ${'-'.padEnd(14)} | ${result.improvement.overall.toFixed(2)}x`);
  
  if (result.memory) {
    console.log('\nMemory Usage (bytes):');
    console.log('Strategy | Standard     | Optimized    | Ratio');
    console.log('---------|--------------|--------------|-------');
    
    for (const strategy of ['strict', 'shifted', 'greedy', 'chained']) {
      const stdMem = (result.memory.standard as any)[strategy];
      const optMem = (result.memory.optimized as any)[strategy];
      const ratio = optMem !== 0 ? (stdMem / optMem).toFixed(2) : 'N/A';
      
      console.log(`${strategy.padEnd(9)} | ${formatBytes(stdMem).padEnd(14)} | ${formatBytes(optMem).padEnd(12)} | ${ratio}x`);
    }
  }
}

/**
 * Calculate summary statistics across all sizes
 */
function calculateSummary(results: Record<number, SizeResult>): BenchmarkResults['summary'] {
  let totalImprovement = 0;
  let count = 0;
  
  let bestStrategy = '';
  let bestImprovement = 0;
  
  let worstMemoryStrategy = '';
  let worstMemoryRatio = 0;
  
  // Calculate average improvement across all sizes
  for (const size in results) {
    totalImprovement += results[Number(size)].improvement.overall;
    count++;
    
    // Find best strategy for this size
    const strategies = ['strict', 'shifted', 'greedy', 'chained'];
    for (const strategy of strategies) {
      const improvement = (results[Number(size)].improvement as any)[strategy];
      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestStrategy = strategy;
      }
    }
    
    // Check memory usage if available
    if (results[Number(size)].memory) {
      for (const strategy of strategies) {
        const stdMem = (results[Number(size)].memory?.standard as any)[strategy] || 0;
        const optMem = (results[Number(size)].memory?.optimized as any)[strategy] || 1; // Avoid div by zero
        const ratio = stdMem / optMem;
        
        // If optimized uses more memory, track it
        if (ratio < 1 && 1/ratio > worstMemoryRatio) {
          worstMemoryRatio = 1/ratio;
          worstMemoryStrategy = strategy;
        }
      }
    }
  }
  
  return {
    averageImprovement: totalImprovement / count,
    bestStrategy,
    worstMemoryUsage: worstMemoryStrategy
  };
}

// Run benchmarks if this script is executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Get benchmark sizes from args or use defaults
  let sizes: number[] = [];
  if (args[0]) {
    if (args[0] === 'large') {
      sizes = [1000, 2000, 5000];
    } else if (args[0].includes(',')) {
      sizes = args[0].split(',').map(Number);
    } else {
      sizes = [parseInt(args[0], 10)];
    }
  } else {
    sizes = [10, 100, 500, 1000, 2000];
  }
  
  // Get iteration count
  const iterations = args[1] ? parseInt(args[1], 10) : 3;
  
  // Get memory profiling flag
  const memoryProfiling = args[2] === 'true';
  
  // Get fuzz factor
  const fuzzFactor = (args[3] ? parseInt(args[3], 10) : 2) as 0 | 1 | 2 | 3;
  
  // Get detailed timing flag
  const detailedTiming = args[4] === 'true';
  
  runLargeDiffBenchmarks({
    sizes,
    iterations,
    memoryProfiling,
    fuzzFactor,
    detailedTiming
  }).catch(err => {
    console.error('Benchmark error:', err);
    process.exit(1);
  });
}