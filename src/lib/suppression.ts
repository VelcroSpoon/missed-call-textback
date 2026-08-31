/**
 * The single decision point for "do we text this caller back?".
 *
 * Kept pure and dependency-free so the rules are testable in isolation and so
 * the order of the checks is obvious: legal first (opt-out), then policy
 * (quiet hours), then cost (Lookup), then configuration.
 */

export type SuppressionReason =
  | "inactive_client"
  | "opted_out"
  | "quiet_hours"
  | "not_mobile";

export interface SuppressionInput {
  clientActive: boolean;
  optedOut: boolean;
  quietHours: boolean;
  /** null = Lookup was inconclusive. We fail open and send. */
  isMobile: boolean | null;
}

export type SuppressionDecision =
  | { send: true; reason: null }
  | { send: false; reason: SuppressionReason };

export function evaluateSuppression(input: SuppressionInput): SuppressionDecision {
  if (!input.clientActive) return { send: false, reason: "inactive_client" };
  if (input.optedOut) return { send: false, reason: "opted_out" };
  if (input.quietHours) return { send: false, reason: "quiet_hours" };
  // Only a definitive "not mobile" blocks the send. An inconclusive lookup
  // (null) still sends — a wasted segment beats a missed lead.
  if (input.isMobile === false) return { send: false, reason: "not_mobile" };
  return { send: true, reason: null };
}

export const SUPPRESSION_LABELS: Record<SuppressionReason | "send_failed", string> = {
  inactive_client: "Client inactive",
  opted_out: "Caller opted out",
  quiet_hours: "Quiet hours",
  not_mobile: "Landline / not SMS-capable",
  send_failed: "Send failed",
};
