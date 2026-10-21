// Learns the owner chat id from the first "/start" the user sends to the bot, so the user
// never types the id. Only a private chat can become the owner, and only while no owner is set.
import type { MessageLanguage } from "../approvals/status-markers";
import type { GatewaySettings } from "../settings/settings";
import type { TelegramApi } from "../telegram/client";
import type { TelegramMessage } from "../telegram/types";
import { MESSAGE_TEXT } from "./message-text";

export interface OwnerDiscoveryDeps {
  settings: () => GatewaySettings;
  saveSettings: () => Promise<void>;
  client: Pick<TelegramApi, "sendMessage">;
  language: () => MessageLanguage;
  /** Called after the owner chat id was stored (Notice, UI refresh). */
  onDiscovered?: () => void;
}

/** "/start", "/start payload" and "/start@MyBot" are all the start command. */
export function isStartCommand(text: string | undefined): boolean {
  return /^\/start(@\w+)?(\s|$)/i.test((text ?? "").trim());
}

export class OwnerDiscovery {
  constructor(private readonly deps: OwnerDiscoveryDeps) {}

  /** True while the plugin has a token but does not know who the owner is. */
  isWaiting(hasToken: boolean): boolean {
    return hasToken && this.deps.settings().chatId.trim() === "";
  }

  /** Handles one incoming message. Returns true when it registered the owner chat. */
  async handleMessage(message: TelegramMessage): Promise<boolean> {
    const settings = this.deps.settings();
    if (settings.chatId.trim() !== "") return false;
    if (message.chat.type !== "private") return false;
    if (!isStartCommand(message.text)) return false;

    settings.chatId = String(message.chat.id);
    await this.deps.saveSettings();
    this.deps.onDiscovered?.();

    try {
      await this.deps.client.sendMessage({
        chat_id: settings.chatId,
        text: MESSAGE_TEXT[this.deps.language()].ownerRegistered,
      });
    } catch {
      // The chat id is stored; the confirmation is a courtesy.
    }
    return true;
  }
}
