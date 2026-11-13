import type {
  CalibrationStateItem,
  CalibrationStatusResponse,
  PolicySelectionItem,
  WindowQuantileResponse,
} from '../services/api.ts';

export interface NormalizedQuantilePoint {
  tau: number;
  label: string;
  value: number;
}

export interface RouteCCurvePoint {
  tau: number;
  tauLabel: string;
  routeC: number;
  routeB: number | null;
}

export interface RouteCSummary {
  isLive: boolean;
  sourceLabel: 'live_api' | 'estimated_fallback';
  H: number;
  originDate: string | null;
  routeName: string;
  modelRunId: string | null;
  segmentClass: string;
  muH: number;
  sigmaH: number;
  thetaG: number;
  multiplierG: number;
  atBoundary: boolean;
  sBase: number;
  conformalOffset: number;
  sCalibrated: number;
  tau95Value: number;
  routeBAtTarget: number | null;
  quantileCount: number;
  curve: RouteCCurvePoint[];
}

export interface LiveTrajectoryPoint {
  cycle: string;
  k: number;
  reviewDate: string;
  availability: number;
  target: number;
  theta: number;
  multiplier: number;
  errorRate: number;
  atBoundary: boolean;
  eta: number;
  phase: string;
}

export interface EffectiveRssMetrics {
  reorderPointS: number | null;
  orderUpToS: number | null;
  safetyStock: number | null;
  eoq: number | null;
  inventoryPosition: number;
  recommendedQty: number;
  policyApplied: string;
  reviewDate: string | null;
  modelRunId: string | null;
  source: string;
  kappa: number | null;
  serviceLevel: number;
  stockoutRisk: number | null;
}

export interface CalendarGridCell {
  date: Date;
  isoKey: string;
  day: number;
  inCurrentMonth: boolean;
}

/**
 * Formats a Date into a local YYYY-MM-DD key without UTC timezone drift.
 */
export function toIsoDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Generates a fixed 6-week (42-cell) Monday-first grid for the specified year and 0-indexed month.
 */
export function buildCalendarMonthGrid(year: number, month: number): CalendarGridCell[] {
  const firstOfMonth = new Date(year, month, 1);
  // Map Sunday(0)..Saturday(6) into Monday(0)..Sunday(6)
  const leadingDays = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - leadingDays);

  const cells: CalendarGridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push({
      date: cellDate,
      isoKey: toIsoDateKey(cellDate),
      day: cellDate.getDate(),
      inCurrentMonth: cellDate.getMonth() === month && cellDate.getFullYear() === year,
    });
  }
  return cells;
}

const DEFAULT_FALLBACK_TAUS = [
  { tau: 0.05, z: -1.645 },
  { tau: 0.1, z: -1.282 },
  { tau: 0.15, z: -1.036 },
  { tau: 0.2, z: -0.842 },
  { tau: 0.25, z: -0.674 },
  { tau: 0.3, z: -0.524 },
  { tau: 0.4, z: -0.253 },
  { tau: 0.5, z: 0.0 },
  { tau: 0.6, z: 0.253 },
  { tau: 0.7, z: 0.524 },
  { tau: 0.75, z: 0.674 },
  { tau: 0.8, z: 0.842 },
  { tau: 0.85, z: 1.036 },
  { tau: 0.9, z: 1.282 },
  { tau: 0.95, z: 1.645 },
  { tau: 0.975, z: 1.96 },
  { tau: 0.99, z: 2.326 },
  { tau: 0.995, z: 2.576 },
  { tau: 0.999, z: 3.09 },
];

/**
 * Formats quantile probability tau consistently for chart ticks and lookup labels.
 */
export function formatTauLabel(tau: number): string {
  if (!Number.isFinite(tau)) return '0.95';
  const rounded4 = Math.round(tau * 10000) / 10000;
  if (Math.abs(rounded4 * 100 - Math.round(rounded4 * 100)) < 1e-6) {
    return rounded4.toFixed(2);
  }
  return rounded4.toString();
}

/**
 * Normalizes backend q_levels keys (e.g. "0.8", "0.9", "0.95", "0.975") into sorted numeric quantile entries.
 */
