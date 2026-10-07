export type StoreStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'BLOCKED';

/**
 * Who changes a store's status and how:
 * - an admin verifies, rejects, blocks and unblocks;
 * - the seller resubmits a rejected store, or sends a verified store back to review by
 *   changing its legal data (BIN/IIN, legal name).
 */
export type StoreTransition =
  'verify' | 'reject' | 'block' | 'unblock' | 'resubmit' | 'legalDataChanged';

const TRANSITIONS: Record<
  StoreTransition,
  { from: readonly StoreStatus[]; to: StoreStatus | 'previous' }
> = {
  verify: { from: ['PENDING_VERIFICATION'], to: 'VERIFIED' },
  reject: { from: ['PENDING_VERIFICATION'], to: 'REJECTED' },
  block: { from: ['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'], to: 'BLOCKED' },
  // A blocked store returns to where it was: verified if it had been verified, otherwise to review.
  unblock: { from: ['BLOCKED'], to: 'previous' },
  resubmit: { from: ['REJECTED'], to: 'PENDING_VERIFICATION' },
  legalDataChanged: { from: ['VERIFIED'], to: 'PENDING_VERIFICATION' },
};

export class StoreTransitionError extends Error {
  constructor(
    readonly transition: StoreTransition,
    readonly from: StoreStatus,
  ) {
    super(`Cannot ${transition} a store in status ${from}`);
    this.name = 'StoreTransitionError';
  }
}

/** Statuses from which the transition is allowed (used for atomic conditional updates). */
export function allowedFrom(transition: StoreTransition): readonly StoreStatus[] {
  return TRANSITIONS[transition].from;
}

export function nextStoreStatus(
  transition: StoreTransition,
  from: StoreStatus,
  context: { wasVerified: boolean } = { wasVerified: false },
): StoreStatus {
  const rule = TRANSITIONS[transition];
  if (!rule.from.includes(from)) throw new StoreTransitionError(transition, from);
  if (rule.to === 'previous') return context.wasVerified ? 'VERIFIED' : 'PENDING_VERIFICATION';
  return rule.to;
}

/** Only a verified store can publish products and receive orders. */
export function canSell(status: StoreStatus): boolean {
  return status === 'VERIFIED';
}
