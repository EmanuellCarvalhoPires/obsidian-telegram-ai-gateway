/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { buildRoutes } from "../src/api/routes";
import { buildTools } from "../src/api/tools";
import { ApprovalStore } from "../src/approvals/store";
import { GatewayService } from "../src/gateway/gateway-service";
import { allStrings } from "../src/i18n";
import { PolicyEngine } from "../src/policy/policy";
import { buildQuestionKeyboard, parseQuestionCallback, questionCallbackData } from "../src/questions/format";
import { QuestionStore } from "../src/questions/store";
import { DEFAULT_SETTINGS, loadSettings } from "../src/settings/settings";
import type { GatewaySettings } from "../src/settings/settings";
import type { TelegramApi } from "../src/telegram/client";
import { LongPoller } from "../src/telegram/poller";
import { TokenManager } from "../src/token/token-manager";
import type { Clock, TimerHandle } from "../src/util/clock";
import { setMockLanguage } from "./mocks/obsidian";

class MockClock implements Clock {
  currentTime = Date.UTC(2026, 0, 15, 15, 0, 0);
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
    const due = [...this.timers.entries()].filter(([, t]) => t.at <= this.currentTime).sort((a, b) => a[1].at - b[1].at);
    for (const [id, t] of due) {
      if (this.timers.has(id)) {
        this.timers.delete(id);
        t.cb();
      }
    }
  }
}

const OWNER = "12345";

interface SetupOptions {
  settings?: Partial<GatewaySettings>;
  /** 1-based number of the sendMessage call that fails. */
  failSend?: number;
  persisted?: unknown;
}

function setup(opts: SetupOptions = {}) {
  const settings: GatewaySettings = {
    ...DEFAULT_SETTINGS,
    recentHistory: [],
    approvals: [],
    questions: [],
    notifyEvents: [...DEFAULT_SETTINGS.notifyEvents],
    botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u",
    chatId: OWNER,
    messageLanguage: "en",
    minCooldownSeconds: 0,
    maxMessagesPerMinute: 100,
    ...opts.settings,
  };
  const clock = new MockClock();
  let saves = 0;
  const questionStore = new QuestionStore(
    {
      clock,
      onChange: () => {
        settings.questions = questionStore.toPersisted();
      },
    },
    opts.persisted,
  );
  const tokenManager = new TokenManager({ settings: () => settings, save: async () => {}, secrets: () => undefined, onChange: () => {} });

  const sent: any[] = [];
  const edited: any[] = [];
  const answered: any[] = [];
  const deleted: any[] = [];
  let sendCalls = 0;
  const client: TelegramApi = {
    sendMessage: async (p) => {
      sendCalls++;
      if (opts.failSend === sendCalls) throw new Error("network down");
      sent.push(p);
      return { message_id: 1000 + sent.length, date: 0, chat: { id: Number(p.chat_id) } };
    },
    editMessageText: async (p) => {
      edited.push(p);
    },
    answerCallbackQuery: async (p) => {
      answered.push(p);
    },
    deleteMessage: async (p) => {
      deleted.push(p);
    },
    getUpdates: async () => [],
    getMe: async () => ({ id: 1, is_bot: true, first_name: "Bot" }),
  };
  const poller = new LongPoller({ api: client, clock, shouldRun: () => false, onUpdates: () => {} });
  const policy = new PolicyEngine(() => settings, clock);
  const service = new GatewayService({
    settings: () => settings,
    saveSettings: async () => {
      saves++;
    },
    tokenManager,
    policy,
    store: new ApprovalStore({ clock }),
    questionStore,
    client,
    poller,
    clock,
  });

  let cbCount = 0;
  /** Presses a button of the message of question `qi`. */
  const press = (id: string, qi: number, action: string, chat: string | number = OWNER) =>
    service.questions.handleCallbackQuery({
      id: `cb_${++cbCount}`,
      from: { id: Number(chat) },
      data: questionCallbackData(id, qi, action),
      message: { message_id: questionStore.get(id)?.items[qi]?.messageId ?? 0, chat: { id: Number(chat) }, date: 0 },
    });
  /** Types a reply to the message `replyTo`. */
  const reply = (text: string, replyTo: number, chat: string | number = OWNER) =>
    service.questions.handleMessage({
      message_id: 5000 + ++cbCount,
      chat: { id: Number(chat) },
      from: { id: Number(chat) },
      text,
      reply_to_message: { message_id: replyTo, chat: { id: Number(chat) } },
    });
  const lastEdit = (messageId: number) => [...edited].reverse().find((e) => e.message_id === messageId);

  return { service, questionStore, settings, clock, sent, edited, answered, deleted, press, reply, lastEdit, poller, saves: () => saves, policy, client };
}

