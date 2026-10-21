// Questions with several options (telegram_ask_question): sends one Telegram message per question,
// handles the buttons and the typed text, and keeps the messages in step with the request status.
// Used by the tools, the routes and the poller through GatewayService.questions.
import { MESSAGE_TEXT } from "../gateway/message-text";
import { t } from "../i18n";
import type { PolicyEngine } from "../policy/policy";
import { PolicyViolationError } from "../policy/policy";
import type { GatewaySettings } from "../settings/settings";
import type { TelegramApi } from "../telegram/client";
import type { LongPoller } from "../telegram/poller";
import { editRich, sendRich } from "../telegram/sender";
import type { TelegramCallbackQuery, TelegramMessage } from "../telegram/types";
import type { TokenManager } from "../token/token-manager";
import type { Clock } from "../util/clock";
import { errorMessage } from "../util/redact";
import {
  buildQuestionKeyboard,
  parseQuestionCallback,
  renderQuestionText,
  selectedAnswer,
} from "./format";
import type { QuestionStore } from "./store";
import { toQuestionView } from "./types";
import type { QuestionRequest, QuestionStatus, QuestionView } from "./types";
import { parseNote, parseQuestions } from "./validate";

export interface AskQuestionOptions {
  sender?: string;
  isAi?: boolean;
  /** The questions as received (validated here). */
  questions?: unknown;
  /** Show the free text button (default true). */
  allowFreeText?: boolean;
  title?: unknown;
  context?: unknown;
  chatId?: string;
  urgent?: boolean;
  silent?: boolean;
  /** Leave out for a question that never expires. */
  expiresInMinutes?: number;
}

export interface ResolveQuestionOptions {
  id?: string;
  status: string;
  detail?: string;
  all?: boolean;
}

export interface InspectorEntry {
  type: string;
  target: string;
  status: number;
  durationMs: number;
  payload?: unknown;
}

export interface QuestionServiceDeps {
  settings: () => GatewaySettings;
  saveSettings: () => Promise<void>;
  tokenManager: TokenManager;
  policy: PolicyEngine;
  store: QuestionStore;
  client: TelegramApi;
  poller: LongPoller;
  clock: Clock;
  logInspector: (entry: InspectorEntry) => void;
}

export class QuestionService {
  constructor(private readonly deps: QuestionServiceDeps) {}

  /** Posts the questions and returns the pending id immediately. */
  async ask(opts: AskQuestionOptions): Promise<{ id: string; status: "pending"; recipient: string; messages: number }> {
    const { settings, policy, store, client } = this.deps;
    const isAi = opts.isAi ?? true;
    const sender = opts.sender ?? (isAi ? "Claude Code" : "User");
    const lang = policy.resolveMessageLanguage();
    const startedAt = this.deps.clock.now();
    const config = settings();

    if (!this.deps.tokenManager.isConfigured()) throw new PolicyViolationError(t("question.error.noToken"), 400);
    if (config.chatId.trim() === "") throw new PolicyViolationError(t("question.error.noOwner"), 400);
    // A question is an approval request for the "notify events" setting.
    if (!config.notifyEvents.includes("pedidos_aprovacao")) throw new PolicyViolationError(t("question.error.disabled"), 403);

    const items = parseQuestions(opts.questions);
    const title = parseNote(opts.title, "title");
    const context = parseNote(opts.context, "context");

    if (isAi) {
      policy.checkAiAllowed();
      policy.checkQuietHours(Boolean(opts.urgent));
      policy.checkRateLimit();
    }
    const targetChatId = policy.resolveChatId(opts.chatId, isAi);

    // No setting applies here: a question never expires unless the caller says so.
    const expiresInMs =
      typeof opts.expiresInMinutes === "number" && opts.expiresInMinutes > 0 ? opts.expiresInMinutes * 60 * 1000 : undefined;

    const request = store.create({
      items,
      chatId: targetChatId,
      title,
      context,
      allowFreeText: opts.allowFreeText !== false,
      requester: sender,
      lang,
      expiresInMs,
    });
    const snippet = items.map((item) => item.question).join(" | ");

    try {
      for (const [index, item] of request.items.entries()) {
        const result = await sendRich(client, {
          chatId: targetChatId,
          html: renderQuestionText(request, item),
          replyMarkup: buildQuestionKeyboard(request, index),
          silent: opts.silent,
        });
        const last = result.messageIds[result.messageIds.length - 1];
        if (last !== undefined) store.attachMessage(request.id, index, last);
      }
    } catch (err) {
      // Questions already sent must not stay at "waiting" for a request that was refused.
      store.decide(request.id, { status: "interrupted", decidedBy: "resolve", detail: MESSAGE_TEXT[lang].questionNotSent });
      await this.refreshAll(request);
      store.discard(request.id);
      policy.recordHistory(sender, "failed", errorMessage(err), targetChatId, snippet);
      await this.deps.saveSettings();
      throw err;
    }

    this.deps.poller.ensureRunning();
    policy.recordSent();
    policy.recordHistory(sender, "requested", `Pending (${request.id})`, targetChatId, snippet);
    this.deps.logInspector({
      type: "telegram_question_request",
      target: targetChatId,
      status: 202,
      durationMs: this.deps.clock.now() - startedAt,
      payload: { id: request.id, questions: items.map((item) => item.question), expires: request.expiresAt ?? null },
    });
    await this.deps.saveSettings();
    return { id: request.id, status: "pending", recipient: targetChatId, messages: items.length };
  }

