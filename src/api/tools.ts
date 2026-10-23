// MCP tools registered in the AI Ecosystem for Claude Code, Antigravity and scripts.
import type { HubCallContext, HubTool, HubToolResult } from "../ecosystem/types";
import { MAX_WAIT_SECONDS } from "../approvals/store";
import type { GatewayService } from "../gateway/gateway-service";
import { t } from "../i18n";
import { PolicyViolationError } from "../policy/policy";
import { QUESTION_LIMITS } from "../questions/types";
import { errorMessage } from "../util/redact";

type Args = Record<string, unknown>;

function jsonResult(structured: Record<string, unknown>): HubToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

/** Default and maximum seconds a tool call may block waiting for a decision. */
export const DEFAULT_WAIT_SECONDS = 25;
export const DEFAULT_MAX_WAIT_SECONDS = MAX_WAIT_SECONDS;

export interface ToolOptions {
  /** Ceiling for wait / wait_seconds, in seconds (default 300). MCP clients with a shorter request timeout need a lower value. */
  maxWaitSeconds?: number;
}

/** Compact JSON text only (no structuredContent duplicate). */
function compactResult(value: Record<string, unknown>): HubToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function clampWait(value: unknown, max: number, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;
}

interface ApprovalLike {
  id: string;
  status: string;
  choice?: string | null;
}

function slimApproval(a: ApprovalLike): Record<string, unknown> {
  return a.choice ? { id: a.id, status: a.status, choice: a.choice } : { id: a.id, status: a.status };
}

interface QuestionLike {
  id: string;
  status: string;
  answers?: unknown;
}

function slimQuestion(q: QuestionLike): Record<string, unknown> {
  return q.status === "pending" || q.answers === undefined
    ? { id: q.id, status: q.status }
    : { id: q.id, status: q.status, answers: q.answers };
}

