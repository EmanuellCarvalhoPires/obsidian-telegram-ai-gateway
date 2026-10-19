// Typed Telegram Bot API client on top of the single transport function.
import { isRecord, parseJson } from "../util/guards";
import type { TelegramTransport } from "./transport";
import type {
  AnswerCallbackParams,
  EditMessageParams,
  GetUpdatesParams,
  SendMessageParams,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./types";

export class TelegramApiError extends Error {
  constructor(
    /** HTTP status of the answer. */
    readonly status: number,
    /** Description sent by Telegram (never contains the token). */
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`Telegram API error ${status}: ${description}`);
    this.name = "TelegramApiError";
  }

  /** Another getUpdates consumer (or a webhook) holds the bot. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isWebhookConflict(): boolean {
    return this.isConflict && /webhook/i.test(this.description);
  }

  /** The token was refused. */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 404;
  }

  get isParseError(): boolean {
    return this.status === 400 && /can't parse entities|can't find end of the entity/i.test(this.description);
  }

  get isNotModified(): boolean {
    return this.status === 400 && /message is not modified/i.test(this.description);
  }
}

export interface TelegramApi {
  sendMessage(params: SendMessageParams): Promise<TelegramMessage>;
  editMessageText(params: EditMessageParams): Promise<void>;
  answerCallbackQuery(params: AnswerCallbackParams): Promise<void>;
  getUpdates(params: GetUpdatesParams): Promise<TelegramUpdate[]>;
  getMe(): Promise<TelegramUser>;
}

export class TelegramClient implements TelegramApi {
  constructor(private readonly transport: TelegramTransport) {}

  /** Calls a method and returns the "result" of an ok answer. */
  private async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await this.transport(method, payload);
    const parsed = parseJson(response.body);
    const body = isRecord(parsed) ? parsed : {};
    if (response.status >= 200 && response.status < 300 && body.ok === true) return body.result;
    const description = typeof body.description === "string" ? body.description : `HTTP ${response.status}`;
    const parameters = isRecord(body.parameters) ? body.parameters : {};
    const retryAfter = typeof parameters.retry_after === "number" ? parameters.retry_after : undefined;
    const status = typeof body.error_code === "number" ? body.error_code : response.status;
    throw new TelegramApiError(status, description, retryAfter);
  }

  async sendMessage(params: SendMessageParams): Promise<TelegramMessage> {
    const result = await this.call("sendMessage", { ...params });
    if (!isRecord(result) || typeof result.message_id !== "number") throw new TelegramApiError(502, "Unexpected sendMessage answer");
    return result as unknown as TelegramMessage;
  }

  async editMessageText(params: EditMessageParams): Promise<void> {
    await this.call("editMessageText", { ...params });
  }

  async answerCallbackQuery(params: AnswerCallbackParams): Promise<void> {
    await this.call("answerCallbackQuery", { ...params });
  }

  async getUpdates(params: GetUpdatesParams): Promise<TelegramUpdate[]> {
    const result = await this.call("getUpdates", { ...params });
    if (!Array.isArray(result)) return [];
    return result.filter((u): u is TelegramUpdate => isRecord(u) && typeof u.update_id === "number");
  }

  async getMe(): Promise<TelegramUser> {
    const result = await this.call("getMe", {});
    if (!isRecord(result) || typeof result.id !== "number") throw new TelegramApiError(502, "Unexpected getMe answer");
    return result as unknown as TelegramUser;
  }
}
