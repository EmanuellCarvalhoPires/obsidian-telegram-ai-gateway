// Time and timers behind one small interface, so the approval store, the poller and the rate
// limiter can be tested with a manual clock.
import { clearTimeout as nodeClearTimeout, setTimeout as nodeSetTimeout } from "node:timers";

export type TimerHandle = unknown;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => nodeSetTimeout(fn, ms),
  clearTimeout: (handle) => nodeClearTimeout(handle as ReturnType<typeof nodeSetTimeout>),
};

/** Resolves after `ms` on the given clock. */
export function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, ms);
  });
}
