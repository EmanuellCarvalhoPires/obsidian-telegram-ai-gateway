// Enforces AI security limits, rate limiting, quiet hours, recipient restrictions and message prefixing.
import type { GatewaySettings, HistoryEntry, HistoryOutcome } from "../settings/settings";
import { MAX_HISTORY } from "../settings/settings";
import type { MessageLanguage } from "../approvals/status-markers";
import { MESSAGE_TEXT } from "../gateway/message-text";
import type { Clock } from "../util/clock";

export interface PolicyCheckResult {
  allowed: boolean;
  statusCode?: number;
  reason?: string;
}

export interface PreparedMessage {
  targetChatId: string;
  text: string;
}

export class PolicyViolationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 403,
  ) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export class PolicyEngine {
  private sentTimestamps: number[] = [];
  private lastSentTimestamp = 0;

  constructor(
    private readonly getSettings: () => GatewaySettings,
    private readonly clock: Clock,
  ) {}

  /** Checks if AI messages are globally allowed. */
  checkAiAllowed(): void {
    const settings = this.getSettings();
    if (!settings.allowAiSend) {
      throw new PolicyViolationError("AI message sending is disabled in plugin settings.", 403);
    }
  }

  /** Checks quiet hours restrictions. */
  checkQuietHours(isUrgent: boolean): void {
    const settings = this.getSettings();
    if (!settings.enableQuietHours) return;

    if (this.isInQuietHours()) {
      if (!isUrgent || !settings.allowUrgentInQuietHours) {
        throw new PolicyViolationError(
          `Quiet hours active (${settings.quietHoursStart} to ${settings.quietHoursEnd}). Non-urgent messages are blocked.`,
          403,
        );
      }
    }
  }

  /** Rate limiter check (cooldown, per-minute, per-hour). */
  checkRateLimit(): void {
    const settings = this.getSettings();
    const now = this.clock.now();

    const cooldownMs = (settings.minCooldownSeconds || 0) * 1000;
    if (this.lastSentTimestamp > 0 && now - this.lastSentTimestamp < cooldownMs) {
      const waitRemaining = Math.ceil((cooldownMs - (now - this.lastSentTimestamp)) / 1000);
      throw new PolicyViolationError(
        `Cooldown active. Wait ${waitRemaining}s before sending another message.`,
        429,
      );
    }

    const oneHourAgo = now - 3600 * 1000;
    this.sentTimestamps = this.sentTimestamps.filter((t) => t >= oneHourAgo);

    const oneMinuteAgo = now - 60 * 1000;
    const countLastMinute = this.sentTimestamps.filter((t) => t >= oneMinuteAgo).length;
    if (countLastMinute >= settings.maxMessagesPerMinute) {
      throw new PolicyViolationError(
        `Rate limit reached (${settings.maxMessagesPerMinute} msgs/min).`,
        429,
      );
    }

    if (this.sentTimestamps.length >= settings.maxMessagesPerHour) {
      throw new PolicyViolationError(
        `Hourly rate limit reached (${settings.maxMessagesPerHour} msgs/h).`,
        429,
      );
    }
  }

  /** Records that a message was successfully sent for rate limiting purposes. */
  recordSent(): void {
    const now = this.clock.now();
    this.sentTimestamps.push(now);
    this.lastSentTimestamp = now;
  }

  /** Resolves and validates the target Chat ID based on owner-only / allowedChatIds. */
  resolveChatId(requestedChatId?: string, isAi = true): string {
    const settings = this.getSettings();
    const ownerChatId = settings.chatId.trim();

    if (!isAi) {
      const target = (requestedChatId || ownerChatId).trim();
      if (!target) {
        throw new PolicyViolationError("Chat ID is not configured.", 400);
      }
      return target;
    }

    if (settings.restrictToOwnerOnly) {
      if (!ownerChatId) {
        throw new PolicyViolationError("Owner Chat ID is not configured in plugin settings.", 400);
      }
      return ownerChatId;
    }

    const requested = (requestedChatId || "").trim();
    if (requested) {
      const allowedList = settings.allowedChatIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (allowedList.length > 0 && !allowedList.includes(requested) && requested !== ownerChatId) {
        throw new PolicyViolationError(`Target Chat ID (${requested}) is not in the allowed list.`, 403);
      }
      return requested;
    }

    if (!ownerChatId) {
      throw new PolicyViolationError("Owner Chat ID is not configured in plugin settings.", 400);
    }
    return ownerChatId;
  }

  /** Prepares message text: truncates if exceeds max characters and prepends AI prefix. */
  prepareText(text: string, lang: MessageLanguage, isAi = true): string {
    const settings = this.getSettings();
    let result = text.trim();

    if (result.length > settings.maxCharactersPerMessage) {
      const note = MESSAGE_TEXT[lang].truncated;
      result = `${result.slice(0, settings.maxCharactersPerMessage)}\n\n⚠️ ${note}`;
    }

    if (isAi && settings.enableAiPrefix && settings.aiMessagePrefix) {
      if (!result.startsWith(settings.aiMessagePrefix)) {
        result = settings.aiMessagePrefix + result;
      }
    }

    return result;
  }

  /** Determines message language based on settings and system locale. */
  resolveMessageLanguage(): MessageLanguage {
    const settings = this.getSettings();
    if (settings.messageLanguage === "en" || settings.messageLanguage === "pt") {
      return settings.messageLanguage;
    }
    // auto
    try {
      return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("pt") ? "pt" : "en";
    } catch {
      return "en";
    }
  }

  /** Records an action in recent transmission history. */
  recordHistory(
    sender: string,
    outcome: HistoryOutcome,
    detail: string,
    recipient: string,
    snippet: string,
  ): void {
    const settings = this.getSettings();
    const entry: HistoryEntry = {
      at: this.clock.now(),
      sender,
      outcome,
      detail,
      recipient,
      snippet: snippet.length > 100 ? `${snippet.slice(0, 97)}...` : snippet,
    };
    settings.recentHistory.unshift(entry);
    if (settings.recentHistory.length > MAX_HISTORY) {
      settings.recentHistory.length = MAX_HISTORY;
    }
  }

  private isInQuietHours(): boolean {
    const settings = this.getSettings();
    try {
      const now = new Date(this.clock.now());
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const [startH, startM] = settings.quietHoursStart.split(":").map(Number);
      const [endH, endM] = settings.quietHoursEnd.split(":").map(Number);

      const startMinutes = (startH ?? 22) * 60 + (startM ?? 0);
      const endMinutes = (endH ?? 8) * 60 + (endM ?? 0);

      if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
      } else {
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
      }
    } catch {
      return false;
    }
  }
}
