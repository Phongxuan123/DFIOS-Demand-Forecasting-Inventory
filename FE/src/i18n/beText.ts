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
  /** Literal pieces around the placeholders: literals.length === names.length + 1. */
  literals: string[];
  names: string[];
  /** Total literal length: longer = more specific, tried first. */
  weight: number;
}

/**
 * Splits a template "A {x} B {y} C" into literals ["A ", " B ", " C"] and names ["x", "y"].
 * Matching is a linear left-to-right scan (no regular expression): each placeholder takes the text up to the
 * FIRST occurrence of the next literal, and the last literal must be the suffix. A regex with several lazy
 * groups backtracks catastrophically on long non-matching texts (it froze the audit log with ~200 templates).
 */
export function compileTemplate(key: string, template: string): Rule {
  const literals: string[] = [];
  const names: string[] = [];
  let rest = template;
  for (;;) {
    const m = /\{(\w+)\}/.exec(rest);
    if (!m) {
      literals.push(rest);
      break;
    }
    literals.push(rest.slice(0, m.index));
    names.push(m[1]);
    rest = rest.slice(m.index + m[0].length);
  }
  return { key, literals, names, weight: literals.reduce((s, l) => s + l.length, 0) };
}

/** Captured values by name, or null when the text does not have the template's shape. */
export function matchTemplate(rule: Rule, text: string): Record<string, string> | null {
  const { literals, names } = rule;
  if (!text.startsWith(literals[0])) return null;
  if (names.length === 0) return text === literals[0] ? {} : null;
  const last = literals[literals.length - 1];
  if (!text.endsWith(last)) return null;
  const end = text.length - last.length;
  const out: Record<string, string> = {};
  let pos = literals[0].length;
  for (let i = 0; i < names.length; i += 1) {
    const isLast = i === names.length - 1;
    let stop: number;
    if (isLast) stop = end;
    else {
      const next = literals[i + 1];
      // A placeholder captures at least one character; an empty separator would be ambiguous.
      if (!next) return null;
      stop = text.indexOf(next, pos + 1);
      if (stop < 0 || stop > end) return null;
    }
    if (stop <= pos) return null;
    out[names[i]] = text.slice(pos, stop);
    pos = isLast ? stop : stop + literals[i + 1].length;
  }
  return pos === end ? out : null;
}

function buildRules(): Rule[] {
  const rules: Rule[] = [];
  for (const [key, template] of Object.entries(vi.be)) {
    if (typeof template !== 'string') continue;
    rules.push(compileTemplate(key, template));
  }
  // Prefer templates with more literal text (more specific) when several could match.
  return rules.sort((a, b) => b.weight - a.weight);
}

let RULES: Rule[] | null = null;

/** Translates one known backend sentence; returns `raw` when it is not known or the locale is Vietnamese. */
export function localizeBe(locale: Locale, raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  if (locale === 'vi' || !raw) return raw;
  RULES ??= buildRules();
  const text = raw.trim();
  for (const rule of RULES) {
    const m = matchTemplate(rule, text);
    if (!m) continue;
    const vars: Record<string, string> = {};
    for (const n of rule.names) {
      // A nested reason (e.g. "; B0: <reason>") or policy label ("Đề xuất <policy>: ...") is itself backend text.
      vars[n] = n === 'reason' || n === 'policy' ? localizeBe(locale, m[n]) : m[n];
    }
    return translate(locale, `be.${rule.key}`, vars);
  }
  return raw;
}

/** Vietnamese-only letters: used to mark backend text that is still untranslated (lang="vi" for screen readers). */
const VI_LETTERS = /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i;
export const looksVietnamese = (text: string | null | undefined): boolean => !!text && VI_LETTERS.test(text);

type CodeParams = Record<string, string | number | null | undefined> | null | undefined;

/**
 * Prefer a stable backend code (`*_code` + params) over the Vietnamese free text (U-06).
 * `be.code.<code>` in the dictionaries is the template; an unknown code falls back to the sentence map,
 * then to the raw text. Works with old backends (no code) and new ones.
 */
export function localizeCoded(locale: Locale, code: string | null | undefined, params: CodeParams, raw: string | null | undefined): string {
  if (code) {
    const key = `be.code.${code}`;
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(params ?? {})) vars[k] = v === null || v === undefined ? '—' : String(v);
    const text = translate(locale, key, vars);
    // A template whose params did not all arrive would show "{x}": use the sentence instead.
    if (text !== key && !/\{\w+\}/.test(text)) return text;
  }
  return localizeBe(locale, raw);
}

/** `be.code` key for a namespaced backend code: prefixCode('kpi', 'no_clock') -> 'kpi_no_clock'; null stays null. */
export const prefixCode = (prefix: string, code: string | null | undefined): string | null => (code ? `${prefix}_${code}` : null);

/** Known audit actions ("replenishment.approve") -> readable label; unknown actions are returned as they are. */
export function auditActionLabel(locale: Locale, action: string): string {
  const key = `be.audit.${action.replace(/\./g, '_')}`;
  const label = translate(locale, key);
  return label === key ? action : label;
}

/** Policy label from the BE ("P-CR - C³-OUT với setpoint = ..."): translated when known. */
export const localizePolicyLabel = localizeBe;
