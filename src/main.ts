// Plugin entry point: Telegram AI Gateway v2.0.0
import { Notice, Plugin, TFile, setIcon } from "obsidian";
import { buildRoutes } from "./api/routes";
import { buildTools } from "./api/tools";
import { ApprovalStore } from "./approvals/store";
import { EcosystemConnector } from "./ecosystem/connector";
import { MissingEcosystemModal } from "./ecosystem/dependency-modal";
import {
  AI_ECOSYSTEM_API_VERSION,
  HOOKS_SERVICE,
  MODULE_ID,
  SECRETS_SERVICE,
  SECRET_HOLDER_SERVICE,
  TEMPLATES_SERVICE,
} from "./ecosystem/types";
import type { AIEcosystemAPI, HooksService, SecretVaultService } from "./ecosystem/types";
import { GatewayService } from "./gateway/gateway-service";
import { OwnerDiscovery } from "./gateway/owner-discovery";
import { t } from "./i18n";
import { PolicyEngine } from "./policy/policy";
import { isQuestionCallback } from "./questions/format";
import { QuestionStore } from "./questions/store";
import { FileQueueWatcher } from "./queue/file-queue";
import { createSetupHandler } from "./setup/setup-handler";
import { CustomMessageModal } from "./settings/custom-message-modal";
import { TelegramAIGatewaySettingTab } from "./settings/settings-tab";
import type { GatewaySettings } from "./settings/settings";
import { DEFAULT_SETTINGS, loadSettings } from "./settings/settings";
import { TelegramClient } from "./telegram/client";
import { LongPoller } from "./telegram/poller";
import { createTransport } from "./telegram/transport";
import { TokenManager } from "./token/token-manager";
import { systemClock } from "./util/clock";

export default class TelegramAIGatewayPlugin extends Plugin {
  settings: GatewaySettings = DEFAULT_SETTINGS;

  tokenManager!: TokenManager;
  policy!: PolicyEngine;
  store!: ApprovalStore;
  questionStore!: QuestionStore;
  client!: TelegramClient;
  poller!: LongPoller;
  gatewayService!: GatewayService;
  fileQueueWatcher!: FileQueueWatcher;
  connector!: EcosystemConnector;
  ownerDiscovery!: OwnerDiscovery;

  private unregisterSetupHandler: (() => void) | undefined;
  private settingTab: TelegramAIGatewaySettingTab | undefined;
  private statusIconEl: HTMLElement | undefined;
  private statusTextEl: HTMLElement | undefined;

