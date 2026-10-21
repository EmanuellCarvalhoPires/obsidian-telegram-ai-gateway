import { describe, expect, it } from "vitest";
import { LongPoller } from "../src/telegram/poller";
import type { TelegramUpdate } from "../src/telegram/types";
import { TelegramApiError } from "../src/telegram/client";

describe("LongPoller", () => {
  it("polls updates and advances offset while shouldRun returns true", async () => {
    let shouldRun = true;
    let callCount = 0;
    const received: TelegramUpdate[] = [];

    const mockApi = {
      getUpdates: async ({ offset }: { offset?: number }) => {
        callCount++;
        if (callCount === 1) {
          return [{ update_id: 100, message: { message_id: 1, chat: { id: 123 }, date: 0 } }];
        }
        shouldRun = false;
        return [];
      },
    };

    const poller = new LongPoller({
      api: mockApi,
      clock: { now: () => 1000, setTimeout: (cb) => { cb(); return 0 as any; }, clearTimeout: () => {} },
      shouldRun: () => shouldRun,
      onUpdates: (updates) => {
        received.push(...updates);
      },
      pollTimeoutSeconds: 0,
    });

    poller.ensureRunning();
    await poller.whenStopped();

    expect(received.length).toBe(1);
    expect(poller.nextOffset).toBe(101);
  });

  it("handles conflict errors without crashing", async () => {
    let shouldRun = true;
    let statusReports: string[] = [];

    const mockApi = {
      getUpdates: async () => {
        shouldRun = false;
        throw new TelegramApiError(409, "Conflict: can't use getUpdates while webhook is active");
      },
    };

    const poller = new LongPoller({
      api: mockApi,
      clock: { now: () => 1000, setTimeout: (cb) => { cb(); return 0 as any; }, clearTimeout: () => {} },
      shouldRun: () => shouldRun,
      onUpdates: () => {},
      onStatus: (s) => statusReports.push(s.state),
      conflictRetryMs: 1,
    });

    poller.ensureRunning();
    await poller.whenStopped();

    expect(statusReports).toContain("webhook");
  });
});
