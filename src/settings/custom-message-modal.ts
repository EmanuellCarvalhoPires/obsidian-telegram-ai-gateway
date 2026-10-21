// Modal for user to send a manual custom message to Telegram. Free of emojis.
import { Modal, Notice, setIcon } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";

export class CustomMessageModal extends Modal {
  constructor(
    app: App,
    private readonly onSubmit: (text: string) => Promise<void> | void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass("tag-modal");

    const iconSpan = titleEl.createSpan({ cls: "tag-modal-icon" });
    setIcon(iconSpan, "send");
    titleEl.appendText(t("modal.custom.title"));

    const textArea = contentEl.createEl("textarea", {
      placeholder: t("modal.custom.placeholder"),
      attr: { rows: "5", style: "width: 100%; margin-bottom: 1rem; resize: vertical;" },
    });
    textArea.focus();

    const buttonContainer = contentEl.createDiv({
      attr: { style: "display: flex; justify-content: flex-end; gap: 8px;" },
    });

    const cancelBtn = buttonContainer.createEl("button", { text: t("modal.custom.cancel") });
    cancelBtn.onclick = () => this.close();

    const sendBtn = buttonContainer.createEl("button", { text: t("modal.custom.send"), cls: "mod-cta" });
    const sendIcon = sendBtn.createSpan({ cls: "tag-modal-icon" });
    setIcon(sendIcon, "send");

    sendBtn.onclick = () => {
      const text = textArea.value.trim();
      if (!text) {
        new Notice(t("core.notice.emptyMessage"));
        return;
      }
      this.close();
      void this.onSubmit(text);
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
