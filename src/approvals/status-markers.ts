// Status markers written INTO the Telegram messages (message content, not plugin UI).
//
// The vault convention marks every decision message with one of these markers so the user can
// tell at a glance whether something still needs their action. This is the only file in src
// allowed to contain emoji characters; the plugin interface itself never uses emojis (it uses
// Lucide icons through setIcon).
import type { ApprovalStatus } from "./types";

export type MessageLanguage = "en" | "pt";

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
