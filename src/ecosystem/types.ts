// Types vendored from other plugins of the AI Ecosystem. This plugin never imports their source:
// it codes against these shapes and checks at runtime what is actually there.
//
// - AI Ecosystem public types: copied from its src/types/index.ts (Provider API version 1).
// - Environment Keys 2.0 contracts: the "secrets" service and the "secret-holder:<module id>" service.
// - AI Templates contract: the "templates" service.

// ---------------------------------------------------------------------------
// AI Ecosystem: version, events, ids
// ---------------------------------------------------------------------------

/** Provider API version this module was written for. */
export const AI_ECOSYSTEM_API_VERSION = 1;

/** Plugin id of the AI Ecosystem. */
export const ECOSYSTEM_ID = "ai-ecosystem";

/** Workspace events sent by the AI Ecosystem (app.workspace.on). */
export const ECOSYSTEM_EVENTS = {
  ready: "ai-ecosystem:ready",
  unloading: "ai-ecosystem:unloading",
  moduleRegistered: "ai-ecosystem:module-registered",
  moduleUnregistered: "ai-ecosystem:module-unregistered",
  serviceChanged: "ai-ecosystem:service-changed",
  serverStatus: "ai-ecosystem:server-status",
} as const;

/** Plugin id of this module (also its route prefix: /api/v1/<id>). */
export const MODULE_ID = "telegram-ai-gateway";

/** Name of the service Environment Keys registers. */
export const SECRETS_SERVICE = "secrets";

/** Name of the service AI Templates registers. */
export const TEMPLATES_SERVICE = "templates";

/** Name of the service this module registers for late adoption of the plaintext token. */
export const SECRET_HOLDER_SERVICE = `secret-holder:${MODULE_ID}`;

// ---------------------------------------------------------------------------
// AI Ecosystem: clients, routes, tools
// ---------------------------------------------------------------------------

export interface ClientContext {
  id: string;
  name: string;
}

export interface ClientRecord {
  id: string;
  name: string;
  tokenHash: string;
  hint: string;
  createdAt: string;
  lastUsedAt?: string;
  importedFrom?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HubRequest {
  method: HttpMethod;
  /** Path relative to the module prefix, starting with "/". */
  path: string;
  fullPath: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Parsed JSON body when Content-Type is JSON, otherwise the raw text. */
  body: unknown;
  rawBody: string;
  client: ClientContext;
}

export interface HubResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HubRoute {
  method: HttpMethod;
  path: string;
  description?: string;
  handler: (req: HubRequest) => Promise<HubResponse> | HubResponse;
}

export type HubToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface HubToolResult {
  content: HubToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface HubCallContext {
  client: ClientContext;
  moduleId: string;
  /** Aborted when the client cancels the call or closes the connection before the answer. */
  signal?: AbortSignal;
  /** Kind of client, detected by the AI Ecosystem from the initialize handshake or the token name. */
  clientKind?: "claude-code" | "antigravity" | "other";
}

export interface HubTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** Stays visible while the module still waits for its setup skill to finish. */
  availableDuringSetup?: boolean;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (args: Record<string, unknown>, ctx: HubCallContext) => Promise<HubToolResult>;
}

export interface HubPromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface HubPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  handler: (
    args: Record<string, string>,
    ctx: HubCallContext,
  ) => Promise<{ description?: string; messages: HubPromptMessage[] }>;
}

export interface HubModuleRegistration {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  routes?: HubRoute[];
  legacyAliases?: HubRoute[];
  tools?: HubTool[];
  prompts?: HubPrompt[];
  instructions?: string;
  onUnload?: () => void;
}

export type RegisterResult = { ok: true; warnings?: string[] } | { ok: false; reason: string };

export type ServiceChangeListener = (name: string, available: boolean) => void;

// ---------------------------------------------------------------------------
// AI Ecosystem: scripts (only referenced by the API shape)
// ---------------------------------------------------------------------------

export type ScriptLanguage = "python" | "node" | "bash" | "powershell";

export interface HubScriptOptions {
  language: ScriptLanguage;
  scriptPath: string;
  inlineCode?: string;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  env?: Record<string, string>;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface ScriptExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
}

/** Activity entry a module reports to the Inspector (AIEcosystemAPI.logActivity). */
export interface ModuleActivityEntry {
  moduleId: string;
  client?: string;
  type: string;
  target: string;
  status: number;
  durationMs: number;
  payload?: unknown;
  response?: unknown;
}