function errorResult(err: unknown): HubToolResult {
  const message = err instanceof PolicyViolationError ? err.message : errorMessage(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export function buildTools(service: GatewayService, templatesAvailable: boolean, options: ToolOptions = {}): HubTool[] {
  const maxWait = Math.min(MAX_WAIT_SECONDS, Math.max(DEFAULT_WAIT_SECONDS, options.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS));
  const waitDescription = `Seconds to block waiting for the decision (max ${maxWait}). Omit to return at once.`;
  const verboseProperty = { type: "boolean", description: "Return the full record instead of {id,status,choice|answers}." };

  const sendProperties: Record<string, unknown> = {
    message: {
      type: "string",
      description: "Message text (HTML or plain).",
    },
    urgent: {
      type: "boolean",
      description: "Bypass quiet hours.",
    },
    silent: {
      type: "boolean",
      description: "Send without sound.",
    },
    chat_id: {
      type: "string",
      description: "Chat ID (default: owner).",
    },
  };

  const askProperties: Record<string, unknown> = {
    message: {
      type: "string",
      description: "Text shown above the buttons.",
    },
    options: {
      type: "array",
      items: { type: "string" },
      description: "Button labels, e.g. ['Aprovar','Rejeitar'].",
    },
    urgent: {
      type: "boolean",
      description: "Bypass quiet hours.",
    },
    silent: {
      type: "boolean",
      description: "Send without sound.",
    },
    chat_id: {
      type: "string",
      description: "Chat ID (default: owner).",
    },
    expires_in_minutes: {
      type: "number",
      description: "Minutes until it expires.",
    },
    wait_seconds: { type: "number", description: waitDescription },
    verbose: verboseProperty,
  };

  if (templatesAvailable) {
    sendProperties.template_id = {
      type: "string",
      description: "AI Template ID to render first.",
    };
    sendProperties.data = {
      type: "object",
      description: "Template variables.",
    };

    askProperties.template_id = {
      type: "string",
      description: "AI Template ID to render first.",
    };
    askProperties.data = {
      type: "object",
      description: "Template variables.",
    };
  }

  return [
    {
      name: "telegram_send_message",
      title: "Send Telegram Notification",
      categoria: "notificacao",
      tags: ["telegram", "mensagem", "notificacao"],
      resumo: "Envia mensagem de notificação via Telegram",
      efeito: "externo",
      exposicao: "fixa",
      aprovacao: "dispensada",
      description:
        "Send a Telegram notification (template_id and data when AI Templates is active).",
      inputSchema: {
        type: "object",
        properties: sendProperties,
        required: templatesAvailable ? [] : ["message"],
        additionalProperties: false,
      },
      handler: async (args: Args, ctx: HubCallContext): Promise<HubToolResult> => {
        try {
          const result = await service.sendMessage({
            sender: ctx.client?.name ?? "AI Agent",
            isAi: true,
            message: typeof args.message === "string" ? args.message : undefined,
            chatId: typeof args.chat_id === "string" ? args.chat_id : undefined,
            urgent: Boolean(args.urgent),
            silent: Boolean(args.silent),
            templateId: typeof args.template_id === "string" ? args.template_id : undefined,
            templateData: args.data,
          });
          return jsonResult({ success: true, ...result });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_ask_approval",
      title: "Ask Approval via Telegram",
      categoria: "notificacao",
      tags: ["telegram", "aprovacao", "botoes"],
      resumo: "Pede aprovação com botões via Telegram",
      efeito: "externo",
      exposicao: "fixa",
      aprovacao: "dispensada",
      description:
        "Ask for approval with buttons on Telegram. With wait_seconds it blocks until decided (long waits need an MCP client timeout above it) and returns {id,status,choice}. Otherwise, or if still undecided, returns status pending with the id: use telegram_get_approval.",
      inputSchema: {
        type: "object",
        properties: askProperties,
        required: templatesAvailable ? [] : ["message"],
        additionalProperties: false,
      },
      handler: async (args: Args, ctx: HubCallContext): Promise<HubToolResult> => {
        try {
          const rawOpts = Array.isArray(args.options) ? args.options : undefined;
          const result = await service.askApproval({
            sender: ctx.client?.name ?? "AI Agent",
            isAi: true,
            message: typeof args.message === "string" ? args.message : undefined,
            options: rawOpts,
            chatId: typeof args.chat_id === "string" ? args.chat_id : undefined,
            urgent: Boolean(args.urgent),
            silent: Boolean(args.silent),
            expiresInMinutes: typeof args.expires_in_minutes === "number" ? args.expires_in_minutes : undefined,
            templateId: typeof args.template_id === "string" ? args.template_id : undefined,
            templateData: args.data,
          });
          const waitSeconds = clampWait(args.wait_seconds, maxWait);
          if (waitSeconds > 0 && result.id) {
            const decided = await service.getApproval(result.id, waitSeconds);
            if (decided) return args.verbose === true ? jsonResult({ success: true, ...decided }) : compactResult(slimApproval(decided));
          }
          return args.verbose === true ? jsonResult({ success: true, ...result }) : compactResult({ id: result.id, status: "pending" });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_get_approval",
      title: "Get Telegram Approval Status",
      categoria: "notificacao",
      tags: ["telegram", "aprovacao", "status"],
      resumo: "Consulta status de aprovação do Telegram",
      efeito: "leitura",
      exposicao: "indice",
      description:
        "Get an approval's status, waiting up to wait seconds for a decision. Returns {id,status,choice}; pending means undecided.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The approval ID returned by telegram_ask_approval.",
          },
          wait: {
            type: "number",
            description: `Seconds to wait (max ${maxWait}, default ${DEFAULT_WAIT_SECONDS}).`,
          },
          verbose: verboseProperty,
        },
        required: ["id"],
        additionalProperties: false,
      },
      handler: async (args: Args): Promise<HubToolResult> => {
        try {
          const id = typeof args.id === "string" ? args.id : "";
          const wait = clampWait(args.wait, maxWait, DEFAULT_WAIT_SECONDS);
          const approval = await service.getApproval(id, wait);
          if (!approval) {
            return errorResult(new Error(`Approval request not found: ${id}`));
          }
          return args.verbose === true ? jsonResult({ success: true, ...approval }) : compactResult(slimApproval(approval));
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_resolve_approval",
      title: "Resolve Telegram Approval",
      categoria: "notificacao",
      tags: ["telegram", "aprovacao", "resolver"],
      resumo: "Resolve ou cancela aprovação pendente do Telegram",
      efeito: "externo",
      exposicao: "indice",
      aprovacao: "dispensada",
      description:
        "Resolve a pending approval from the agent or terminal (e.g. after user approved directly in chat). Updates the Telegram message to show the decision and removes the buttons.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Optional approval ID. If omitted, resolves the newest pending approval.",
          },
          status: {
            type: "string",
            enum: ["approved", "rejected", "interrupted"],
            description: "The resolution status.",
          },
          choice: {
            type: "string",
            description: "Optional choice label that was selected.",
          },
          detail: {
            type: "string",
            description: "Optional reason or note (e.g. 'decidido no terminal').",
          },
          all: {
            type: "boolean",
            description: "If true, resolves all currently pending approvals.",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
      handler: async (args: Args): Promise<HubToolResult> => {
        try {
          const status = typeof args.status === "string" ? args.status : "approved";
          const id = typeof args.id === "string" ? args.id : undefined;
          const choice = typeof args.choice === "string" ? args.choice : undefined;
          const detail = typeof args.detail === "string" ? args.detail : undefined;
          const all = Boolean(args.all);

          const result = await service.resolveApproval({ id, status, choice, detail, all });
          return jsonResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_ask_question",
      title: "Ask Question via Telegram",
      categoria: "notificacao",
      tags: ["telegram", "pergunta", "botoes"],
      resumo: "Faz perguntas interativas com opções via Telegram",
      efeito: "externo",
      exposicao: "fixa",
      aprovacao: "dispensada",
      description:
        "Ask one to four questions on Telegram (2-4 option buttons each, single or multiSelect, plus free text), like AskUserQuestion. Never expires unless expires_in_minutes. With wait_seconds it blocks until answered and returns {id,status,answers}; otherwise, or if unanswered, returns pending with the id: use telegram_get_question.",
      inputSchema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: QUESTION_LIMITS.questions.min,
            maxItems: QUESTION_LIMITS.questions.max,
            description: "The questions to ask. Each question text must be unique: the answers are keyed by it.",
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "The question text." },
                header: {
                  type: "string",
                  maxLength: QUESTION_LIMITS.header,
                  description: `Short title shown in bold above the question (up to ${QUESTION_LIMITS.header} characters).`,
                },
                options: {
                  type: "array",
                  minItems: QUESTION_LIMITS.options.min,
                  maxItems: QUESTION_LIMITS.options.max,
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Button text and the value returned when chosen." },
                      description: { type: "string", description: "Explanation shown next to the option." },
                    },
                    required: ["label"],
                    additionalProperties: false,
                  },
                },
                multiSelect: {
                  type: "boolean",
                  description: "If true, the user toggles several options and taps Send. The answer is a list of labels.",
                },
              },
              required: ["question", "options"],
              additionalProperties: false,
            },
          },
          allow_free_text: {
            type: "boolean",
            description: "Show the button to type a free text answer (default true).",
          },
          expires_in_minutes: {
            type: "number",
            description: "Minutes until the question expires. Omit for a question that never expires (the default).",
          },
          title: {
            type: "string",
            description: "Optional line shown above every question (for example the task being worked on).",
          },
          context: {
            type: "string",
            description: "Optional extra line shown next to the title.",
          },
          urgent: {
            type: "boolean",
            description: "Bypass quiet hours.",
          },
          silent: {
            type: "boolean",
            description: "Send without sound.",
          },
          chat_id: {
            type: "string",
            description: "Chat ID (default: owner).",
          },
          wait_seconds: { type: "number", description: waitDescription },
          verbose: verboseProperty,
        },
        required: ["questions"],
        additionalProperties: false,
      },
      handler: async (args: Args, ctx: HubCallContext): Promise<HubToolResult> => {
        try {
          const result = await service.questions.ask({
            sender: ctx.client?.name ?? "AI Agent",
            isAi: true,
            questions: args.questions,
            allowFreeText: typeof args.allow_free_text === "boolean" ? args.allow_free_text : undefined,
            title: args.title,
            context: args.context,
            chatId: typeof args.chat_id === "string" ? args.chat_id : undefined,
            urgent: Boolean(args.urgent),
            silent: Boolean(args.silent),
            expiresInMinutes: typeof args.expires_in_minutes === "number" ? args.expires_in_minutes : undefined,
          });
          const waitSeconds = clampWait(args.wait_seconds, maxWait);
          if (waitSeconds > 0 && result.id) {
            const answered = await service.questions.get(result.id, waitSeconds);
            if (answered) return args.verbose === true ? jsonResult({ success: true, ...answered }) : compactResult(slimQuestion(answered));
          }
          return args.verbose === true ? jsonResult({ success: true, ...result }) : compactResult({ id: result.id, status: "pending" });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_get_question",
      title: "Get Telegram Question Answers",
      categoria: "notificacao",
      tags: ["telegram", "pergunta", "respostas"],
      resumo: "Obtém respostas de pergunta feita no Telegram",
      efeito: "leitura",
      exposicao: "indice",
      description:
        "Get a question's answers (keyed by question text), waiting up to wait seconds. Returns {id,status,answers}; pending means unanswered.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The question ID returned by telegram_ask_question.",
          },
          wait: {
            type: "number",
            description: `Seconds to wait (max ${maxWait}, default ${DEFAULT_WAIT_SECONDS}).`,
          },
          verbose: verboseProperty,
        },
        required: ["id"],
        additionalProperties: false,
      },
      handler: async (args: Args): Promise<HubToolResult> => {
        try {
          const id = typeof args.id === "string" ? args.id : "";
          const wait = clampWait(args.wait, maxWait, DEFAULT_WAIT_SECONDS);
          const question = await service.questions.get(id, wait);
          if (!question) {
            return errorResult(new Error(t("question.error.notFound", { id })));
          }
          return args.verbose === true ? jsonResult({ success: true, ...question }) : compactResult(slimQuestion(question));
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_resolve_question",
      title: "Resolve Telegram Question",
      categoria: "notificacao",
      tags: ["telegram", "pergunta", "resolver"],
      resumo: "Encerra pergunta pendente do Telegram",
      efeito: "externo",
      exposicao: "indice",
      aprovacao: "dispensada",
      description:
        "End a pending question from the agent or terminal: the user answered on the PC (answered_elsewhere) or the question was interrupted. Updates the Telegram messages to the final status and removes the buttons, so a message never stays at waiting after the decision was made elsewhere.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Optional question ID. If omitted, resolves the newest pending question.",
          },
          status: {
            type: "string",
            enum: ["answered_elsewhere", "interrupted"],
            description: "The resolution status.",
          },
          detail: {
            type: "string",
            description: "Optional note shown in the message (e.g. 'answered in the terminal').",
          },
          all: {
            type: "boolean",
            description: "If true, resolves all currently pending questions.",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
      handler: async (args: Args): Promise<HubToolResult> => {
        try {
          const result = await service.questions.resolve({
            id: typeof args.id === "string" ? args.id : undefined,
            status: typeof args.status === "string" ? args.status : "answered_elsewhere",
            detail: typeof args.detail === "string" ? args.detail : undefined,
            all: Boolean(args.all),
          });
          return jsonResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
  ];
}
