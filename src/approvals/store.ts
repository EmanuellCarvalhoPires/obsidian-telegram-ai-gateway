// In-memory approval store with a persisted copy. Pure logic: no Obsidian, no network.
import type { Clock, TimerHandle } from "../util/clock";
import { isRecord } from "../util/guards";
import type { Approval, ApprovalOption, ApprovalStatus, DecisionSource, PersistedApproval } from "./types";

export const MAX_WAIT_SECONDS = 300;
const MAX_DECIDED = 50;
const DECIDED_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 200;

export interface NewApproval {
  options: ApprovalOption[];
  chatId: string;
  text: string;
  requester: string;
  lang: "en" | "pt";
  expiresInMs?: number;
}

export interface Decision {
  status: Exclude<ApprovalStatus, "pending">;
  choice?: string;
  decidedBy: DecisionSource;
  detail?: string;
}

export type DecisionListener = (approval: Approval) => void;

interface Waiter {
  id: string;
  resolve: (approval: Approval | undefined) => void;
  timer: TimerHandle;
}

export interface StoreOptions {
  clock: Clock;
  /** Called after every change so the owner can persist (debounced by the caller). */
  onChange?: () => void;
  newId?: () => string;
}

function randomId(): string {
  const bytes = new Uint8Array(6);
  window.crypto.getRandomValues(bytes);
  return `apr_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const STATUSES: readonly ApprovalStatus[] = ["pending", "approved", "rejected", "interrupted"];

/** Validates one persisted record; undefined when it is unusable. */
export function parsePersistedApproval(raw: unknown): PersistedApproval | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, status, chatId, text, requester, createdAt, lang } = raw;
  if (typeof id !== "string" || id === "") return undefined;
  if (typeof status !== "string" || !STATUSES.includes(status as ApprovalStatus)) return undefined;
  if (typeof chatId !== "string" || typeof text !== "string" || typeof createdAt !== "number") return undefined;
  const options: ApprovalOption[] = [];
  if (Array.isArray(raw.options)) {
    for (const option of raw.options) {
      if (!isRecord(option) || typeof option.label !== "string") continue;
      options.push({ label: option.label, outcome: option.outcome === "rejected" ? "rejected" : "approved" });
    }
  }
  const messageIds = Array.isArray(raw.messageIds)
    ? raw.messageIds.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : [];
  const approval: PersistedApproval = {
    id,
    status: status as ApprovalStatus,
    options,
    chatId,
    messageIds,
    text,
    requester: typeof requester === "string" ? requester : "",
    createdAt,
    lang: lang === "pt" ? "pt" : "en",
  };
  if (typeof raw.expiresAt === "number") approval.expiresAt = raw.expiresAt;
  if (typeof raw.decidedAt === "number") approval.decidedAt = raw.decidedAt;
  if (typeof raw.choice === "string") approval.choice = raw.choice;
  if (typeof raw.detail === "string") approval.detail = raw.detail;
  if (raw.decidedBy === "telegram" || raw.decidedBy === "resolve" || raw.decidedBy === "expired" || raw.decidedBy === "shutdown") {
    approval.decidedBy = raw.decidedBy;
  }
  return approval;
}

export class ApprovalStore {
  private readonly items = new Map<string, Approval>();
  private readonly waiters = new Set<Waiter>();
  private readonly listeners = new Set<DecisionListener>();
  private readonly clock: Clock;
  private readonly newId: () => string;
  private readonly onChange: (() => void) | undefined;

  constructor(options: StoreOptions, persisted: unknown = []) {
    this.clock = options.clock;
    this.onChange = options.onChange;
    this.newId = options.newId ?? randomId;
    if (Array.isArray(persisted)) {
      for (const raw of persisted) {
        const approval = parsePersistedApproval(raw);
        if (approval) this.items.set(approval.id, approval);
      }
    }
    this.prune();
  }

  /** Registers a pending approval. The message ids are filled in once Telegram accepted the message. */
  create(input: NewApproval): Approval {
    const now = this.clock.now();
    const approval: Approval = {
      id: this.uniqueId(),
      status: "pending",
      options: input.options,
      chatId: input.chatId,
      messageIds: [],
      text: input.text,
      requester: input.requester,
      createdAt: now,
      lang: input.lang,
    };
    if (input.expiresInMs && input.expiresInMs > 0) approval.expiresAt = now + input.expiresInMs;
    this.items.set(approval.id, approval);
    this.changed();
    return approval;
  }

  /** Forgets an approval that never reached Telegram. */
  discard(id: string): void {
    if (this.items.delete(id)) this.changed();
  }

  attachMessages(id: string, messageIds: number[]): void {
    const approval = this.items.get(id);
    if (!approval) return;
    approval.messageIds = messageIds;
    this.changed();
  }

  get(id: string): Approval | undefined {
    return this.items.get(id);
  }

  list(): Approval[] {
    return [...this.items.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  pending(): Approval[] {
    return this.list().filter((a) => a.status === "pending");
  }

  /** The newest pending approval, or undefined. */
  newestPending(): Approval | undefined {
    return this.pending()[0];
  }

  pendingCount(): number {
    let count = 0;
    for (const approval of this.items.values()) if (approval.status === "pending") count++;
    return count;
  }

  /**
   * Records a decision. Only a pending approval can be decided; returns undefined otherwise (so
   * the first decision wins when Telegram and the terminal race).
   */
  decide(id: string, decision: Decision): Approval | undefined {
    const approval = this.items.get(id);
    if (!approval || approval.status !== "pending") return undefined;
    approval.status = decision.status;
    approval.decidedAt = this.clock.now();
    approval.decidedBy = decision.decidedBy;
    if (decision.choice !== undefined) approval.choice = decision.choice;
    if (decision.detail !== undefined && decision.detail !== "") approval.detail = decision.detail;
    this.releaseWaitersFor(id, approval);
    this.prune();
    this.changed();
    for (const listener of this.listeners) listener(approval);
    return approval;
  }

  /** Pending approvals whose expiry time has passed. The caller decides them as "expired". */
  due(): Approval[] {
    const now = this.clock.now();
    return this.pending().filter((a) => a.expiresAt !== undefined && a.expiresAt <= now);
  }

  /**
   * Waits for a decision. Resolves right away when the approval is already decided, with the
   * pending state after `seconds` (capped at 25), or with undefined when the id is unknown.
   */
  wait(id: string, seconds: number): Promise<Approval | undefined> {
    const approval = this.items.get(id);
    if (!approval || approval.status !== "pending") return Promise.resolve(approval);
    const capped = Math.min(MAX_WAIT_SECONDS, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
    if (capped === 0) return Promise.resolve(approval);
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
  onDecision(listener: DecisionListener): () => void {
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

  /** The records to persist: every pending approval plus the recently decided ones. */
  toPersisted(): PersistedApproval[] {
    return this.list().map((a) => ({ ...a, options: a.options.map((o) => ({ ...o })), messageIds: [...a.messageIds] }));
  }

  private uniqueId(): string {
    let id = this.newId();
    while (this.items.has(id)) id = this.newId();
    return id;
  }

  private releaseWaitersFor(id: string, approval: Approval): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.id !== id) continue;
      this.clock.clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(approval);
    }
  }

  /** Drops old decided records (kept 24 h, at most 50) and caps runaway pending lists. */
  private prune(): void {
    const now = this.clock.now();
    const decided = this.list().filter((a) => a.status !== "pending");
    decided.forEach((a, index) => {
      const at = a.decidedAt ?? a.createdAt;
      if (index >= MAX_DECIDED || now - at > DECIDED_RETENTION_MS) this.items.delete(a.id);
    });
    const pending = this.pending();
    for (const stale of pending.slice(MAX_PENDING)) this.items.delete(stale.id);
  }

  private changed(): void {
    this.onChange?.();
  }
}
