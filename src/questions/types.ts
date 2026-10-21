import type { MessageLanguage, QuestionStatus } from "../approvals/status-markers";
import type { DecisionSource } from "../approvals/types";

export type { QuestionStatus };

/** Limits of a question request (the first four mirror Claude Code's AskUserQuestion). */
export const QUESTION_LIMITS = {
  questions: { min: 1, max: 4 },
  options: { min: 2, max: 4 },
  header: 12,
  /** Text limits that keep one question inside a single Telegram message (4096 characters). */
  question: 1000,
  label: 100,
  description: 300,
  title: 100,
  context: 300,
} as const;

export interface QuestionOption {
  label: string;
  description?: string;
}

/** One question of a request; each one is sent as its own Telegram message. */
export interface QuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
  /** Telegram message that carries this question, its buttons and its status line. */
  messageId?: number;
  /** multiSelect: option indexes toggled so far. */
  selected: number[];
  /** multiSelect: text typed through the free text button, answered together with the options. */
  extra?: string;
  /** Message asking for the typed text (force_reply), while the user has not replied yet. */
  promptMessageId?: number;
  /** Final answer: the label, the labels (multiSelect) or the typed text. */
  answer?: string | string[];
  /** True when the answer is (or includes) typed text. */
  freeText?: boolean;
}

/** A question request, as kept in memory and persisted in data.json (never contains the token). */
export interface QuestionRequest {
  id: string;
  status: QuestionStatus;
  items: QuestionItem[];
  chatId: string;
  title?: string;
  context?: string;
  allowFreeText: boolean;
  /** Display name of the client that asked. */
  requester: string;
  createdAt: number;
  /** Absent when the question never expires (the default). */
  expiresAt?: number;
  decidedAt?: number;
  decidedBy?: DecisionSource;
  detail?: string;
  /** Language of the words written into the messages of this request. */
  lang: MessageLanguage;
}

export type PersistedQuestion = QuestionRequest;

/** What the HTTP routes and tools return for a question request. */
export interface QuestionView {
  id: string;
  status: QuestionStatus;
  /** Answers by question text; only the questions answered so far. */
  answers: Record<string, string | string[]>;
  /** Question texts whose answer is (or includes) typed text. */
  free_text: Record<string, true>;
  questions: Array<{ question: string; answered: boolean }>;
  decided_at: string | null;
  decided_by: DecisionSource | null;
  detail: string | null;
  created_at: string;
  expires_at: string | null;
}

export function answersOf(request: QuestionRequest): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {};
  for (const item of request.items) {
    if (item.answer !== undefined) answers[item.question] = Array.isArray(item.answer) ? [...item.answer] : item.answer;
  }
  return answers;
}

export function toQuestionView(request: QuestionRequest): QuestionView {
  const freeText: Record<string, true> = {};
  for (const item of request.items) {
    if (item.answer !== undefined && item.freeText) freeText[item.question] = true;
  }
  return {
    id: request.id,
    status: request.status,
    answers: answersOf(request),
    free_text: freeText,
    questions: request.items.map((item) => ({ question: item.question, answered: item.answer !== undefined })),
    decided_at: request.decidedAt ? new Date(request.decidedAt).toISOString() : null,
    decided_by: request.decidedBy ?? null,
    detail: request.detail ?? null,
    created_at: new Date(request.createdAt).toISOString(),
    expires_at: request.expiresAt ? new Date(request.expiresAt).toISOString() : null,
  };
}