/** The Provider API of the AI Ecosystem (plugin.api). */
export interface AIEcosystemAPI {
  readonly apiVersion: number;
  isReady(): boolean;
  registerModule(module: HubModuleRegistration): RegisterResult;
  unregisterModule(moduleId: string): boolean;
  /** Replaces the tools of a registered module. */
  updateTools(moduleId: string, tools: HubTool[]): void;
  updatePrompts(moduleId: string, prompts: HubPrompt[]): void;
  registerService<T>(serviceName: string, ownerModuleId: string, instance: T): void;
  unregisterService(serviceName: string): void;
  getService<T>(serviceName: string): T | undefined;
  /** Single callback for every service; returns an unsubscribe function. */
  onServiceChange(cb: ServiceChangeListener): () => void;
  importClients(clients: ClientRecord[], sourceModuleId: string): Promise<number>;
  runScript(options: HubScriptOptions, callerModuleId: string): Promise<ScriptExecutionResult>;
  logActivity(entry: ModuleActivityEntry): void;
  getServerStatus(): { running: boolean; port: number; activeModules: string[] };
}

// ---------------------------------------------------------------------------
// AI Ecosystem: hooks service (guided setup)
// ---------------------------------------------------------------------------

/** Name of the service the AI Ecosystem registers for hooks and the guided module setup. */
export const HOOKS_SERVICE = "hooks";

export interface HookRuleData {
  /** environment-variables: allowed host patterns of secrets WITHOUT full access / any host. */
  hosts?: string[];
  /** ai-scripts: vault-relative folders whose scripts must run through the plugin. */
  scriptFolders?: string[];
  /** ai-templates: vault-relative target path patterns of the templates ({{...}} becomes *). */
  templateTargets?: string[];
  /** environment-variables: vault-relative folders of tool notes (Grep stays allowed there). */
  toolNoteFolders?: string[];
}

export interface SetupHandler {
  /** Facts the module detects by itself (never secret values). */
  detect?(): Promise<Record<string, unknown>>;
  /** Applies one answer. Returns an error message to refuse it. */
  save?(key: string, value: unknown): Promise<string | void>;
  /** Called by ecosystem_setup_complete. ok:false blocks completion and lists what is missing. */
  validate?(): Promise<{ ok: boolean; missing?: string[] }>;
}

export interface HooksService {
  setRuleData(moduleId: string, data: HookRuleData): void;
  /** Returns an unregister function. */
  registerSetupHandler(moduleId: string, handler: SetupHandler): () => void;
  getModuleState(moduleId: string): "pendente_configuracao" | "configurado" | "desativado" | undefined;
}

// ---------------------------------------------------------------------------
// Environment Keys 2.0
// ---------------------------------------------------------------------------

export interface SecretRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface SecretResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The "secrets" service. No method returns the value of a secret. */
export interface SecretVaultService {
  isLocked(): boolean;
  /**
   * Resolves {{secret:NAME}} in headers, URL path/query and body for allowed hosts and sends the
   * request. The response is already redacted.
   */
  request(req: SecretRequest, callerModuleId: string): Promise<SecretResponse>;
  spawnWithSecrets(
    env: Record<string, string>,
    spawnFn: (resolvedEnv: Record<string, string>) => void,
    callerModuleId: string,
  ): Promise<void>;
  redact(text: string): string;
  /** True when a secret OR a value already uses this name. Absent in older Environment Keys. */
  nameExists?(name: string): boolean;
  adoptPlaintextSecret(input: {
    ownerModuleId: string;
    field: string;
    suggestedName: string;
    allowedHosts: string[];
    value: string;
  }): Promise<{ placeholder: string }>;
}

export interface PlaintextSecret {
  field: string;
  suggestedName: string;
  allowedHosts: string[];
  value: string;
}

/** Service "secret-holder:<module id>", registered by modules that hold plaintext tokens. */
export interface SecretHolder {
  listPlaintextSecrets(): PlaintextSecret[];
  replaceWithPlaceholder(field: string, placeholder: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// AI Templates
// ---------------------------------------------------------------------------

export type TemplateChannel = "obsidian" | "telegram";

export interface TemplateSummary {
  id: string;
  description: string;
}

/** The "templates" service (AI Templates plugin). */
export interface TemplatesService {
  render(templateId: string, data: unknown, channel: TemplateChannel): Promise<string>;
  getSchema(templateId: string): unknown;
  listTemplates(): TemplateSummary[];
}
