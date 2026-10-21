// Orchestrates Telegram messaging, approvals lifecycle, template rendering, and Inspector activity.
import type { Approval, ApprovalOption, ApprovalStatus, ApprovalView } from "../approvals/types";
import { toView } from "../approvals/types";
import { buildKeyboard, parseCallbackData, renderApprovalText } from "../approvals/format";
import type { ApprovalStore } from "../approvals/store";
import type { AIEcosystemAPI, TemplatesService } from "../ecosystem/types";
import { MODULE_ID, TEMPLATES_SERVICE } from "../ecosystem/types";
import { MESSAGE_TEXT } from "./message-text";
import type { PolicyEngine } from "../policy/policy";
import { PolicyViolationError } from "../policy/policy";
import { QuestionService } from "../questions/question-service";
import type { QuestionStore } from "../questions/store";
import type { GatewaySettings } from "../settings/settings";
import type { TelegramApi } from "../telegram/client";
import type { LongPoller } from "../telegram/poller";
import { editRich, sendRich } from "../telegram/sender";
import type { TokenManager } from "../token/token-manager";
import type { Clock } from "../util/clock";

export interface SendMessageOptions {
  sender?: string;
  isAi?: boolean;
  message?: string;
  text?: string;
  chatId?: string;
  urgent?: boolean;
  silent?: boolean;
  templateId?: string;
  templateData?: unknown;
}

export interface SendApprovalOptions {
  sender?: string;
  isAi?: boolean;
  message?: string;
  text?: string;
  options?: Array<string | ApprovalOption>;
  chatId?: string;
  urgent?: boolean;
  silent?: boolean;
  expiresInMinutes?: number;
  templateId?: string;
  templateData?: unknown;
}

export interface ResolveApprovalOptions {
  id?: string;
  status: string;
  choice?: string;
  detail?: string;
  all?: boolean;
}

export interface GatewayServiceDeps {
  settings: () => GatewaySettings;
  saveSettings: () => Promise<void>;
  tokenManager: TokenManager;
  policy: PolicyEngine;
  store: ApprovalStore;
  questionStore: QuestionStore;
  client: TelegramApi;
  poller: LongPoller;
  clock: Clock;
  getEcosystemApi?: () => AIEcosystemAPI | undefined;
}

export class GatewayService {
  /** Questions with several options and typed answers (telegram_ask_question). */
  readonly questions: QuestionService;

  constructor(private readonly deps: GatewayServiceDeps) {
    this.questions = new QuestionService({
      settings: deps.settings,
      saveSettings: deps.saveSettings,
      tokenManager: deps.tokenManager,
      policy: deps.policy,
      store: deps.questionStore,
      client: deps.client,
      poller: deps.poller,
      clock: deps.clock,
      logInspector: (entry) => this.logInspector(entry),
    });
    // Listen to store decisions to trigger poller stop/start when needed
    this.deps.store.onDecision(() => {
      if (this.deps.store.pendingCount() === 0) {
        // Poller will naturally idle based on shouldRun()
      }
    });
  }

  private get eco(): AIEcosystemAPI | undefined {
    return this.deps.getEcosystemApi?.();
  }

  isTemplatesAvailable(): boolean {
    const api = this.eco;
    if (!api) return false;
    return Boolean(api.getService<TemplatesService>(TEMPLATES_SERVICE));
  }

  async renderText(
    rawText: string | undefined,
    templateId: string | undefined,
    templateData: unknown,
  ): Promise<string> {
    if (templateId) {
      const api = this.eco;
      const templates = api?.getService<TemplatesService>(TEMPLATES_SERVICE);
      if (!templates || !this.deps.settings().allowTemplates) {
        throw new PolicyViolationError("Templates require the AI Templates plugin to be active.", 400);
      }
      return templates.render(templateId, templateData, "telegram");
    }

    const text = (rawText ?? "").trim();
    if (!text) {
      throw new PolicyViolationError("The 'message' field is required.", 400);
    }
    return text;
  }

