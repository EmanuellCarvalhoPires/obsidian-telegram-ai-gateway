// Checks the input of telegram_ask_question / POST /question and turns it into clean items.
// Every refusal is a PolicyViolationError (HTTP 400) with a message the agent can act on.
import { t } from "../i18n";
import { PolicyViolationError } from "../policy/policy";
import { isRecord } from "../util/guards";
import type { NewQuestionItem } from "./store";
import { QUESTION_LIMITS } from "./types";
import type { QuestionOption } from "./types";

function refuse(key: string, vars?: Record<string, string | number>): never {
  throw new PolicyViolationError(t(key, vars), 400);
}

/** Length in characters as the user sees them (an emoji counts as one). */
function length(text: string): number {
  return [...text].length;
}

function parseOptions(raw: unknown, n: number): QuestionOption[] {
  const { min, max } = QUESTION_LIMITS.options;
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) refuse("question.error.options", { n, min, max });
  const options: QuestionOption[] = [];
  raw.forEach((entry: unknown, i) => {
    // A bare string is accepted as a label.
    const source = typeof entry === "string" ? { label: entry } : isRecord(entry) ? entry : {};
    const label = typeof source.label === "string" ? source.label.trim() : "";
    if (label === "" || length(label) > QUESTION_LIMITS.label) {
      refuse("question.error.optionLabel", { n, o: i + 1, max: QUESTION_LIMITS.label });
    }
    if (options.some((o) => o.label === label)) refuse("question.error.optionDuplicate", { n, label });
    const description = source.description;
    if (description !== undefined && description !== null && (typeof description !== "string" || length(description) > QUESTION_LIMITS.description)) {
      refuse("question.error.optionDescription", { n, o: i + 1, max: QUESTION_LIMITS.description });
    }
    const text = typeof description === "string" ? description.trim() : "";
    options.push(text ? { label, description: text } : { label });
  });
  return options;
}

export function parseQuestions(raw: unknown): NewQuestionItem[] {
  const { min, max } = QUESTION_LIMITS.questions;
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) refuse("question.error.questionsRequired", { min, max });
  const items: NewQuestionItem[] = [];
  raw.forEach((entry: unknown, i) => {
    const n = i + 1;
    if (!isRecord(entry)) refuse("question.error.notObject", { n });
    const question = typeof entry.question === "string" ? entry.question.trim() : "";
    if (question === "" || length(question) > QUESTION_LIMITS.question) {
      refuse("question.error.questionText", { n, max: QUESTION_LIMITS.question });
    }
    if (items.some((item) => item.question === question)) refuse("question.error.questionDuplicate", { n });
    const header = entry.header;
    if (header !== undefined && header !== null && (typeof header !== "string" || length(header.trim()) > QUESTION_LIMITS.header)) {
      refuse("question.error.header", { n, max: QUESTION_LIMITS.header });
    }
    const multiSelect = entry.multiSelect;
    if (multiSelect !== undefined && multiSelect !== null && typeof multiSelect !== "boolean") refuse("question.error.multiSelect", { n });
    items.push({
      question,
      header: typeof header === "string" ? header.trim() : "",
      options: parseOptions(entry.options, n),
      multiSelect: multiSelect === true,
    });
  });
  return items;
}

/** Optional one-line texts (title, context): undefined when absent or blank, refused when too long. */
export function parseNote(raw: unknown, key: "title" | "context"): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const max = QUESTION_LIMITS[key];
  if (typeof raw !== "string" || length(raw.trim()) > max) refuse(`question.error.${key}`, { max });
  const text = raw.trim();
  return text === "" ? undefined : text;
}
