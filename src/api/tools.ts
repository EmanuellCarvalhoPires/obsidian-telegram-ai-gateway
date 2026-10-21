// MCP tools registered in the AI Ecosystem for Claude Code, Antigravity and scripts.
import type { HubCallContext, HubTool, HubToolResult } from "../ecosystem/types";
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

function errorResult(err: unknown): HubToolResult {
  const message = err instanceof PolicyViolationError ? err.message : errorMessage(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export function buildTools(service: GatewayService, templatesAvailable: boolean): HubTool[] {
  const sendProperties: Record<string, unknown> = {
    message: {
      type: "string",
      description: "Text message to send to Telegram (supports HTML and plain text).",
    },
    urgent: {
      type: "boolean",
      description: "If true, bypasses quiet hours restrictions.",
    },
    silent: {
      type: "boolean",
      description: "If true, sends without audible notification on recipient device.",
    },
    chat_id: {
      type: "string",
      description: "Target Telegram Chat ID. Defaults to the configured owner chat ID.",
    },
  };

  const askProperties: Record<string, unknown> = {
    message: {
      type: "string",
      description: "Question or decision text to present above the buttons.",
    },
    options: {
      type: "array",
      items: { type: "string" },
      description: "List of button options (e.g. ['Aprovar', 'Rejeitar'] or ['Sim', 'Não']).",
    },
    urgent: {
      type: "boolean",
      description: "If true, bypasses quiet hours.",
    },
    silent: {
      type: "boolean",
      description: "If true, sends silently without notification sound.",
    },
    chat_id: {
      type: "string",
      description: "Target Telegram Chat ID (defaults to owner chat ID).",
    },
    expires_in_minutes: {
      type: "number",
      description: "Minutes until this approval expires automatically.",
    },
  };

  if (templatesAvailable) {
    sendProperties.template_id = {
      type: "string",
      description: "ID of the AI Template to render before sending (via AI Templates plugin).",
    };
    sendProperties.data = {
      type: "object",
      description: "Template variables and table payload.",
    };

    askProperties.template_id = {
      type: "string",
      description: "ID of the AI Template to render before sending.",
    };
    askProperties.data = {
      type: "object",
      description: "Template variables and table payload.",
    };
  }

  return [
    {
      name: "telegram_send_message",
      title: "Send Telegram Notification",
      description:
        "Send a notification message to Telegram from AI agents. With AI Templates active, accepts template_id and data.",
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
      description:
        "Ask for user confirmation or approval with interactive buttons on Telegram. Returns immediately with an approval id in status pending. Poll telegram_get_approval to check the user's decision.",
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
          return jsonResult({ success: true, ...result });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_get_approval",
      title: "Get Telegram Approval Status",
      description:
        "Check the status of a pending Telegram approval request. Waits up to 25 seconds for a decision if wait is provided. Call repeatedly in a loop until status is no longer pending.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The approval ID returned by telegram_ask_approval.",
          },
          wait: {
            type: "number",
            description: "Seconds to wait for a decision (max 25s, default 25s).",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      handler: async (args: Args): Promise<HubToolResult> => {
        try {
          const id = typeof args.id === "string" ? args.id : "";
          const wait = typeof args.wait === "number" ? Math.min(25, Math.max(0, args.wait)) : 25;
          const approval = await service.getApproval(id, wait);
          if (!approval) {
            return errorResult(new Error(`Approval request not found: ${id}`));
          }
          return jsonResult({ success: true, ...approval });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_resolve_approval",
      title: "Resolve Telegram Approval",
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
      description:
        "Ask the user one to four questions on Telegram, each with two to four options as buttons (single choice or multiSelect) and a button to type a free text answer. Same shape as Claude Code's AskUserQuestion. Sends one message per question and returns immediately with a question id in status pending. The question never expires unless expires_in_minutes is given. Poll telegram_get_question until the status is no longer pending.",
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
            description: "If true, bypasses quiet hours.",
          },
          silent: {
            type: "boolean",
            description: "If true, sends silently without notification sound.",
          },
          chat_id: {
            type: "string",
            description: "Target Telegram Chat ID (defaults to owner chat ID).",
          },
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
          return jsonResult({ success: true, ...result });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_get_question",
      title: "Get Telegram Question Answers",
      description:
        "Check a question asked with telegram_ask_question. Waits up to 25 seconds for the answers. When answered, returns answers keyed by question text: the chosen label, a list of labels for multiSelect, or the typed text; free_text marks the questions answered with typed text. Call repeatedly until status is no longer pending.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The question ID returned by telegram_ask_question.",
          },
          wait: {
            type: "number",
            description: "Seconds to wait for the answers (max 25s, default 25s).",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      handler: async (args: Args): Promise<HubToolResult> => {
        try {
          const id = typeof args.id === "string" ? args.id : "";
          const wait = typeof args.wait === "number" ? Math.min(25, Math.max(0, args.wait)) : 25;
          const question = await service.questions.get(id, wait);
          if (!question) {
            return errorResult(new Error(t("question.error.notFound", { id })));
          }
          return jsonResult({ success: true, ...question });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: "telegram_resolve_question",
      title: "Resolve Telegram Question",
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
