// In-memory store of question requests with a persisted copy. Same shape as the approval store
// (src/approvals/store.ts): pure logic, no Obsidian, no network. A question is made of several
// items, each answered on its own; the request is decided when the last item is answered or when
// the caller, the expiry or a shutdown ends it.
import { MAX_WAIT_SECONDS } from "../approvals/store";
import type { DecisionSource } from "../approvals/types";
import type { Clock, TimerHandle } from "../util/clock";
import { isRecord } from "../util/guards";
import type { PersistedQuestion, QuestionItem, QuestionOption, QuestionRequest, QuestionStatus } from "./types";

const MAX_DECIDED = 50;
const DECIDED_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 200;

export interface NewQuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface NewQuestion {
  items: NewQuestionItem[];
  chatId: string;
  title?: string;
  context?: string;
  allowFreeText: boolean;
  requester: string;
  lang: "en" | "pt";
  /** Leave undefined for a question that never expires. */
  expiresInMs?: number;
}

export interface QuestionDecision {
  status: Exclude<QuestionStatus, "pending">;
  decidedBy: DecisionSource;
  detail?: string;
}

export type QuestionListener = (request: QuestionRequest) => void;

interface Waiter {
  id: string;
  resolve: (request: QuestionRequest | undefined) => void;
  timer: TimerHandle;
}

export interface QuestionStoreOptions {
  clock: Clock;
  /** Called after every change so the owner can persist (debounced by the caller). */
  onChange?: () => void;
  newId?: () => string;
}

