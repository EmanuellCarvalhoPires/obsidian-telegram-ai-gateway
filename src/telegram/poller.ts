// The single getUpdates long-polling loop of the plugin. It runs only while something needs
// button presses (pending approvals), stops when nothing does, backs off on errors and reports a
// clear status when another consumer (a script, another bot instance) or a webhook holds the bot.
import { TokenUnavailableError } from "../token/token-manager";
import type { Clock, TimerHandle } from "../util/clock";
import { TelegramApiError } from "./client";
import type { TelegramApi } from "./client";
import type { TelegramUpdate } from "./types";

export type PollerState =
  /** Not polling (nothing pending, stopped, or no token). */
  | "idle"
  | "listening"
  /** Another getUpdates consumer is polling the same bot. */
  | "conflict"
  /** A webhook is set for the bot, so getUpdates is refused. */
  | "webhook"
  /** The token was refused by Telegram. */
  | "unauthorized"
  /** The token cannot be used right now (vault locked, Environment Keys missing). */
  | "token-unavailable"
  /** Network or server error; retrying with backoff. */
  | "error";

export interface PollerStatus {
  state: PollerState;
  /** Consecutive failed polls. */
  failures: number;
  /** Seconds until the next attempt, when known. */
  retryInSeconds?: number;
  /** Redacted error text. */
  detail?: string;
}

export interface PollerOptions {
  api: Pick<TelegramApi, "getUpdates">;
  clock: Clock;
  /** Handles one batch of updates (in order). Errors are caught per batch. */
  onUpdates: (updates: TelegramUpdate[]) => Promise<void> | void;
  /** The loop keeps running only while this returns true. */
  shouldRun: () => boolean;
  onStatus?: (status: PollerStatus) => void;
  /** Redacts an error text before it is stored or shown. */
  redact?: (text: string) => string;
  /** Long polling timeout sent to Telegram, in seconds. */
  pollTimeoutSeconds?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  conflictRetryMs?: number;
  unauthorizedRetryMs?: number;
}

const ALLOWED_UPDATES = ["callback_query", "message"];

export class LongPoller {
  private offset: number | undefined;
  private generation = 0;
  private running = false;
  private stopped = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private current: PollerStatus = { state: "idle", failures: 0 };

  private readonly pollTimeout: number;
  private readonly backoffBase: number;
  private readonly backoffMax: number;
  private readonly conflictRetry: number;
  private readonly unauthorizedRetry: number;

  constructor(private readonly options: PollerOptions) {
    this.pollTimeout = options.pollTimeoutSeconds ?? 25;
    this.backoffBase = options.backoffBaseMs ?? 2000;
    this.backoffMax = options.backoffMaxMs ?? 60_000;
    this.conflictRetry = options.conflictRetryMs ?? 15_000;
    this.unauthorizedRetry = options.unauthorizedRetryMs ?? 60_000;
  }

  get status(): PollerStatus {
    return this.current;
  }

  /** The next offset to confirm (kept in memory only). */
  get nextOffset(): number | undefined {
    return this.offset;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Starts the loop when it is not running and there is something to listen for. */
  ensureRunning(): void {
    if (this.stopped || this.running || !this.options.shouldRun()) return;
    this.running = true;
    const generation = ++this.generation;
    this.loop = this.run(generation).finally(() => {
      if (generation === this.generation) {
        this.running = false;
        if (this.current.state === "listening") this.setStatus({ state: "idle", failures: 0 });
      }
    });
  }

  /** Restarts the loop (the token changed). A request still in flight is discarded when it returns. */
  restart(): void {
    if (this.stopped) return;
    this.generation++;
    this.running = false;
    this.wake?.();
    this.setStatus({ state: "idle", failures: 0 });
    this.ensureRunning();
  }

  /** Stops for good (plugin unload). A request still in flight finishes in the background and is ignored. */
  stop(): void {
    this.stopped = true;
    this.generation++;
    this.running = false;
    this.wake?.();
    this.setStatus({ state: "idle", failures: 0 });
  }

  /** Resolves when the current loop has ended (for tests). */
  whenStopped(): Promise<void> {
    return this.loop ?? Promise.resolve();
  }

  private alive(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  private setStatus(status: PollerStatus): void {
    this.current = status;
    this.options.onStatus?.(status);
  }

  /** Sleeps, but wakes up early when the poller is stopped or restarted. */
  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: TimerHandle;
      const done = (): void => {
        this.options.clock.clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      timer = this.options.clock.setTimeout(done, ms);
      this.wake = done;
    });
  }

  private async run(generation: number): Promise<void> {
    let failures = 0;
    while (this.alive(generation) && this.options.shouldRun()) {
      try {
        const updates = await this.options.api.getUpdates({
          ...(this.offset !== undefined ? { offset: this.offset } : {}),
          timeout: this.pollTimeout,
          allowed_updates: ALLOWED_UPDATES,
        });
        if (!this.alive(generation)) return;
        failures = 0;
        this.setStatus({ state: "listening", failures: 0 });
        for (const update of updates) {
          this.offset = Math.max(this.offset ?? 0, update.update_id + 1);
        }
        if (updates.length > 0) {
          try {
            await this.options.onUpdates(updates);
          } catch (err) {
            // A bad update must not stop the loop; the offset already moved past it.
            this.setStatus({ state: "listening", failures: 0, detail: this.redact(err) });
          }
        }
      } catch (err) {
        if (!this.alive(generation)) return;
        failures++;
        const wait = this.statusForError(err, failures);
        await this.pause(wait);
      }
    }
  }

  private redact(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    return this.options.redact ? this.options.redact(text) : text;
  }

  /** Sets the status for an error and returns how long to wait before the next try. */
  private statusForError(err: unknown, failures: number): number {
    const detail = this.redact(err);
    if (err instanceof TokenUnavailableError) {
      this.setStatus({ state: "token-unavailable", failures, retryInSeconds: this.seconds(this.unauthorizedRetry), detail: err.code });
      return this.unauthorizedRetry;
    }
    if (err instanceof TelegramApiError) {
      if (err.isConflict) {
        const wait = this.conflictRetry;
        this.setStatus({
          state: err.isWebhookConflict ? "webhook" : "conflict",
          failures,
          retryInSeconds: this.seconds(wait),
          detail,
        });
        return wait;
      }
      if (err.isUnauthorized) {
        this.setStatus({ state: "unauthorized", failures, retryInSeconds: this.seconds(this.unauthorizedRetry), detail });
        return this.unauthorizedRetry;
      }
      if (err.status === 429 && err.retryAfter !== undefined) {
        const wait = Math.max(1, err.retryAfter) * 1000;
        this.setStatus({ state: "error", failures, retryInSeconds: this.seconds(wait), detail });
        return wait;
      }
    }
    const wait = Math.min(this.backoffMax, this.backoffBase * 2 ** Math.min(failures - 1, 10));
    this.setStatus({ state: "error", failures, retryInSeconds: this.seconds(wait), detail });
    return wait;
  }

  private seconds(ms: number): number {
    return Math.ceil(ms / 1000);
  }
}
