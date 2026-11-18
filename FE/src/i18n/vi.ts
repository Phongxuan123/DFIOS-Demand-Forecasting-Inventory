/**
 * Vietnamese dictionary (default locale, source of truth for the key set).
 * Each namespace lives in its own file under ./vi so page agents can work in parallel.
 * To add a namespace: create vi/<ns>.ts + en/<ns>.ts and register it here and in en.ts.
 */
import { common } from './vi/common.ts';
import { nav, shell } from './vi/nav.ts';
import { auth } from './vi/auth.ts';
import { dashboard } from './vi/dashboard.ts';
import { reports } from './vi/reports.ts';
import { models } from './vi/models.ts';
import { forecast } from './vi/forecast.ts';
import { products } from './vi/products.ts';
import { replenishment } from './vi/replenishment.ts';
import { abcxyz } from './vi/abcxyz.ts';
import { settings } from './vi/settings.ts';
import { inventory } from './vi/inventory.ts';
import { metrics } from './vi/metrics.ts';
import { be } from './vi/be.ts';
import { ops } from './vi/ops.ts';

export const vi = {
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
  metrics,
  be,
  ops,
};

export type Dictionary = typeof vi;