  async onload(): Promise<void> {
    const loaded = loadSettings(await this.loadData());
    this.settings = loaded.settings;

    const clock = systemClock;

    // Approvals store
    this.store = new ApprovalStore(
      {
        clock,
        onChange: () => {
          this.settings.approvals = this.store.toPersisted();
          void this.saveSettings();
        },
      },
      this.settings.approvals,
    );

    // Questions store (telegram_ask_question): pending ones survive a reload like approvals
    this.questionStore = new QuestionStore(
      {
        clock,
        onChange: () => {
          this.settings.questions = this.questionStore.toPersisted();
          void this.saveSettings();
        },
      },
      this.settings.questions,
    );

    if (loaded.migrated) {
      await this.saveSettings();
    }

    // Token manager
    this.tokenManager = new TokenManager({
      settings: () => this.settings,
      save: async () => this.saveSettings(),
      secrets: () => this.connector?.getApi()?.getService<SecretVaultService>(SECRETS_SERVICE),
      onChange: () => {
        this.poller?.restart();
        this.settingTab?.refresh();
      },
    });

    // Transport and API client
    const transport = createTransport({
      resolveToken: () => this.tokenManager.resolve(),
      clock,
    });
    this.client = new TelegramClient(transport);

    // Learns the owner chat id from the first /start (the user never types it)
    this.ownerDiscovery = new OwnerDiscovery({
      settings: () => this.settings,
      saveSettings: async () => this.saveSettings(),
      client: this.client,
      language: () => this.policy.resolveMessageLanguage(),
      onDiscovered: () => {
        new Notice(t("core.notice.ownerDiscovered"));
        this.updateStatusBar();
        this.settingTab?.refresh();
      },
    });

    // Poller for button clicks, typed answers and /start (runs only while approvals or questions are pending, or the owner is unknown)
    this.poller = new LongPoller({
      api: this.client,
      clock,
      shouldRun: () =>
        this.tokenManager.isConfigured() &&
        (this.store.pendingCount() > 0 || this.questionStore.pendingCount() > 0 || this.ownerDiscovery.isWaiting(true)),
      onUpdates: async (updates) => {
        for (const update of updates) {
          if (update.callback_query) {
            if (isQuestionCallback(update.callback_query.data)) {
              await this.gatewayService.questions.handleCallbackQuery(update.callback_query);
            } else {
              await this.gatewayService.handleCallbackQuery(update.callback_query);
            }
          } else if (update.message) {
            // A typed answer to a question is only a reply to the message that asked for it
            if (!(await this.gatewayService.questions.handleMessage(update.message))) {
              await this.ownerDiscovery.handleMessage(update.message);
            }
          }
        }
      },
      onStatus: () => this.updateStatusBar(),
      redact: (text) => this.tokenManager.redact(text),
    });

    // Policy engine
    this.policy = new PolicyEngine(() => this.settings, clock);

    // Main service
    this.gatewayService = new GatewayService({
      settings: () => this.settings,
      saveSettings: async () => this.saveSettings(),
      tokenManager: this.tokenManager,
      policy: this.policy,
      store: this.store,
      questionStore: this.questionStore,
      client: this.client,
      poller: this.poller,
      clock,
      getEcosystemApi: () => this.connector?.getApi(),
    });

    // File queue watcher
    this.fileQueueWatcher = new FileQueueWatcher(this.app, this.gatewayService, () => this.settings);
    if (this.settings.enableFileQueue) {
      this.fileQueueWatcher.start();
    }

    // Periodic check for expired approvals and questions
    this.registerInterval(
      window.setInterval(() => {
        void this.gatewayService.checkDueApprovals();
        void this.gatewayService.questions.checkDue();
      }, 60_000),
    );

    // Setup Status Bar Item
    this.setupStatusBar();

    // Connector for AI Ecosystem Provider API
    this.connector = new EcosystemConnector(this, {
      buildRegistration: () => ({
        id: MODULE_ID,
        name: this.manifest.name,
        version: this.manifest.version,
        apiVersion: AI_ECOSYSTEM_API_VERSION,
        routes: buildRoutes(this.gatewayService),
        tools: buildTools(this.gatewayService, this.gatewayService.isTemplatesAvailable()),
        instructions:
          "Send Telegram notifications and interactive approval requests with buttons. For approvals, call telegram_ask_approval with wait_seconds to block until the user decides, or without it and then call telegram_get_approval (it waits up to wait seconds); only call again if the status is still pending. Use telegram_resolve_approval when deciding from chat or terminal. To ask the user real questions (one to four, with option buttons, multiple choice and typed answers), call telegram_ask_question the same way (wait_seconds, then telegram_get_question); questions never expire unless expires_in_minutes is given. Use telegram_resolve_question when the user answered somewhere else.",
      }),
      onStatus: () => {
        this.updateStatusBar();
        this.settingTab?.refresh();
      },
      onMissing: () => new MissingEcosystemModal(this.app).open(),
      onIncompatible: (reason) => new Notice(`Telegram AI Gateway: ${reason}`),
      onConnected: (api) => {
        // Expose secret-holder service for late adoption by Environment Keys
        api.registerService(SECRET_HOLDER_SERVICE, MODULE_ID, this.tokenManager.holder);

        // Guided setup (hooks service of the AI Ecosystem; absent in older cores)
        this.registerSetupHandler(api);

        // Waiting for the first /start: poll until the owner chat is known
        this.poller.ensureRunning();

        // Sync tool index (API 1.1 tools.db)
        this.syncToolIndex();

        // Listen for service changes (templates, secrets)
        api.onServiceChange((name: string) => {
          if (name === TEMPLATES_SERVICE) {
            api.updateTools(MODULE_ID, buildTools(this.gatewayService, this.gatewayService.isTemplatesAvailable()));
            this.syncToolIndex();
            this.settingTab?.refresh();
          }
          if (name === SECRETS_SERVICE) {
            this.settingTab?.refresh();
          }
          if (name === HOOKS_SERVICE) {
            this.registerSetupHandler(api);
          }
        });
      },
      onDisconnected: () => {
        this.unregisterSetupHandler?.();
        this.unregisterSetupHandler = undefined;
        this.updateStatusBar();
        this.settingTab?.refresh();
      },
    });
    this.connector.start();

    // Commands
    this.registerCommands();

    // Ribbon Icon
    this.addRibbonIcon("send", t("core.ribbon.title"), () => {
      new CustomMessageModal(this.app, (text) => {
        void this.gatewayService.sendMessage({ sender: "User", isAi: false, message: text });
      }).open();
    });

    // Expose global API on window
    (window as unknown as { TelegramAIGateway: unknown }).TelegramAIGateway = {
      send: (p: Record<string, unknown>) => this.gatewayService.sendMessage({ isAi: true, ...p }),
      askApproval: (p: Record<string, unknown>) => this.gatewayService.askApproval({ isAi: true, ...p }),
      resolveApproval: (p: Record<string, unknown>) =>
        this.gatewayService.resolveApproval(p as unknown as Parameters<GatewayService["resolveApproval"]>[0]),
      askQuestion: (p: Record<string, unknown>) => this.gatewayService.questions.ask({ isAi: true, ...p }),
      getQuestion: (id: string, wait?: number) => this.gatewayService.questions.get(id, wait),
      resolveQuestion: (p: Record<string, unknown>) =>
        this.gatewayService.questions.resolve(p as unknown as Parameters<GatewayService["questions"]["resolve"]>[0]),
      getStatus: () => this.gatewayService.getStatus(),
    };

    // Setting Tab
    this.settingTab = new TelegramAIGatewaySettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  onunload(): void {
    this.unregisterSetupHandler?.();
    this.unregisterSetupHandler = undefined;
    this.poller?.stop();
    this.fileQueueWatcher?.stop();
    this.connector?.stop();
    this.store?.releaseWaiters();
    this.questionStore?.releaseWaiters();
    delete (window as unknown as { TelegramAIGateway?: unknown }).TelegramAIGateway;
  }

  async saveSettings(): Promise<void> {
    if (this.store) {
      this.settings.approvals = this.store.toPersisted();
    }
    if (this.questionStore) {
      this.settings.questions = this.questionStore.toPersisted();
    }
    await this.saveData(this.settings);
  }

  private registerSetupHandler(api: AIEcosystemAPI): void {
    this.unregisterSetupHandler?.();
    this.unregisterSetupHandler = api.getService<HooksService>(HOOKS_SERVICE)?.registerSetupHandler(
      MODULE_ID,
      createSetupHandler({
        settings: () => this.settings,
        saveSettings: async () => this.saveSettings(),
        tokenManager: this.tokenManager,
        secrets: () => api.getService<SecretVaultService>(SECRETS_SERVICE),
      }),
    );
  }

  private registerCommands(): void {
    this.addCommand({
      id: "tg-send-active-note",
      name: t("core.cmd.sendActiveNote"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file instanceof TFile) {
          if (!checking) {
            void this.app.vault.read(file).then((content) => {
              void this.gatewayService
                .sendMessage({ sender: "User", isAi: false, message: `📄 **${file.basename}**\n\n${content}` })
                .then(() => new Notice(t("core.notice.sent")))
                .catch((err) => new Notice(t("core.notice.failed", { error: String(err) })));
            });
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "tg-send-selected-text",
      name: t("core.cmd.sendSelection"),
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (!selection || !selection.trim()) {
          new Notice(t("core.notice.noSelection"));
          return;
        }
        void this.gatewayService
          .sendMessage({ sender: "User", isAi: false, message: selection.trim() })
          .then(() => new Notice(t("core.notice.sent")))
          .catch((err) => new Notice(t("core.notice.failed", { error: String(err) })));
      },
    });

    this.addCommand({
      id: "tg-send-custom-message",
      name: t("core.cmd.sendCustom"),
      callback: () => {
        new CustomMessageModal(this.app, (text) => {
          void this.gatewayService
            .sendMessage({ sender: "User", isAi: false, message: text })
            .then(() => new Notice(t("core.notice.sent")))
            .catch((err) => new Notice(t("core.notice.failed", { error: String(err) })));
        }).open();
      },
    });

    this.addCommand({
      id: "tg-test-connection",
      name: t("core.cmd.testConnection"),
      callback: () => {
        new Notice(t("core.notice.testing"));
        void this.gatewayService
          .sendMessage({ sender: "User", isAi: false, message: t("core.notice.testSuccess") })
          .then(() => new Notice(t("core.notice.testSuccess")))
          .catch((err) => new Notice(t("core.notice.failed", { error: String(err) })));
      },
    });
  }

  private setupStatusBar(): void {
    const el = this.addStatusBarItem();
    el.addClass("tag-status-bar", "mod-clickable");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", t("core.ribbon.title"));
    this.statusIconEl = el.createSpan({ cls: "tag-status-bar-icon" });
    this.statusTextEl = el.createSpan({ cls: "tag-status-bar-text" });

    el.onclick = () => {
      (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting.open();
      (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting.openTabById(MODULE_ID);
    };

    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    if (!this.statusIconEl || !this.statusTextEl) return;
    this.statusIconEl.empty();
    const conn = this.connector?.status ?? "missing";

    if (conn === "connected") {
      const pollerState = this.poller?.status.state ?? "idle";
      const pending = (this.store?.pendingCount() ?? 0) + (this.questionStore?.pendingCount() ?? 0);
      if (pending > 0) {
        setIcon(this.statusIconEl, "clock");
        this.statusTextEl.setText(`Telegram (${pending})`);
      } else if (pollerState === "conflict") {
        setIcon(this.statusIconEl, "alert-triangle");
        this.statusTextEl.setText("Telegram: conflict");
      } else {
        setIcon(this.statusIconEl, "send");
        this.statusTextEl.setText("Telegram");
      }
    } else if (conn === "waiting") {
      setIcon(this.statusIconEl, "loader");
      this.statusTextEl.setText("Telegram: waiting");
    } else {
      setIcon(this.statusIconEl, "alert-circle");
      this.statusTextEl.setText("Telegram: offline");
    }
  }
  private syncToolIndex(): void {
    const api = this.connector?.getApi();
    if (!api?.toolIndex) return;
    const tools = buildTools(this.gatewayService, this.gatewayService.isTemplatesAvailable());
    const entries = tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      categoria: t.categoria,
      tags: t.tags,
      resumo: t.resumo,
      efeito: t.efeito,
      exposicao: t.exposicao,
      aprovacao: t.aprovacao,
    }));
    api.toolIndex.sync(MODULE_ID, entries).catch((err: unknown) => {
      console.error("[Telegram AI Gateway] Could not sync the tool index", err);
    });
  }
}