  /** Gets or waits for the answers. */
  async get(id: string, waitSeconds = 0): Promise<QuestionView | undefined> {
    const request = await this.deps.store.wait(id, waitSeconds);
    return request ? toQuestionView(request) : undefined;
  }

  /** Ends pending question(s) from code or terminal: answered on the PC, or interrupted. */
  async resolve(opts: ResolveQuestionOptions): Promise<{ success: boolean; resolved: QuestionView[] }> {
    const status = this.parseStatus(opts.status);
    if (!status) throw new PolicyViolationError(t("question.error.invalidStatus", { status: opts.status }), 400);

    const { store } = this.deps;
    const targets: QuestionRequest[] = [];
    if (opts.all) {
      targets.push(...store.pending());
    } else if (opts.id) {
      const item = store.get(opts.id);
      if (item && item.status === "pending") targets.push(item);
    } else {
      const newest = store.newestPending();
      if (newest) targets.push(newest);
    }
    if (targets.length === 0) throw new PolicyViolationError(t("question.error.nothingToResolve"), 404);

    const views: QuestionView[] = [];
    for (const target of targets) {
      const prompts = this.promptsOf(target);
      const decided = store.decide(target.id, { status, decidedBy: "resolve", detail: opts.detail });
      if (!decided) continue;
      await this.refreshAll(decided, prompts);
      this.deps.policy.recordHistory(
        "Resolver",
        status === "answered" ? "answered" : "interrupted",
        opts.detail ?? `Resolved (${status})`,
        decided.chatId,
        decided.items.map((item) => item.question).join(" | "),
      );
      this.deps.logInspector({
        type: "telegram_question_resolve",
        target: decided.chatId,
        status: 200,
        durationMs: 0,
        payload: { id: decided.id, status: decided.status, detail: opts.detail },
      });
      views.push(toQuestionView(decided));
    }
    await this.deps.saveSettings();
    return { success: true, resolved: views };
  }

  /** Handles a button of a question message. Only the chat the question was sent to may answer. */
  async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const parsed = query.data ? parseQuestionCallback(query.data) : undefined;
    if (!parsed) return;
    const { store, client } = this.deps;
    const request = store.get(parsed.id);

    // In a private chat the user id and the chat id are the same.
    const fromChat = String(query.message?.chat.id ?? query.from.id);
    if (request && fromChat !== request.chatId) {
      await this.answerQuery(query.id);
      return;
    }
    const item = request?.items[parsed.index];
    if (!request || !item || request.status !== "pending" || item.answer !== undefined) {
      await this.answerQuery(query.id, MESSAGE_TEXT[request?.lang ?? "en"].noLongerPending);
      return;
    }
    const texts = MESSAGE_TEXT[request.lang];
    const { action } = parsed;

    if (action.kind === "option") {
      const option = item.options[action.option];
      if (!option) {
        await this.answerQuery(query.id);
        return;
      }
      if (item.multiSelect) {
        store.toggle(request.id, parsed.index, action.option);
        await this.refresh(request, parsed.index, true);
        await this.answerQuery(query.id);
        await this.deps.saveSettings();
        return;
      }
      await this.recordAnswer(request, parsed.index, option.label, false, query.id);
      return;
    }

    if (action.kind === "send") {
      const labels = selectedAnswer(item);
      if (!item.multiSelect || labels.length === 0) {
        await this.answerQuery(query.id, texts.selectAtLeastOne);
        return;
      }
      await this.recordAnswer(request, parsed.index, labels, item.extra !== undefined, query.id);
      return;
    }