const COLORS = {
  question: "Which color?",
  header: "Color",
  options: [
    { label: "Azul", description: "cold" },
    { label: "Verde", description: "alive" },
  ],
};

const SIZES = {
  question: "Which sizes?",
  header: "Size",
  multiSelect: true,
  options: [{ label: "S" }, { label: "M" }, { label: "L" }],
};

function buttons(message: any): Array<{ text: string; callback_data: string }> {
  return (message.reply_markup?.inline_keyboard ?? []).flat();
}

describe("questions: layout and single choice", () => {
  it("sends one message per question with header, numbered options, status and buttons", async () => {
    const { service, sent } = setup();
    const res = await service.questions.ask({ questions: [COLORS], sender: "Claude Code", title: "Palette" });

    expect(res.status).toBe("pending");
    expect(res.id).toMatch(/^qst_[0-9a-f]{12}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0].chat_id).toBe(OWNER);
    expect(sent[0].parse_mode).toBe("HTML");
    const text: string = sent[0].text;
    expect(text).toContain("<i>Palette</i>");
    expect(text).toContain("<b>Color</b> (Claude Code)");
    expect(text).toContain("Which color?");
    expect(text).toContain("1. <b>Azul</b> - cold");
    expect(text).toContain("2. <b>Verde</b> - alive");
    expect(text.endsWith("⏳ Waiting")).toBe(true);

    const labels = buttons(sent[0]).map((b) => b.text);
    expect(labels).toEqual(["1. Azul", "2. Verde", "Other (type)"]);
  });

  it("answers with the label, edits the message to the final status and removes the buttons", async () => {
    const { service, questionStore, sent, answered, lastEdit, press } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS] });

    await press(id, 0, "o1");

    const view = await service.questions.get(id);
    expect(view).toMatchObject({ status: "answered", answers: { "Which color?": "Verde" }, free_text: {}, decided_by: "telegram" });
    expect(questionStore.get(id)?.status).toBe("answered");
    const edit = lastEdit(1001);
    expect(edit.text).toContain("Answered: Verde");
    expect(edit.text).not.toContain("Waiting");
    expect(edit.reply_markup).toBeUndefined();
    expect(answered.at(-1).text).toBe("Recorded");
    expect(sent).toHaveLength(1);
  });

  it("escapes HTML in every field", async () => {
    const { service, sent } = setup();
    await service.questions.ask({
      questions: [{ question: "a < b & c?", header: "<h>", options: [{ label: "x<y" }, { label: "ok", description: "&" }] }],
    });
    expect(sent[0].text).toContain("<b>&lt;h&gt;</b>");
    expect(sent[0].text).toContain("a &lt; b &amp; c?");
    expect(sent[0].text).toContain("<b>x&lt;y</b>");
  });

  it("writes the layout in Portuguese when the message language is pt", async () => {
    const { service, sent } = setup({ settings: { messageLanguage: "pt" } });
    await service.questions.ask({ questions: [SIZES] });
    expect(sent[0].text).toContain("Marque as opções e toque em Enviar.");
    expect(sent[0].text.endsWith("⏳ Aguardando")).toBe(true);
    expect(buttons(sent[0]).map((b) => b.text)).toEqual(["☐ 1. S", "☐ 2. M", "☐ 3. L", "Outro (digitar)", "Enviar"]);
  });

  it("hides the free text button when allow_free_text is false", async () => {
    const { service, sent, press, answered } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS], allowFreeText: false });
    expect(buttons(sent[0]).map((b) => b.text)).toEqual(["1. Azul", "2. Verde"]);
    await press(id, 0, "x");
    expect(sent).toHaveLength(1);
    expect(answered).toHaveLength(1);
  });

  it("keeps callback_data under 64 bytes for every button", async () => {
    const { service, sent } = setup();
    await service.questions.ask({
      questions: [1, 2, 3, 4].map((n) => ({
        question: `Q${n}`,
        multiSelect: n % 2 === 0,
        options: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }],
      })),
    });
    expect(sent).toHaveLength(4);
    const all = sent.flatMap((m) => buttons(m));
    expect(all.length).toBeGreaterThan(16);
    for (const button of all) {
      expect(Buffer.byteLength(button.callback_data, "utf8")).toBeLessThanOrEqual(64);
      expect(parseQuestionCallback(button.callback_data)).toBeDefined();
    }
  });
});