export function normalizeQuantileMap(
  qLevels: Record<string, number> | null | undefined
): NormalizedQuantilePoint[] {
  if (!qLevels || typeof qLevels !== 'object') return [];

  const deduped = new Map<number, number>();
  for (const [rawKey, rawVal] of Object.entries(qLevels)) {
    const tau = Number.parseFloat(rawKey);
    const val = Number(rawVal);
    if (Number.isFinite(tau) && tau > 0 && tau < 1 && Number.isFinite(val)) {
      const normalizedTau = Math.round(tau * 10000) / 10000;
      deduped.set(normalizedTau, Math.max(0, val));
    }
  }

  return Array.from(deduped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tau, value]) => ({
      tau,
      label: formatTauLabel(tau),
      value,
    }));
}

/**
 * Resolves a quantile value at targetTau with exact float-tolerant lookup or piecewise linear interpolation.
 */
export function resolveQuantileValue(
  qLevels: Record<string, number> | null | undefined,
  targetTau: number
): { value: number; exact: boolean; matchedTau: number } | null {
  const points = normalizeQuantileMap(qLevels);
  if (points.length === 0) return null;

  const exact = points.find((p) => Math.abs(p.tau - targetTau) < 1e-4);
  if (exact) {
    return { value: exact.value, exact: true, matchedTau: exact.tau };
  }

  if (targetTau <= points[0].tau) {
    return { value: points[0].value, exact: false, matchedTau: points[0].tau };
  }
  const last = points[points.length - 1];
  if (targetTau >= last.tau) {
    return { value: last.value, exact: false, matchedTau: last.tau };
  }

  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];
    if (targetTau > lo.tau && targetTau < hi.tau) {
      const weight = (targetTau - lo.tau) / (hi.tau - lo.tau);
      const interpolated = lo.value + weight * (hi.value - lo.value);
      return { value: interpolated, exact: false, matchedTau: targetTau };
    }
  }

  return null;
}

function approxNormalZ(tau: number): number {
  const known = DEFAULT_FALLBACK_TAUS.find((item) => Math.abs(item.tau - tau) < 1e-4);
  if (known) return known.z;
  // Beasley-Springer-Moro style compact rational approximation for tail z
  const p = Math.min(0.9995, Math.max(0.0005, tau));
  const sign = p < 0.5 ? -1 : 1;
  const t = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  const z = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
  return sign * z;
}

/**
 * Computes Route (c) protection-window summary using live BE window quantiles + calibration state,
 * falling back transparently to forecast/uncertainty estimates when a SKU lacks persisted window quantiles.
 */
