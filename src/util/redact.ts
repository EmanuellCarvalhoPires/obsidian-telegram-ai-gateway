// Keeps the bot token out of logs, errors and the Inspector.

/** Telegram bot tokens look like 123456789:AAH... (digits, colon, 30+ url-safe characters). */
const TOKEN_PATTERN = /\d{6,}:[A-Za-z0-9_-]{20,}/g;
const BOT_URL_PATTERN = /(\/bot)[^/\s"']+/g;

export const MASK = "***";

/**
 * Masks bot tokens in a text: the exact plaintext token when known, anything shaped like a
 * token, and the segment after "/bot" in a Telegram API URL (which may be a secret placeholder
 * or a token written another way).
 */
export function redactToken(text: string, knownToken?: string): string {
  let out = text;
  if (knownToken && knownToken.length >= 6) out = out.split(knownToken).join(MASK);
  out = out.replace(BOT_URL_PATTERN, (_m, prefix: string) => `${prefix}${MASK}`);
  return out.replace(TOKEN_PATTERN, MASK);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}
