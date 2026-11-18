import type { LucideIcon } from 'lucide-react';
import { Boxes, Warehouse, Cpu, FileBarChart, LayoutDashboard, PieChart, Settings, Palette, Truck, TrendingUp } from 'lucide-react';
import type { Action } from '../../auth/permissions.ts';
import type { TKey } from '../../i18n/index.tsx';

export interface NavItem {
  path: string;
  label: TKey;
  icon: LucideIcon;
  /** Item is hidden for roles that lack this action (R-36). */
  action: Action;
  /** Only in `vite dev`. */
  devOnly?: boolean;
  end?: boolean;
}

export interface NavGroup {
  id: string;
  label: TKey;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'operations',
    label: 'nav.group_operations',
    items: [
      { path: '/', label: 'nav.dashboard', icon: LayoutDashboard, action: 'view:dashboard', end: true },
      { path: '/replenishment', label: 'nav.replenishment', icon: Truck, action: 'view:replenishment' },
      { path: '/inventory', label: 'nav.inventory', icon: Warehouse, action: 'view:inventory' },
      { path: '/products', label: 'nav.products', icon: Boxes, action: 'view:products' },
    ],
  },
  {
    id: 'analysis',
    label: 'nav.group_analysis',
    items: [
      { path: '/forecast-explorer', label: 'nav.forecast_explorer', icon: TrendingUp, action: 'view:forecast' },
      { path: '/abc-xyz', label: 'nav.abc_xyz', icon: PieChart, action: 'view:abcxyz' },
      { path: '/reports', label: 'nav.reports', icon: FileBarChart, action: 'view:reports' },
      { path: '/model-performance', label: 'nav.model_performance', icon: Cpu, action: 'view:models' },
    ],
  },
  {
    id: 'system',
    label: 'nav.group_system',
    items: [
      { path: '/settings', label: 'nav.settings', icon: Settings, action: 'view:settings' },
      { path: '/design-system', label: 'nav.design_system', icon: Palette, action: 'view:dashboard', devOnly: true },
    ],
  },
];
