// Text helpers for Telegram's HTML parse mode: escaping, splitting at the 4096 character limit
// without breaking tags, and a plain-text fallback.

/** Telegram's limit for the text of one message, counted after entities are parsed. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NAMED_ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&amp;": "&" };

/** Strips tags and decodes the entities Telegram accepts. Used when Telegram refuses the HTML. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(lt|gt|quot|amp);/g, (m) => NAMED_ENTITIES[m] ?? m);
}

const TOKEN_PATTERN = /<[^>]*>|&#?\w+;|[^<&]+|[<&]/g;

function tagName(tag: string): string {
  const match = /^<\/?\s*([A-Za-z][\w-]*)/.exec(tag);
  return (match?.[1] ?? "").toLowerCase();
}

/** Where to cut a text so that at most `room` characters stay: after a newline or space when one is near. */
function cutPoint(text: string, room: number): number {
  if (text.length <= room) return text.length;
  const head = text.slice(0, room);
  const newline = head.lastIndexOf("\n");
  if (newline >= room * 0.4) return newline + 1;
  const space = head.lastIndexOf(" ");
  if (space >= room * 0.4) return space + 1;
  // Never split a surrogate pair.
  const last = head.charCodeAt(room - 1);
  return last >= 0xd800 && last <= 0xdbff ? room - 1 : room;
}

/**
 * Splits Telegram HTML into pieces of at most `limit` visible characters. Tags that are open at
 * a cut are closed at the end of the piece and opened again at the start of the next one, so each
 * piece is valid on its own. Entities such as &amp; count as one character.
 */
export function splitHtml(html: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const chunks: string[] = [];
  const open: Array<{ name: string; tag: string }> = [];
  let current = "";
  let visible = 0;

  const closers = (): string => [...open].reverse().map((o) => `</${o.name}>`).join("");
  const reopeners = (): string => open.map((o) => o.tag).join("");
  const flush = (): void => {
    if (visible > 0) chunks.push(current + closers());
    current = reopeners();
    visible = 0;
  };

  for (const token of html.match(TOKEN_PATTERN) ?? []) {
    if (token.startsWith("<") && token.length > 1 && token.endsWith(">")) {
      const name = tagName(token);
      if (token.startsWith("</")) {
        const index = open.map((o) => o.name).lastIndexOf(name);
        if (index >= 0) open.splice(index, 1);
      } else if (name !== "" && !token.endsWith("/>")) {
        open.push({ name, tag: token });
      }
      current += token;
    } else if (/^&#?\w+;$/.test(token)) {
      if (visible + 1 > limit) flush();
      current += token;
      visible += 1;
    } else {
      let rest = token;
      while (rest.length > 0) {
        if (visible >= limit) flush();
        const cut = cutPoint(rest, limit - visible);
        current += rest.slice(0, cut);
        visible += cut;
        rest = rest.slice(cut);
        if (rest.length > 0) flush();
      }
    }
  }
  if (visible > 0) chunks.push(current + closers());
  return chunks.length > 0 ? chunks : [""];
}

/** Splits plain text (escaped first) into HTML pieces. */
export function splitPlainText(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  return splitHtml(escapeHtml(text), limit);
}

/** Cuts raw text to `max` characters. Never leaves a partial tag at the end of HTML. */
export function truncateText(text: string, max: number, isHtml: boolean): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max);
  if (isHtml) {
    const lt = cut.lastIndexOf("<");
    if (lt > cut.lastIndexOf(">")) cut = cut.slice(0, lt);
    const amp = cut.lastIndexOf("&");
    if (amp > cut.lastIndexOf(";") && cut.length - amp <= 10) cut = cut.slice(0, amp);
  }
  return { text: cut, truncated: true };
}
