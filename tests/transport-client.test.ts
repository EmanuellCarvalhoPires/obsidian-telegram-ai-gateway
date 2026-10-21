import { describe, expect, it } from "vitest";
import { htmlToPlain, splitHtml } from "../src/telegram/chunking";
import { TelegramClient } from "../src/telegram/client";
import { createTransport } from "../src/telegram/transport";
import type { SecretVaultService } from "../src/ecosystem/types";
import { redactToken } from "../src/util/redact";

describe("Transport and Redaction", () => {
  it("masks token in URLs and errors", () => {
    const token = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ123";
    const text = `Error calling https://api.telegram.org/bot${token}/sendMessage with token ${token}`;
    const redacted = redactToken(text, token);
    expect(redacted).not.toContain(token);
    expect(redacted).toContain("***");
  });

  it("routes through requestUrl for plaintext tokens", async () => {
    let calledUrl = "";
    const transport = createTransport({
      resolveToken: () => ({ kind: "plaintext", token: "my-token" }),
      clock: { now: () => 1000, setTimeout: () => 0 as any, clearTimeout: () => {} },
      requestUrlFn: async (req) => {
        calledUrl = req.url;
        return { status: 200, text: JSON.stringify({ ok: true, result: { message_id: 12 } }) };
      },
    });

    const client = new TelegramClient(transport);
    const sent = await client.sendMessage({ chat_id: "123", text: "Hello" });

    expect(calledUrl).toBe("https://api.telegram.org/botmy-token/sendMessage");
    expect(sent.message_id).toBe(12);
  });

  it("routes through secrets.request for placeholders", async () => {
    let secretUrl = "";
    const mockSecrets: SecretVaultService = {
      isLocked: () => false,
      request: async (req) => {
        secretUrl = req.url;
        return { status: 200, headers: {}, body: JSON.stringify({ ok: true, result: { message_id: 42 } }) };
      },
      spawnWithSecrets: async () => {},
      redact: (t) => t,
      adoptPlaintextSecret: async () => ({ placeholder: "" }),
    };

    const transport = createTransport({
      resolveToken: () => ({ kind: "placeholder", placeholder: "{{secret:BOT}}", secrets: mockSecrets }),
      clock: { now: () => 1000, setTimeout: () => 0 as any, clearTimeout: () => {} },
    });

    const client = new TelegramClient(transport);
    const sent = await client.sendMessage({ chat_id: "123", text: "Secure" });

    expect(secretUrl).toBe("https://api.telegram.org/bot{{secret:BOT}}/sendMessage");
    expect(sent.message_id).toBe(42);
  });

  it("splits large HTML messages within Telegram limits", () => {
    const longHtml = "<p>" + "A".repeat(5000) + "</p>";
    const chunks = splitHtml(longHtml, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(htmlToPlain(chunk).length).toBeLessThanOrEqual(4096);
    }
  });
});
