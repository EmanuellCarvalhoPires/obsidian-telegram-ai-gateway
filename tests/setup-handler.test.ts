import { describe, expect, it, vi } from "vitest";
import type { SecretVaultService } from "../src/ecosystem/types";
import { OwnerDiscovery, isStartCommand } from "../src/gateway/owner-discovery";
import { DEFAULT_SETTINGS } from "../src/settings/settings";
import type { GatewaySettings } from "../src/settings/settings";
import { createSetupHandler } from "../src/setup/setup-handler";
import { TokenManager } from "../src/token/token-manager";

function secretsMock(overrides: Partial<SecretVaultService> = {}): SecretVaultService {
  return {
    isLocked: () => false,
    request: async () => ({ status: 200, headers: {}, body: "{}" }),
    spawnWithSecrets: async () => {},
    redact: (text) => text,
    adoptPlaintextSecret: async () => ({ placeholder: "{{secret:X}}" }),
    ...overrides,
  };
}

function setup(initial: Partial<GatewaySettings> = {}, secrets: SecretVaultService | null = secretsMock()) {
  const service = secrets ?? undefined;
  const settings: GatewaySettings = { ...DEFAULT_SETTINGS, ...initial };
  const save = vi.fn(async () => {});
  const tokenManager = new TokenManager({ settings: () => settings, save, secrets: () => service, onChange: () => {} });
  const handler = createSetupHandler({ settings: () => settings, saveSettings: save, tokenManager, secrets: () => service });
  return { settings, save, handler };
}

describe("setup handler", () => {
  it("detects the state without exposing secrets", async () => {
    const { handler } = setup({ chatId: "42", botTokenPlaceholder: "{{secret:TELEGRAM_BOT_TOKEN}}" });
    const facts = await handler.detect!();
    expect(facts).toMatchObject({
      envKeysAvailable: true,
      envKeysUnlocked: true,
      tokenState: "env-keys",
      chatIdConfigured: true,
      waitingForStart: false,
    });
    expect(JSON.stringify(facts)).not.toContain("42");
  });

  it("reports waitingForStart when the token is set and the chat is unknown", async () => {
    const { handler } = setup({ botTokenPlaceholder: "{{secret:TELEGRAM_BOT_TOKEN}}" });
    expect(await handler.detect!()).toMatchObject({ waitingForStart: true, chatIdConfigured: false });
  });

  it("detects a missing Environment Keys", async () => {
    const { handler } = setup({}, null);
    expect(await handler.detect!()).toMatchObject({ envKeysAvailable: false, envKeysUnlocked: false, tokenState: "none" });
  });

  it("saves token_secret as a placeholder", async () => {
    const { handler, settings } = setup();
    expect(await handler.save!("token_secret", "TELEGRAM_BOT_TOKEN")).toBeUndefined();
    expect(settings.botTokenPlaceholder).toBe("{{secret:TELEGRAM_BOT_TOKEN}}");
    expect(settings.botToken).toBe("");
  });

  it("rejects token_secret values that are not valid secret names", async () => {
    const { handler, settings } = setup();
    for (const bad of ["123456:ABC-DEF1234ghIkl-zyx57W2v1u", "{{secret:A}}", "a b", "", "x}}", 7, undefined]) {
      expect(typeof (await handler.save!("token_secret", bad))).toBe("string");
    }
    expect(settings.botTokenPlaceholder).toBe("");
    expect(settings.botToken).toBe("");
  });

  it("saves eventos and rejects unknown values and keys", async () => {
    const { handler, settings } = setup();
    expect(await handler.save!("eventos", ["avisos", "avisos", "pedidos_aprovacao"])).toBeUndefined();
    expect(settings.notifyEvents).toEqual(["avisos", "pedidos_aprovacao"]);
    expect(typeof (await handler.save!("eventos", ["nope"]))).toBe("string");
    expect(typeof (await handler.save!("eventos", "avisos"))).toBe("string");
    expect(await handler.save!("outra", 1)).toBe("Unknown key: outra");
  });

  it("validates only with the Environment Keys token and a known chat id", async () => {
    const empty = await setup().handler.validate!();
    expect(empty).toEqual({ ok: false, missing: ["token", "chat_id: send /start to the bot"] });

    const plain = await setup({ botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u", chatId: "1" }).handler.validate!();
    expect(plain.ok).toBe(false);

    const locked = await setup(
      { botTokenPlaceholder: "{{secret:T}}", chatId: "1" },
      secretsMock({ isLocked: () => true }),
    ).handler.validate!();
    expect(locked.ok).toBe(false);

    const unknown = await setup(
      { botTokenPlaceholder: "{{secret:T}}", chatId: "1" },
      secretsMock({ nameExists: () => false }),
    ).handler.validate!();
    expect(unknown.missing).toEqual(["token: secret T does not exist"]);

    const ok = await setup(
      { botTokenPlaceholder: "{{secret:T}}", chatId: "1" },
      secretsMock({ nameExists: () => true }),
    ).handler.validate!();
    expect(ok).toEqual({ ok: true });
  });
});

describe("owner discovery", () => {
  function discovery(chatId = "") {
    const settings: GatewaySettings = { ...DEFAULT_SETTINGS, chatId };
    const sendMessage = vi.fn(async () => ({ message_id: 1, chat: { id: 1 } }));
    const onDiscovered = vi.fn();
    const d = new OwnerDiscovery({
      settings: () => settings,
      saveSettings: async () => {},
      client: { sendMessage },
      language: () => "en",
      onDiscovered,
    });
    return { settings, sendMessage, onDiscovered, d };
  }

  it("recognizes the start command", () => {
    expect(isStartCommand("/start")).toBe(true);
    expect(isStartCommand("/start@MyBot")).toBe(true);
    expect(isStartCommand("/start abc")).toBe(true);
    expect(isStartCommand("/started")).toBe(false);
    expect(isStartCommand("hello /start")).toBe(false);
    expect(isStartCommand(undefined)).toBe(false);
  });

  it("stores the chat id of the first private /start and confirms", async () => {
    const { settings, sendMessage, onDiscovered, d } = discovery();
    expect(await d.handleMessage({ message_id: 1, chat: { id: 555, type: "private" }, text: "/start" })).toBe(true);
    expect(settings.chatId).toBe("555");
    expect(onDiscovered).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chat_id: "555" }));
  });

  it("ignores groups, other text and an already known owner", async () => {
    const group = discovery();
    expect(await group.d.handleMessage({ message_id: 1, chat: { id: -9, type: "group" }, text: "/start" })).toBe(false);
    expect(group.settings.chatId).toBe("");

    const text = discovery();
    expect(await text.d.handleMessage({ message_id: 1, chat: { id: 5, type: "private" }, text: "hi" })).toBe(false);
    expect(text.settings.chatId).toBe("");

    const known = discovery("111");
    expect(await known.d.handleMessage({ message_id: 1, chat: { id: 222, type: "private" }, text: "/start" })).toBe(false);
    expect(known.settings.chatId).toBe("111");
    expect(known.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps the chat id when the confirmation fails", async () => {
    const { settings, sendMessage, d } = discovery();
    sendMessage.mockRejectedValueOnce(new Error("network"));
    expect(await d.handleMessage({ message_id: 1, chat: { id: 7, type: "private" }, text: "/start" })).toBe(true);
    expect(settings.chatId).toBe("7");
  });

  it("is waiting only with a token and no owner", () => {
    expect(discovery().d.isWaiting(true)).toBe(true);
    expect(discovery().d.isWaiting(false)).toBe(false);
    expect(discovery("1").d.isWaiting(true)).toBe(false);
  });
});
