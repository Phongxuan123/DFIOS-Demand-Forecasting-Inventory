/**
 * Same-tab bridge between pages that change stock/orders and the Topbar bell.
 * (U-01/U-02) The old per-account "tracked history" that downloaded every CRITICAL alert and every
 * PENDING order is gone: the bell now asks the server for a count plus a handful of rows.
 */
export const ALERTS_SYNC_EVENT = 'dfios:alerts-updated';

/** Tell the bell that stock or orders changed so it re-reads its (small) server summary. */
export const emitAlertsSyncEvent = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ALERTS_SYNC_EVENT));
  }
};
