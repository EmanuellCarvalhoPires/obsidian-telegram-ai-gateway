// Builds the text and the buttons of a question message (one message per question).
import { QUESTION_STATUS_MARKERS, SELECTION_MARKERS } from "../approvals/status-markers";
import { MESSAGE_TEXT } from "../gateway/message-text";
import { escapeHtml } from "../telegram/chunking";
import type { InlineKeyboardMarkup } from "../telegram/types";
import type { QuestionItem, QuestionRequest } from "./types";

/** Longest button text; Telegram shortens long labels anyway, this keeps them readable. */
const BUTTON_TEXT_MAX = 60;
/** Longest answer echoed in the status line, so the final edit never passes the 4096 limit. */
const ANSWER_ECHO_MAX = 300;

function shorten(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** The labels (and typed text) that make up the answer a multiSelect item would send now. */
export function selectedAnswer(item: QuestionItem): string[] {
  const labels = item.selected.map((index) => item.options[index]?.label ?? "").filter((label) => label !== "");
  if (item.extra) labels.push(item.extra);
  return labels;
}

/** The status line at the end of a question message (HTML-safe). */
export function questionStatusLine(request: QuestionRequest, item: QuestionItem): string {
  const markers = QUESTION_STATUS_MARKERS[request.lang];
  const texts = MESSAGE_TEXT[request.lang];
  if (item.answer !== undefined) {
    const shown = Array.isArray(item.answer) ? item.answer.join(", ") : item.answer;
    return `${markers.answered}: ${escapeHtml(shorten(shown, ANSWER_ECHO_MAX))}`;
  }
  if (request.status === "pending") return markers.pending;
  const notes: string[] = [];
  if (request.status === "answered" && request.decidedBy === "resolve") notes.push(texts.answeredElsewhere);
  if (request.decidedBy === "shutdown") notes.push(texts.shutdown);
  if (request.detail) notes.push(request.detail);
  const line = markers[request.status];
  return notes.length > 0 ? `${line} (${escapeHtml(notes.join("; "))})` : line;
}

/** HTML body of one question: header, question, numbered options. No status line. */
export function renderQuestionBody(request: QuestionRequest, item: QuestionItem): string {
  const texts = MESSAGE_TEXT[request.lang];
  const lines: string[] = [];
  const note = [request.title, request.context].filter((part): part is string => Boolean(part)).join(" - ");
  if (note) lines.push(`<i>${escapeHtml(note)}</i>`, "");
  const requester = request.requester ? ` (${escapeHtml(request.requester)})` : "";
  lines.push(`<b>${escapeHtml(item.header || texts.questionHeaderFallback)}</b>${requester}`, "", escapeHtml(item.question), "");
  item.options.forEach((option, index) => {
    const description = option.description ? ` - ${escapeHtml(option.description)}` : "";
    lines.push(`${index + 1}. <b>${escapeHtml(option.label)}</b>${description}`);
  });
  if (item.multiSelect) lines.push("", `<i>${escapeHtml(texts.multiSelectHint)}</i>`);
  return lines.join("\n");
}

/** HTML body + blank line + status line. */
export function renderQuestionText(request: QuestionRequest, item: QuestionItem): string {
  return `${renderQuestionBody(request, item)}\n\n${questionStatusLine(request, item)}`;
}

const CALLBACK_PATTERN = /^q:([\w-]+):(\d+):(o\d+|x|s)$/;

export type QuestionAction =
  /** A button of the option with this index. */
  | { kind: "option"; option: number }
  /** The free text button. */
  | { kind: "text" }
  /** The Send button of a multiSelect question. */
  | { kind: "send" };

/** callback_data is limited to 64 bytes by Telegram: "q:<id>:<question index>:<action>" (about 23). */
export function questionCallbackData(id: string, index: number, action: string): string {
  return `q:${id}:${index}:${action}`;
}

export function isQuestionCallback(data: string | undefined): boolean {
  return data !== undefined && data.startsWith("q:");
}

export function parseQuestionCallback(data: string): { id: string; index: number; action: QuestionAction } | undefined {
  const match = CALLBACK_PATTERN.exec(data);
  if (!match) return undefined;
  const code = match[3] ?? "";
  const action: QuestionAction = code === "x" ? { kind: "text" } : code === "s" ? { kind: "send" } : { kind: "option", option: Number(code.slice(1)) };
  return { id: match[1] ?? "", index: Number(match[2]), action };
}

/** One button per option (a toggle for multiSelect), then the free text button and Send. */
export function buildQuestionKeyboard(request: QuestionRequest, index: number): InlineKeyboardMarkup {
  const item = request.items[index];
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  if (!item) return { inline_keyboard: rows };
  const texts = MESSAGE_TEXT[request.lang];
  item.options.forEach((option, i) => {
    const mark = item.multiSelect ? `${item.selected.includes(i) ? SELECTION_MARKERS.on : SELECTION_MARKERS.off} ` : "";
    rows.push([
      { text: shorten(`${mark}${i + 1}. ${option.label}`, BUTTON_TEXT_MAX), callback_data: questionCallbackData(request.id, index, `o${i}`) },
    ]);
  });
  if (request.allowFreeText) {
    const text = item.extra ? `${texts.otherButtonFilled}: ${item.extra}` : texts.otherButton;
    rows.push([{ text: shorten(text, BUTTON_TEXT_MAX), callback_data: questionCallbackData(request.id, index, "x") }]);
  }
  if (item.multiSelect) rows.push([{ text: texts.sendButton, callback_data: questionCallbackData(request.id, index, "s") }]);
  return { inline_keyboard: rows };
}
