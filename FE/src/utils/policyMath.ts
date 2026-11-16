/**
 * Single source of truth for the (R, s, S) policy arithmetic shown in the UI (R-29, P-41).
 * Matches docs/research.md: s = ceil(Q_hat * exp(m_g + theta)), S = s + kappa * EOQ,
 * kappa = (S - s) / EOQ. Pages should display the s / S the backend computed
 * (inventory_params / replenishments) and only use these helpers to DERIVE kappa or to
 * explain a number, never to invent one. Every function returns null when an input is
 * missing or the result is not a finite number.
 */
const fin = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** kappa = (S - s) / EOQ. */
export function kappaFromPolicy(s: number | null | undefined, S: number | null | undefined, eoq: number | null | undefined): number | null {
  if (!fin(s) || !fin(S) || !fin(eoq) || eoq <= 0) return null;
  return (S - s) / eoq;
}

/** s = ceil(Q_hat * exp(m_g + theta)). */
export function reorderPoint(qHat: number | null | undefined, mG: number | null | undefined, theta: number | null | undefined): number | null {
  if (!fin(qHat) || !fin(mG) || !fin(theta)) return null;
  return Math.ceil(qHat * Math.exp(mG + theta));
}

/** S = s + ceil(kappa * EOQ) (the backend rounds kappa * EOQ up). */
export function orderUpTo(s: number | null | undefined, kappa: number | null | undefined, eoq: number | null | undefined): number | null {
  if (!fin(s) || !fin(kappa) || !fin(eoq)) return null;
  return s + Math.ceil(kappa * eoq);
}

/** Order quantity q = max(0, S - IP). */
export function orderQuantity(S: number | null | undefined, inventoryPosition: number | null | undefined): number | null {
  if (!fin(S) || !fin(inventoryPosition)) return null;
  return Math.max(0, S - inventoryPosition);
}

/** Inventory position IP = on_hand + on_order. */
export function inventoryPosition(onHand: number | null | undefined, onOrder: number | null | undefined): number | null {
  if (!fin(onHand) || !fin(onOrder)) return null;
  return onHand + onOrder;
}
