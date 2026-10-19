export type ApprovalStatus = "pending" | "approved" | "rejected" | "interrupted";

/** What a button means for the caller. */
export type ApprovalOutcome = "approved" | "rejected";

export interface ApprovalOption {
  label: string;
  outcome: ApprovalOutcome;
}

/** Where a decision came from. */
export type DecisionSource = "telegram" | "resolve" | "expired" | "shutdown";

/** An approval request, as kept in memory and persisted in data.json (never contains the token). */
export interface Approval {
  id: string;
  status: ApprovalStatus;
  options: ApprovalOption[];
  chatId: string;
  /** Telegram message ids of every chunk sent; the last one carries the buttons and the status line. */
  messageIds: number[];
  /** HTML body of the last chunk, without the status line (used to re-render the status). */
  text: string;
  /** Display name of the client that asked. */
  requester: string;
  createdAt: number;
  expiresAt?: number;
  decidedAt?: number;
  /** Label of the button that was pressed, when there was one. */
  choice?: string;
  decidedBy?: DecisionSource;
  detail?: string;
  /** Language of the status line of this message. */
  lang: "en" | "pt";
}

export type PersistedApproval = Approval;

/** What the HTTP routes and tools return for an approval. */
export interface ApprovalView {
  id: string;
  status: ApprovalStatus;
  choice: string | null;
  decided_at: string | null;
  decided_by: DecisionSource | null;
  created_at: string;
  expires_at: string | null;
  options: string[];
}

export function toView(approval: Approval): ApprovalView {
  return {
    id: approval.id,
    status: approval.status,
    choice: approval.choice ?? null,
    decided_at: approval.decidedAt ? new Date(approval.decidedAt).toISOString() : null,
    decided_by: approval.decidedBy ?? null,
    created_at: new Date(approval.createdAt).toISOString(),
    expires_at: approval.expiresAt ? new Date(approval.expiresAt).toISOString() : null,
    options: approval.options.map((o) => o.label),
  };
}
