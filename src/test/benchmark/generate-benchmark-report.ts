// src/test/benchmark/generate-benchmark-report.ts
import * as fs from 'fs';
import * as path from 'path';

// Interfaces for type safety with benchmark results
interface BenchmarkSummary {
  averageImprovement?: number;
  bestStrategy?: string;
  worstMemoryUsage?: string;
}

interface SizeResult {
  standard: Record<string, number>;
  optimized: Record<string, number>;
  improvement: {
    strict: number;
    shifted: number;
    greedy: number;
    chained: number;
    overall: number;
  };
  memory?: {
    standard: Record<string, number>;
    optimized: Record<string, number>;
  };
}

interface BenchmarkConfig {
  sizes: number[];
  iterations: number;
  memoryProfiling: boolean;
  fuzzFactor: 0 | 1 | 2 | 3;
  detailedTiming: boolean;
}

interface BenchmarkResults {
  timestamp: string;
  nodeVersion: string;
  config: BenchmarkConfig;
  results: Record<number, SizeResult>;
  summary: BenchmarkSummary;
}

interface PerformanceResults {
  timestamp: string;
  nodeVersion: string;
  sizes: number[];
  metrics: Record<number, Record<string, number>>;
}

interface ReportSummary {
  averageImprovements?: {
    strict?: number;
    shifted?: number;
    greedy?: number;
    chained?: number;
    overall?: number;
  };
  bestStrategy?: string;
  largestTestedSize?: number;
  peakMemoryUsage?: string;
  performanceBySize?: Record<string, string>;
  memoryBySize?: Record<string, string>;
}

interface CombinedReport {
  timestamp: string;
  summary: ReportSummary;
  detailedResults: Array<BenchmarkResults | PerformanceResults>;
}

// Paths to benchmark result files
const resultFiles = [
  path.join(__dirname, '..', '..', '..', 'large-diff-benchmark-results.json'),
  path.join(__dirname, '..', '..', '..', 'performance-results.json')
];

// Generate report
async function generateReport(): Promise<void> {
  console.log('Generating comprehensive benchmark report...');
  console.log('==========================================\n');
  
  const report: CombinedReport = {
    timestamp: new Date().toISOString(),
    summary: {},
    detailedResults: []
  };
  
  let hasValidResults = false;
  
  for (const file of resultFiles) {
    try {
      if (fs.existsSync(file)) {
        const fileContent = fs.readFileSync(file, 'utf8');
        if (!fileContent || fileContent.trim() === '') {
          console.log(`File ${file} exists but is empty`);
          continue;
        }
        
        try {
          const data = JSON.parse(fileContent);
          report.detailedResults.push(data);
          
          // Extract key metrics for summary
          summarizeResults(data, report.summary);
          
          // Log summary of this benchmark
          logBenchmarkSummary(data);
          
          hasValidResults = true;
        } catch (parseError) {
          console.error(`Error parsing ${file}: ${(parseError as Error).message}`);
        }
      } else {
        console.log(`File not found: ${file}`);
      }
    } catch (err) {
      console.error(`Error processing ${file}: ${(err as Error).message}`);
    }
  }
  
  if (!hasValidResults) {
    console.log('No valid benchmark results found. Run benchmarks before generating a report.');
    return;
  }
  
  // Generate combined report file
  const reportPath = path.join(__dirname, '..', '..', '..', 'benchmark-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n==========================================');
  console.log(`Full report saved to: ${reportPath}`);
  console.log('');
  
  // Generate summary table
  console.log('PERFORMANCE SUMMARY:');
  console.log('------------------');
  
  if (report.summary.averageImprovements?.overall) {
    console.log(`Overall optimization improvement: ${report.summary.averageImprovements.overall.toFixed(2)}x`);
    console.log(`Best strategy: ${report.summary.bestStrategy || 'N/A'}`);
    console.log(`Largest file tested: ${report.summary.largestTestedSize || 'N/A'} KB`);
    
    if (report.summary.peakMemoryUsage) {
      console.log(`Peak memory usage: ${report.summary.peakMemoryUsage}`);
    } else {
      console.log(`Peak memory usage: Not available (run with memory profiling enabled)`);
    }
    
    console.log('\nPerformance by strategy (average across all sizes):');
    
    if (report.summary.averageImprovements.strict) {
      console.log(`- Strict strategy: ${report.summary.averageImprovements.strict.toFixed(2)}x faster`);
    }
    
    if (report.summary.averageImprovements.greedy) {
      console.log(`- Greedy strategy: ${report.summary.averageImprovements.greedy.toFixed(2)}x faster`);
    }
    
    if (report.summary.averageImprovements.shifted) {
      console.log(`- Shifted strategy: ${report.summary.averageImprovements.shifted.toFixed(2)}x faster`);
    }
    
    if (report.summary.averageImprovements.chained) {
      console.log(`- Chained strategy: ${report.summary.averageImprovements.chained.toFixed(2)}x faster`);
    }
  } else {
    console.log('No summary data available. Run comprehensive benchmarks with the "benchmark:suite" command.');
  }
}

