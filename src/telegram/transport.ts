// The ONE function through which every request to api.telegram.org goes.
//
//   token is a placeholder  -> secrets.request() with https://api.telegram.org/bot{{secret:NAME}}/<method>
//                              (Environment Keys resolves the placeholder; this plugin never sees the value)
//   token is plaintext      -> requestUrl() with the token in the URL
//
// Nothing here logs a URL. Errors are redacted before they leave this file.
import { requestUrl } from "obsidian";
import { MODULE_ID } from "../ecosystem/types";
import type { SecretResponse } from "../ecosystem/types";
import { TokenUnavailableError } from "../token/token-manager";
import type { TokenSource } from "../token/token-manager";
import type { Clock } from "../util/clock";
import { errorMessage, redactToken } from "../util/redact";

export interface RawTelegramResponse {
  status: number;
  /** Response body as text (parsed once by the client). */
  body: string;
}

export interface TransportCallInfo {
  /** Bot API method, e.g. "sendMessage". */
  method: string;
  /** HTTP status, 0 when there was no response. */
  status: number;
  durationMs: number;
  via: "secrets" | "requestUrl";
}

export type RequestUrlFn = (request: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  throw: boolean;
}) => Promise<{ status: number; text: string }>;

export interface TransportDeps {
  /** Resolves the token source; throws TokenUnavailableError. */
  resolveToken: () => TokenSource;
  clock: Clock;
  /** Called after every call with timing only (no URL, no token). */
  onCall?: (info: TransportCallInfo) => void;
  /** For tests. Defaults to Obsidian's requestUrl. */
  requestUrlFn?: RequestUrlFn;
}

export class TelegramNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramNetworkError";
  }
}

const API_ROOT = "https://api.telegram.org";

const defaultRequestUrl: RequestUrlFn = async (request) => {
  const response = await requestUrl(request);
  return { status: response.status, text: response.text };
};

/** Placeholder URL used with Environment Keys. The placeholder is not a secret value. */
export function placeholderUrl(placeholder: string, method: string): string {
  return `${API_ROOT}/bot${placeholder}/${method}`;
}

export type TelegramTransport = (method: string, payload: Record<string, unknown>) => Promise<RawTelegramResponse>;

export function createTransport(deps: TransportDeps): TelegramTransport {
  const send = deps.requestUrlFn ?? defaultRequestUrl;

  return async (method, payload) => {
    const source = deps.resolveToken();
    const body = JSON.stringify(payload);
    const headers = { "Content-Type": "application/json" };
    const startedAt = deps.clock.now();
    const plaintext = source.kind === "plaintext" ? source.token : undefined;
    const via = source.kind === "placeholder" ? "secrets" : "requestUrl";

    let status = 0;
    try {
      let response: { status: number; body: string };
      if (source.kind === "placeholder") {
        const result: SecretResponse = await source.secrets.request(
          { method: "POST", url: placeholderUrl(source.placeholder, method), headers, body },
          MODULE_ID,
        );
        response = { status: result.status, body: result.body };
      } else {
        const result = await send({
          url: `${API_ROOT}/bot${source.token}/${method}`,
          method: "POST",
          headers,
          body,
          throw: false,
        });
        response = { status: result.status, body: result.text };
      }
      status = response.status;
      return response;
    } catch (err) {
      if (err instanceof TokenUnavailableError) throw err;
      // Redact: the underlying error may carry the request URL.
      throw new TelegramNetworkError(redactToken(errorMessage(err), plaintext));
    } finally {
      deps.onCall?.({ method, status, durationMs: deps.clock.now() - startedAt, via });
    }
  };
}