describe("questions: several questions", () => {
  it("edits only the answered message and finishes when the last one is answered", async () => {
    const { service, sent, lastEdit, press } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS, { ...COLORS, question: "Which other color?" }] });
    expect(sent).toHaveLength(2);

    await press(id, 1, "o0");
    const view = await service.questions.get(id);
    expect(view?.status).toBe("pending");
    expect(view?.answers).toEqual({ "Which other color?": "Azul" });
    expect(view?.questions).toEqual([
      { question: "Which color?", answered: false },
      { question: "Which other color?", answered: true },
    ]);
    expect(lastEdit(1001)).toBeUndefined();
    expect(lastEdit(1002).text).toContain("Answered: Azul");

    await press(id, 0, "o1");
    expect(await service.questions.get(id)).toMatchObject({
      status: "answered",
      answers: { "Which color?": "Verde", "Which other color?": "Azul" },
    });
  });

  it("keeps the first answer when the same question is answered twice", async () => {
    const { service, answered, press } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS, { ...COLORS, question: "Two?" }] });
    await press(id, 0, "o0");
    await press(id, 0, "o1");
    expect((await service.questions.get(id))?.answers["Which color?"]).toBe("Azul");
    expect(answered.at(-1).text).toBe("This request is no longer pending.");
  });
});

describe("questions: multiSelect", () => {
  it("toggles options, refuses an empty Send, then answers with the labels in option order", async () => {
    const { service, sent, edited, answered, lastEdit, press } = setup();
    const { id } = await service.questions.ask({ questions: [SIZES] });

    await press(id, 0, "s");
    expect(answered.at(-1).text).toBe("Select at least one option first.");
    expect((await service.questions.get(id))?.status).toBe("pending");

    await press(id, 0, "o2");
    await press(id, 0, "o0");
    await press(id, 0, "o1");
    await press(id, 0, "o1");
    expect(edited).toHaveLength(4);
    const marks = buttons(lastEdit(1001)).map((b) => b.text);
    expect(marks).toEqual(["☑ 1. S", "☐ 2. M", "☑ 3. L", "Other (type)", "Send"]);
    expect(lastEdit(1001).text).toContain("Waiting");
    expect(sent).toHaveLength(1);

    await press(id, 0, "s");
    const view = await service.questions.get(id);
    expect(view).toMatchObject({ status: "answered", answers: { "Which sizes?": ["S", "L"] }, free_text: {} });
    expect(lastEdit(1001).text).toContain("Answered: S, L");
    expect(lastEdit(1001).reply_markup).toBeUndefined();
  });
});

describe("questions: free text", () => {
  it("asks for the text with force_reply and takes the reply as the answer", async () => {
    const { service, sent, deleted, lastEdit, press, reply } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS] });

    await press(id, 0, "x");
    expect(sent).toHaveLength(2);
    expect(sent[1].reply_markup).toMatchObject({ force_reply: true });
    expect(sent[1].text).toContain("Which color?");
    const prompt = 1002;

    expect(await reply("Roxo", prompt)).toBe(true);
    const view = await service.questions.get(id);
    expect(view).toMatchObject({
      status: "answered",
      answers: { "Which color?": "Roxo" },
      free_text: { "Which color?": true },
    });
    expect(deleted).toEqual([{ chat_id: OWNER, message_id: prompt }]);
    expect(lastEdit(1001).text).toContain("Answered: Roxo");
    expect(lastEdit(1001).reply_markup).toBeUndefined();
  });

  it("adds the typed text to the selection of a multiSelect question", async () => {
    const { service, lastEdit, press, reply } = setup();
    const { id } = await service.questions.ask({ questions: [SIZES] });

    await press(id, 0, "o0");
    await press(id, 0, "x");
    await reply("XXL", 1002);
    expect(buttons(lastEdit(1001)).map((b) => b.text)).toContain("Other: XXL");
    expect((await service.questions.get(id))?.status).toBe("pending");

    await press(id, 0, "s");
    expect(await service.questions.get(id)).toMatchObject({
      status: "answered",
      answers: { "Which sizes?": ["S", "XXL"] },
      free_text: { "Which sizes?": true },
    });
  });

  it("lets Send go through with only the typed text", async () => {
    const { service, press, reply } = setup();
    const { id } = await service.questions.ask({ questions: [SIZES] });
    await press(id, 0, "x");
    await reply("custom", 1002);
    await press(id, 0, "s");
    expect((await service.questions.get(id))?.answers).toEqual({ "Which sizes?": ["custom"] });
  });

  it("ignores messages from other chats, plain messages and replies to other messages", async () => {
    const { service, press, reply, deleted } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS] });
    await press(id, 0, "x");
    const prompt = 1002;

    expect(await reply("intruder", prompt, "999")).toBe(false);
    expect(await reply("wrong target", 1001)).toBe(false);
    expect(await reply("unknown target", 424242)).toBe(false);
    expect(
      await service.questions.handleMessage({ message_id: 9, chat: { id: Number(OWNER) }, from: { id: Number(OWNER) }, text: "not a reply" }),
    ).toBe(false);
    expect(await reply("   ", prompt)).toBe(false);
    expect((await service.questions.get(id))?.status).toBe("pending");
    expect(deleted).toHaveLength(0);

    expect(await reply("real answer", prompt)).toBe(true);
    expect((await service.questions.get(id))?.answers).toEqual({ "Which color?": "real answer" });
  });

  it("ignores button presses that come from another chat", async () => {
    const { service, press, edited } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS] });
    await press(id, 0, "o0", "999");
    expect((await service.questions.get(id))?.status).toBe("pending");
    expect(edited).toHaveLength(0);
  });

  it("only the new prompt counts when the free text button is pressed twice", async () => {
    const { service, press, reply, deleted } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS] });
    await press(id, 0, "x");
    await press(id, 0, "x");
    expect(deleted).toEqual([{ chat_id: OWNER, message_id: 1002 }]);
    expect(await reply("old", 1002)).toBe(false);
    expect(await reply("new", 1003)).toBe(true);
    expect((await service.questions.get(id))?.answers).toEqual({ "Which color?": "new" });
  });
});

