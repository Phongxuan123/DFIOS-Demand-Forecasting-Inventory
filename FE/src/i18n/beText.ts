/**
 * Backend free text -> i18n (U-06).
 * The backend answers with Vietnamese sentences (reasons, suggested actions, policy labels, insights, ABC/XYZ rules).
 * `be.*` in the dictionaries lists the sentences we know; the matcher is derived from the Vietnamese template
 * (`{name}` = a captured value), so adding a sentence is one line in vi/be.ts + en/be.ts.
 * Unknown text is returned unchanged (graceful fallback), and in the Vietnamese UI everything is returned unchanged.
 */
import { vi } from './vi.ts';
import { translate } from './index.tsx';
import type { Locale } from './format.ts';

interface Rule {
  key: string;
  re: RegExp;
  names: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildRules(): Rule[] {
  const rules: Rule[] = [];
  for (const [key, template] of Object.entries(vi.be)) {
    if (typeof template !== 'string') continue;
    const names: string[] = [];
    const pattern = template
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return escapeRe(part);
        names.push(m[1]);
        return '(.+?)';
      })
      .join('');
    rules.push({ key, re: new RegExp(`^${pattern}$`, 's'), names });
  }
  // Prefer templates with more literal text (more specific) when several could match.
  return rules.sort((a, b) => b.re.source.length - a.re.source.length);
}

let RULES: Rule[] | null = null;

/** Translates one known backend sentence; returns `raw` when it is not known or the locale is Vietnamese. */
export function localizeBe(locale: Locale, raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  if (locale === 'vi' || !raw) return raw;
  RULES ??= buildRules();
  const text = raw.trim();
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const vars: Record<string, string> = {};
    rule.names.forEach((n, i) => {
      // A nested reason (e.g. "; B0: <reason>") or policy label ("Đề xuất <policy>: ...") is itself backend text.
      vars[n] = n === 'reason' || n === 'policy' ? localizeBe(locale, m[i + 1]) : m[i + 1];
    });
    return translate(locale, `be.${rule.key}`, vars);
  }
  return raw;
}

/** Known audit actions ("replenishment.approve") -> readable label; unknown actions are returned as they are. */
export function auditActionLabel(locale: Locale, action: string): string {
  const key = `be.audit.${action.replace(/\./g, '_')}`;
  const label = translate(locale, key);
  return label === key ? action : label;
}

/** Policy label from the BE ("P-CR - C³-OUT với setpoint = ..."): translated when known. */
export const localizePolicyLabel = localizeBe;
