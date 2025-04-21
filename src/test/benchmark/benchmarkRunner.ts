// src/test/benchmark/benchmarkSuite.ts

import * as fs from 'fs';
import * as path from 'path';
import * as DiffLib from 'diff';
import { performance } from 'perf_hooks';
import { 
    PatchStrategy,
    PatchStrategyFactory 
  } from '../../strategies/patchStrategy';
  import {
    OptimizedPatchStrategyFactory 
  } from '../../strategies/optimizedPatchStrategy';
import { DiffParsedPatch } from '../../types/patchTypes';
import { measureExecution, generateLargeDiff } from './largeDiffBenchmark';


/**
 * Enhanced benchmark configuration
 */
export interface BenchmarkConfig {
  /** Test sizes in KB */
  sizes: number[];
  /** Number of iterations per test for statistical significance */
  iterations: number;
  /** Enable memory profiling (has performance impact) */
  memoryProfiling: boolean;
  /** Output path for results */
  outputPath?: string;
  /** Fuzz factor for strategies */
  fuzzFactor: 0 | 1 | 2 | 3;
}

/**
 * Results of a benchmark run
 */
export interface BenchmarkResults {
  /** Timestamp of the run */
  timestamp: string;
  /** Node.js version */
  nodeVersion: string;
  /** Configuration used */
  config: BenchmarkConfig;
  /** Results by size */
  results: Record<number, SizeResult>;
  /** Summary statistics */
  summary: {
    /** Average improvement ratio across all sizes */
    averageImprovement: number;
    /** Strategy with best overall performance */
    bestStrategy: string;
    /** Strategy with worst memory usage */
    worstMemoryUsage: string;
  };
}

/**
 * Results for a specific size
 */
export interface SizeResult {
  /** Standard strategies timings */
  standard: {
    strict: number;
    shifted: number;
    greedy: number;
    chained: number;
  };
  /** Optimized strategies timings */
  optimized: {
    strict: number;
    shifted: number;
    greedy: number;
    chained: number;
  };
  /** Memory usage when available */
  memory?: {
    standard: Record<string, number>;
    optimized: Record<string, number>;
  };
  /** Improvement ratios (standard time / optimized time) */
  improvement: {
    strict: number;
    shifted: number;
    greedy: number;
    chained: number;
    overall: number;
  };
}

/**
 * Runs the enhanced benchmark suite with the given configuration
 */
