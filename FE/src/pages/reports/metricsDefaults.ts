/** The model-degradation event of the demo (E9c): M5 d_1760, 2015-11-23 on the M5 calendar. */
export const MODEL_SWITCH_DAY_INDEX = 1759;
export const M5_DAY0 = '2011-01-29';
export const MODEL_SWITCH_DATE = '2015-11-23';

/** The event date on the calendar of the database (`m5_day0` of GET /clock; the M5 calendar when absent). */
export function modelSwitchDate(m5Day0?: string | null): string {
  if (!m5Day0 || m5Day0.slice(0, 10) === M5_DAY0) return MODEL_SWITCH_DATE;
  const d = new Date(`${m5Day0.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + MODEL_SWITCH_DAY_INDEX);
  return d.toISOString().slice(0, 10);
}

export function defaultEventDate(clockDate: string | null | undefined, m5Day0?: string | null): string {
  const sw = modelSwitchDate(m5Day0);
  return clockDate && clockDate.slice(0, 10) > sw ? sw : '';
}