    // Free text: ask for it with a reply, so the typed text is tied to this question.
    if (!request.allowFreeText) {
      await this.answerQuery(query.id);
      return;
    }
    await this.answerQuery(query.id);
    try {
      const prompt = await client.sendMessage({
        chat_id: request.chatId,
        text: `${texts.freeTextPrompt} ${item.question}`,
        reply_markup: { force_reply: true, input_field_placeholder: texts.freeTextPlaceholder },
      });
      const previous = item.promptMessageId;
      store.setPrompt(request.id, parsed.index, prompt.message_id);
      if (previous !== undefined) await this.deleteQuietly(request.chatId, previous);
      await this.deps.saveSettings();
    } catch (err) {
      console.warn("[Telegram AI Gateway] Failed to ask for typed text:", errorMessage(err));
    }
  }

  /**
   * Handles a message received by the poller. Returns true when it was the typed answer of a
   * question: a reply, in the right chat, to the message that asked for the text. Anything else
   * (other chats, messages that are not replies to a prompt) is ignored.
   */
  async handleMessage(message: TelegramMessage): Promise<boolean> {
    const target = message.reply_to_message?.message_id;
    const text = message.text?.trim();
    if (target === undefined || !text) return false;
    const { store } = this.deps;
    const found = store.findPrompt(String(message.chat.id), target);
    if (!found) return false;
    const { request, index } = found;
    const item = request.items[index];
    if (!item) return false;

    await this.deleteQuietly(request.chatId, target);
    if (item.multiSelect) {
      // The text joins the selected options; the user still taps Send.
      store.setExtra(request.id, index, text);
      await this.refresh(request, index, true);
      await this.deps.saveSettings();
      return true;
    }
    await this.recordAnswer(request, index, text, true);
    return true;
  }

  /** Marks requests whose expiry time has passed as expired. */
  async checkDue(): Promise<void> {
    const { store, policy } = this.deps;
    const due = store.due();
    for (const request of due) {
      const prompts = this.promptsOf(request);
      const decided = store.decide(request.id, { status: "expired", decidedBy: "expired" });
      if (!decided) continue;
      await this.refreshAll(decided, prompts);
      policy.recordHistory("System", "interrupted", "Expired", decided.chatId, decided.items.map((item) => item.question).join(" | "));
    }
    if (due.length > 0) await this.deps.saveSettings();
  }

  /** Stores one answer, edits the message to the final state and decides the request when it was the last. */
  private async recordAnswer(
    request: QuestionRequest,
    index: number,
    answer: string | string[],
    freeText: boolean,
    callbackId?: string,
  ): Promise<void> {
    const { store, policy } = this.deps;
    const result = store.answer(request.id, index, answer, freeText);
    if (!result) {
      if (callbackId) await this.answerQuery(callbackId, MESSAGE_TEXT[request.lang].noLongerPending);
      return;
    }
    await this.refresh(result.request, index, false);
    if (callbackId) await this.answerQuery(callbackId, MESSAGE_TEXT[request.lang].decisionRecorded);

    const question = request.items[index]?.question ?? "";
    this.deps.logInspector({
      type: "telegram_question_answer",
      target: request.chatId,
      status: 200,
      durationMs: 0,
      payload: { id: request.id, question, free_text: freeText, completed: result.completed },
    });
    if (result.completed) {
      policy.recordHistory("Telegram", "answered", `Answered (${request.id})`, request.chatId, question);
    }
    await this.deps.saveSettings();
  }

  /** Edits one question message to the current state; the buttons stay only when asked to. */
  private async refresh(request: QuestionRequest, index: number, keepButtons: boolean): Promise<void> {
    const item = request.items[index];
    if (item?.messageId === undefined) return;
    try {
      await editRich(this.deps.client, {
        chatId: request.chatId,
        messageId: item.messageId,
        html: renderQuestionText(request, item),
        // Omitting replyMarkup removes the inline buttons
        ...(keepButtons ? { replyMarkup: buildQuestionKeyboard(request, index) } : {}),
      });
    } catch (err) {
      console.warn("[Telegram AI Gateway] Failed to edit Telegram question message:", errorMessage(err));
    }
  }

  /** The request ended: every message gets its final status without buttons, open prompts go away. */
  private async refreshAll(request: QuestionRequest, prompts: number[] = []): Promise<void> {
    for (let index = 0; index < request.items.length; index++) await this.refresh(request, index, false);
    for (const prompt of prompts) await this.deleteQuietly(request.chatId, prompt);
  }

  private promptsOf(request: QuestionRequest): number[] {
    return request.items.map((item) => item.promptMessageId).filter((id): id is number => id !== undefined);
  }

  private async deleteQuietly(chatId: string, messageId: number): Promise<void> {
    try {
      await this.deps.client.deleteMessage({ chat_id: chatId, message_id: messageId });
    } catch {
      // The prompt may be gone already; nothing depends on it.
    }
  }

  private async answerQuery(id: string, text?: string): Promise<void> {
    try {
      await this.deps.client.answerCallbackQuery({ callback_query_id: id, ...(text ? { text } : {}) });
    } catch {
      // ignored
    }
  }

  private parseStatus(raw: string): Exclude<QuestionStatus, "pending" | "expired"> | undefined {
    const lowered = raw.trim().toLowerCase();
    if (["answered_elsewhere", "answered", "respondido", "respondido_no_pc"].includes(lowered)) return "answered";
    if (["interrupted", "interrompido", "cancel", "cancelado"].includes(lowered)) return "interrupted";
    return undefined;
  }
}