describe("questions: resolved from outside", () => {
  it("answered_elsewhere cleans every unanswered message and removes the open prompt", async () => {
    const { service, press, lastEdit, deleted } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS, { ...COLORS, question: "Second?" }] });
    await press(id, 0, "o0");
    await press(id, 1, "x");

    const res = await service.questions.resolve({ id, status: "answered_elsewhere", detail: "in the terminal" });
    expect(res.resolved[0]).toMatchObject({
      status: "answered",
      decided_by: "resolve",
      detail: "in the terminal",
      answers: { "Which color?": "Azul" },
    });
    expect(lastEdit(1001).text).toContain("Answered: Azul");
    expect(lastEdit(1002).text).toContain("\u{1F4AC} Answered (answered on the PC; in the terminal)");
    expect(lastEdit(1002).reply_markup).toBeUndefined();
    expect(deleted).toEqual([{ chat_id: OWNER, message_id: 1003 }]);
  });

  it("interrupted marks the messages as interrupted", async () => {
    const { service, lastEdit, press, answered } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS] });
    const res = await service.questions.resolve({ id, status: "interrupted" });
    expect(res.resolved[0]?.status).toBe("interrupted");
    expect(lastEdit(1001).text.endsWith("\u{1F6D1} Interrupted")).toBe(true);
    expect(lastEdit(1001).reply_markup).toBeUndefined();

    await press(id, 0, "o0");
    expect(answered.at(-1).text).toBe("This request is no longer pending.");
    expect((await service.questions.get(id))?.status).toBe("interrupted");
  });

  it("resolves the newest pending question, or all of them, and refuses when none is pending", async () => {
    const { service } = setup();
    const first = await service.questions.ask({ questions: [COLORS] });
    const second = await service.questions.ask({ questions: [COLORS] });

    const newest = await service.questions.resolve({ status: "answered_elsewhere" });
    expect(newest.resolved).toHaveLength(1);
    const all = await service.questions.resolve({ status: "interrupted", all: true });
    expect(all.resolved).toHaveLength(1);
    expect((await service.questions.get(first.id))?.status).toBeDefined();
    expect([(await service.questions.get(first.id))?.status, (await service.questions.get(second.id))?.status].sort()).toEqual([
      "answered",
      "interrupted",
    ]);
    await expect(service.questions.resolve({ status: "interrupted" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.questions.resolve({ status: "nope" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("wakes a waiting telegram_get_question when the question is resolved", async () => {
    const { service } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS] });
    const waiting = service.questions.get(id, 25);
    await service.questions.resolve({ id, status: "answered_elsewhere" });
    expect((await waiting)?.status).toBe("answered");
  });
});

describe("questions: expiry", () => {
  it("never expires by default, whatever the approval expiry setting says", async () => {
    const { service, clock, lastEdit } = setup({ settings: { approvalExpiryMinutes: 1 } });
    const { id } = await service.questions.ask({ questions: [COLORS] });
    const view = await service.questions.get(id);
    expect(view?.expires_at).toBeNull();

    clock.advance(30 * 24 * 60 * 60 * 1000);
    await service.questions.checkDue();
    expect((await service.questions.get(id))?.status).toBe("pending");
    expect(lastEdit(1001)).toBeUndefined();
  });

  it("expires after expires_in_minutes and cleans the message", async () => {
    const { service, clock, lastEdit, press, answered } = setup();
    const { id } = await service.questions.ask({ questions: [COLORS], expiresInMinutes: 5 });
    expect((await service.questions.get(id))?.expires_at).not.toBeNull();

    clock.advance(4 * 60 * 1000);
    await service.questions.checkDue();
    expect((await service.questions.get(id))?.status).toBe("pending");

    clock.advance(2 * 60 * 1000);
    await service.questions.checkDue();
    expect(await service.questions.get(id)).toMatchObject({ status: "expired", decided_by: "expired" });
    expect(lastEdit(1001).text.endsWith("⌛ Expired")).toBe(true);
    expect(lastEdit(1001).reply_markup).toBeUndefined();

    await press(id, 0, "o0");
    expect(answered.at(-1).text).toBe("This request is no longer pending.");
  });
});

describe("questions: persistence and restart", () => {
  it("keeps pending questions after a reload and keeps handling their buttons and typed text", async () => {
    const first = setup();
    const { id } = await first.service.questions.ask({ questions: [COLORS, SIZES], expiresInMinutes: 60 });
    await first.press(id, 0, "o0");
    await first.press(id, 1, "o1");
    await first.press(id, 1, "x");

    // data.json round trip, as the plugin does on reload
    const raw = JSON.parse(JSON.stringify({ ...first.settings, questions: first.questionStore.toPersisted() })) as unknown;
    const reloaded = loadSettings(raw).settings;
    expect(reloaded.questions).toHaveLength(1);

    const second = setup({ persisted: reloaded.questions });
    expect(second.questionStore.pendingCount()).toBe(1);
    expect(second.service.getStatus().pending_questions).toBe(1);

    const view = await second.service.questions.get(id);
    expect(view).toMatchObject({ status: "pending", answers: { "Which color?": "Azul" } });
    expect(view?.expires_at).not.toBeNull();

    // the open prompt and the toggled option survived: type the text, then Send
    const prompt = first.questionStore.get(id)?.items[1]?.promptMessageId ?? -1;
    expect(await second.reply("XL", prompt)).toBe(true);
    await second.press(id, 1, "s");
    expect(await second.service.questions.get(id)).toMatchObject({
      status: "answered",
      answers: { "Which color?": "Azul", "Which sizes?": ["M", "XL"] },
      free_text: { "Which sizes?": true },
    });
  });

  it("drops unusable persisted records", () => {
    const loaded = loadSettings({ questions: [null, 3, { id: "x" }, { id: "q", status: "pending", chatId: "1", createdAt: 1, items: [] }] });
    expect(loaded.settings.questions).toEqual([]);
    expect(loadSettings({}).settings.questions).toEqual([]);
  });

  it("the poller keeps running while a question is pending and asks Telegram for buttons and messages", async () => {
    const calls: any[] = [];
    const clock = new MockClock();
    const store = new QuestionStore({ clock });
    let running = true;
    const poller = new LongPoller({
      api: {
        getUpdates: async (params) => {
          calls.push(params);
          running = false;
          return [];
        },
      },
      clock,
      shouldRun: () => running && store.pendingCount() > 0,
      onUpdates: () => {},
    });
    store.create({ items: [{ question: "q", header: "", options: [{ label: "a" }, { label: "b" }], multiSelect: false }], chatId: OWNER, allowFreeText: true, requester: "x", lang: "en" });
    poller.ensureRunning();
    await poller.whenStopped();
    expect(calls).toHaveLength(1);
    expect(calls[0].allowed_updates).toEqual(expect.arrayContaining(["callback_query", "message"]));
  });
});

describe("questions: invalid input", () => {
  const ok = { question: "Q?", options: [{ label: "a" }, { label: "b" }] };

  async function refused(questions: unknown, fragment: string) {
    const { service, sent } = setup();
    await expect(service.questions.ask({ questions })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining(fragment),
    });
    expect(sent).toHaveLength(0);
  }

  it("refuses 0 and 5 questions", async () => {
    await refused([], "1 to 4 questions");
    await refused(undefined, "1 to 4 questions");
    await refused([1, 2, 3, 4, 5].map((n) => ({ ...ok, question: `Q${n}` })), "1 to 4 questions");
  });

  it("refuses 1 and 5 options", async () => {
    await refused([{ question: "Q?", options: [{ label: "a" }] }], "2 to 4 options");
    await refused([{ question: "Q?", options: ["a", "b", "c", "d", "e"].map((label) => ({ label })) }], "2 to 4 options");
  });

  it("refuses a header longer than 12 characters", async () => {
    await refused([{ ...ok, header: "1234567890123" }], "'header' must be a text of up to 12 characters");
    const { service } = setup();
    await expect(service.questions.ask({ questions: [{ ...ok, header: "123456789012" }] })).resolves.toMatchObject({ status: "pending" });
  });

  it("refuses empty texts, duplicates and wrong types", async () => {
    await refused(["text"], "must be an object");
    await refused([{ ...ok, question: "  " }], "'question' must be a non-empty text");
    await refused([ok, ok], "repeats the text of another question");
    await refused([{ question: "Q?", options: [{ label: "a" }, { label: "a" }] }], "two options have the label 'a'");
    await refused([{ question: "Q?", options: [{ label: "a" }, { label: "" }] }], "option 2: 'label'");
    await refused([{ question: "Q?", options: [{ label: "a" }, { label: "b", description: 5 }] }], "'description'");
    await refused([{ ...ok, multiSelect: "yes" }], "'multiSelect' must be true or false");
    await refused([{ question: "x".repeat(1001), options: ok.options }], "'question' must be a non-empty text");
  });

  it("refuses a title that is too long and accepts bare string options", async () => {
    const { service } = setup();
    await expect(service.questions.ask({ questions: [ok], title: "t".repeat(101) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.questions.ask({ questions: [{ question: "Q?", options: ["a", "b"] }] })).resolves.toMatchObject({ status: "pending" });
  });

  it("writes the error in Portuguese when the interface language is Portuguese", async () => {
    setMockLanguage("pt");
    try {
      await refused([], "1 a 4 perguntas");
    } finally {
      setMockLanguage("en");
    }
  });
});

describe("questions: policy and settings", () => {
  const question = [COLORS];

  it("returns a clear error and sends nothing without a token or an owner chat id", async () => {
    const noToken = setup({ settings: { botToken: "" } });
    await expect(noToken.service.questions.ask({ questions: question })).rejects.toThrow("token is not configured");
    const noOwner = setup({ settings: { chatId: "" } });
    await expect(noOwner.service.questions.ask({ questions: question })).rejects.toThrow("owner Chat ID is not configured");
    expect(noToken.sent).toHaveLength(0);
    expect(noOwner.sent).toHaveLength(0);
  });

  it("follows allowAiSend, quiet hours (urgent passes) and the rate limit like approvals", async () => {
    const off = setup({ settings: { allowAiSend: false } });
    await expect(off.service.questions.ask({ questions: question })).rejects.toMatchObject({ statusCode: 403 });

    // 23:00 local time, inside the quiet hours
    const quiet = setup({ settings: { enableQuietHours: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" } });
    quiet.clock.currentTime = new Date(2026, 0, 15, 23, 0, 0).getTime();
    await expect(quiet.service.questions.ask({ questions: question })).rejects.toThrow("Quiet hours active");
    await expect(quiet.service.questions.ask({ questions: question, urgent: true })).resolves.toMatchObject({ status: "pending" });

    const limited = setup({ settings: { minCooldownSeconds: 30 } });
    await limited.service.questions.ask({ questions: question });
    await expect(limited.service.questions.ask({ questions: question })).rejects.toMatchObject({ statusCode: 429 });
  });

  it("counts as pedidos_aprovacao in the notify events", async () => {
    const { service, sent } = setup({ settings: { notifyEvents: ["avisos"] } });
    await expect(service.questions.ask({ questions: question })).rejects.toMatchObject({ statusCode: 403, message: expect.stringContaining("pedidos_aprovacao") });
    expect(sent).toHaveLength(0);
  });

  it("uses the owner chat, or a chat from the allowed list", async () => {
    const owner = setup();
    expect((await owner.service.questions.ask({ questions: question, chatId: "777" })).recipient).toBe(OWNER);

    const open = setup({ settings: { restrictToOwnerOnly: false, allowedChatIds: "777, 888" } });
    expect((await open.service.questions.ask({ questions: question, chatId: "777" })).recipient).toBe("777");
    await expect(open.service.questions.ask({ questions: question, chatId: "555" })).rejects.toMatchObject({ statusCode: 403 });
    // the allowed chat is the one that may answer, not the owner chat
    const { id } = await open.service.questions.ask({ questions: question, chatId: "888" });
    await open.press(id, 0, "o0", OWNER);
    expect((await open.service.questions.get(id))?.status).toBe("pending");
    await open.press(id, 0, "o0", "888");
    expect((await open.service.questions.get(id))?.status).toBe("answered");
  });

  it("records the request and the answer in the history and the Inspector, and counts pending questions", async () => {
    const { service, settings, press } = setup();
    const { id } = await service.questions.ask({ questions: question });
    expect(settings.recentHistory[0]).toMatchObject({ outcome: "requested", recipient: OWNER });
    expect(service.getStatus().pending_questions).toBe(1);
    await press(id, 0, "o0");
    expect(settings.recentHistory[0]).toMatchObject({ outcome: "answered", sender: "Telegram" });
    expect(service.getStatus().pending_questions).toBe(0);
  });

  it("interrupts the messages already sent when a later message fails, and keeps nothing pending", async () => {
    const { service, questionStore, lastEdit, settings } = setup({ failSend: 2 });
    await expect(service.questions.ask({ questions: [COLORS, { ...COLORS, question: "Two?" }] })).rejects.toThrow("network down");
    expect(questionStore.list()).toHaveLength(0);
    expect(lastEdit(1001).text).toContain("Interrupted (the request could not be sent)");
    expect(lastEdit(1001).reply_markup).toBeUndefined();
    expect(settings.recentHistory[0]).toMatchObject({ outcome: "failed" });
  });
});

describe("questions: tools and routes", () => {
  const ctx = { client: { name: "Claude Code" } as any, moduleId: "telegram-ai-gateway" };

  it("registers the three tools next to the approval tools", () => {
    const { service } = setup();
    const names = buildTools(service, false).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "telegram_send_message",
        "telegram_ask_approval",
        "telegram_get_approval",
        "telegram_resolve_approval",
        "telegram_ask_question",
        "telegram_get_question",
        "telegram_resolve_question",
      ]),
    );
    const ask = buildTools(service, true).find((tool) => tool.name === "telegram_ask_question");
    expect((ask?.inputSchema as any).required).toEqual(["questions"]);
    expect(ask?.description).toContain("Never expires");
    expect(ask?.description).toContain("wait_seconds");
    expect((ask?.inputSchema as any).properties.wait_seconds).toBeDefined();
    expect((ask?.inputSchema as any).properties.verbose).toBeDefined();
  });

  it("registers the three routes next to the approval routes", () => {
    const { service } = setup();
    const keys = buildRoutes(service).map((route) => `${route.method} ${route.path}`);
    expect(keys).toEqual(expect.arrayContaining(["POST /approval", "POST /question", "GET /question/:id", "POST /question/resolve"]));
  });

  it("asks, reads and resolves through the tools", async () => {
    const { service, press } = setup();
    const tools = new Map(buildTools(service, false).map((tool) => [tool.name, tool]));

    const asked = await tools.get("telegram_ask_question")!.handler({ questions: [COLORS, SIZES], title: "T" }, ctx);
    const { id } = JSON.parse((asked.content[0] as any).text);
    expect(asked.structuredContent).toBeUndefined();
    expect(JSON.parse((asked.content[0] as any).text)).toEqual({ id, status: "pending" });
    const askedVerbose = await tools.get("telegram_ask_question")!.handler({ questions: [COLORS], verbose: true }, ctx);
    expect(askedVerbose.structuredContent).toMatchObject({ success: true, status: "pending", messages: 1 });

    await press(id, 0, "x");
    const pending = await tools.get("telegram_get_question")!.handler({ id, wait: 0 }, ctx);
    expect(JSON.parse((pending.content[0] as any).text)).toEqual({ id, status: "pending" });

    const resolved = await tools.get("telegram_resolve_question")!.handler({ id, status: "answered_elsewhere" }, ctx);
    expect(resolved.structuredContent).toMatchObject({ success: true });

    const final = await tools.get("telegram_get_question")!.handler({ id, wait: 0 }, ctx);
    expect(JSON.parse((final.content[0] as any).text)).toMatchObject({ id, status: "answered", answers: expect.any(Object) });
    const finalVerbose = await tools.get("telegram_get_question")!.handler({ id, wait: 0, verbose: true }, ctx);
    expect(finalVerbose.structuredContent).toMatchObject({ status: "answered", decided_by: "resolve" });

    const missing = await tools.get("telegram_get_question")!.handler({ id: "qst_nope", wait: 0 }, ctx);
    expect(missing.isError).toBe(true);
    const invalid = await tools.get("telegram_ask_question")!.handler({ questions: [] }, ctx);
    expect(invalid.isError).toBe(true);
    expect((invalid.content[0] as any).text).toContain("1 to 4 questions");
  });

  it("wait_seconds blocks until the question is answered and the approval tool is slim", async () => {
    const { service, press, clock, questionStore } = setup();
    const tools = new Map(buildTools(service, false).map((tool) => [tool.name, tool]));

    const p = tools.get("telegram_ask_question")!.handler({ questions: [COLORS], wait_seconds: 120 }, ctx);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const id = questionStore.newestPending()!.id;
    await press(id, 0, "o1");
    const done = JSON.parse(((await p).content[0] as any).text);
    expect(done).toMatchObject({ id, status: "answered" });
    expect(done.answers).toBeDefined();

    const ap = tools.get("telegram_ask_approval")!;
    const waiting = ap.handler({ message: "ok?", wait_seconds: 60 }, ctx);
    await new Promise((r) => setTimeout(r, 0));
    const pending = (service as any).deps.store.newestPending();
    await service.resolveApproval({ id: pending.id, status: "approved", choice: "Aprovar" });
    expect(JSON.parse(((await waiting).content[0] as any).text)).toEqual({ id: pending.id, status: "approved", choice: "Aprovar" });

    const timeout = ap.handler({ message: "again?", wait_seconds: 5 }, ctx);
    await new Promise((r) => setTimeout(r, 0));
    clock.advance(6000);
    const res = JSON.parse(((await timeout).content[0] as any).text);
    expect(res.status).toBe("pending");
    expect(Object.keys(res).sort()).toEqual(["id", "status"]);
    const got = await tools.get("telegram_get_approval")!.handler({ id: res.id, wait: 0, verbose: true }, ctx);
    expect(got.structuredContent).toMatchObject({ id: res.id, status: "pending", options: expect.any(Array) });
  });

  it("asks, reads and resolves through the routes", async () => {
    const { service, press } = setup();
    const routes = new Map(buildRoutes(service).map((route) => [`${route.method} ${route.path}`, route]));
    const req = (body?: unknown, params: Record<string, string> = {}, query: Record<string, string> = {}) =>
      ({ body, params, query, client: { name: "script" } }) as any;

    const asked = await routes.get("POST /question")!.handler(req({ questions: [COLORS], expires_in_minutes: 10 }));
    expect(asked.status).toBe(202);
    const id = (asked.body as any).id as string;

    await press(id, 0, "o0");
    const read = await routes.get("GET /question/:id")!.handler(req(undefined, { id }, { wait: "0" }));
    expect(read).toMatchObject({ status: 200, body: { status: "answered", answers: { "Which color?": "Azul" } } });

    expect((await routes.get("GET /question/:id")!.handler(req(undefined, { id: "qst_nope" }))).status).toBe(404);
    expect((await routes.get("POST /question")!.handler(req({ questions: [] }))).status).toBe(400);
    expect((await routes.get("POST /question/resolve")!.handler(req({ status: "interrupted" }))).status).toBe(404);
  });
});

describe("questions: store and texts", () => {
  it("waits for the end of the request and times out as pending", async () => {
    const clock = new MockClock();
    const store = new QuestionStore({ clock });
    const request = store.create({
      items: [{ question: "q", header: "", options: [{ label: "a" }, { label: "b" }], multiSelect: false }],
      chatId: OWNER,
      allowFreeText: true,
      requester: "x",
      lang: "en",
    });
    const timedOut = store.wait(request.id, 5);
    clock.advance(5500);
    expect((await timedOut)?.status).toBe("pending");

    const done = store.wait(request.id, 5);
    store.answer(request.id, 0, "a", false);
    expect((await done)?.status).toBe("answered");
    expect(await store.wait("unknown", 1)).toBeUndefined();
  });

  it("keeps a free text button label and the Send button in the keyboard", () => {
    const { questionStore } = setup();
    const request = questionStore.create({
      items: [{ question: "q", header: "", options: [{ label: "a" }, { label: "b" }], multiSelect: true }],
      chatId: OWNER,
      allowFreeText: true,
      requester: "x",
      lang: "pt",
    });
    questionStore.toggle(request.id, 0, 1);
    questionStore.setExtra(request.id, 0, "talvez");
    const labels = buildQuestionKeyboard(request, 0).inline_keyboard.flat().map((b) => b.text);
    expect(labels).toEqual(["☐ 1. a", "☑ 2. b", "Outro: talvez", "Enviar"]);
  });

  it("has every question string in both languages", () => {
    const { en, pt } = allStrings();
    const keys = Object.keys(en).filter((key) => key.startsWith("question."));
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) expect(pt[key], key).toBeTruthy();
    expect(Object.keys(pt).filter((key) => key.startsWith("question.")).sort()).toEqual(keys.sort());
  });
});
