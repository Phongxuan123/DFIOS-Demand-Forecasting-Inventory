/**
 * Role-based UI permissions (R-36). Mirrors the backend dependencies
 * (require_admin / require_manager_or_admin / get_current_user). The backend stays the
 * source of truth: this only decides what to show, a 403 must still be rendered as a
 * "no permission" state, never as an empty list.
 */
export type Role = 'ADMIN' | 'WAREHOUSE MANAGER' | 'VIEWER';

export type Action =
  | 'view:dashboard'
  | 'view:forecast'
  | 'view:replenishment'
  | 'view:abcxyz'
  | 'view:reports'
  | 'view:products'
  | 'view:models'
  | 'view:settings'
  | 'clock:view'
  | 'clock:advance'
  | 'replenishment:write'
  | 'inventory:adjust'
  | 'models:manage'
  | 'users:manage'
  | 'audit:view'
  | 'data:import'
  | 'data:quality';

const ALL: readonly Role[] = ['ADMIN', 'WAREHOUSE MANAGER', 'VIEWER'];
const MANAGER_UP: readonly Role[] = ['ADMIN', 'WAREHOUSE MANAGER'];
const ADMIN_ONLY: readonly Role[] = ['ADMIN'];

const MATRIX: Record<Action, readonly Role[]> = {
  'view:dashboard': ALL,
  'view:forecast': ALL,
  'view:replenishment': MANAGER_UP, // GET /replenishments needs manager
  'view:abcxyz': ALL,
  'view:reports': ALL,
  'view:products': ALL,
  'view:models': ADMIN_ONLY, // /models/* is admin only
  'view:settings': ALL, // profile is for everyone, admin tabs gate themselves
  'clock:view': MANAGER_UP, // GET /clock
  'clock:advance': ADMIN_ONLY, // POST /clock/advance is admin only
  'replenishment:write': MANAGER_UP,
  'inventory:adjust': MANAGER_UP,
  'models:manage': ADMIN_ONLY,
  'users:manage': ADMIN_ONLY,
  'audit:view': ADMIN_ONLY,
  'data:import': MANAGER_UP, // POST /imports: Manager + Admin
  'data:quality': ADMIN_ONLY, // /data-quality/*: require_admin
};

export function normalizeRole(role: string | undefined | null): Role {
  const r = (role || 'VIEWER').toUpperCase();
  if (r === 'ADMIN') return 'ADMIN';
  if (r === 'WAREHOUSE MANAGER' || r === 'MANAGER') return 'WAREHOUSE MANAGER';
  return 'VIEWER';
}

export function can(role: string | undefined | null, action: Action): boolean {
  return MATRIX[action].includes(normalizeRole(role));
}

/** i18n key suffix for a role: common.roles.<roleKey(role)>. */
export function roleKey(role: string | undefined | null): 'admin' | 'manager' | 'viewer' {
  const r = normalizeRole(role);
  return r === 'ADMIN' ? 'admin' : r === 'WAREHOUSE MANAGER' ? 'manager' : 'viewer';
}
