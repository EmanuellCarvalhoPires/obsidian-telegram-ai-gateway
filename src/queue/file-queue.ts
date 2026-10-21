// Vault file queue watcher: processes offline queued messages dropped as JSON files into the vault.
import type { App } from "obsidian";
import type { GatewayService } from "../gateway/gateway-service";
import type { GatewaySettings } from "../settings/settings";
import { isRecord, parseJson } from "../util/guards";

export class FileQueueWatcher {
  private timer: number | null = null;
  private running = false;

  constructor(
    private readonly app: App,
    private readonly service: GatewayService,
    private readonly getSettings: () => GatewaySettings,
  ) {}

  start(): void {
    this.stop();
    const adapter = this.app.vault.adapter;
    const queueDir = this.getSettings().fileQueuePath;

    void adapter.exists(queueDir).then((exists) => {
      if (!exists) {
        adapter.mkdir(queueDir).catch(() => {});
      }
    });

    this.timer = window.setInterval(() => {
      if (!this.getSettings().enableFileQueue || this.running) return;
      void this.processQueue();
    }, 2500);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async processQueue(): Promise<void> {
    this.running = true;
    const adapter = this.app.vault.adapter;
    const queueDir = this.getSettings().fileQueuePath;

    try {
      const exists = await adapter.exists(queueDir);
      if (!exists) return;

      const list = await adapter.list(queueDir);
      for (const filePath of list.files) {
        const fileName = filePath.split("/").pop() ?? "";
        if (fileName.endsWith(".json") && !fileName.endsWith(".error.json") && !fileName.endsWith(".processed.json")) {
          await this.processFile(filePath);
        }
      }
    } catch (err) {
      console.warn("[Telegram AI Gateway] Queue watcher error:", err);
    } finally {
      this.running = false;
    }
  }

  private async processFile(filePath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      const content = await adapter.read(filePath);
      const data = parseJson(content);
      if (!isRecord(data)) throw new Error("Invalid JSON in queue file.");

      const isApproval = data.type === "approval" || Array.isArray(data.options);
      if (isApproval) {
        await this.service.askApproval({
          sender: typeof data.sender === "string" ? data.sender : "File Queue",
          isAi: true,
          message: typeof data.message === "string" ? data.message : typeof data.text === "string" ? data.text : "",
          options: Array.isArray(data.options) ? data.options : undefined,
          chatId: typeof data.chat_id === "string" ? data.chat_id : undefined,
          urgent: Boolean(data.urgent),
          silent: Boolean(data.silent),
          expiresInMinutes: typeof data.expires_in_minutes === "number" ? data.expires_in_minutes : undefined,
        });
      } else {
        await this.service.sendMessage({
          sender: typeof data.sender === "string" ? data.sender : "File Queue",
          isAi: true,
          message: typeof data.message === "string" ? data.message : typeof data.text === "string" ? data.text : "",
          chatId: typeof data.chat_id === "string" ? data.chat_id : undefined,
          urgent: Boolean(data.urgent),
          silent: Boolean(data.silent),
        });
      }

      await adapter.remove(filePath);
    } catch (err) {
      console.warn(`[Telegram AI Gateway] Failed to process queue file ${filePath}:`, err);
      try {
        const errorPath = filePath.replace(/\.json$/, ".error.json");
        const errorContent = JSON.stringify(
          {
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
            originalFile: filePath,
          },
          null,
          2,
        );
        await adapter.write(errorPath, errorContent);
        await adapter.remove(filePath);
      } catch {
        // ignored
      }
    }
  }
}
