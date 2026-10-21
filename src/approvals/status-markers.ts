// Status markers written INTO the Telegram messages (message content, not plugin UI).
//
// The vault convention marks every decision message with one of these markers so the user can
// tell at a glance whether something still needs their action. This is the only file in src
// allowed to contain emoji characters; the plugin interface itself never uses emojis (it uses
// Lucide icons through setIcon).
import type { ApprovalStatus } from "./types";

export type MessageLanguage = "en" | "pt";

/** Lifecycle of a question asked through telegram_ask_question (see src/questions). */
export type QuestionStatus = "pending" | "answered" | "expired" | "interrupted";

export const STATUS_MARKERS: Record<MessageLanguage, Record<ApprovalStatus, string>> = {
  pt: {
    pending: "⏳ Aguardando",
    approved: "✅ Aprovado",
    rejected: "❌ Recusado",
    interrupted: "\u{1F6D1} Interrompido",
  },
  en: {
    pending: "⏳ Waiting",
    approved: "✅ Approved",
    rejected: "❌ Rejected",
    interrupted: "\u{1F6D1} Interrupted",
  },
};

export const QUESTION_STATUS_MARKERS: Record<MessageLanguage, Record<QuestionStatus, string>> = {
  pt: {
    pending: "⏳ Aguardando",
    answered: "\u{1F4AC} Respondido",
    expired: "⌛ Expirado",
    interrupted: "\u{1F6D1} Interrompido",
  },
  en: {
    pending: "⏳ Waiting",
    answered: "\u{1F4AC} Answered",
    expired: "⌛ Expired",
    interrupted: "\u{1F6D1} Interrupted",
  },
};

/** Marks written on the buttons of a multiSelect question. */
export const SELECTION_MARKERS = { on: "☑", off: "☐" } as const;
