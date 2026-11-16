/**
 * Per-account notification preferences for the topbar bell (stored in this browser only).
 * They are READ by the bell (useAlertFeed): a switched-off category is neither fetched nor shown.
 *   stock          -> CRITICAL stock alerts (count badge + rows)
 *   replenishment  -> pending replenishment orders line
 * Key `dfios_notification_prefs` is per account: it is wiped on login/logout (services/session.ts).
 */
export const NOTIF_KEY = 'dfios_notification_prefs';
export const NOTIF_PREFS_EVENT = 'dfios:notification-prefs';

export interface NotifPrefs {
  stock: boolean;
  replenishment: boolean;
}

export const DEFAULT_NOTIFS: NotifPrefs = { stock: true, replenishment: true };

export function readNotifPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(NOTIF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<keyof NotifPrefs, unknown>>;
      return {
        stock: typeof parsed.stock === 'boolean' ? parsed.stock : DEFAULT_NOTIFS.stock,
        replenishment: typeof parsed.replenishment === 'boolean' ? parsed.replenishment : DEFAULT_NOTIFS.replenishment,
      };
    }
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  return { ...DEFAULT_NOTIFS };
}

export function writeNotifPrefs(next: NotifPrefs): void {
  try {
    localStorage.setItem(NOTIF_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the in-memory value still reaches the bell through the event */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<NotifPrefs>(NOTIF_PREFS_EVENT, { detail: next }));
}
