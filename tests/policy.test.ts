import { describe, expect, it } from "vitest";
import { PolicyEngine, PolicyViolationError } from "../src/policy/policy";
import { DEFAULT_SETTINGS } from "../src/settings/settings";
import type { GatewaySettings } from "../src/settings/settings";
import type { Clock } from "../src/util/clock";

class FakeClock implements Clock {
  constructor(public time: number = 1000) {}
  now(): number {
    return this.time;
  }
  setTimeout(): any {
    return 0;
  }
  clearTimeout(): void {}
}

describe("PolicyEngine", () => {
  it("blocks AI when allowAiSend is false", () => {
    const settings: GatewaySettings = { ...DEFAULT_SETTINGS, allowAiSend: false };
    const policy = new PolicyEngine(() => settings, new FakeClock());

    expect(() => policy.checkAiAllowed()).toThrow(PolicyViolationError);
  });

  it("enforces cooldown and rate limits", () => {
    const settings: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      minCooldownSeconds: 5,
      maxMessagesPerMinute: 2,
    };
    const clock = new FakeClock(10_000);
    const policy = new PolicyEngine(() => settings, clock);

    expect(() => policy.checkRateLimit()).not.toThrow();
    policy.recordSent();

    // Within cooldown (< 5s)
    clock.time += 2000;
    expect(() => policy.checkRateLimit()).toThrow(PolicyViolationError);

    // After cooldown
    clock.time += 4000;
    expect(() => policy.checkRateLimit()).not.toThrow();
    policy.recordSent();

    // Hit minute limit (2 msgs within 60s)
    clock.time += 6000;
    expect(() => policy.checkRateLimit()).toThrow(PolicyViolationError);
  });

  it("validates recipient chat ID based on owner-only rule", () => {
    const settings: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      chatId: "999",
      restrictToOwnerOnly: true,
      allowedChatIds: "111,222",
    };
    const policy = new PolicyEngine(() => settings, new FakeClock());

    // When restrictToOwnerOnly = true, AI always gets owner chat ID
    expect(policy.resolveChatId("111", true)).toBe("999");
    expect(policy.resolveChatId(undefined, true)).toBe("999");

    // When restrictToOwnerOnly = false, checks allowed list
    settings.restrictToOwnerOnly = false;
    expect(policy.resolveChatId("111", true)).toBe("111");
    expect(policy.resolveChatId("999", true)).toBe("999");
    expect(() => policy.resolveChatId("333", true)).toThrow(PolicyViolationError);
  });

  it("truncates long messages and prepends prefix", () => {
    const settings: GatewaySettings = {
      ...DEFAULT_SETTINGS,
      maxCharactersPerMessage: 20,
      enableAiPrefix: true,
      aiMessagePrefix: "[AI]: ",
    };
    const policy = new PolicyEngine(() => settings, new FakeClock());

    const result = policy.prepareText("Short", "en", true);
    expect(result).toBe("[AI]: Short");

    const longText = policy.prepareText("123456789012345678901234567890", "en", true);
    expect(longText).toContain("[AI]: 12345678901234567890");
    expect(longText).toContain("[Truncated by the plugin limit]");
  });
});
