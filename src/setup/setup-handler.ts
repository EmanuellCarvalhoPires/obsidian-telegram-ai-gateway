// Answers the guided setup of the AI Ecosystem (tools ecosystem_setup_status/save/complete).
// Nothing here returns or accepts a secret value: the token is set by placeholder only.
import { isNotifyEvent, isSecretPlaceholder, NOTIFY_EVENTS } from "../settings/settings";
import type { GatewaySettings } from "../settings/settings";
import type { SecretVaultService, SetupHandler } from "../ecosystem/types";
import type { TokenManager } from "../token/token-manager";

export interface SetupHandlerDeps {
  settings: () => GatewaySettings;
  saveSettings: () => Promise<void>;
  tokenManager: TokenManager;
  secrets: () => SecretVaultService | undefined;
}

const SECRET_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export function createSetupHandler(deps: SetupHandlerDeps): SetupHandler {
  return {
    async detect() {
      const secrets = deps.secrets();
      const settings = deps.settings();
      const chatIdConfigured = settings.chatId.trim() !== "";
      return {
        envKeysAvailable: secrets !== undefined,
        envKeysUnlocked: secrets !== undefined && !secrets.isLocked(),
        tokenState: deps.tokenManager.getState(),
        chatIdConfigured,
        waitingForStart: deps.tokenManager.isConfigured() && !chatIdConfigured,
        eventos: [...settings.notifyEvents],
      };
    },

    async save(key, value) {
      if (key === "token_secret") {
        if (typeof value !== "string" || !SECRET_NAME.test(value.trim())) {
          return "token_secret must be the name of a secret (letters, digits, _ . -), not the token itself.";
        }
        const placeholder = `{{secret:${value.trim()}}}`;
        if (!isSecretPlaceholder(placeholder)) return "token_secret is not a valid secret name.";
        await deps.tokenManager.setToken(placeholder);
        return;
      }
      if (key === "eventos") {
        if (!Array.isArray(value) || !value.every(isNotifyEvent)) {
          return `eventos must be a list with values from: ${NOTIFY_EVENTS.join(", ")}.`;
        }
        deps.settings().notifyEvents = [...new Set(value)];
        await deps.saveSettings();
        return;
      }
      return `Unknown key: ${key}`;
    },

    async validate() {
      const missing: string[] = [];
      const settings = deps.settings();
      const secrets = deps.secrets();
      const placeholder = settings.botTokenPlaceholder;

      if (!placeholder) {
        missing.push(settings.botToken ? "token: store it in Environment Keys (token_secret)" : "token");
      } else if (!secrets) {
        missing.push("environment_keys: not available");
      } else if (secrets.isLocked()) {
        missing.push("environment_keys: unlock the vault");
      } else {
        const name = /^\{\{secret:([^}]+)\}\}$/.exec(placeholder)?.[1];
        if (name && secrets.nameExists && !secrets.nameExists(name)) missing.push(`token: secret ${name} does not exist`);
      }
      if (settings.chatId.trim() === "") missing.push("chat_id: send /start to the bot");

      return missing.length === 0 ? { ok: true } : { ok: false, missing };
    },
  };
}
