// Sending and editing rich (HTML) messages: chunking at the 4096 limit, buttons on the last
// chunk, and a plain-text retry when Telegram cannot parse the HTML.
import { TelegramApiError } from "./client";
import type { TelegramApi } from "./client";
import { TELEGRAM_MESSAGE_LIMIT, htmlToPlain, splitHtml } from "./chunking";
import type { InlineKeyboardMarkup } from "./types";

export interface SendRichInput {
  chatId: string;
  html: string;
  silent?: boolean;
  /** Buttons go on the last chunk. */
  replyMarkup?: InlineKeyboardMarkup;
  limit?: number;
}

export interface SendRichResult {
  messageIds: number[];
  chunks: string[];
  /** True when Telegram refused the HTML and the text was sent without formatting. */
  plainFallback: boolean;
}

export async function sendRich(api: TelegramApi, input: SendRichInput): Promise<SendRichResult> {
  const chunks = splitHtml(input.html, input.limit ?? TELEGRAM_MESSAGE_LIMIT);
  const messageIds: number[] = [];
  let plainFallback = false;
  for (let i = 0; i < chunks.length; i++) {
    const html = chunks[i] ?? "";
    const isLast = i === chunks.length - 1;
    const base = {
      chat_id: input.chatId,
      ...(input.silent ? { disable_notification: true } : {}),
      ...(isLast && input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    };
    try {
      const sent = await api.sendMessage({ ...base, text: html, parse_mode: "HTML" });
      messageIds.push(sent.message_id);
    } catch (err) {
      if (!(err instanceof TelegramApiError) || !err.isParseError) throw err;
      plainFallback = true;
      const sent = await api.sendMessage({ ...base, text: htmlToPlain(html) });
      messageIds.push(sent.message_id);
    }
  }
  return { messageIds, chunks, plainFallback };
}

export interface EditRichInput {
  chatId: string;
  messageId: number;
  html: string;
  /** Omit to remove the buttons. */
  replyMarkup?: InlineKeyboardMarkup;
}

/** Edits a message; "message is not modified" counts as success. */
export async function editRich(api: TelegramApi, input: EditRichInput): Promise<void> {
  const base = {
    chat_id: input.chatId,
    message_id: input.messageId,
    ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
  };
  try {
    await api.editMessageText({ ...base, text: input.html, parse_mode: "HTML" });
  } catch (err) {
    if (!(err instanceof TelegramApiError)) throw err;
    if (err.isNotModified) return;
    if (!err.isParseError) throw err;
    try {
      await api.editMessageText({ ...base, text: htmlToPlain(input.html) });
    } catch (second) {
      if (second instanceof TelegramApiError && second.isNotModified) return;
      throw second;
    }
  }
}
