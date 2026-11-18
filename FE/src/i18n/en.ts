/** English dictionary. Typed against the Vietnamese one: a missing or extra key fails tsc. */
import type { Dictionary } from './vi.ts';
import { common } from './en/common.ts';
import { nav, shell } from './en/nav.ts';
import { auth } from './en/auth.ts';
import { dashboard } from './en/dashboard.ts';
import { reports } from './en/reports.ts';
import { models } from './en/models.ts';
import { forecast } from './en/forecast.ts';
import { products } from './en/products.ts';
import { replenishment } from './en/replenishment.ts';
import { abcxyz } from './en/abcxyz.ts';
import { settings } from './en/settings.ts';
import { inventory } from './en/inventory.ts';
import { be } from './en/be.ts';

export const en: Dictionary = {
  common,
  nav,
  shell,
  auth,
  dashboard,
  reports,
  models,
  forecast,
  products,
  replenishment,
  abcxyz,
  settings,
  inventory,
  be,
};