// Extract summary data from benchmark results with better validation
function summarizeResults(data: any, summary: ReportSummary): void {
  // Initialize structures if they don't exist
  summary.averageImprovements = summary.averageImprovements || {
    strict: 0,
    shifted: 0,
    greedy: 0,
    chained: 0,
    overall: 0
  };
  
  let improvementCount = 0;
  
  // Handle large diff benchmark results
  if (data.summary && data.results) {
    summary.bestStrategy = data.summary.bestStrategy || summary.bestStrategy;
    
    // Find largest tested size
    const sizes = Object.keys(data.results).map(Number);
    if (sizes.length > 0) {
      const maxSize = Math.max(...sizes);
      if (!summary.largestTestedSize || maxSize > summary.largestTestedSize) {
        summary.largestTestedSize = maxSize;
      }
    }
    
    // Process improvement factors by strategy
    let strictSum = 0, strictCount = 0;
    let shiftedSum = 0, shiftedCount = 0;
    let greedySum = 0, greedyCount = 0;
    let chainedSum = 0, chainedCount = 0;
    let overallSum = 0, overallCount = 0;
    
    // Collect all memory values for peak usage calculation
    const allMemoryValues: number[] = [];
    
    for (const size in data.results) {
      if (data.results[size].improvement) {
        const imp = data.results[size].improvement;
        
        // Only include valid improvement values (>0)
        if (imp.strict > 0) {
          strictSum += imp.strict;
          strictCount++;
        }
        
        if (imp.shifted > 0) {
          shiftedSum += imp.shifted;
          shiftedCount++;
        }
        
        if (imp.greedy > 0) {
          greedySum += imp.greedy;
          greedyCount++;
        }
        
        if (imp.chained > 0) {
          chainedSum += imp.chained;
          chainedCount++;
        }
        
        if (imp.overall > 0) {
          overallSum += imp.overall;
          overallCount++;
        }
      }
      
      // Check for valid memory data
      if (data.results[size].memory) {
        const memData = data.results[size].memory;
        
        try {
          // Collect valid memory values from standard strategies
          for (const strategy in memData.standard) {
            const value = memData.standard[strategy];
            if (typeof value === 'number' && value > 0 && !isNaN(value)) {
              allMemoryValues.push(value);
            }
          }
          
          // Collect valid memory values from optimized strategies
          for (const strategy in memData.optimized) {
            const value = memData.optimized[strategy];
            if (typeof value === 'number' && value > 0 && !isNaN(value)) {
              allMemoryValues.push(value);
            }
          }
        } catch (e) {
          console.warn(`Error processing memory data for size ${size}: ${e}`);
        }
      }
    }
    
    // Calculate averages for each strategy type
    if (strictCount > 0) {
      summary.averageImprovements.strict = 
        (summary.averageImprovements.strict || 0) + (strictSum / strictCount);
    }
    
    if (shiftedCount > 0) {
      summary.averageImprovements.shifted = 
        (summary.averageImprovements.shifted || 0) + (shiftedSum / shiftedCount);
    }
    
    if (greedyCount > 0) {
      summary.averageImprovements.greedy = 
        (summary.averageImprovements.greedy || 0) + (greedySum / greedyCount);
    }
    
    if (chainedCount > 0) {
      summary.averageImprovements.chained = 
        (summary.averageImprovements.chained || 0) + (chainedSum / chainedCount);
    }
    
    if (overallCount > 0) {
      summary.averageImprovements.overall = 
        (summary.averageImprovements.overall || 0) + (overallSum / overallCount);
      improvementCount++;
    }
    
    // Calculate peak memory usage from all valid values
    if (allMemoryValues.length > 0) {
      const peakMemory = Math.max(...allMemoryValues);
      summary.peakMemoryUsage = formatBytes(peakMemory);
    }
  }
  
  // Handle performance-results.json format
  if (data.metrics) {
    summary.performanceBySize = summary.performanceBySize || {};
    summary.memoryBySize = summary.memoryBySize || {};
    
    for (const size in data.metrics) {
      if (!data.metrics[size]) {continue;}
      
      const strategies = data.metrics[size];
      const validTimes: number[] = [];
      
      for (const strategy in strategies) {
        const time = strategies[strategy];
        if (typeof time === 'number' && time > 0 && !isNaN(time)) {
          validTimes.push(time);
        }
      }
      
      if (validTimes.length > 0) {
        const avgTime = validTimes.reduce((sum, time) => sum + time, 0) / validTimes.length;
        summary.performanceBySize[size] = `${avgTime.toFixed(2)} ms`;
      }
    }
  }
  
  // Normalize improvement averages if we've processed multiple result sets
  if (improvementCount > 1) {
    if (summary.averageImprovements.strict) {
      summary.averageImprovements.strict /= improvementCount;
    }
    
    if (summary.averageImprovements.shifted) {
      summary.averageImprovements.shifted /= improvementCount;
    }
    
    if (summary.averageImprovements.greedy) {
      summary.averageImprovements.greedy /= improvementCount;
    }
    
    if (summary.averageImprovements.chained) {
      summary.averageImprovements.chained /= improvementCount;
    }
    
    if (summary.averageImprovements.overall) {
      summary.averageImprovements.overall /= improvementCount;
    }
  }
}

