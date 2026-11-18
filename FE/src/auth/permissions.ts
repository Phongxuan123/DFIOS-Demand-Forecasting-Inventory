/**
 * Role-based UI permissions (R-36). Mirrors the backend dependencies
 * (require_admin / require_manager_or_admin / get_current_user). The backend stays the
 * source of truth: this only decides what to show, a 403 must still be rendered as a
 * "no permission" state, never as an empty list.
 */
export type Role = 'ADMIN' | 'WAREHOUSE MANAGER' | 'PLANNER' | 'VIEWER';

export type Action =
  | 'view:dashboard'
  | 'view:forecast'
  | 'view:replenishment'
  | 'view:abcxyz'
  | 'view:reports'
  | 'view:products'
  | 'view:inventory'
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
  | 'data:quality'
  | 'forecast:write'
  | 'forecast_quality:view'
  | 'policy:manage'
  | 'batch:view'
  | 'forecast_sources:view';

const ALL: readonly Role[] = ['ADMIN', 'WAREHOUSE MANAGER', 'PLANNER', 'VIEWER'];
const PLANNER_UP: readonly Role[] = ['ADMIN', 'WAREHOUSE MANAGER', 'PLANNER'];
const MANAGER_UP: readonly Role[] = ['ADMIN', 'WAREHOUSE MANAGER'];
const ADMIN_ONLY: readonly Role[] = ['ADMIN'];

const MATRIX: Record<Action, readonly Role[]> = {
  'view:dashboard': ALL,
  'view:forecast': ALL,
  'view:replenishment': PLANNER_UP, // Planner, Manager, Admin can view replenishments
  'view:abcxyz': ALL,
  'view:reports': ALL,
  'view:products': ALL,
  'view:inventory': ALL,
  'view:models': ADMIN_ONLY, // /models/* is admin only
  'view:settings': ALL, // profile is for everyone, admin tabs gate themselves
  'clock:view': PLANNER_UP, // GET /clock is allowed for Planner, Manager, Admin
  'clock:advance': ADMIN_ONLY, // POST /clock/advance is admin only
  'replenishment:write': PLANNER_UP, // Planner, Manager, Admin can adjust/approve/reject replenishments
  'inventory:adjust': MANAGER_UP, // Physical stock adjustment remains Manager + Admin
  'models:manage': ADMIN_ONLY,
  'users:manage': ADMIN_ONLY,
  'audit:view': ADMIN_ONLY,
  'data:import': MANAGER_UP, // POST /imports: Manager + Admin
  'data:quality': ADMIN_ONLY, // /data-quality/*: require_admin
  'forecast:write': PLANNER_UP, // forecast overrides + SHAP explanation: Planner, Manager, Admin
  'forecast_quality:view': PLANNER_UP, // GET /metrics/forecast-quality
  // Manager + Admin only on the BE: /simulation/compare-policies, /metrics/controller,
  // /classification/recommendations|recompute, /optimization/service-level|refit-policies
  'policy:manage': MANAGER_UP,
  'batch:view': MANAGER_UP, // /batch-runs: Manager + Admin
  'forecast_sources:view': ADMIN_ONLY, // /forecast-sources: Admin only
};

export function normalizeRole(role: string | undefined | null): Role {
  const r = (role || 'VIEWER').toUpperCase();
  if (r === 'ADMIN') return 'ADMIN';
  if (r === 'WAREHOUSE MANAGER' || r === 'MANAGER') return 'WAREHOUSE MANAGER';
  if (r === 'PLANNER') return 'PLANNER';
  return 'VIEWER';
}

export function can(role: string | undefined | null, action: Action): boolean {
  return MATRIX[action].includes(normalizeRole(role));
}

/** i18n key suffix for a role: common.roles.<roleKey(role)>. */
export function roleKey(role: string | undefined | null): 'admin' | 'manager' | 'planner' | 'viewer' {
  const r = normalizeRole(role);
  if (r === 'ADMIN') return 'admin';
  if (r === 'WAREHOUSE MANAGER') return 'manager';
  if (r === 'PLANNER') return 'planner';
  return 'viewer';
}