export async function runEnhancedBenchmark(config: BenchmarkConfig): Promise<BenchmarkResults> {
  const startTime = performance.now();
  console.log('=== PatchPilot Enhanced Performance Benchmark Suite ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Configuration: ${JSON.stringify(config, null, 2)}`);

  // Results structure
  const results: Record<number, SizeResult> = {};
  
  // For collecting memory metrics if enabled
  const memorySnapshots: Record<string, number[]> = {};

  // Run benchmarks for each size
  for (const size of config.sizes) {
    console.log(`\n=== Benchmarking ${size}KB diff (${config.iterations} iterations) ===`);
    
    // Prepare result structure for this size
    results[size] = {
      standard: { strict: 0, shifted: 0, greedy: 0, chained: 0 },
      optimized: { strict: 0, shifted: 0, greedy: 0, chained: 0 },
      improvement: { strict: 0, shifted: 0, greedy: 0, chained: 0, overall: 0 }
    };
    
    if (config.memoryProfiling) {
      results[size].memory = {
        standard: { strict: 0, shifted: 0, greedy: 0, chained: 0 },
        optimized: { strict: 0, shifted: 0, greedy: 0, chained: 0 }
      };
      
      // Initialize memory snapshots
      memorySnapshots[`${size}_standard_strict`] = [];
      memorySnapshots[`${size}_standard_shifted`] = [];
      memorySnapshots[`${size}_standard_greedy`] = [];
      memorySnapshots[`${size}_standard_chained`] = [];
      memorySnapshots[`${size}_optimized_strict`] = [];
      memorySnapshots[`${size}_optimized_shifted`] = [];
      memorySnapshots[`${size}_optimized_greedy`] = [];
      memorySnapshots[`${size}_optimized_chained`] = [];
    }
    
    // Run iterations
    for (let i = 0; i < config.iterations; i++) {
      console.log(`\nIteration ${i + 1}/${config.iterations}`);
      
      // Generate fresh test data for each iteration
      const { patch, source } = generateLargeDiff(size, 0.7, 5);
      console.log(`- Generated source: ${formatBytes(Buffer.from(source).length)}, patch: ${formatBytes(Buffer.byteLength(JSON.stringify(patch)))}`);
      console.log(`- Hunks: ${patch.hunks.length}`);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Test standard strategies
      await benchmarkStrategies(
        'standard',
        source,
        patch,
        config.fuzzFactor,
        results[size],
        size,
        config.memoryProfiling,
        memorySnapshots
      );
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Test optimized strategies
      await benchmarkStrategies(
        'optimized',
        source,
        patch,
        config.fuzzFactor,
        results[size],
        size,
        config.memoryProfiling,
        memorySnapshots
      );
    }
    
    // Calculate averages
    finalizeResults(results[size], config.iterations, config.memoryProfiling, memorySnapshots, size);
    
    // Log summary for this size
    logSizeResults(size, results[size]);
  }
  
  // Calculate overall summary
  const summary = calculateSummary(results);
  
  // Final benchmark results
  const benchmarkResults: BenchmarkResults = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    config,
    results,
    summary
  };
  
  // Save results to file
  if (config.outputPath) {
    const outputPath = config.outputPath;
    fs.writeFileSync(outputPath, JSON.stringify(benchmarkResults, null, 2));
    console.log(`\nResults saved to ${outputPath}`);
  } else {
    const defaultPath = path.join(__dirname, '..', '..', '..', 'enhanced-benchmark-results.json');
    fs.writeFileSync(defaultPath, JSON.stringify(benchmarkResults, null, 2));
    console.log(`\nResults saved to ${defaultPath}`);
  }
  
  const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\nBenchmark completed in ${totalTime}s`);
  
  return benchmarkResults;
}

/**
 * Benchmark all strategies of a specific type (standard or optimized)
 */
async function benchmarkStrategies(
  type: 'standard' | 'optimized',
  source: string,
  patch: DiffParsedPatch,
  fuzzFactor: 0 | 1 | 2 | 3,
  result: SizeResult,
  size: number,
  memoryProfiling: boolean,
  memorySnapshots: Record<string, number[]>
): Promise<void> {
  console.log(`\n- Testing ${type} strategies:`);
  
  // Create strategies based on type
  const strategies = type === 'standard' 
    ? {
        strict: PatchStrategyFactory.createStrictStrategy(),
        shifted: PatchStrategyFactory.createShiftedStrategy(fuzzFactor),
        greedy: PatchStrategyFactory.createGreedyStrategy(),
        chained: PatchStrategyFactory.createDefaultStrategy(fuzzFactor)
      }
    : {
        strict: OptimizedPatchStrategyFactory.createStrictStrategy(),
        shifted: OptimizedPatchStrategyFactory.createShiftedStrategy(fuzzFactor),
        greedy: OptimizedPatchStrategyFactory.createGreedyStrategy(),
        chained: OptimizedPatchStrategyFactory.createOptimizedStrategy(fuzzFactor)
      };
  
  // Benchmark each strategy
  for (const [name, strategy] of Object.entries(strategies)) {
    // Take memory snapshot before
    let memBefore = 0;
    if (memoryProfiling) {
      if (global.gc) {
        global.gc();
      }
      memBefore = process.memoryUsage().heapUsed;
    }
    
    // Run the strategy
    const [duration, strategyResult] = await measureExecution(async () => {
      return strategy.apply(source, patch);
    });
    
    // Record the result
    (result[type] as any)[name] += duration;
    
    // Take memory snapshot after
    if (memoryProfiling) {
      if (global.gc) {
        global.gc();
      }
      const memAfter = process.memoryUsage().heapUsed;
      const memDiff = memAfter - memBefore;
      memorySnapshots[`${size}_${type}_${name}`].push(memDiff);
    }
    
    // Log the result
    console.log(`  - ${name.padEnd(8)}: ${duration.toFixed(2)}ms (${strategyResult.success ? 'succeeded' : 'failed'})`);
  }
}

/**
 * Finalize results by calculating averages and improvements
 */
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
        // Skip outliers by taking the median
        snapshots.sort((a, b) => a - b);
        const medianIndex = Math.floor(snapshots.length / 2);
        (result.memory as any)[type][strategy] = snapshots[medianIndex];
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

/**
 * Format bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) {return '0 B';}
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

/**
 * Extend the PatchStrategyFactory with explicit creation methods
 * for individual strategies to support benchmarking
 */
declare module '../../strategies/patchStrategy' {
  interface PatchStrategyFactory {
    createStrictStrategy(): PatchStrategy;
    createShiftedStrategy(fuzzFactor: 0 | 1 | 2 | 3): PatchStrategy;
    createGreedyStrategy(): PatchStrategy;
  }
}

/**
 * Add factory methods for individual strategies
 */
PatchStrategyFactory.createStrictStrategy = function() {
  return new (require('../../strategies/patchStrategy').StrictStrategy)();
};

PatchStrategyFactory.createShiftedStrategy = function(fuzzFactor: 0 | 1 | 2 | 3) {
  return new (require('../../strategies/patchStrategy').ShiftedHeaderStrategy)(fuzzFactor);
};

PatchStrategyFactory.createGreedyStrategy = function() {
  return new (require('../../strategies/patchStrategy').GreedyStrategy)();
};

/**
 * Extend OptimizedPatchStrategyFactory with explicit strategy creation methods
 */
declare module '../../strategies/optimizedPatchStrategy' {
  interface OptimizedPatchStrategyFactory {
    createStrictStrategy(): PatchStrategy;
    createShiftedStrategy(fuzzFactor: 0 | 1 | 2 | 3): PatchStrategy;
    createGreedyStrategy(): PatchStrategy; 
  }
}

/**
 * Add factory methods for individual optimized strategies
 */
OptimizedPatchStrategyFactory.createStrictStrategy = function() {
  // For strict strategy, the standard one is already optimal
  return PatchStrategyFactory.createStrictStrategy();
};

OptimizedPatchStrategyFactory.createShiftedStrategy = function(fuzzFactor: 0 | 1 | 2 | 3) {
  // For shifted strategy, the standard one is already good
  return PatchStrategyFactory.createShiftedStrategy(fuzzFactor);
};

OptimizedPatchStrategyFactory.createGreedyStrategy = function() {
  // Use the optimized greedy strategy
  return new (require('../../strategies/optimizedPatchStrategy').OptimizedGreedyStrategy)();
};

// Export benchmark runner for CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const sizes = args[0] ? args[0].split(',').map(Number) : [10, 100, 500, 1000, 2000];
  const iterations = args[1] ? parseInt(args[1], 10) : 3;
  const memoryProfiling = args[2] === 'true';
  const fuzzFactor = (args[3] ? parseInt(args[3], 10) : 2) as 0 | 1 | 2 | 3;
  
  runEnhancedBenchmark({
    sizes,
    iterations,
    memoryProfiling,
    fuzzFactor
  }).catch(err => {
    console.error('Benchmark error:', err);
    process.exit(1);
  });
}