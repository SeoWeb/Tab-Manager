import type { CloudMutation, SyncMutationOutcome } from './types';

/**
 * Outcome-driven queue gating.
 *
 * The sync endpoint reports exactly one outcome per submitted mutation. What
 * happens to a queued mutation depends on that verdict:
 * - `applied`  — committed; the queue entry is done and is removed.
 * - `conflict` — deterministic CAS rejection. The entry is RETAINED, flagged
 *                `conflicted`, until the user's resolution is applied or the
 *                conflict is explicitly discarded (fix-cross-context-data-loss
 *                7.1) — it must never be deleted merely because a conflict was
 *                recorded. Retrying can never succeed, so flagged entries are
 *                excluded from future pushes rather than dropped.
 * - `skipped`  — permanently rejected without being attempted; warned about
 *                and dropped (keeping it would loop forever).
 * - `error`    — transient per-mutation failure; the entry STAYS queued for
 *                the next sync. Infrastructure failures are HTTP 5xx and never
 *                reach this path.
 * A missing outcome entry is treated like an error: keep queued + log, never
 * drop silently.
 */

export interface OutcomeGate {
  /** Mutations the server finalized; safe to remove from the queue. */
  settled: CloudMutation[];
  /** Mutations the server rejected via CAS; flag + retain until resolution. */
  conflicted: CloudMutation[];
  /** Mutations kept queued (`error` outcomes or missing entries). */
  retained: CloudMutation[];
}

/**
 * Partition pushed mutations by their sync outcomes. Matching is by
 * `clientMutationId` (not position) so a reordered outcome list can never
 * settle the wrong mutation. Logs a warning for `skipped`/missing entries and
 * an error for `error` outcomes.
 */
export function gateMutationsByOutcomes(
  mutations: readonly CloudMutation[],
  outcomes: readonly SyncMutationOutcome[] | undefined
): OutcomeGate {
  const byId = new Map<string, SyncMutationOutcome>();
  for (const outcome of outcomes ?? []) {
    byId.set(outcome.clientMutationId, outcome);
  }

  const settled: CloudMutation[] = [];
  const conflicted: CloudMutation[] = [];
  const retained: CloudMutation[] = [];
  for (const mutation of mutations) {
    const outcome = byId.get(mutation.clientMutationId);
    if (!outcome) {
      console.warn(
        `[cloud-sync] no outcome reported for mutation ${mutation.clientMutationId}; keeping it queued`
      );
      retained.push(mutation);
      continue;
    }
    switch (outcome.status) {
      case 'applied':
        settled.push(mutation);
        break;
      case 'conflict':
        // CAS rejection: the local edit stays queued (flagged) until the user
        // resolves or discards the conflict. Never deleted here.
        conflicted.push(mutation);
        break;
      case 'skipped':
        console.warn(
          `[cloud-sync] mutation ${mutation.clientMutationId} skipped by server (${outcome.reason ?? 'unknown reason'}); dropping it`
        );
        settled.push(mutation);
        break;
      case 'error':
        console.error(
          `[cloud-sync] mutation ${mutation.clientMutationId} failed: ${outcome.message ?? 'unknown error'}; keeping it queued`
        );
        retained.push(mutation);
        break;
      default:
        // Unknown status from a newer server: conservative — keep queued.
        console.warn(
          `[cloud-sync] mutation ${mutation.clientMutationId} reported unknown outcome "${String(outcome.status)}"; keeping it queued`
        );
        retained.push(mutation);
        break;
    }
  }
  return { settled, conflicted, retained };
}