  /** Sends a simple notification message. */
  async sendMessage(opts: SendMessageOptions): Promise<{ status: "sent"; recipient: string; timestamp: string }> {
    const isAi = opts.isAi ?? true;
    const sender = opts.sender ?? (isAi ? "Claude Code" : "User");
    const lang = this.deps.policy.resolveMessageLanguage();
    const startedAt = this.deps.clock.now();

    const rawContent = await this.renderText(opts.message ?? opts.text, opts.templateId, opts.templateData);

    if (isAi) {
      this.deps.policy.checkAiAllowed();
      this.deps.policy.checkQuietHours(Boolean(opts.urgent));
      this.deps.policy.checkRateLimit();
    }

    const targetChatId = this.deps.policy.resolveChatId(opts.chatId, isAi);
    const textToSend = this.deps.policy.prepareText(rawContent, lang, isAi);

    try {
      await sendRich(this.deps.client, {
        chatId: targetChatId,
        html: textToSend,
        silent: opts.silent,
      });

      this.deps.policy.recordSent();
      this.deps.policy.recordHistory(sender, "sent", "Success", targetChatId, textToSend);

      this.logInspector({
        type: "telegram_send",
        target: targetChatId,
        status: 200,
        durationMs: this.deps.clock.now() - startedAt,
        payload: { text: textToSend, urgent: opts.urgent, silent: opts.silent },
      });

      await this.deps.saveSettings();
      return { status: "sent", recipient: targetChatId, timestamp: new Date(startedAt).toISOString() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.policy.recordHistory(sender, "failed", msg, targetChatId, textToSend);
      this.logInspector({
        type: "telegram_send",
        target: targetChatId,
        status: 500,
        durationMs: this.deps.clock.now() - startedAt,
        payload: { error: msg },
      });
      await this.deps.saveSettings();
      throw err;
    }
  }

  /** Posts an interactive approval request and returns pending ID immediately. */
  async askApproval(opts: SendApprovalOptions): Promise<{ id: string; status: "pending"; recipient: string }> {
    const isAi = opts.isAi ?? true;
    const sender = opts.sender ?? (isAi ? "Claude Code" : "User");
    const lang = this.deps.policy.resolveMessageLanguage();
    const startedAt = this.deps.clock.now();

    const rawContent = await this.renderText(opts.message ?? opts.text, opts.templateId, opts.templateData);

    if (isAi) {
      this.deps.policy.checkAiAllowed();
      this.deps.policy.checkQuietHours(Boolean(opts.urgent));
      this.deps.policy.checkRateLimit();
    }

    const targetChatId = this.deps.policy.resolveChatId(opts.chatId, isAi);
    const preparedText = this.deps.policy.prepareText(rawContent, lang, isAi);

    // Normalize buttons
    const normalizedOptions: ApprovalOption[] = [];
    const rawOptions = opts.options && opts.options.length > 0 ? opts.options : ["Aprovar", "Rejeitar"];

    for (const opt of rawOptions) {
      if (typeof opt === "string") {
        const isRejection = /^(rejeit|recus|não|nao|no|reject|cancel|interromp)/i.test(opt.trim());
        normalizedOptions.push({ label: opt.trim(), outcome: isRejection ? "rejected" : "approved" });
      } else if (typeof opt === "object" && opt && typeof opt.label === "string") {
        normalizedOptions.push({
          label: opt.label.trim(),
          outcome: opt.outcome === "rejected" ? "rejected" : "approved",
        });
      }
    }

    const expiryMinutes =
      typeof opts.expiresInMinutes === "number"
        ? opts.expiresInMinutes
        : this.deps.settings().approvalExpiryMinutes;
    const expiresInMs = expiryMinutes > 0 ? expiryMinutes * 60 * 1000 : undefined;

    const approval = this.deps.store.create({
      options: normalizedOptions,
      chatId: targetChatId,
      text: preparedText,
      requester: sender,
      lang,
      expiresInMs,
    });

    const htmlToSend = renderApprovalText(approval);
    const replyMarkup = buildKeyboard(approval);

    try {
      const result = await sendRich(this.deps.client, {
        chatId: targetChatId,
        html: htmlToSend,
        replyMarkup,
        silent: opts.silent,
      });

      this.deps.store.attachMessages(approval.id, result.messageIds);
      this.deps.poller.ensureRunning();

      this.deps.policy.recordSent();
      this.deps.policy.recordHistory(sender, "requested", `Pending (${approval.id})`, targetChatId, preparedText);

      this.logInspector({
        type: "telegram_approval_request",
        target: targetChatId,
        status: 202,
        durationMs: this.deps.clock.now() - startedAt,
        payload: { id: approval.id, text: preparedText, options: normalizedOptions },
      });

      await this.deps.saveSettings();
      return { id: approval.id, status: "pending", recipient: targetChatId };
    } catch (err) {
      this.deps.store.discard(approval.id);
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.policy.recordHistory(sender, "failed", msg, targetChatId, preparedText);
      await this.deps.saveSettings();
      throw err;
    }
  }

  /** Gets or waits for an approval decision. */
  async getApproval(id: string, waitSeconds = 0): Promise<ApprovalView | undefined> {
    const approval = await this.deps.store.wait(id, waitSeconds);
    return approval ? toView(approval) : undefined;
  }

  /** Resolves pending approval(s) from code/terminal without pressing Telegram buttons. */
  async resolveApproval(opts: ResolveApprovalOptions): Promise<{ success: boolean; resolved: ApprovalView[] }> {
    const normalizedStatus = this.parseApprovalStatus(opts.status);
    if (!normalizedStatus) {
      throw new PolicyViolationError(`Invalid status: ${opts.status}. Allowed: approved, rejected, interrupted`, 400);
    }

    const targets: Approval[] = [];
    if (opts.all) {
      targets.push(...this.deps.store.pending());
    } else if (opts.id) {
      const item = this.deps.store.get(opts.id);
      if (item && item.status === "pending") targets.push(item);
    } else {
      const newest = this.deps.store.newestPending();
      if (newest) targets.push(newest);
    }

    if (targets.length === 0) {
      throw new PolicyViolationError("No pending approval to resolve.", 404);
    }

    const resolvedViews: ApprovalView[] = [];

    for (const item of targets) {
      const decided = this.deps.store.decide(item.id, {
        status: normalizedStatus,
        choice: opts.choice,
        decidedBy: "resolve",
        detail: opts.detail,
      });

      if (!decided) continue;

      // Update the Telegram message (remove keyboard & show updated status)
      await this.updateTelegramMessageDecision(decided);

      this.deps.policy.recordHistory(
        "Resolver",
        decided.status as "approved" | "rejected" | "interrupted",
        opts.detail ?? `Resolved (${decided.status})`,
        decided.chatId,
        decided.text,
      );

      this.logInspector({
        type: "telegram_approval_resolve",
        target: decided.chatId,
        status: 200,
        durationMs: 0,
        payload: { id: decided.id, status: decided.status, detail: opts.detail },
      });

      resolvedViews.push(toView(decided));
    }

    await this.deps.saveSettings();
    return { success: true, resolved: resolvedViews };
  }

  /** Processes callback queries received from Telegram buttons. */
  async handleCallbackQuery(query: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number | string } };
  }): Promise<void> {
    const data = query.data;
    if (!data) return;

    const parsed = parseCallbackData(data);
    if (!parsed) return;

    const approval = this.deps.store.get(parsed.id);
    if (!approval) {
      try {
        await this.deps.client.answerCallbackQuery({
          callback_query_id: query.id,
          text: MESSAGE_TEXT.en.noLongerPending,
        });
      } catch {
        // ignored
      }
      return;
    }

    if (approval.status !== "pending") {
      try {
        await this.deps.client.answerCallbackQuery({
          callback_query_id: query.id,
          text: MESSAGE_TEXT[approval.lang].noLongerPending,
        });
      } catch {
        // ignored
      }
      return;
    }

    const option = approval.options[parsed.index];
    const outcome = option ? option.outcome : "approved";
    const choice = option ? option.label : undefined;
    const newStatus: Exclude<ApprovalStatus, "pending"> = outcome === "rejected" ? "rejected" : "approved";

    const decided = this.deps.store.decide(approval.id, {
      status: newStatus,
      choice,
      decidedBy: "telegram",
    });

    if (decided) {
      await this.updateTelegramMessageDecision(decided);

      try {
        await this.deps.client.answerCallbackQuery({
          callback_query_id: query.id,
          text: MESSAGE_TEXT[decided.lang].decisionRecorded,
        });
      } catch {
        // ignored
      }

      this.deps.policy.recordHistory(
        "Telegram",
        decided.status as "approved" | "rejected" | "interrupted",
        `Button: ${choice ?? ""}`,
        decided.chatId,
        decided.text,
      );

      this.logInspector({
        type: "telegram_button_click",
        target: decided.chatId,
        status: 200,
        durationMs: 0,
        payload: { id: decided.id, choice, status: decided.status },
      });

      await this.deps.saveSettings();
    }
  }

  /** Checks for expired approvals and marks them interrupted. */
  async checkDueApprovals(): Promise<void> {
    const due = this.deps.store.due();
    for (const item of due) {
      const decided = this.deps.store.decide(item.id, {
        status: "interrupted",
        decidedBy: "expired",
      });
      if (decided) {
        await this.updateTelegramMessageDecision(decided);
        this.deps.policy.recordHistory("System", "interrupted", "Expired", decided.chatId, decided.text);
      }
    }
    if (due.length > 0) {
      await this.deps.saveSettings();
    }
  }

  /** System status for GET /status and settings tab. */
  getStatus() {
    const tokenState = this.deps.tokenManager.getState();
    const pollerStatus = this.deps.poller.status;
    const settings = this.deps.settings();

    return {
      configured: this.deps.tokenManager.isConfigured(),
      token_source: tokenState,
      poller: {
        state: pollerStatus.state,
        failures: pollerStatus.failures,
        retry_in_seconds: pollerStatus.retryInSeconds,
        detail: pollerStatus.detail,
      },
      pending_approvals: this.deps.store.pendingCount(),
      pending_questions: this.deps.questionStore.pendingCount(),
      ai_templates_available: this.isTemplatesAvailable(),
      chat_id: settings.chatId,
    };
  }

  private async updateTelegramMessageDecision(approval: Approval): Promise<void> {
    const lastMsgId = approval.messageIds[approval.messageIds.length - 1];
    if (typeof lastMsgId !== "number") return;

    try {
      const updatedText = renderApprovalText(approval);
      await editRich(this.deps.client, {
        chatId: approval.chatId,
        messageId: lastMsgId,
        html: updatedText,
        // Omitting replyMarkup removes the inline buttons
      });
    } catch (err) {
      console.warn("[Telegram AI Gateway] Failed to edit Telegram message after decision:", err);
    }
  }

  private parseApprovalStatus(raw: string): Exclude<ApprovalStatus, "pending"> | undefined {
    const lowered = raw.trim().toLowerCase();
    if (lowered === "approved" || lowered === "aprovado" || lowered === "sim" || lowered === "yes") {
      return "approved";
    }
    if (lowered === "rejected" || lowered === "recusado" || lowered === "rejeitado" || lowered === "não" || lowered === "nao" || lowered === "no") {
      return "rejected";
    }
    if (lowered === "interrupted" || lowered === "interrompido" || lowered === "cancel" || lowered === "cancelado") {
      return "interrupted";
    }
    return undefined;
  }

  private logInspector(entry: {
    type: string;
    target: string;
    status: number;
    durationMs: number;
    payload?: unknown;
  }): void {
    const api = this.eco;
    if (!api) return;
    try {
      api.logActivity({
        moduleId: MODULE_ID,
        type: entry.type,
        target: entry.target,
        status: entry.status,
        durationMs: entry.durationMs,
        payload: entry.payload,
      });
    } catch {
      // ignored
    }
  }
}
