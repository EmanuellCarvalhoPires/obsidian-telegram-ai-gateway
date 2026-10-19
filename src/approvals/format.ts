// Builds the text and the buttons of an approval message.
import { escapeHtml } from "../telegram/chunking";
import type { InlineKeyboardMarkup } from "../telegram/types";
import { MESSAGE_TEXT } from "../gateway/message-text";
import { STATUS_MARKERS } from "./status-markers";
import type { Approval } from "./types";

/** The status line shown at the end of an approval message (HTML-safe). */
export function statusLine(approval: Approval): string {
  const marker = STATUS_MARKERS[approval.lang][approval.status];
  if (approval.status === "pending") return marker;
  const texts = MESSAGE_TEXT[approval.lang];
  let line = marker;
  if (approval.choice) line += `: ${escapeHtml(approval.choice)}`;
  const notes: string[] = [];
  if (approval.decidedBy === "resolve") notes.push(texts.resolvedInTerminal);
  if (approval.decidedBy === "expired") notes.push(texts.expired);
  if (approval.decidedBy === "shutdown") notes.push(texts.shutdown);
  if (approval.detail) notes.push(approval.detail);
  if (notes.length > 0) line += ` (${escapeHtml(notes.join("; "))})`;
  return line;
}

/** HTML body + blank line + status line. */
export function renderApprovalText(approval: Approval): string {
  return `${approval.text}\n\n${statusLine(approval)}`;
}

const CALLBACK_PATTERN = /^a:([\w-]+):(\d+)$/;

/** callback_data is limited to 64 bytes by Telegram: "a:<id>:<option index>". */
export function callbackData(id: string, index: number): string {
  return `a:${id}:${index}`;
}

export function parseCallbackData(data: string): { id: string; index: number } | undefined {
  const match = CALLBACK_PATTERN.exec(data);
  if (!match) return undefined;
  return { id: match[1] ?? "", index: Number(match[2]) };
}

/** One button per row for long labels, two per row otherwise. */
export function buildKeyboard(approval: Approval): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  let row: InlineKeyboardMarkup["inline_keyboard"][number] = [];
  approval.options.forEach((option, index) => {
    row.push({ text: option.label, callback_data: callbackData(approval.id, index) });
    if (row.length === 2 || option.label.length > 18) {
      rows.push(row);
      row = [];
    }
  });
  if (row.length > 0) rows.push(row);
  return { inline_keyboard: rows };
}
