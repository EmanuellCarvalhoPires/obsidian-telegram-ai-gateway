// data.json of the plugin: types, defaults, normalization and the migration from 1.0.
//
// The bot token is the only secret here. It lives in `botToken` (plaintext) OR as a secret
// placeholder in `botTokenPlaceholder` (Environment Keys holds the value), never both.
import { parsePersistedApproval } from "../approvals/store";
import type { PersistedApproval } from "../approvals/types";
import { parsePersistedQuestion } from "../questions/store";
import type { PersistedQuestion } from "../questions/types";
import { asBoolean, asInt, asString, isRecord } from "../util/guards";

export const SETTINGS_SCHEMA_VERSION = 2;

export const DEFAULT_QUEUE_PATH = ".telegram-queue";

export type MessageLanguageSetting = "auto" | "en" | "pt";

export type HistoryOutcome =
  | "sent"
  | "blocked"
  | "failed"
  | "requested"
  | "approved"
  | "rejected"
  | "answered"
  | "interrupted";

export interface HistoryEntry {
  /** Epoch milliseconds; 0 for entries migrated from 1.0 (see legacyTime). */
  at: number;
  sender: string;
  outcome: HistoryOutcome;
  /** Short explanation, e.g. the reason a message was blocked. */
  detail: string;
  recipient: string;
  snippet: string;
  /** "date time" text of an entry migrated from 1.0. */
  legacyTime?: string;
}

export const NOTIFY_EVENTS = ["conclusao_desenvolvimento", "pedidos_aprovacao", "avisos"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export function isNotifyEvent(value: unknown): value is NotifyEvent {
  return typeof value === "string" && (NOTIFY_EVENTS as readonly string[]).includes(value);
}

export interface GatewaySettings {
  schemaVersion: number;

  // Bot
  /** Plaintext token. Empty when the token is held by Environment Keys or not set. */
  botToken: string;
  /** "{{secret:NAME}}" when Environment Keys holds the token. */
  botTokenPlaceholder: string;
  chatId: string;

  // File queue (vault-internal, no network)
  enableFileQueue: boolean;
  fileQueuePath: string;

  // Limits for AI senders
  allowAiSend: boolean;
  restrictToOwnerOnly: boolean;
  allowedChatIds: string;
  maxMessagesPerHour: number;
  maxMessagesPerMinute: number;
  minCooldownSeconds: number;
  maxCharactersPerMessage: number;
  aiMessagePrefix: string;
  enableAiPrefix: boolean;
  enableQuietHours: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  allowUrgentInQuietHours: boolean;

  // Messages and approvals
  /** Language of the words written into Telegram messages (status line and notes). */
  messageLanguage: MessageLanguageSetting;
  /** Pending approvals expire after this many minutes (0 = never). */
  approvalExpiryMinutes: number;
  /** Lets agents use templates when the AI Templates plugin is active. */
  allowTemplates: boolean;

  /** Events the user wants to hear about (guided setup answer; informational for now). */
  notifyEvents: NotifyEvent[];

  // State
  recentHistory: HistoryEntry[];
  approvals: PersistedApproval[];
  /** Questions asked through telegram_ask_question (pending ones survive a reload). */
  questions: PersistedQuestion[];
}

export const DEFAULT_SETTINGS: GatewaySettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  botToken: "",
  botTokenPlaceholder: "",
  chatId: "",
  enableFileQueue: true,
  fileQueuePath: DEFAULT_QUEUE_PATH,
  allowAiSend: true,
  restrictToOwnerOnly: true,
  allowedChatIds: "",
  maxMessagesPerHour: 20,
  maxMessagesPerMinute: 5,
  minCooldownSeconds: 5,
  maxCharactersPerMessage: 3500,
  aiMessagePrefix: "[Claude Code]: ",
  enableAiPrefix: true,
  enableQuietHours: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  allowUrgentInQuietHours: true,
  messageLanguage: "auto",
  approvalExpiryMinutes: 1440,
  allowTemplates: true,
  notifyEvents: [...NOTIFY_EVENTS],
  recentHistory: [],
  approvals: [],
  questions: [],
};