export function computeRouteCSummary(params: {
  windowQuantile?: WindowQuantileResponse | null;
  dailyForecastDemands?: number[];
  sigmaHFromUncertainty?: number | null;
  targetTau: number;
  segmentClass?: string | null;
  calibrationStatus?: CalibrationStatusResponse | null;
}): RouteCSummary {
  const {
    windowQuantile,
    dailyForecastDemands = [],
    sigmaHFromUncertainty,
    targetTau,
    segmentClass,
    calibrationStatus,
  } = params;

  const seg = (segmentClass || 'AX').toUpperCase();
  const calState = calibrationStatus?.states?.find((s) => s.class_id?.toUpperCase() === seg);
  const thetaRaw =
    calibrationStatus?.thetas?.[seg] ??
    calState?.theta ??
    0;
  const thetaG = Number.isFinite(Number(thetaRaw)) ? Number(thetaRaw) : 0;
  const multRaw =
    calibrationStatus?.multipliers?.[seg] ??
    calState?.multiplier ??
    Math.exp(thetaG);
  const multiplierG = Number.isFinite(Number(multRaw)) ? Number(multRaw) : Math.exp(thetaG);
  const atBoundary = Boolean(
    calState?.at_boundary || calibrationStatus?.at_boundary_classes?.includes(seg)
  );

  const normalizedPoints = normalizeQuantileMap(windowQuantile?.q_levels);
  const hasLiveQuantiles = Boolean(windowQuantile && normalizedPoints.length > 0);

  if (hasLiveQuantiles && windowQuantile) {
    const H = Number(windowQuantile.horizon_days) || 10;
    const muH = Number(windowQuantile.point_window) || 0;
    const tau95Resolved = resolveQuantileValue(windowQuantile.q_levels, 0.95);
    const tau95Value = Number(windowQuantile.tau_95 ?? tau95Resolved?.value ?? muH);

    const impliedSigma =
      tau95Value > muH ? (tau95Value - muH) / 1.645 : Math.max(1, muH * 0.18);
    const sigmaH =
      sigmaHFromUncertainty != null && sigmaHFromUncertainty > 0
        ? Number(sigmaHFromUncertainty)
        : Number(impliedSigma.toFixed(2));

    // Ensure the currently inspected targetTau appears cleanly on the curve
    const hasTargetOnCurve = normalizedPoints.some((p) => Math.abs(p.tau - targetTau) < 1e-4);
    const mergedPoints = [...normalizedPoints];
    if (!hasTargetOnCurve) {
      const resolvedTarget = resolveQuantileValue(windowQuantile.q_levels, targetTau);
      if (resolvedTarget) {
        mergedPoints.push({
          tau: targetTau,
          label: formatTauLabel(targetTau),
          value: resolvedTarget.value,
        });
        mergedPoints.sort((a, b) => a.tau - b.tau);
      }
    }

    const curve: RouteCCurvePoint[] = mergedPoints.map((pt) => {
      const z = approxNormalZ(pt.tau);
      // Naive Route (b) daily quantile comonotonic inflation benchmark
      const routeB = Math.max(0, Math.round(muH + z * sigmaH * 1.28));
      return {
        tau: pt.tau,
        tauLabel: pt.label,
        routeC: Math.round(pt.value * 10) / 10,
        routeB,
      };
    });

    const selectedResolved = resolveQuantileValue(windowQuantile.q_levels, targetTau);
    const sBase = Math.round((selectedResolved?.value ?? tau95Value) * 10) / 10;
    const conformalOffset = Math.round(Math.max(0, thetaG * sigmaH) * 10) / 10;
    const sCalibrated = Math.round((sBase + conformalOffset) * 10) / 10;
    const selectedCurvePt = curve.find((c) => Math.abs(c.tau - targetTau) < 1e-4);

    return {
      isLive: true,
      sourceLabel: 'live_api',
      H,
      originDate: windowQuantile.origin_date || null,
      routeName: windowQuantile.route || 'route_c',
      modelRunId: windowQuantile.model_run_id || null,
      segmentClass: seg,
      muH: Math.round(muH * 10) / 10,
      sigmaH: Math.round(sigmaH * 10) / 10,
      thetaG: Math.round(thetaG * 1000) / 1000,
      multiplierG: Math.round(multiplierG * 1000) / 1000,
      atBoundary,
      sBase,
      conformalOffset,
      sCalibrated,
      tau95Value: Math.round(tau95Value * 10) / 10,
      routeBAtTarget: selectedCurvePt?.routeB ?? null,
      quantileCount: normalizedPoints.length,
      curve,
    };
  }

  // Fallback preview when persisted window quantiles are absent for the SKU/store
  const H = 10;
  const windowSlice = dailyForecastDemands.slice(0, H);
  const meanDaily =
    windowSlice.length > 0
      ? windowSlice.reduce((acc, v) => acc + Number(v || 0), 0) / windowSlice.length
      : 18.5;
  const muH = Math.max(12, Math.round(meanDaily * H));
  const sigmaH =
    sigmaHFromUncertainty != null && sigmaHFromUncertainty > 0
      ? Number(sigmaHFromUncertainty)
      : Number((muH * 0.215).toFixed(1));

  const curve: RouteCCurvePoint[] = DEFAULT_FALLBACK_TAUS.map((q) => {
    const skewFactor = q.z > 0 ? 1 + 0.11 * q.z : 1 - 0.04 * Math.abs(q.z);
    const routeC = Math.max(1, Math.round(muH + q.z * sigmaH * skewFactor));
    const routeB = Math.max(1, Math.round(muH + q.z * sigmaH * 1.32));
    return {
      tau: q.tau,
      tauLabel: formatTauLabel(q.tau),
      routeC,
      routeB,
    };
  });

  const selectedPt =
    curve.find((c) => Math.abs(c.tau - targetTau) < 1e-4) ||
    curve.find((c) => Math.abs(c.tau - 0.95) < 1e-4) ||
    curve[curve.length - 1];
  const sBase = selectedPt.routeC;
  const conformalOffset = Math.round(Math.max(0, thetaG * sigmaH) * 10) / 10;
  const sCalibrated = Math.round((sBase + conformalOffset) * 10) / 10;
  const pt95 = curve.find((c) => Math.abs(c.tau - 0.95) < 1e-4);

  return {
    isLive: false,
    sourceLabel: 'estimated_fallback',
    H,
    originDate: null,
    routeName: 'estimated_preview',
    modelRunId: null,
    segmentClass: seg,
    muH,
    sigmaH: Math.round(sigmaH * 10) / 10,
    thetaG: Math.round(thetaG * 1000) / 1000,
    multiplierG: Math.round(multiplierG * 1000) / 1000,
    atBoundary,
    sBase,
    conformalOffset,
    sCalibrated,
    tau95Value: pt95?.routeC ?? sBase,
    routeBAtTarget: selectedPt.routeB,
    quantileCount: 0,
    curve,
  };
}

