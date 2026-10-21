import { describe, expect, it } from "vitest";
import { buildKeyboard, callbackData, parseCallbackData, renderApprovalText, statusLine } from "../src/approvals/format";
import { STATUS_MARKERS } from "../src/approvals/status-markers";
import { ApprovalStore } from "../src/approvals/store";
import type { Approval } from "../src/approvals/types";
import type { Clock, TimerHandle } from "../src/util/clock";

class MockClock implements Clock {
  currentTime = 1000;
  private timers = new Map<number, { at: number; cb: () => void }>();
  private nextTimerId = 1;

  now(): number {
    return this.currentTime;
  }

  setTimeout(cb: () => void, ms: number): TimerHandle {
    const id = this.nextTimerId++;
    this.timers.set(id, { at: this.currentTime + ms, cb });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  advance(ms: number): void {
    this.currentTime += ms;
    const due = [...this.timers.entries()]
      .filter(([_, t]) => t.at <= this.currentTime)
      .sort((a, b) => a[1].at - b[1].at);

    for (const [id, t] of due) {
      if (this.timers.has(id)) {
        this.timers.delete(id);
        t.cb();
      }
    }
  }
}

describe("ApprovalStore", () => {
  it("creates pending approval with unique IDs and attaches message IDs", () => {
    const clock = new MockClock();
    let changeCount = 0;
    const store = new ApprovalStore({ clock, onChange: () => changeCount++ });

    const apr = store.create({
      chatId: "123456",
      text: "Approve deploy?",
      options: [
        { label: "Approve", outcome: "approved" },
        { label: "Reject", outcome: "rejected" },
      ],
      requester: "TestAgent",
      lang: "pt",
      expiresInMs: 60_000,
    });

    expect(apr.id).toMatch(/^apr_/);
    expect(apr.status).toBe("pending");
    expect(apr.expiresAt).toBe(61_000);
    expect(store.pendingCount()).toBe(1);

    store.attachMessages(apr.id, [101]);
    expect(store.get(apr.id)?.messageIds).toEqual([101]);
    expect(changeCount).toBe(2);
  });

  it("decides an approval and resolves waiters", async () => {
    const clock = new MockClock();
    const store = new ApprovalStore({ clock });

    const apr = store.create({
      chatId: "123",
      text: "Proceed?",
      options: [{ label: "Sim", outcome: "approved" }],
      requester: "Agent",
      lang: "pt",
    });

    const waitPromise = store.wait(apr.id, 10);
    store.decide(apr.id, {
      status: "approved",
      choice: "Sim",
      decidedBy: "telegram",
    });

    const result = await waitPromise;
    expect(result?.status).toBe("approved");
    expect(result?.choice).toBe("Sim");
    expect(result?.decidedBy).toBe("telegram");
    expect(store.pendingCount()).toBe(0);
  });

  it("times out waiting when no decision occurs within wait window", async () => {
    const clock = new MockClock();
    const store = new ApprovalStore({ clock });

    const apr = store.create({
      chatId: "123",
      text: "Pending?",
      options: [],
      requester: "Agent",
      lang: "en",
    });

    const waitPromise = store.wait(apr.id, 5);
    clock.advance(5500);

    const result = await waitPromise;
    expect(result?.status).toBe("pending");
  });

  it("identifies due (expired) approvals", () => {
    const clock = new MockClock();
    const store = new ApprovalStore({ clock });

    store.create({
      chatId: "123",
      text: "Expire me",
      options: [],
      requester: "Agent",
      lang: "pt",
      expiresInMs: 2000,
    });

    expect(store.due().length).toBe(0);
    clock.advance(2500);
    expect(store.due().length).toBe(1);
  });
});

describe("Approval Format", () => {
  it("renders status lines in English and Portuguese", () => {
    const apr: Approval = {
      id: "apr_test",
      status: "pending",
      options: [{ label: "Yes", outcome: "approved" }],
      chatId: "123",
      messageIds: [1],
      text: "Question?",
      requester: "Agent",
      createdAt: 1000,
      lang: "pt",
    };

    expect(statusLine(apr)).toBe(STATUS_MARKERS.pt.pending);
    expect(renderApprovalText(apr)).toBe(`Question?\n\n${STATUS_MARKERS.pt.pending}`);

    apr.status = "approved";
    apr.choice = "Yes";
    apr.decidedBy = "telegram";
    expect(statusLine(apr)).toBe(`${STATUS_MARKERS.pt.approved}: Yes`);

    apr.lang = "en";
    apr.status = "rejected";
    apr.choice = "No";
    apr.decidedBy = "resolve";
    expect(statusLine(apr)).toBe(`${STATUS_MARKERS.en.rejected}: No (decided in the terminal)`);
  });

  it("parses and generates callbackData", () => {
    const data = callbackData("apr_abc123", 1);
    expect(data).toBe("a:apr_abc123:1");
    expect(parseCallbackData(data)).toEqual({ id: "apr_abc123", index: 1 });
    expect(parseCallbackData("invalid:data")).toBeUndefined();
  });

  it("builds inline keyboard markup with row wrapping", () => {
    const apr: Approval = {
      id: "apr_1",
      status: "pending",
      options: [
        { label: "Option 1", outcome: "approved" },
        { label: "Option 2", outcome: "rejected" },
        { label: "Very long label that takes whole row", outcome: "approved" },
      ],
      chatId: "123",
      messageIds: [],
      text: "T",
      requester: "R",
      createdAt: 0,
      lang: "en",
    };

    const kb = buildKeyboard(apr);
    expect(kb.inline_keyboard.length).toBe(2);
    expect(kb.inline_keyboard[0]?.length).toBe(2);
    expect(kb.inline_keyboard[1]?.length).toBe(1);
  });
});
