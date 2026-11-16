import { describe, expect, it } from 'vitest';
import { inventoryPosition, kappaFromPolicy, orderQuantity, orderUpTo, reorderPoint } from './policyMath.ts';

describe('policyMath', () => {
  it('kappa = (S - s) / EOQ', () => {
    expect(kappaFromPolicy(10, 30, 20)).toBe(1);
    expect(kappaFromPolicy(10, 25, 10)).toBe(1.5);
    expect(kappaFromPolicy(10, 10, 5)).toBe(0);
  });

  it('kappa is null (never 0 or NaN) when an input is missing or EOQ is not positive', () => {
    expect(kappaFromPolicy(null, 30, 20)).toBeNull();
    expect(kappaFromPolicy(10, undefined, 20)).toBeNull();
    expect(kappaFromPolicy(10, 30, 0)).toBeNull();
    expect(kappaFromPolicy(10, 30, -5)).toBeNull();
    expect(kappaFromPolicy(Number.NaN, 30, 20)).toBeNull();
  });

  it('s = ceil(Q * exp(m + theta))', () => {
    expect(reorderPoint(10, 0, 0)).toBe(10);
    expect(reorderPoint(10, Math.log(2), 0)).toBe(20);
    expect(reorderPoint(10, 0.1, 0.05)).toBe(Math.ceil(10 * Math.exp(0.15)));
    expect(reorderPoint(null, 0, 0)).toBeNull();
  });

  it('S = s + ceil(kappa * EOQ), q = max(0, S - IP), IP = on_hand + on_order', () => {
    expect(orderUpTo(10, 1.5, 7)).toBe(21);
    expect(orderUpTo(10, null, 7)).toBeNull();
    expect(orderQuantity(30, 12)).toBe(18);
    expect(orderQuantity(30, 50)).toBe(0);
    expect(orderQuantity(null, 5)).toBeNull();
    expect(inventoryPosition(4, 6)).toBe(10);
    expect(inventoryPosition(4, null)).toBeNull();
  });
});
