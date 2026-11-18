export const MODEL_SWITCH_DATE = '2015-11-23';

export function defaultEventDate(clockDate: string | null | undefined): string {
  return clockDate && clockDate.slice(0, 10) > MODEL_SWITCH_DATE ? MODEL_SWITCH_DATE : '';
}
