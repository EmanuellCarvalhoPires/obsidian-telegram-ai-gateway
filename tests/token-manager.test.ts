import { describe, expect, it } from "vitest";
import type { SecretVaultService } from "../src/ecosystem/types";
import { DEFAULT_SETTINGS } from "../src/settings/settings";
import type { GatewaySettings } from "../src/settings/settings";
import { TokenManager, TokenUnavailableError } from "../src/token/token-manager";

describe("TokenManager", () => {
  it("detects state correctly with plaintext token", async () => {
    let settings: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u",
    };

    const manager = new TokenManager({
      settings: () => settings,
      save: async () => {},
      secrets: () => undefined,
      onChange: () => {},
    });

    expect(manager.getState()).toBe("plaintext");
    expect(manager.isConfigured()).toBe(true);

    const source = manager.resolve();
    expect(source.kind).toBe("plaintext");
    if (source.kind === "plaintext") {
      expect(source.token).toBe(settings.botToken);
    }
  });

  it("throws TokenUnavailableError when token is not configured", () => {
    const settings: GatewaySettings = { ...DEFAULT_SETTINGS, botToken: "", botTokenPlaceholder: "" };
    const manager = new TokenManager({
      settings: () => settings,
      save: async () => {},
      secrets: () => undefined,
      onChange: () => {},
    });

    expect(manager.getState()).toBe("none");
    expect(manager.isConfigured()).toBe(false);
    expect(() => manager.resolve()).toThrow(TokenUnavailableError);
  });

  it("adopts token when Environment Keys is active", async () => {
    let settings: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u",
    };

    let adoptedInput: unknown;
    const mockSecrets: SecretVaultService = {
      isLocked: () => false,
      request: async () => ({ status: 200, headers: {}, body: "{}" }),
      spawnWithSecrets: async () => {},
      redact: (t) => t,
      adoptPlaintextSecret: async (input) => {
        adoptedInput = input;
        return { placeholder: "{{secret:TELEGRAM_BOT_TOKEN}}" };
      },
    };

    const manager = new TokenManager({
      settings: () => settings,
      save: async () => {},
      secrets: () => mockSecrets,
      onChange: () => {},
    });

    expect(manager.canAdopt()).toBe(true);
    const result = await manager.adoptNow();

    expect(result.kind).toBe("adopted");
    expect(adoptedInput).toBeDefined();
    expect(settings.botToken).toBe("");
    expect(settings.botTokenPlaceholder).toBe("{{secret:TELEGRAM_BOT_TOKEN}}");
    expect(manager.getState()).toBe("env-keys");

    const source = manager.resolve();
    expect(source.kind).toBe("placeholder");
  });

  it("handles vault-locked and missing Environment Keys states", () => {
    let settings: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      botTokenPlaceholder: "{{secret:TELEGRAM_BOT_TOKEN}}",
    };

    // Missing
    let manager = new TokenManager({
      settings: () => settings,
      save: async () => {},
      secrets: () => undefined,
      onChange: () => {},
    });
    expect(manager.getState()).toBe("env-keys-missing");
    expect(() => manager.resolve()).toThrow(TokenUnavailableError);

    // Locked
    const lockedSecrets: SecretVaultService = {
      isLocked: () => true,
      request: async () => ({ status: 200, headers: {}, body: "{}" }),
      spawnWithSecrets: async () => {},
      redact: (t) => t,
      adoptPlaintextSecret: async () => ({ placeholder: "" }),
    };

    manager = new TokenManager({
      settings: () => settings,
      save: async () => {},
      secrets: () => lockedSecrets,
      onChange: () => {},
    });
    expect(manager.getState()).toBe("vault-locked");
    expect(() => manager.resolve()).toThrow(TokenUnavailableError);
  });

  it("supports late adoption via holder interface", async () => {
    let settings: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u",
    };

    const manager = new TokenManager({
      settings: () => settings,
      save: async () => {},
      secrets: () => undefined,
      onChange: () => {},
    });

    const secretsList = manager.holder.listPlaintextSecrets();
    expect(secretsList.length).toBe(1);
    expect(secretsList[0]?.suggestedName).toBe("TELEGRAM_BOT_TOKEN");
    expect(secretsList[0]?.value).toBe(settings.botToken);

    await manager.holder.replaceWithPlaceholder("botToken", "{{secret:TELEGRAM_BOT_TOKEN}}");
    expect(settings.botToken).toBe("");
    expect(settings.botTokenPlaceholder).toBe("{{secret:TELEGRAM_BOT_TOKEN}}");
  });
});
