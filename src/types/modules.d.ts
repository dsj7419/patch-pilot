// Add additional typing support for factory methods
declare module '../../strategies/patchStrategy' {
    interface PatchStrategyFactory {
      createStrictStrategy(): PatchStrategy;
      createShiftedStrategy(fuzzFactor: 0 | 1 | 2 | 3): PatchStrategy;
      createGreedyStrategy(): PatchStrategy;
    }
  }
  
  declare module '../../strategies/optimizedPatchStrategy' {
    interface OptimizedPatchStrategyFactory {
      createStrictStrategy(): PatchStrategy;
      createShiftedStrategy(fuzzFactor: 0 | 1 | 2 | 3): PatchStrategy;
      createGreedyStrategy(): PatchStrategy;
    }
  }