// Log summary of an individual benchmark with improved validation
function logBenchmarkSummary(data: any): void {
  if (!data) {
    console.warn('Invalid benchmark data provided to summary logger');
    return;
  }
  
  if (data.timestamp) {
    console.log(`\nBenchmark from: ${new Date(data.timestamp).toLocaleString()}`);
  }
  
  if (data.summary && typeof data.summary.averageImprovement === 'number') {
    console.log(`Average improvement: ${data.summary.averageImprovement.toFixed(2)}x`);
    console.log(`Best strategy: ${data.summary.bestStrategy || 'Unknown'}`);
  }
  
  if (Array.isArray(data.sizes)) {
    console.log(`Tested sizes: ${data.sizes.join(', ')} KB`);
  }
  
  if (data.results) {
    console.log('\nResults by size:');
    for (const size in data.results) {
      const result = data.results[size];
      if (result && result.improvement && typeof result.improvement.overall === 'number') {
        console.log(`  - ${size}KB: ${result.improvement.overall.toFixed(2)}x improvement`);
      }
    }
  }
  
  if (data.metrics) {
    console.log('\nAverage execution times:');
    for (const size in data.metrics) {
      const strategies = data.metrics[size];
      if (!strategies) {continue;}
      
      console.log(`  - ${size}KB:`);
      for (const strategy in strategies) {
        const time = strategies[strategy];
        if (typeof time === 'number' && !isNaN(time)) {
          console.log(`    * ${strategy}: ${time.toFixed(2)} ms`);
        }
      }
    }
  }
}

// Format bytes to human-readable size with improved validation
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

// Run the report generation
generateReport().catch(err => console.error('Error generating report:', err));