/**
 * Converts backend calibration_history rows (descending order) into chronological k-index trajectory points.
 */
export function buildCalibrationTrajectory(
  historyItems: CalibrationStateItem[],
  classId: string,
  isVi: boolean = false
): LiveTrajectoryPoint[] {
  const targetClass = (classId || 'AX').toUpperCase();
  const filtered = (historyItems || [])
    .filter((item) => (item.class_id || '').toUpperCase() === targetClass)
    .slice()
    .sort((a, b) => Number(a.review_index) - Number(b.review_index));

  return filtered.map((item) => {
    const k = Number(item.review_index) || 0;
    const errorRate = Number(item.error_rate) || 0;
    const setpointFrac = Number(item.setpoint) > 1 ? Number(item.setpoint) / 100 : Number(item.setpoint || 0.95);
    const availability = Number(((1 - errorRate) * 100).toFixed(2));
    const target = Number((setpointFrac * 100).toFixed(1));
    const theta = Number(Number(item.theta || 0).toFixed(3));
    const multiplier = Number(Number(item.multiplier ?? Math.exp(theta)).toFixed(3));
    const deadband = 0.5; // 0.005 in %
    const diff = availability - target;

    let phase: string;
    if (item.at_boundary || theta >= 2.0) {
      phase = isVi ? 'Cảnh báo chạm biên θ_max = 2.0' : 'Boundary saturation (θ_max = 2.0)';
    } else if (k === 0) {
      phase = isVi ? 'Khởi tạo ban đầu (k=0)' : 'Seeded baseline state (k=0)';
    } else if (Math.abs(diff) <= deadband) {
      phase = isVi ? 'Trong dải chết (|e| ≤ 0.5%)' : 'Within deadband (|e| ≤ 0.5%)';
    } else if (diff < -deadband) {
      phase = isVi ? 'Thiếu hụt phục vụ — tăng θ_g' : 'Under-target — stepping up θ_g';
    } else {
      phase = isVi ? 'Vượt mục tiêu — giảm nhẹ θ_g' : 'Above target — relaxing θ_g';
    }

    return {
      cycle: isVi ? `Chu kỳ k=${k}` : `Cycle k=${k}`,
      k,
      reviewDate: item.review_date ? String(item.review_date).slice(0, 10) : '',
      availability,
      target,
      theta,
      multiplier,
      errorRate: Number((errorRate * 100).toFixed(2)),
      atBoundary: Boolean(item.at_boundary || theta >= 2.0),
      eta: Number(item.eta ?? 4.5),
      phase,
    };
  });
}

/**
 * Formats a clean summary label for Stage 4 Refit-RSS policy selection output.
 */
