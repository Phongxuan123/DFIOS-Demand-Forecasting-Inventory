import { useCallback } from 'react';
import { useI18n } from './index.tsx';
import { auditActionLabel, localizeBe, localizeCoded } from './beText.ts';

/** `const be = useBe(); be(row.reason)`: known backend (Vietnamese) sentences in the active language, others unchanged. */
export function useBe() {
  const { locale } = useI18n();
  return useCallback((raw: string | null | undefined) => localizeBe(locale, raw), [locale]);
}

/** `const beCode = useBeCode(); beCode(row.reason_code, row.reason_params, row.reason)`: code first, text as fallback. */
export function useBeCode() {
  const { locale } = useI18n();
  return useCallback(
    (code: string | null | undefined, params: Record<string, string | number | null | undefined> | null | undefined, raw: string | null | undefined) =>
      localizeCoded(locale, code, params, raw),
    [locale],
  );
}

/** `const audit = useAuditLabel(); audit('replenishment.approve')` -> "Approve replenishment". */
export function useAuditLabel() {
  const { locale } = useI18n();
  return useCallback((action: string) => auditActionLabel(locale, action), [locale]);
}
