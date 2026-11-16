import { describe, expect, it } from 'vitest';
import { can, normalizeRole, roleKey, type Action } from './permissions.ts';

describe('can() role matrix', () => {
  const adminOnly: Action[] = ['view:models', 'clock:advance', 'models:manage', 'users:manage', 'audit:view'];
  const managerUp: Action[] = ['view:replenishment', 'clock:view', 'replenishment:write', 'inventory:adjust', 'data:import'];
  const everyone: Action[] = ['view:dashboard', 'view:forecast', 'view:abcxyz', 'view:reports', 'view:products', 'view:settings'];

  it('admin can do everything', () => {
    for (const a of [...adminOnly, ...managerUp, ...everyone]) expect(can('ADMIN', a), a).toBe(true);
  });

  it('manager gets operational actions but no admin actions', () => {
    for (const a of managerUp) expect(can('WAREHOUSE MANAGER', a), a).toBe(true);
    for (const a of adminOnly) expect(can('WAREHOUSE MANAGER', a), a).toBe(false);
  });

  it('viewer only reads the shared pages', () => {
    for (const a of everyone) expect(can('VIEWER', a), a).toBe(true);
    for (const a of [...managerUp, ...adminOnly]) expect(can('VIEWER', a), a).toBe(false);
  });

  it('unknown or missing role is treated as viewer (least privilege)', () => {
    expect(can(undefined, 'view:replenishment')).toBe(false);
    expect(can(null, 'clock:advance')).toBe(false);
    expect(can('SUPERUSER', 'users:manage')).toBe(false);
    expect(normalizeRole('manager')).toBe('WAREHOUSE MANAGER');
    expect(normalizeRole('admin')).toBe('ADMIN');
  });

  it('maps roles to i18n key suffixes', () => {
    expect(roleKey('ADMIN')).toBe('admin');
    expect(roleKey('WAREHOUSE MANAGER')).toBe('manager');
    expect(roleKey(undefined)).toBe('viewer');
  });
});
