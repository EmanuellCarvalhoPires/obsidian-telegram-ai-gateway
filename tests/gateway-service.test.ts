import { describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/approvals/store";
import { GatewayService } from "../src/gateway/gateway-service";
import { QuestionStore } from "../src/questions/store";
import { PolicyEngine } from "../src/policy/policy";
import { DEFAULT_SETTINGS } from "../src/settings/settings";
import type { GatewaySettings } from "../src/settings/settings";
import { TokenManager } from "../src/token/token-manager";
import type { TelegramApi } from "../src/telegram/client";
import { LongPoller } from "../src/telegram/poller";
import type { AIEcosystemAPI, TemplatesService } from "../src/ecosystem/types";

describe("GatewayService", () => {
  function setupTestService(opts?: { allowTemplates?: boolean; templateServiceMock?: boolean }) {
    let settings: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u",
      chatId: "12345",
      allowTemplates: opts?.allowTemplates ?? true,
    };

    const clock = {
      now: () => 1000,
      setTimeout: (cb: any) => { cb(); return 0 as any; },
      clearTimeout: () => {},
    };

    const store = new ApprovalStore({ clock });
    const tokenManager = new TokenManager({
      settings: () => settings,
      save: async () => {},
      secrets: () => undefined,
      onChange: () => {},
    });

    const sentMessages: any[] = [];
    const editedMessages: any[] = [];
    const mockClient: TelegramApi = {
      sendMessage: async (p) => {
        sentMessages.push(p);
        return { message_id: 1000 + sentMessages.length, date: 0, chat: { id: 123 } };
      },
      editMessageText: async (p) => {
        editedMessages.push(p);
      },
      answerCallbackQuery: async () => {},
      deleteMessage: async () => {},
      getUpdates: async () => [],
      getMe: async () => ({ id: 1, is_bot: true, first_name: "Bot" }),
    };

    const poller = new LongPoller({
      api: mockClient,
      clock,
      shouldRun: () => false,
      onUpdates: () => {},
    });

    const policy = new PolicyEngine(() => settings, clock);

    let templatesService: TemplatesService | undefined;
    if (opts?.templateServiceMock) {
      templatesService = {
        render: async (id, data) => `Rendered template ${id}: ${JSON.stringify(data)}`,
        getSchema: () => ({}),
        listTemplates: () => [],
      };
    }

    const mockEcoApi: Partial<AIEcosystemAPI> = {
      getService: (name: string) => {
        if (name === "templates") return templatesService as any;
        return undefined;
      },
      logActivity: () => {},
    };

    const service = new GatewayService({
      settings: () => settings,
      saveSettings: async () => {},
      tokenManager,
      policy,
      store,
      questionStore: new QuestionStore({ clock }),
      client: mockClient,
      poller,
      clock,
      getEcosystemApi: () => mockEcoApi as AIEcosystemAPI,
    });

    return { service, store, sentMessages, editedMessages, settings };
  }

  it("sends simple notification message", async () => {
    const { service, sentMessages } = setupTestService();

    const res = await service.sendMessage({
      message: "Hello Telegram!",
      isAi: true,
      sender: "TestAgent",
    });

    expect(res.status).toBe("sent");
    expect(res.recipient).toBe("12345");
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].text).toContain("Hello Telegram!");
  });

  it("asks approval with interactive buttons and resolves via callback", async () => {
    const { service, store, sentMessages, editedMessages } = setupTestService();

    const askRes = await service.askApproval({
      message: "Confirm release?",
      options: ["Aprovar", "Rejeitar"],
      isAi: true,
    });

    expect(askRes.status).toBe("pending");
    expect(askRes.id).toMatch(/^apr_/);
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].reply_markup?.inline_keyboard).toBeDefined();

    // Simulate clicking "Aprovar" (index 0)
    await service.handleCallbackQuery({
      id: "cb_1",
      data: `a:${askRes.id}:0`,
      message: { message_id: sentMessages[0].message_id, chat: { id: "12345" } },
    });

    const approval = store.get(askRes.id);
    expect(approval?.status).toBe("approved");
    expect(approval?.choice).toBe("Aprovar");
    expect(approval?.decidedBy).toBe("telegram");

    // Verified Telegram message was edited to remove keyboard & show decision
    expect(editedMessages.length).toBe(1);
    expect(editedMessages[0].text).toContain("Aprovado: Aprovar");
  });

  it("resolves approval from terminal/chat", async () => {
    const { service, store, editedMessages } = setupTestService();

    const askRes = await service.askApproval({
      message: "Merge PR?",
      options: ["Sim", "Não"],
      isAi: true,
    });

    const res = await service.resolveApproval({
      id: askRes.id,
      status: "approved",
      choice: "Sim",
      detail: "decidido no terminal",
    });

    expect(res.success).toBe(true);
    expect(res.resolved[0]?.status).toBe("approved");

    const approval = store.get(askRes.id);
    expect(approval?.status).toBe("approved");
    expect(approval?.decidedBy).toBe("resolve");
    expect(editedMessages.length).toBe(1);
  });

  it("renders with AI Templates when available, fails with 400 when unavailable", async () => {
    // Available
    const { service: serviceWithTemplates } = setupTestService({ templateServiceMock: true });
    const res = await serviceWithTemplates.sendMessage({
      templateId: "weekly-report",
      templateData: { count: 5 },
    });
    expect(res.status).toBe("sent");

    // Unavailable
    const { service: serviceWithoutTemplates } = setupTestService({ templateServiceMock: false });
    await expect(
      serviceWithoutTemplates.sendMessage({
        templateId: "weekly-report",
        templateData: { count: 5 },
      }),
    ).rejects.toThrow("Templates require the AI Templates plugin to be active.");
  });
});
