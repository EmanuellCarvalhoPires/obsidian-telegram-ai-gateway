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
  ownerRegistered: string;
  /** Question messages (telegram_ask_question). */
  questionHeaderFallback: string;
  otherButton: string;
  otherButtonFilled: string;
  sendButton: string;
  multiSelectHint: string;
  freeTextPrompt: string;
  freeTextPlaceholder: string;
  selectAtLeastOne: string;
  answeredElsewhere: string;
  questionNotSent: string;
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
    ownerRegistered: "Done. This chat is now the owner chat of Telegram AI Gateway.",
    questionHeaderFallback: "Question",
    otherButton: "Other (type)",
    otherButtonFilled: "Other",
    sendButton: "Send",
    multiSelectHint: "Select the options, then tap Send.",
    freeTextPrompt: "Reply to this message with your answer to:",
    freeTextPlaceholder: "Your answer",
    selectAtLeastOne: "Select at least one option first.",
    answeredElsewhere: "answered on the PC",
    questionNotSent: "the request could not be sent",
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
    ownerRegistered: "Pronto. Este chat agora é o chat do dono do Telegram AI Gateway.",
    questionHeaderFallback: "Pergunta",
    otherButton: "Outro (digitar)",
    otherButtonFilled: "Outro",
    sendButton: "Enviar",
    multiSelectHint: "Marque as opções e toque em Enviar.",
    freeTextPrompt: "Responda esta mensagem com o texto para:",
    freeTextPlaceholder: "Sua resposta",
    selectAtLeastOne: "Marque ao menos uma opção antes.",
    answeredElsewhere: "respondido no PC",
    questionNotSent: "o pedido não pôde ser enviado",
  },
};
