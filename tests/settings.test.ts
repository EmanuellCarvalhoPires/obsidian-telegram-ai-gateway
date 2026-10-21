import { describe, expect, it } from "vitest";
import { loadSettings } from "../src/settings/settings";

describe("Settings Migration and Loading", () => {
  it("loads defaults for empty input", () => {
    const { settings, migrated, droppedKeys } = loadSettings(null);
    expect(settings.schemaVersion).toBe(2);
    expect(settings.botToken).toBe("");
    expect(migrated).toBe(false);
    expect(droppedKeys).toEqual([]);
  });

  it("migrates from v1.0 settings by dropping local server and port keys", () => {
    const legacyData = {
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u",
      chatId: "987654",
      enableLocalServer: true,
      serverPort: 27125,
      aiAuthToken: "secret123",
      enableFileQueue: true,
      recentHistory: [
        {
          date: "19/10/2026",
          time: "10:30",
          sender: "Claude Code",
          status: "Sucesso",
          recipient: "987654",
          snippet: "Done",
        },
      ],
    };

    const { settings, migrated, droppedKeys } = loadSettings(legacyData);

    expect(migrated).toBe(true);
    expect(settings.schemaVersion).toBe(2);
    expect(settings.botToken).toBe("123456:ABC-DEF1234ghIkl-zyx57W2v1u");
    expect(settings.chatId).toBe("987654");
    expect(droppedKeys).toContain("enableLocalServer");
    expect(droppedKeys).toContain("serverPort");
    expect(droppedKeys).toContain("aiAuthToken");

    // Verified history was converted
    expect(settings.recentHistory.length).toBe(1);
    expect(settings.recentHistory[0]?.outcome).toBe("sent");
    expect(settings.recentHistory[0]?.snippet).toBe("Done");
  });

  it("converts placeholder typed into plaintext botToken field", () => {
    const data = {
      botToken: "{{secret:TELEGRAM_BOT_TOKEN}}",
      chatId: "123",
    };

    const { settings } = loadSettings(data);
    expect(settings.botToken).toBe("");
    expect(settings.botTokenPlaceholder).toBe("{{secret:TELEGRAM_BOT_TOKEN}}");
  });
});
