/** Field, Input, SearchInput (debounced), Select, Checkbox, Switch, Tabs. */
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import { cx, type ControlSize } from './primitives.tsx';
import './ui.css';

/* ---------------------------------- Field ---------------------------------- */
export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, hint, error, htmlFor, className, children }) => (
  <div className={cx('ui-field', className)}>
    {label && (
      <label className="ui-field__label" htmlFor={htmlFor}>
        {label}
      </label>
    )}
    {children}
    {error ? (
      <span className="ui-field__error" role="alert">
        {error}
      </span>
    ) : (
      hint && <span className="ui-field__hint">{hint}</span>
    )}
  </div>
);

/* ---------------------------------- Input ---------------------------------- */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  size?: ControlSize;
  leftIcon?: React.ReactNode;
  /** Element at the right edge (e.g. a show-password IconButton). */
  trailing?: React.ReactNode;
  wrapperClassName?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  hint,
  error,
  size = 'md',
  leftIcon,
  trailing,
  wrapperClassName,
  className,
  id,
  disabled,
  ...rest
}) => {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={wrapperClassName}>
      <div className={cx('ui-control', size !== 'md' && `ui-control--${size}`, !!error && 'ui-control--error', disabled && 'ui-control--disabled')}>
        {leftIcon && <span className="ui-control__icon">{leftIcon}</span>}
        <input id={inputId} className={cx('ui-control__input', className)} disabled={disabled} aria-invalid={!!error || undefined} {...rest} />
        {trailing}
      </div>
    </Field>
  );
};

/* -------------------------------- SearchInput ------------------------------ */
export interface SearchInputProps {
  /** Committed (debounced) value. */
  value: string;
  /** Called after `delay` ms of silence, on Enter, and on clear. */
  onChange: (value: string) => void;
  delay?: number;
  placeholder?: string;
  size?: ControlSize;
  className?: string;
  'aria-label'?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, delay = 350, placeholder, size = 'md', className, ...rest }) => {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const lastCommitted = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // External reset (e.g. "clear filters").
  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === lastCommitted.current) return;
    const id = setTimeout(() => {
      lastCommitted.current = draft;
      onChangeRef.current(draft);
    }, delay);
    return () => clearTimeout(id);
  }, [draft, delay]);

  const commit = (next: string) => {
    lastCommitted.current = next;
    setDraft(next);
    onChangeRef.current(next);
  };

  return (
    <div className={cx('ui-control', size !== 'md' && `ui-control--${size}`, className)} role="search">
      <span className="ui-control__icon">
        <Search size={15} />
      </span>
      <input
        className="ui-control__input"
        type="search"
        value={draft}
        placeholder={placeholder ?? t('common.form.search_placeholder')}
        aria-label={rest['aria-label'] ?? t('common.actions.search')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
          if (e.key === 'Escape' && draft) commit('');
        }}
      />
      {draft && (
        <button type="button" className="ui-control__addon" aria-label={t('common.form.clear_search')} onClick={() => commit('')}>
          <X size={14} />
        </button>
      )}
    </div>
  );
};

/* ---------------------------------- Select --------------------------------- */
export interface SelectOption<V extends string | number = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string | number = string> {
  value: V | '';
  onChange: (value: V) => void;
  options: ReadonlyArray<SelectOption<V>>;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  placeholder?: string;
  size?: ControlSize;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/** Native <select> (accessible, mobile friendly) with the DFIOS look. */
export function Select<V extends string | number = string>({
  value,
  onChange,
  options,
  label,
  hint,
  error,
  placeholder,
  size = 'md',
  disabled,
  id,
  className,
  ...rest
}: SelectProps<V>) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={selectId} className={className}>
      <div className={cx('ui-control', 'ui-select-wrap', size !== 'md' && `ui-control--${size}`, !!error && 'ui-control--error', disabled && 'ui-control--disabled')}>
        <select
          id={selectId}
          className="ui-control__input"
          value={String(value)}
          disabled={disabled}
          aria-label={rest['aria-label']}
          onChange={(e) => {
            const opt = options.find((o) => String(o.value) === e.target.value);
            if (opt) onChange(opt.value);
          }}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="ui-select-caret" aria-hidden="true" />
      </div>
    </Field>
  );
}

/* --------------------------------- Checkbox -------------------------------- */
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: React.ReactNode;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
}

export const Checkbox: React.FC<CheckboxProps> = ({ label, indeterminate, onChange, className, ...rest }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className={cx('ui-check', className)}>
      <input ref={ref} type="checkbox" onChange={(e) => onChange?.(e.target.checked)} {...rest} />
      {label && <span>{label}</span>}
    </label>
  );
};

/* ---------------------------------- Switch --------------------------------- */
export const Switch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
}> = ({ checked, onChange, label, disabled, ...rest }) => (
  <label className="ui-switch">
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest['aria-label']}
      disabled={disabled}
      className="ui-switch__track"
      onClick={() => onChange(!checked)}
    />
    {label && <span>{label}</span>}
  </label>
);

/* ----------------------------------- Tabs ---------------------------------- */
export interface TabItem<Id extends string = string> {
  id: Id;
  label: React.ReactNode;
  count?: number;
  disabled?: boolean;
}

export function Tabs<Id extends string = string>({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: {
  items: ReadonlyArray<TabItem<Id>>;
  value: Id;
  onChange: (id: Id) => void;
  'aria-label'?: string;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: React.KeyboardEvent) => {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const target = enabled[next];
      onChange(target.id);
      refs.current[target.id]?.focus();
    }
  };
  return (
    <div className={cx('ui-tabs', className)} role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[item.id] = el;
          }}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && <span className="ui-tab__count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
