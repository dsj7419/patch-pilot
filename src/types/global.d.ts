/* -------------------------------------------------------------------------- *
 *  PatchPilot — Global helper types shared in tests & mocks                  *
 * -------------------------------------------------------------------------- */

declare type UnknownFunction = (...args: unknown[]) => unknown;

/** Minimal URI stub used inside mocks */
declare interface MockUri {
  readonly fsPath: string;
  toString(): string;
}

declare namespace NodeJS {
  interface Global {
    // Allow jest.spyOn(globalThis, …) without ts‑errors
    [key: string]: unknown;
  }
}