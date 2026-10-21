// HTTP routes registered with the AI Ecosystem under /api/v1/telegram-ai-gateway/...
import type { HubRequest, HubResponse, HubRoute } from "../ecosystem/types";
import type { GatewayService } from "../gateway/gateway-service";
import { t } from "../i18n";
import { PolicyViolationError } from "../policy/policy";
import { isRecord } from "../util/guards";

export function buildRoutes(service: GatewayService): HubRoute[] {
  return [
    {
      method: "POST",
      path: "/send",
      description: "Send a notification message to Telegram.",
      handler: async (req: HubRequest): Promise<HubResponse> => {
        try {
          const body = isRecord(req.body) ? req.body : {};
          const result = await service.sendMessage({
            sender: req.client?.name ?? "AI Agent",
            isAi: true,
            message: typeof body.message === "string" ? body.message : undefined,
            text: typeof body.text === "string" ? body.text : undefined,
            chatId: typeof body.chat_id === "string" ? body.chat_id : typeof body.chatId === "string" ? body.chatId : undefined,
            urgent: Boolean(body.urgent),
            silent: Boolean(body.silent),
            templateId: typeof body.template_id === "string" ? body.template_id : undefined,
            templateData: body.data,
          });
          return { status: 200, body: { success: true, ...result } };
        } catch (err) {
          return handleRouteError(err);
        }
      },
    },
    {
      method: "POST",
      path: "/message",
      description: "Alias for /send.",
      handler: async (req: HubRequest): Promise<HubResponse> => {
        try {
          const body = isRecord(req.body) ? req.body : {};
          const result = await service.sendMessage({
            sender: req.client?.name ?? "AI Agent",
            isAi: true,
            message: typeof body.message === "string" ? body.message : undefined,
            text: typeof body.text === "string" ? body.text : undefined,
            chatId: typeof body.chat_id === "string" ? body.chat_id : typeof body.chatId === "string" ? body.chatId : undefined,
            urgent: Boolean(body.urgent),
            silent: Boolean(body.silent),
            templateId: typeof body.template_id === "string" ? body.template_id : undefined,
            templateData: body.data,
          });
          return { status: 200, body: { success: true, ...result } };
        } catch (err) {
          return handleRouteError(err);
        }
      },
    },
    {
      method: "POST",
      path: "/approval",
      description: "Ask for confirmation with interactive Telegram buttons. Responds with 202 and pending status.",
      handler: async (req: HubRequest): Promise<HubResponse> => {
        try {
          const body = isRecord(req.body) ? req.body : {};
          const options = Array.isArray(body.options) ? body.options : undefined;
          const result = await service.askApproval({
            sender: req.client?.name ?? "AI Agent",
            isAi: true,
            message: typeof body.message === "string" ? body.message : undefined,
            text: typeof body.text === "string" ? body.text : undefined,
            options,
            chatId: typeof body.chat_id === "string" ? body.chat_id : typeof body.chatId === "string" ? body.chatId : undefined,
            urgent: Boolean(body.urgent),
            silent: Boolean(body.silent),
            expiresInMinutes: typeof body.expires_in_minutes === "number" ? body.expires_in_minutes : undefined,
            templateId: typeof body.template_id === "string" ? body.template_id : undefined,
            templateData: body.data,
          });
          return { status: 202, body: { success: true, ...result } };
        } catch (err) {
          return handleRouteError(err);
        }
      },
    },
    {
      method: "GET",
      path: "/approval/:id",
      description: "Query decision status of an approval. Supports ?wait=<seconds> (max 25s).",
      handler: async (req: HubRequest): Promise<HubResponse> => {
        try {
          const id = req.params.id;
          if (!id) return { status: 400, body: { error: "Missing approval ID parameter." } };
          const waitParam = req.query.wait;
          const waitSeconds = waitParam ? Math.min(25, Math.max(0, parseInt(waitParam, 10) || 0)) : 0;
          const approval = await service.getApproval(id, waitSeconds);
          if (!approval) {
            return { status: 404, body: { error: `Approval not found: ${id}` } };
          }
          return { status: 200, body: approval };
        } catch (err) {
          return handleRouteError(err);
        }
      },
    },
    {
      method: "POST",
      path: "/resolve",
      description: "Mark pending approval(s) as approved, rejected or interrupted from chat or terminal.",
      handler: async (req: HubRequest): Promise<HubResponse> => {
        try {
          const body = isRecord(req.body) ? req.body : {};
          const status = typeof body.status === "string" ? body.status : "approved";
          const id = typeof body.id === "string" ? body.id : undefined;
          const choice = typeof body.choice === "string" ? body.choice : undefined;
          const detail = typeof body.detail === "string" ? body.detail : undefined;
          const all = Boolean(body.all);

          const result = await service.resolveApproval({ id, status, choice, detail, all });
          return { status: 200, body: result };
        } catch (err) {
          return handleRouteError(err);
        }
      },
    },
    {
      method: "POST",
      path: "/question",
      description:
        "Ask one to four questions with option buttons and free text on Telegram. Responds with 202 and pending status. The question never expires unless expires_in_minutes is given.",
      handler: async (req: HubRequest): Promise<HubResponse> => {
        try {
          const body = isRecord(req.body) ? req.body : {};
          const result = await service.questions.ask({
            sender: req.client?.name ?? "AI Agent",
            isAi: true,
            questions: body.questions,
            allowFreeText: typeof body.allow_free_text === "boolean" ? body.allow_free_text : undefined,
            title: body.title,
            context: body.context,
            chatId: typeof body.chat_id === "string" ? body.chat_id : typeof body.chatId === "string" ? body.chatId : undefined,
            urgent: Boolean(body.urgent),
            silent: Boolean(body.silent),
            expiresInMinutes: typeof body.expires_in_minutes === "number" ? body.expires_in_minutes : undefined,
          });
          return { status: 202, body: { success: true, ...result } };
        } catch (err) {
          return handleRouteError(err);
        }
      },
    },
    {
      method: "GET",
      path: "/question/:id",
      description: "Query the answers of a question. Supports ?wait=<seconds> (max 25s).",
      handler: async (req: HubRequest): Promise<HubResponse> => {
        try {
          const id = req.params.id;
          if (!id) return { status: 400, body: { error: "Missing question ID parameter." } };
          const waitParam = req.query.wait;
          const waitSeconds = waitParam ? Math.min(25, Math.max(0, parseInt(waitParam, 10) || 0)) : 0;
          const question = await service.questions.get(id, waitSeconds);
          if (!question) {
            return { status: 404, body: { error: t("question.error.notFound", { id }) } };
          }
          return { status: 200, body: question };
        } catch (err) {
          return handleRouteError(err);
        }
      },
    },
    {
      method: "POST",
      path: "/question/resolve",
      description: "Mark pending question(s) as answered elsewhere (on the PC) or interrupted, and clean the Telegram messages.",
      handler: async (req: HubRequest): Promise<HubResponse> => {
        try {
          const body = isRecord(req.body) ? req.body : {};
          const result = await service.questions.resolve({
            id: typeof body.id === "string" ? body.id : undefined,
            status: typeof body.status === "string" ? body.status : "answered_elsewhere",
            detail: typeof body.detail === "string" ? body.detail : undefined,
            all: Boolean(body.all),
          });
          return { status: 200, body: result };
        } catch (err) {
          return handleRouteError(err);
        }
      },
    },
    {
      method: "GET",
      path: "/status",
      description: "Check bot status, poller state, token source and pending approvals and questions.",
      handler: (_req: HubRequest): HubResponse => {
        return { status: 200, body: service.getStatus() };
      },
    },
  ];
}

function handleRouteError(err: unknown): HubResponse {
  if (err instanceof PolicyViolationError) {
    return { status: err.statusCode, body: { success: false, error: err.message, code: err.statusCode } };
  }
  const status = (err as { status?: number; statusCode?: number }).statusCode ?? (err as { status?: number }).status ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  return { status, body: { success: false, error: message, code: status } };
}
