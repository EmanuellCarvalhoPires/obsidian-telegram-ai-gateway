// Words written INTO Telegram messages, in the language chosen for the messages (not the
// language of the Obsidian interface). No emojis here: the status markers live in
// src/approvals/status-markers.ts.
import type { MessageLanguage } from "../approvals/status-markers";

export interface MessageTexts {
  truncated: string;
  resolvedInTerminal: string;
  expired: string;
  shutdown: string;
  noLongerPending: string;
  decisionRecorded: string;
  testMessage: string;
  noteHeader: string;
}

export const MESSAGE_TEXT: Record<MessageLanguage, MessageTexts> = {
  en: {
    truncated: "[Truncated by the plugin limit]",
    resolvedInTerminal: "decided in the terminal",
    expired: "expired",
    shutdown: "plugin stopped",
    noLongerPending: "This request is no longer pending.",
    decisionRecorded: "Recorded",
    testMessage: "Test message from Telegram AI Gateway.",
    noteHeader: "Note",
  },
  pt: {
    truncated: "[Conteúdo truncado pelo limite do plugin]",
    resolvedInTerminal: "decidido no terminal",
    expired: "expirou",
    shutdown: "plugin encerrado",
    noLongerPending: "Este pedido não está mais pendente.",
    decisionRecorded: "Registrado",
    testMessage: "Mensagem de teste do Telegram AI Gateway.",
    noteHeader: "Nota",
  },
};