export function findPolicySelectionForClass(
  policies: PolicySelectionItem[] | null | undefined,
  classId: string
): PolicySelectionItem | null {
  if (!policies || policies.length === 0) return null;
  const target = (classId || 'AX').toUpperCase();
  return policies.find((p) => (p.class_id || '').toUpperCase() === target) || null;
}

/**
 * Resolves periodic-review (R, s, S) + EOQ metrics giving priority to real backend schema fields
 * (`reorder_point_s`, `order_up_to_S`, `inventory_position`, `eoq_quantity`, `policy_applied`, `s`, `S`).
 */
export function resolveEffectiveRssMetrics(row: {
  on_hand?: number;
  on_order?: number;
  safety_stock?: number;
  reorder_point?: number;
  reorder_point_s?: number | null;
  rop?: number;
  s?: number | null;
  order_up_to_S?: number | null;
  S?: number | null;
  eoq?: number | null;
  eoq_quantity?: number | null;
  recommended_qty?: number | null;
  final_qty?: number | null;
  inventory_position?: number | null;
  policy_applied?: string | null;
  review_date?: string | null;
  model_run_id?: string | null;
  source?: string | null;
  service_level?: number | null;
  unit_price?: number | null;
  price?: number | null;
}): EffectiveRssMetrics {
  const onHand = Number(row.on_hand ?? 0);
  const onOrder = Number(row.on_order ?? 0);
  const inventoryPosition =
    row.inventory_position != null && Number.isFinite(Number(row.inventory_position))
      ? Number(row.inventory_position)
      : onHand + onOrder;

  const explicitS = row.reorder_point_s ?? row.s ?? row.reorder_point ?? row.rop ?? null;
  const explicitSs = row.safety_stock ?? null;
  const safetyStock =
    explicitSs != null && Number.isFinite(Number(explicitSs))
      ? Math.max(0, Math.round(Number(explicitSs)))
      : null;
  const reorderPointS =
    explicitS != null && Number.isFinite(Number(explicitS))
      ? Math.max(0, Math.round(Number(explicitS)))
      : null;

  const recQty = Math.max(0, Math.round(Number(row.final_qty ?? row.recommended_qty ?? 0)));
  const explicitEoq = row.eoq_quantity ?? row.eoq ?? null;
  const eoq =
    explicitEoq != null && Number.isFinite(Number(explicitEoq))
      ? Math.max(0, Math.round(Number(explicitEoq)))
      : recQty > 0
        ? recQty
        : null;

  const explicitBigS = row.order_up_to_S ?? row.S ?? null;
  const orderUpToS =
    explicitBigS != null && Number.isFinite(Number(explicitBigS)) && Number(explicitBigS) > 0
      ? Math.round(Number(explicitBigS))
      : reorderPointS != null && eoq != null
        ? reorderPointS + eoq
        : null;

  const kappa =
    safetyStock != null && reorderPointS != null && safetyStock > 0 && reorderPointS > safetyStock && eoq != null && eoq > 0
      ? Number(((reorderPointS - safetyStock) / eoq).toFixed(2))
      : null;

  const serviceLevel = Number(row.service_level ?? 0.95);
  const stockoutRisk =
    reorderPointS != null && inventoryPosition <= reorderPointS && reorderPointS > 0
      ? Number(
          Math.min(
            98,
            Math.max(12, Math.round(((reorderPointS - inventoryPosition) / reorderPointS) * 100))
          ).toFixed(1)
        )
      : reorderPointS != null
        ? Number(Math.max(0.5, (1 - serviceLevel) * 100 * 0.5).toFixed(1))
        : null;

  return {
    reorderPointS,
    orderUpToS,
    safetyStock,
    eoq,
    inventoryPosition,
    recommendedQty: recQty,
    policyApplied: row.policy_applied || (row.source === 'ml' ? 'ML Dynamic (R, s, S)' : 'Static Formula'),
    reviewDate: row.review_date ? String(row.review_date).slice(0, 10) : null,
    modelRunId: row.model_run_id || null,
    source: row.source || (row.model_run_id ? 'ml' : 'formula'),
    kappa,
    serviceLevel,
    stockoutRisk,
  };
}

