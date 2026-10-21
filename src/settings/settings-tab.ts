// Settings tab for Telegram AI Gateway. Strictly follows no-emoji policy (uses Lucide icons via setIcon).
import { Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";
import type { MessageLanguageSetting } from "./settings";
import { LIMITS } from "./settings";
import type TelegramAIGatewayPlugin from "../main";

export class TelegramAIGatewaySettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: TelegramAIGatewayPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // =========================================================================
    // 1. AI Ecosystem Connection
    // =========================================================================
    this.createHeader(containerEl, t("settings.ecosystem.heading"), "cpu");

    const status = this.plugin.connector.status;
    const ecoSetting = new Setting(containerEl).setName(t(`status.${status}`));

    if (status === "connected") {
      ecoSetting.setDesc(t("settings.ecosystem.connectedDesc"));
      const pill = ecoSetting.controlEl.createSpan({ cls: "tag-status-pill mod-success" });
      setIcon(pill.createSpan(), "check-circle");
      pill.appendText("Connected");
    } else if (status === "waiting") {
      ecoSetting.setDesc(t("settings.ecosystem.waitingDesc"));
      const pill = ecoSetting.controlEl.createSpan({ cls: "tag-status-pill mod-warning" });
      setIcon(pill.createSpan(), "clock");
      pill.appendText("Waiting");
    } else if (status === "incompatible") {
      ecoSetting.setDesc(t("settings.ecosystem.incompatibleDesc", { reason: "API version mismatch" }));
      const pill = ecoSetting.controlEl.createSpan({ cls: "tag-status-pill mod-error" });
      setIcon(pill.createSpan(), "alert-triangle");
      pill.appendText("Incompatible");
    } else {
      ecoSetting.setDesc(t("settings.ecosystem.missingDesc"));
      const pill = ecoSetting.controlEl.createSpan({ cls: "tag-status-pill mod-error" });
      setIcon(pill.createSpan(), "alert-circle");
      pill.appendText("Missing");
    }

    // =========================================================================
    // 2. Telegram Bot Credentials
    // =========================================================================
    this.createHeader(containerEl, t("settings.bot.heading"), "bot");

    const tokenState = this.plugin.tokenManager.getState();
    const tokenSetting = new Setting(containerEl)
      .setName(t("settings.bot.token"))
      .setDesc(t("settings.bot.tokenDesc"));

    if (tokenState === "env-keys") {
      tokenSetting.addText((text) =>
        text
          .setPlaceholder(this.plugin.settings.botTokenPlaceholder)
          .setValue(this.plugin.settings.botTokenPlaceholder)
          .setDisabled(true),
      );
      const pill = tokenSetting.controlEl.createSpan({ cls: "tag-status-pill mod-success" });
      setIcon(pill.createSpan(), "shield-check");
      pill.appendText(t("token.envKeys"));

      tokenSetting.addButton((btn) =>
        btn
          .setButtonText(t("modal.custom.cancel"))
          .setIcon("trash")
          .onClick(async () => {
            await this.plugin.tokenManager.setToken("");
            this.display();
          }),
      );
    } else {
      tokenSetting.addText((text) =>
        text
          .setPlaceholder(t("settings.bot.tokenPlaceholder"))
          .setValue(this.plugin.settings.botToken)
          .onChange(async (val) => {
            await this.plugin.tokenManager.setToken(val);
          }),
      );

      if (tokenState === "plaintext") {
        const pill = tokenSetting.controlEl.createSpan({ cls: "tag-status-pill mod-warning" });
        setIcon(pill.createSpan(), "key");
        pill.appendText(t("token.plaintext"));

        if (this.plugin.tokenManager.canAdopt()) {
          new Setting(containerEl)
            .setName(t("token.adoptBtn"))
            .setDesc(t("token.adoptBtnDesc"))
            .addButton((btn) =>
              btn
                .setButtonText(t("token.adoptBtn"))
                .setIcon("shield")
                .setCta()
                .onClick(async () => {
                  const res = await this.plugin.tokenManager.adoptNow();
                  if (res.kind === "adopted") {
                    new Notice(t("token.adoptSuccess"));
                    this.display();
                  }
                }),
            );
        }
      } else if (tokenState === "vault-locked") {
        const pill = tokenSetting.controlEl.createSpan({ cls: "tag-status-pill mod-error" });
        setIcon(pill.createSpan(), "lock");
        pill.appendText(t("token.vaultLocked"));
      } else if (tokenState === "env-keys-missing") {
        const pill = tokenSetting.controlEl.createSpan({ cls: "tag-status-pill mod-error" });
        setIcon(pill.createSpan(), "alert-circle");
        pill.appendText(t("token.envKeysMissing"));
      }
    }

    // Chat ID
    new Setting(containerEl)
      .setName(t("settings.bot.chatId"))
      .setDesc(t("settings.bot.chatIdDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.bot.chatIdPlaceholder"))
          .setValue(this.plugin.settings.chatId)
          .onChange(async (val) => {
            this.plugin.settings.chatId = val.trim();
            await this.plugin.saveSettings();
          }),
      );

    // Test Button
    new Setting(containerEl)
      .setName(t("core.cmd.testConnection"))
      .setDesc(t("core.notice.testing"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.bot.testBtn"))
          .setIcon("send")
          .onClick(async () => {
            try {
              new Notice(t("core.notice.testing"));
              await this.plugin.gatewayService.sendMessage({
                sender: "User",
                isAi: false,
                message: t("core.notice.testSuccess"),
              });
              new Notice(t("core.notice.testSuccess"));
              this.display();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(t("core.notice.failed", { error: msg }));
            }
          }),
      );

    // =========================================================================
    // 3. AI Security & Rate Limits
    // =========================================================================
    this.createHeader(containerEl, t("settings.policy.heading"), "shield-alert");

    new Setting(containerEl)
      .setName(t("settings.policy.allowAi"))
      .setDesc(t("settings.policy.allowAiDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.allowAiSend).onChange(async (val) => {
          this.plugin.settings.allowAiSend = val;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.policy.restrictOwner"))
      .setDesc(t("settings.policy.restrictOwnerDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.restrictToOwnerOnly).onChange(async (val) => {
          this.plugin.settings.restrictToOwnerOnly = val;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (!this.plugin.settings.restrictToOwnerOnly) {
      new Setting(containerEl)
        .setName(t("settings.policy.allowedChatIds"))
        .setDesc(t("settings.policy.allowedChatIdsDesc"))
        .addText((text) =>
          text.setValue(this.plugin.settings.allowedChatIds).onChange(async (val) => {
            this.plugin.settings.allowedChatIds = val.trim();
            await this.plugin.saveSettings();
          }),
        );
    }

    new Setting(containerEl)
      .setName(t("settings.policy.maxPerHour"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.maxMessagesPerHour)).onChange(async (val) => {
          const num = parseInt(val, 10);
          if (!isNaN(num) && num >= LIMITS.perHour.min && num <= LIMITS.perHour.max) {
            this.plugin.settings.maxMessagesPerHour = num;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.policy.maxPerMin"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.maxMessagesPerMinute)).onChange(async (val) => {
          const num = parseInt(val, 10);
          if (!isNaN(num) && num >= LIMITS.perMinute.min && num <= LIMITS.perMinute.max) {
            this.plugin.settings.maxMessagesPerMinute = num;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.policy.cooldown"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.minCooldownSeconds)).onChange(async (val) => {
          const num = parseInt(val, 10);
          if (!isNaN(num) && num >= LIMITS.cooldown.min && num <= LIMITS.cooldown.max) {
            this.plugin.settings.minCooldownSeconds = num;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.policy.maxChars"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.maxCharactersPerMessage)).onChange(async (val) => {
          const num = parseInt(val, 10);
          if (!isNaN(num) && num >= LIMITS.characters.min && num <= LIMITS.characters.max) {
            this.plugin.settings.maxCharactersPerMessage = num;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.policy.enablePrefix"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableAiPrefix).onChange(async (val) => {
          this.plugin.settings.enableAiPrefix = val;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (this.plugin.settings.enableAiPrefix) {
      new Setting(containerEl)
        .setName(t("settings.policy.aiPrefix"))
        .setDesc(t("settings.policy.aiPrefixDesc"))
        .addText((text) =>
          text.setValue(this.plugin.settings.aiMessagePrefix).onChange(async (val) => {
            this.plugin.settings.aiMessagePrefix = val;
            await this.plugin.saveSettings();
          }),
        );
    }

    new Setting(containerEl)
      .setName(t("settings.policy.quietHours"))
      .setDesc(t("settings.policy.quietHoursDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableQuietHours).onChange(async (val) => {
          this.plugin.settings.enableQuietHours = val;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (this.plugin.settings.enableQuietHours) {
      new Setting(containerEl)
        .setName(t("settings.policy.quietHoursStart"))
        .addText((text) =>
          text.setValue(this.plugin.settings.quietHoursStart).onChange(async (val) => {
            this.plugin.settings.quietHoursStart = val.trim();
            await this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName(t("settings.policy.quietHoursEnd"))
        .addText((text) =>
          text.setValue(this.plugin.settings.quietHoursEnd).onChange(async (val) => {
            this.plugin.settings.quietHoursEnd = val.trim();
            await this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName(t("settings.policy.allowUrgentQuiet"))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.allowUrgentInQuietHours).onChange(async (val) => {
            this.plugin.settings.allowUrgentInQuietHours = val;
            await this.plugin.saveSettings();
          }),
        );
    }

    // =========================================================================
    // 4. Approvals & Messages
    // =========================================================================
    this.createHeader(containerEl, t("settings.approvals.heading"), "check-square");

    new Setting(containerEl)
      .setName(t("settings.approvals.language"))
      .setDesc(t("settings.approvals.languageDesc"))
      .addDropdown((drop) =>
        drop
          .addOption("auto", "Auto")
          .addOption("pt", "Português")
          .addOption("en", "English")
          .setValue(this.plugin.settings.messageLanguage)
          .onChange(async (val) => {
            this.plugin.settings.messageLanguage = val as MessageLanguageSetting;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.approvals.expiry"))
      .setDesc(t("settings.approvals.expiryDesc"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.approvalExpiryMinutes)).onChange(async (val) => {
          const num = parseInt(val, 10);
          if (!isNaN(num) && num >= LIMITS.expiryMinutes.min && num <= LIMITS.expiryMinutes.max) {
            this.plugin.settings.approvalExpiryMinutes = num;
            await this.plugin.saveSettings();
          }
        }),
      );

    const templatesAvailable = this.plugin.gatewayService.isTemplatesAvailable();
    new Setting(containerEl)
      .setName(t("settings.approvals.templates"))
      .setDesc(templatesAvailable ? t("settings.approvals.templatesActive") : t("settings.approvals.templatesInactive"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.allowTemplates).onChange(async (val) => {
          this.plugin.settings.allowTemplates = val;
          await this.plugin.saveSettings();
        }),
      );

    // =========================================================================
    // 5. Vault File Queue
    // =========================================================================
    this.createHeader(containerEl, t("settings.queue.heading"), "inbox");

    new Setting(containerEl)
      .setName(t("settings.queue.enable"))
      .setDesc(t("settings.queue.enableDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableFileQueue).onChange(async (val) => {
          this.plugin.settings.enableFileQueue = val;
          await this.plugin.saveSettings();
          if (val) {
            this.plugin.fileQueueWatcher.start();
          } else {
            this.plugin.fileQueueWatcher.stop();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.queue.path"))
      .addText((text) =>
        text.setValue(this.plugin.settings.fileQueuePath).onChange(async (val) => {
          this.plugin.settings.fileQueuePath = val.trim();
          await this.plugin.saveSettings();
        }),
      );

    // =========================================================================
    // 6. Recent History Table
    // =========================================================================
    this.createHeader(containerEl, t("settings.history.heading"), "history");

    const history = this.plugin.settings.recentHistory;
    if (!history || history.length === 0) {
      containerEl.createEl("p", { text: t("settings.history.empty"), cls: "tag-muted" });
    } else {
      const table = containerEl.createEl("table", { cls: "tag-history-table" });
      const thead = table.createEl("thead");
      const trHead = thead.createEl("tr");
      trHead.createEl("th", { text: t("settings.history.thTime") });
      trHead.createEl("th", { text: t("settings.history.thSender") });
      trHead.createEl("th", { text: t("settings.history.thStatus") });
      trHead.createEl("th", { text: t("settings.history.thRecipient") });
      trHead.createEl("th", { text: t("settings.history.thSnippet") });

      const tbody = table.createEl("tbody");
      for (const item of history) {
        const tr = tbody.createEl("tr");
        const timeText = item.at > 0 ? new Date(item.at).toLocaleTimeString() : (item.legacyTime ?? "-");
        tr.createEl("td", { text: timeText });
        tr.createEl("td", { text: item.sender });
        tr.createEl("td", { text: item.outcome });
        tr.createEl("td", { text: item.recipient });
        tr.createEl("td", { text: item.snippet });
      }
    }
  }

  refresh(): void {
    try {
      if (this.containerEl && this.containerEl.isShown()) {
        this.display();
      }
    } catch {
      // ignored
    }
  }

  private createHeader(container: HTMLElement, title: string, iconId: string): void {
    const heading = new Setting(container).setHeading().setName(title);
    const iconSpan = heading.nameEl.createSpan({ cls: "tag-settings-header-icon" });
    setIcon(iconSpan, iconId);
    heading.nameEl.prepend(iconSpan);
  }
}