export const LIMITS = {
  perMinute: { min: 1, max: 120 },
  perHour: { min: 1, max: 3600 },
  cooldown: { min: 0, max: 3600 },
  characters: { min: 50, max: 20000 },
  expiryMinutes: { min: 0, max: 10080 },
} as const;

export const MAX_HISTORY = 15;

/** Keys that only existed in 1.0 (local server and its token). They are dropped on migration. */
export const REMOVED_KEYS = ["enableLocalServer", "serverPort", "aiAuthToken"] as const;

const PLACEHOLDER_PATTERN = /^\{\{secret:[A-Za-z0-9_.-]+\}\}$/;
const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function isSecretPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value.trim());
}

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value.trim());
}

export interface LoadResult {
  settings: GatewaySettings;
  /** True when the data came from 1.0 (or earlier) and was converted. */
  migrated: boolean;
  /** 1.0 keys that were found and dropped. */
  droppedKeys: string[];
}

function normalizeHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: HistoryEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const snippet = asString(raw.snippet) ?? "";
    const sender = asString(raw.sender) ?? "";
    const recipient = asString(raw.recipient) ?? "";
    if (typeof raw.outcome === "string") {
      const outcomes: HistoryOutcome[] = ["sent", "blocked", "failed", "requested", "approved", "rejected", "answered", "interrupted"];
      const outcome = outcomes.find((o) => o === raw.outcome) ?? "failed";
      out.push({
        at: typeof raw.at === "number" ? raw.at : 0,
        sender,
        outcome,
        detail: asString(raw.detail) ?? "",
        recipient,
        snippet,
        ...(typeof raw.legacyTime === "string" ? { legacyTime: raw.legacyTime } : {}),
      });
      continue;
    }
    // 1.0 entry: { time, date, sender, status, recipient, snippet } with a free-text status.
    const status = asString(raw.status) ?? "";
    const lowered = status.toLowerCase();
    const outcome: HistoryOutcome = lowered.startsWith("sucesso")
      ? "sent"
      : lowered.startsWith("bloqueado")
        ? "blocked"
        : "failed";
    out.push({
      at: 0,
      sender,
      outcome,
      detail: status,
      recipient,
      snippet,
      legacyTime: `${asString(raw.date) ?? ""} ${asString(raw.time) ?? ""}`.trim(),
    });
  }
  return out.slice(0, MAX_HISTORY);
}

function normalizeApprovals(value: unknown): PersistedApproval[] {
  if (!Array.isArray(value)) return [];
  const out: PersistedApproval[] = [];
  for (const raw of value) {
    const approval = parsePersistedApproval(raw);
    if (approval) out.push(approval);
  }
  return out;
}

function normalizeQuestions(value: unknown): PersistedQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: PersistedQuestion[] = [];
  for (const raw of value) {
    const question = parsePersistedQuestion(raw);
    if (question) out.push(question);
  }
  return out;
}

function normalizeTime(value: unknown, fallback: string): string {
  return typeof value === "string" && isValidTime(value) ? value.trim() : fallback;
}

/**
 * Normalizes whatever is in data.json: fills defaults, clamps numbers, converts the 1.0 layout.
 * Never throws. Garbage in, defaults out.
 */
