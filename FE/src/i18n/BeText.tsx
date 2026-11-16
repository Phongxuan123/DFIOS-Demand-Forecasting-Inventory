import React from 'react';
import { useI18n } from './index.tsx';
import { localizeCoded, looksVietnamese } from './beText.ts';

/**
 * Backend free text in the active language (U-06). Uses the stable code when the BE sends one,
 * else the known-sentence map. Text that is still Vietnamese in the English UI keeps lang="vi"
 * (correct pronunciation for screen readers) and a hint that it is the server's original wording.
 */
export const BeText: React.FC<{
  text: string | null | undefined;
  code?: string | null;
  params?: Record<string, string | number | null | undefined> | null;
  className?: string;
}> = ({ text, code, params, className }) => {
  const { locale, t } = useI18n();
  const out = localizeCoded(locale, code, params, text);
  if (!out) return null;
  if (locale !== 'vi' && looksVietnamese(out)) {
    return (
      <span lang="vi" className={className} title={t('common.misc.server_text_vi')}>
        {out}
      </span>
    );
  }
  return <span className={className}>{out}</span>;
};
