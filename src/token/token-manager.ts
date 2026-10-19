// Where the bot token lives and how it is used.
//
//   plaintext   -> data.json holds the token (Environment Keys absent, or not adopted yet)
//   env-keys    -> data.json holds only {{secret:NAME}}; Environment Keys sends the requests
//   env-keys-missing / vault-locked -> the placeholder is there but cannot be resolved
//
// The manager never logs a token and never puts one in an error message.
import type { GatewaySettings } from "../settings/settings";
import { isSecretPlaceholder } from "../settings/settings";
import { MODULE_ID } from "../ecosystem/types";
import type { PlaintextSecret, SecretHolder, SecretVaultService } from "../ecosystem/types";
import { errorMessage, redactToken } from "../util/redact";

export const TOKEN_SECRET_NAME = "TELEGRAM_BOT_TOKEN";
export const TOKEN_FIELD = "botToken";
export const TELEGRAM_HOST = "api.telegram.org";

export type TokenState =
  | "none"
  | "plaintext"
  | "env-keys"
  | "env-keys-missing"
  | "vault-locked";

export type TokenErrorCode = "not_configured" | "env_keys_missing" | "vault_locked";

export class TokenUnavailableError extends Error {
  constructor(readonly code: TokenErrorCode) {
    super(code);
    this.name = "TokenUnavailableError";
  }
}

/** What the transport needs to call the Telegram API. */
export type TokenSource =
  | { kind: "plaintext"; token: string }
  | { kind: "placeholder"; placeholder: string; secrets: SecretVaultService };

export type SetTokenResult =
  /** The token went to Environment Keys; data.json holds only the placeholder. */
  | { kind: "adopted"; placeholder: string }
  /** The token is in data.json. `reason` says why it was not moved to Environment Keys. */
  | { kind: "plaintext"; reason?: "no-env-keys" | "vault-locked" | "adoption-failed"; error?: string }
  /** The user pasted a {{secret:NAME}} placeholder. */
  | { kind: "placeholder"; placeholder: string }
  | { kind: "cleared" }
  | { kind: "invalid" };

export interface TokenManagerDeps {
  /** Live settings object (mutated in place). */
  settings: () => GatewaySettings;
  save: () => Promise<void>;
  /** The Environment Keys "secrets" service, when it is registered. */
  secrets: () => SecretVaultService | undefined;
  /** Called after any change of state (UI refresh, poller restart, holder service sync). */
  onChange: () => void;
}

const TOKEN_FORMAT = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

export function looksLikeBotToken(value: string): boolean {
  return TOKEN_FORMAT.test(value.trim());
}

export class TokenManager {
  constructor(private readonly deps: TokenManagerDeps) {}

  getState(): TokenState {
    const settings = this.deps.settings();
    if (settings.botTokenPlaceholder) {
      const secrets = this.deps.secrets();
      if (!secrets) return "env-keys-missing";
      return secrets.isLocked() ? "vault-locked" : "env-keys";
    }
    return settings.botToken ? "plaintext" : "none";
  }

  /** True when a token (in any form) is configured. */
  isConfigured(): boolean {
    const settings = this.deps.settings();
    return Boolean(settings.botToken || settings.botTokenPlaceholder);
  }

  /** The plaintext token is in data.json and Environment Keys is there to take it. */
  canAdopt(): boolean {
    const settings = this.deps.settings();
    return Boolean(settings.botToken) && this.deps.secrets() !== undefined;
  }

  /** Resolves how to authenticate the next request. Throws TokenUnavailableError. */
  resolve(): TokenSource {
    const settings = this.deps.settings();
    if (settings.botTokenPlaceholder) {
      const secrets = this.deps.secrets();
      if (!secrets) throw new TokenUnavailableError("env_keys_missing");
      if (secrets.isLocked()) throw new TokenUnavailableError("vault_locked");
      return { kind: "placeholder", placeholder: settings.botTokenPlaceholder, secrets };
    }
    if (settings.botToken) return { kind: "plaintext", token: settings.botToken };
    throw new TokenUnavailableError("not_configured");
  }

