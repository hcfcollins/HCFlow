/** What a deal's stage dropdown should show as selected. For non-brokers the
 * list swaps "Closed" (disabled — only a broker closes a deal, via the
 * Close-Out Calculator) for a "Ready for Closeout" option, which isn't a real
 * stage: it's an Under Contract deal with ready_for_closeout_at set. */
export function stageSelectValue(tx, stages) {
  if (tx.stage === "contract" && tx.ready_for_closeout_at && stages.some((s) => s.key === "ready_closeout")) {
    return "ready_closeout";
  }
  return tx.stage;
}

/** Card/detail badge for where a deal sits in the closing workflow, or null. */
export function closingStatusBadge(tx) {
  if (tx.terminated_at) return null;
  if (tx.stage === "contract" && tx.ready_for_closeout_at) return { label: "Ready for Closeout", className: "tx-status-badge--ready" };
  if (tx.stage === "closed" && tx.compliance_closed_at) return { label: "✓ Compliance Closed", className: "tx-status-badge--compliant" };
  if (tx.stage === "closed") return { label: "Compliance Review", className: "tx-status-badge--review" };
  return null;
}