function randomId(): string {
  const bytes = new Uint8Array(6);
  window.crypto.getRandomValues(bytes);
  return `qst_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const STATUSES: readonly QuestionStatus[] = ["pending", "answered", "expired", "interrupted"];

function parseItem(raw: unknown): QuestionItem | undefined {
  if (!isRecord(raw) || typeof raw.question !== "string" || !Array.isArray(raw.options)) return undefined;
  const options: QuestionOption[] = [];
  for (const option of raw.options) {
    if (!isRecord(option) || typeof option.label !== "string") continue;
    options.push({ label: option.label, ...(typeof option.description === "string" ? { description: option.description } : {}) });
  }
  const item: QuestionItem = {
    question: raw.question,
    header: typeof raw.header === "string" ? raw.header : "",
    options,
    multiSelect: raw.multiSelect === true,
    selected: Array.isArray(raw.selected)
      ? raw.selected.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < options.length)
      : [],
  };
  if (typeof raw.messageId === "number") item.messageId = raw.messageId;
  if (typeof raw.extra === "string" && raw.extra !== "") item.extra = raw.extra;
  if (typeof raw.promptMessageId === "number") item.promptMessageId = raw.promptMessageId;
  if (typeof raw.answer === "string") item.answer = raw.answer;
  else if (Array.isArray(raw.answer)) item.answer = raw.answer.filter((a): a is string => typeof a === "string");
  if (raw.freeText === true) item.freeText = true;
  return item;
}

/** Validates one persisted record; undefined when it is unusable. */
export function parsePersistedQuestion(raw: unknown): PersistedQuestion | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, status, chatId, requester, createdAt, lang } = raw;
  if (typeof id !== "string" || id === "") return undefined;
  if (typeof status !== "string" || !STATUSES.includes(status as QuestionStatus)) return undefined;
  if (typeof chatId !== "string" || typeof createdAt !== "number" || !Array.isArray(raw.items)) return undefined;
  const items: QuestionItem[] = [];
  for (const rawItem of raw.items) {
    const item = parseItem(rawItem);
    if (item) items.push(item);
  }
  if (items.length === 0) return undefined;
  const request: PersistedQuestion = {
    id,
    status: status as QuestionStatus,
    items,
    chatId,
    allowFreeText: raw.allowFreeText !== false,
    requester: typeof requester === "string" ? requester : "",
    createdAt,
    lang: lang === "pt" ? "pt" : "en",
  };
  if (typeof raw.title === "string" && raw.title !== "") request.title = raw.title;
  if (typeof raw.context === "string" && raw.context !== "") request.context = raw.context;
  if (typeof raw.expiresAt === "number") request.expiresAt = raw.expiresAt;
  if (typeof raw.decidedAt === "number") request.decidedAt = raw.decidedAt;
  if (typeof raw.detail === "string") request.detail = raw.detail;
  if (raw.decidedBy === "telegram" || raw.decidedBy === "resolve" || raw.decidedBy === "expired" || raw.decidedBy === "shutdown") {
    request.decidedBy = raw.decidedBy;
  }
  return request;
}

export class QuestionStore {
  private readonly items = new Map<string, QuestionRequest>();
  private readonly waiters = new Set<Waiter>();
  private readonly listeners = new Set<QuestionListener>();
  private readonly clock: Clock;
  private readonly newId: () => string;
  private readonly onChange: (() => void) | undefined;

  constructor(options: QuestionStoreOptions, persisted: unknown = []) {
    this.clock = options.clock;
    this.onChange = options.onChange;
    this.newId = options.newId ?? randomId;
    if (Array.isArray(persisted)) {
      for (const raw of persisted) {
        const request = parsePersistedQuestion(raw);
        if (request) this.items.set(request.id, request);
      }
    }
    this.prune();
  }

  /** Registers a pending question. The message ids are filled in once Telegram accepted each message. */
  create(input: NewQuestion): QuestionRequest {
    const now = this.clock.now();
    const request: QuestionRequest = {
      id: this.uniqueId(),
      status: "pending",
      items: input.items.map((item) => ({
        question: item.question,
        header: item.header,
        options: item.options.map((o) => ({ ...o })),
        multiSelect: item.multiSelect,
        selected: [],
      })),
      chatId: input.chatId,
      allowFreeText: input.allowFreeText,
      requester: input.requester,
      createdAt: now,
      lang: input.lang,
    };
    if (input.title) request.title = input.title;
    if (input.context) request.context = input.context;
    if (input.expiresInMs && input.expiresInMs > 0) request.expiresAt = now + input.expiresInMs;
    this.items.set(request.id, request);
    this.changed();
    return request;
  }

  /** Forgets a request that never fully reached Telegram. */
  discard(id: string): void {
    if (this.items.delete(id)) this.changed();
  }

  attachMessage(id: string, index: number, messageId: number): void {
    const item = this.items.get(id)?.items[index];
    if (!item) return;
    item.messageId = messageId;
    this.changed();
  }

  get(id: string): QuestionRequest | undefined {
    return this.items.get(id);
  }

  list(): QuestionRequest[] {
    return [...this.items.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  pending(): QuestionRequest[] {
    return this.list().filter((q) => q.status === "pending");
  }

  /** The newest pending request, or undefined. */
  newestPending(): QuestionRequest | undefined {
    return this.pending()[0];
  }

  pendingCount(): number {
    let count = 0;
    for (const request of this.items.values()) if (request.status === "pending") count++;
    return count;
  }

  /** The pending request and item waiting for typed text in reply to this prompt message. */
  findPrompt(chatId: string, promptMessageId: number): { request: QuestionRequest; index: number } | undefined {
    for (const request of this.pending()) {
      if (request.chatId !== chatId) continue;
      const index = request.items.findIndex((item) => item.promptMessageId === promptMessageId && item.answer === undefined);
      if (index >= 0) return { request, index };
    }
    return undefined;
  }

  /** multiSelect: flips one option. Returns undefined unless the item is open and takes that option. */
  toggle(id: string, index: number, option: number): QuestionItem | undefined {
    const item = this.openItem(id, index);
    if (!item || !item.multiSelect || option < 0 || option >= item.options.length) return undefined;
    item.selected = item.selected.includes(option) ? item.selected.filter((n) => n !== option) : [...item.selected, option].sort((a, b) => a - b);
    this.changed();
    return item;
  }

  /** multiSelect: stores the typed text that goes with the selected options. */
  setExtra(id: string, index: number, text: string): QuestionItem | undefined {
    const item = this.openItem(id, index);
    if (!item || !item.multiSelect) return undefined;
    item.extra = text;
    item.promptMessageId = undefined;
    this.changed();
    return item;
  }

  /** Remembers the message that asks for typed text (undefined clears it). */
  setPrompt(id: string, index: number, messageId: number | undefined): QuestionItem | undefined {
    const item = this.openItem(id, index);
    if (!item) return undefined;
    item.promptMessageId = messageId;
    this.changed();
    return item;
  }

  /**
   * Records the answer of one item. The request is decided as answered when it was the last open
   * item. Returns undefined when the request is no longer pending or the item already has an answer
   * (the first answer wins when buttons and typed text race).
   */
  answer(
    id: string,
    index: number,
    answer: string | string[],
    freeText: boolean,
  ): { request: QuestionRequest; completed: boolean } | undefined {
    const request = this.items.get(id);
    const item = this.openItem(id, index);
    if (!request || !item) return undefined;
    item.answer = answer;
    item.promptMessageId = undefined;
    if (freeText) item.freeText = true;
    if (request.items.every((i) => i.answer !== undefined)) {
      this.decide(id, { status: "answered", decidedBy: "telegram" });
      return { request, completed: true };
    }
    this.changed();
    return { request, completed: false };
  }

  /**
   * Ends the request. Only a pending request can be decided; returns undefined otherwise (so the
   * first outcome wins when Telegram, the terminal and the expiry race).
   */
  decide(id: string, decision: QuestionDecision): QuestionRequest | undefined {
    const request = this.items.get(id);
    if (!request || request.status !== "pending") return undefined;
    request.status = decision.status;
    request.decidedAt = this.clock.now();
    request.decidedBy = decision.decidedBy;
    if (decision.detail !== undefined && decision.detail !== "") request.detail = decision.detail;
    for (const item of request.items) item.promptMessageId = undefined;
    this.releaseWaitersFor(id, request);
    this.prune();
    this.changed();
    for (const listener of this.listeners) listener(request);
    return request;
  }

  /** Pending requests whose expiry time has passed. The caller decides them as "expired". */
  due(): QuestionRequest[] {
    const now = this.clock.now();
    return this.pending().filter((q) => q.expiresAt !== undefined && q.expiresAt <= now);
  }

  /**
   * Waits for the end of the request. Resolves right away when it is already decided, with the
   * pending state after `seconds` (capped at 25), or with undefined when the id is unknown.
   */
  wait(id: string, seconds: number): Promise<QuestionRequest | undefined> {
    const request = this.items.get(id);
    if (!request || request.status !== "pending") return Promise.resolve(request);
    const capped = Math.min(MAX_WAIT_SECONDS, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
    if (capped === 0) return Promise.resolve(request);
    return new Promise((resolve) => {
      const waiter: Waiter = {
        id,
        resolve,
        timer: this.clock.setTimeout(() => {
          this.waiters.delete(waiter);
          resolve(this.items.get(id));
        }, capped * 1000),
      };
      this.waiters.add(waiter);
    });
  }

  /** Subscribes to decisions; returns an unsubscribe function. */
  onDecision(listener: QuestionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ends every wait with the current state (plugin unload). */
  releaseWaiters(): void {
    for (const waiter of [...this.waiters]) {
      this.clock.clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(this.items.get(waiter.id));
    }
  }

  /** The records to persist: every pending request plus the recently decided ones. */
  toPersisted(): PersistedQuestion[] {
    return this.list().map((q) => ({
      ...q,
      items: q.items.map((item) => ({
        ...item,
        options: item.options.map((o) => ({ ...o })),
        selected: [...item.selected],
        ...(Array.isArray(item.answer) ? { answer: [...item.answer] } : {}),
      })),
    }));
  }

  private openItem(id: string, index: number): QuestionItem | undefined {
    const request = this.items.get(id);
    if (!request || request.status !== "pending") return undefined;
    const item = request.items[index];
    return item && item.answer === undefined ? item : undefined;
  }

  private uniqueId(): string {
    let id = this.newId();
    while (this.items.has(id)) id = this.newId();
    return id;
  }

  private releaseWaitersFor(id: string, request: QuestionRequest): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.id !== id) continue;
      this.clock.clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(request);
    }
  }

  /** Drops old decided records (kept 24 h, at most 50) and caps runaway pending lists. */
  private prune(): void {
    const now = this.clock.now();
    const decided = this.list().filter((q) => q.status !== "pending");
    decided.forEach((q, index) => {
      const at = q.decidedAt ?? q.createdAt;
      if (index >= MAX_DECIDED || now - at > DECIDED_RETENTION_MS) this.items.delete(q.id);
    });
    const pending = this.pending();
    for (const stale of pending.slice(MAX_PENDING)) this.items.delete(stale.id);
  }

  private changed(): void {
    this.onChange?.();
  }
}