  /** The plaintext token, only for masking it in error texts. Never log or display it. */
  knownPlaintext(): string | undefined {
    return this.deps.settings().botToken || undefined;
  }

  /** Masks the token (and anything shaped like one) in a text. */
  redact(text: string): string {
    const masked = redactToken(text, this.knownPlaintext());
    const secrets = this.deps.secrets();
    if (!secrets) return masked;
    try {
      return secrets.redact(masked);
    } catch {
      return masked;
    }
  }

  /**
   * Saves the token typed by the user. With Environment Keys active and unlocked the value is
   * handed over (secret TELEGRAM_BOT_TOKEN, host api.telegram.org) and data.json keeps only the
   * placeholder. Otherwise it stays in data.json. An empty value removes the token.
   */
  async setToken(raw: string): Promise<SetTokenResult> {
    const value = raw.trim();
    const settings = this.deps.settings();

    if (value === "") {
      settings.botToken = "";
      settings.botTokenPlaceholder = "";
      await this.commit();
      return { kind: "cleared" };
    }

    if (isSecretPlaceholder(value)) {
      settings.botToken = "";
      settings.botTokenPlaceholder = value;
      await this.commit();
      return { kind: "placeholder", placeholder: value };
    }

    if (!looksLikeBotToken(value)) return { kind: "invalid" };

    const secrets = this.deps.secrets();
    if (!secrets) return this.storePlaintext(value, "no-env-keys");
    if (secrets.isLocked()) return this.storePlaintext(value, "vault-locked");

    try {
      const { placeholder } = await secrets.adoptPlaintextSecret({
        ownerModuleId: MODULE_ID,
        field: TOKEN_FIELD,
        suggestedName: TOKEN_SECRET_NAME,
        allowedHosts: [TELEGRAM_HOST],
        value,
      });
      if (!isSecretPlaceholder(placeholder)) throw new Error("Environment Keys returned an invalid placeholder.");
      settings.botToken = "";
      settings.botTokenPlaceholder = placeholder;
      await this.commit();
      return { kind: "adopted", placeholder };
    } catch (err) {
      return this.storePlaintext(value, "adoption-failed", redactToken(errorMessage(err), value));
    }
  }

  /** Moves a plaintext token already in data.json to Environment Keys (manual action). */
  async adoptNow(): Promise<SetTokenResult> {
    const settings = this.deps.settings();
    if (!settings.botToken) return { kind: "cleared" };
    return this.setToken(settings.botToken);
  }

  /** The service registered as "secret-holder:telegram-ai-gateway". */
  readonly holder: SecretHolder = {
    listPlaintextSecrets: (): PlaintextSecret[] => {
      const { botToken } = this.deps.settings();
      if (!botToken) return [];
      return [{ field: TOKEN_FIELD, suggestedName: TOKEN_SECRET_NAME, allowedHosts: [TELEGRAM_HOST], value: botToken }];
    },
    replaceWithPlaceholder: async (field: string, placeholder: string): Promise<void> => {
      const settings = this.deps.settings();
      if (field !== TOKEN_FIELD) throw new Error(`Unknown field: ${field}`);
      if (!isSecretPlaceholder(placeholder)) throw new Error("Invalid secret placeholder.");
      if (!settings.botToken) throw new Error("There is no plaintext secret for this field.");
      settings.botToken = "";
      settings.botTokenPlaceholder = placeholder.trim();
      await this.commit();
    },
  };

  private async storePlaintext(
    value: string,
    reason: "no-env-keys" | "vault-locked" | "adoption-failed",
    error?: string,
  ): Promise<SetTokenResult> {
    const settings = this.deps.settings();
    settings.botToken = value;
    settings.botTokenPlaceholder = "";
    await this.commit();
    return error !== undefined ? { kind: "plaintext", reason, error } : { kind: "plaintext", reason };
  }

  private async commit(): Promise<void> {
    await this.deps.save();
    this.deps.onChange();
  }
}