export function loadSettings(raw: unknown): LoadResult {
  const data = isRecord(raw) ? raw : {};
  const defaults = DEFAULT_SETTINGS;

  const hasVersion = typeof data.schemaVersion === "number";
  const looksLegacy =
    !hasVersion && ["botToken", "chatId", "serverPort", "aiAuthToken", "enableLocalServer", "recentHistory"].some((k) => k in data);
  const droppedKeys = REMOVED_KEYS.filter((k) => k in data);
  const migrated = looksLegacy || (hasVersion && (data.schemaVersion as number) < SETTINGS_SCHEMA_VERSION);

  let botToken = (asString(data.botToken) ?? "").trim();
  let botTokenPlaceholder = (asString(data.botTokenPlaceholder) ?? "").trim();
  // A placeholder typed into the old plaintext field is a placeholder.
  if (botToken && isSecretPlaceholder(botToken)) {
    if (!botTokenPlaceholder) botTokenPlaceholder = botToken;
    botToken = "";
  }
  if (!isSecretPlaceholder(botTokenPlaceholder)) botTokenPlaceholder = "";
  // Never both: the placeholder wins and the stale plaintext is dropped.
  if (botTokenPlaceholder) botToken = "";

  const messageLanguage: MessageLanguageSetting =
    data.messageLanguage === "en" || data.messageLanguage === "pt" || data.messageLanguage === "auto"
      ? data.messageLanguage
      : looksLegacy
        ? "pt" // 1.0 messages followed the Portuguese status convention of the vault
        : defaults.messageLanguage;

  const settings: GatewaySettings = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    botToken,
    botTokenPlaceholder,
    chatId: (asString(data.chatId) ?? "").trim(),
    enableFileQueue: asBoolean(data.enableFileQueue, defaults.enableFileQueue),
    fileQueuePath: (asString(data.fileQueuePath) ?? "").trim() || defaults.fileQueuePath,
    allowAiSend: asBoolean(data.allowAiSend, defaults.allowAiSend),
    restrictToOwnerOnly: asBoolean(data.restrictToOwnerOnly, defaults.restrictToOwnerOnly),
    allowedChatIds: asString(data.allowedChatIds) ?? defaults.allowedChatIds,
    maxMessagesPerHour: asInt(data.maxMessagesPerHour, LIMITS.perHour.min, LIMITS.perHour.max, defaults.maxMessagesPerHour),
    maxMessagesPerMinute: asInt(data.maxMessagesPerMinute, LIMITS.perMinute.min, LIMITS.perMinute.max, defaults.maxMessagesPerMinute),
    minCooldownSeconds: asInt(data.minCooldownSeconds, LIMITS.cooldown.min, LIMITS.cooldown.max, defaults.minCooldownSeconds),
    maxCharactersPerMessage: asInt(
      data.maxCharactersPerMessage,
      LIMITS.characters.min,
      LIMITS.characters.max,
      defaults.maxCharactersPerMessage,
    ),
    aiMessagePrefix: asString(data.aiMessagePrefix) ?? defaults.aiMessagePrefix,
    enableAiPrefix: asBoolean(data.enableAiPrefix, defaults.enableAiPrefix),
    enableQuietHours: asBoolean(data.enableQuietHours, defaults.enableQuietHours),
    quietHoursStart: normalizeTime(data.quietHoursStart, defaults.quietHoursStart),
    quietHoursEnd: normalizeTime(data.quietHoursEnd, defaults.quietHoursEnd),
    allowUrgentInQuietHours: asBoolean(data.allowUrgentInQuietHours, defaults.allowUrgentInQuietHours),
    messageLanguage,
    approvalExpiryMinutes: asInt(
      data.approvalExpiryMinutes,
      LIMITS.expiryMinutes.min,
      LIMITS.expiryMinutes.max,
      defaults.approvalExpiryMinutes,
    ),
    allowTemplates: asBoolean(data.allowTemplates, defaults.allowTemplates),
    notifyEvents: Array.isArray(data.notifyEvents)
      ? [...new Set(data.notifyEvents.filter(isNotifyEvent))]
      : [...defaults.notifyEvents],
    recentHistory: normalizeHistory(data.recentHistory),
    approvals: normalizeApprovals(data.approvals),
    questions: normalizeQuestions(data.questions),
  };
  return { settings, migrated, droppedKeys: [...droppedKeys] };
}
