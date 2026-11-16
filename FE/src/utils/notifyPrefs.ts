/**
 * Per-account notification preferences for the topbar bell (stored in this browser only).
 * They are READ by the bell (useAlertFeed): a switched-off category is neither fetched nor shown.
 *   stock          -> CRITICAL stock alerts (count badge + rows)
 *   replenishment  -> pending replenishment orders line
 * R5F-08: key `dfios_notification_prefs` holds one entry PER ACCOUNT ({ [userId]: prefs }) and is preserved across
 * login/logout (services/session.ts PRESERVED_KEYS), so a sign-in no longer resets the switches and accounts that
 * share a browser keep separate choices.
 */
import { getStoredUser } from '../services/session.ts';

export const NOTIF_KEY = 'dfios_notification_prefs';
export const NOTIF_PREFS_EVENT = 'dfios:notification-prefs';

export interface NotifPrefs {
  stock: boolean;
  replenishment: boolean;
}

export const DEFAULT_NOTIFS: NotifPrefs = { stock: true, replenishment: true };

function accountKey(): string {
  const u = getStoredUser<{ id?: unknown; email?: unknown }>();
  return typeof u?.id === 'string' && u.id ? u.id : typeof u?.email === 'string' && u.email ? u.email : 'anonymous';
}

function readAll(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(NOTIF_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readNotifPrefs(): NotifPrefs {
  try {
    const all = readAll();
    const own = all[accountKey()];
    // per-account entry; a flat object is the older single-entry format
    const entry = own && typeof own === 'object' ? own : 'stock' in all || 'replenishment' in all ? all : null;
    if (entry) {
      const parsed = entry as Partial<Record<keyof NotifPrefs, unknown>>;
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
    const all = readAll();
    delete all.stock; // drop the older flat format
    delete all.replenishment;
    localStorage.setItem(NOTIF_KEY, JSON.stringify({ ...all, [accountKey()]: next }));
  } catch {
    /* storage blocked: the in-memory value still reaches the bell through the event */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<NotifPrefs>(NOTIF_PREFS_EVENT, { detail: next }));
}
