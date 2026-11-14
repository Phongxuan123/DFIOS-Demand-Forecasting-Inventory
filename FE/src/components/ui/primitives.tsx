/** Buttons, badges, cards, KPI tile, page header, section, skeleton, tooltip, source note. */
import React, { useId } from 'react';
import { ArrowDownRight, ArrowUpRight, Database, Minus } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import './ui.css';

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

/* ---------------------------------- Button --------------------------------- */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={cx('ui-btn', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`, fullWidth && 'ui-btn--full', className)}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...rest}
  >
    {loading ? <span className="ui-spinner" aria-hidden="true" /> : leftIcon}
    {children}
    {!loading && rightIcon}
  </button>
);

export interface IconButtonProps extends Omit<ButtonProps, 'leftIcon' | 'rightIcon' | 'children' | 'fullWidth'> {
  /** Required: accessible name and tooltip. */
  label: string;
  icon: React.ReactNode;
}

export const IconButton: React.FC<IconButtonProps> = ({ label, icon, variant = 'ghost', size = 'md', className, loading, ...rest }) => (
  <button
    type="button"
    className={cx('ui-btn', 'ui-btn--icon', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`, className)}
    aria-label={label}
    title={label}
    aria-busy={loading || undefined}
    {...rest}
  >
    {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon}
  </button>
);

/* ---------------------------------- Badge ---------------------------------- */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const Badge: React.FC<{ tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }> = ({
  tone = 'neutral',
  dot,
  children,
  className,
}) => (
  <span className={cx('ui-badge', tone !== 'neutral' && `ui-badge--${tone}`, className)}>
    {dot && <span className="ui-badge__dot" aria-hidden="true" />}
    {children}
  </span>
);

/** Badge with a leading status dot. Colour is never the only signal: always pass a text label. */
export const StatusPill: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = (props) => (
  <Badge dot {...props} />
);

/* ----------------------------------- Card ---------------------------------- */
export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Remove body padding (tables, charts bleeding to the edge). */
  flush?: boolean;
  as?: 'section' | 'div' | 'article';
}

export const Card: React.FC<CardProps> = ({ title, description, actions, flush, as: Tag = 'section', className, children, ...rest }) => (
  <Tag className={cx('ui-card', flush && 'ui-card--flush', className)} {...rest}>
    {(title || actions) && (
      <header className="ui-card__header">
        <div style={{ minWidth: 0 }}>
          {title && <h3 className="ui-card__title">{title}</h3>}
          {description && <p className="ui-card__desc">{description}</p>}
        </div>
        {actions && <div className="ui-card__actions">{actions}</div>}
      </header>
    )}
    <div className="ui-card__body">{children}</div>
  </Tag>
);

/* ------------------------------ Page header / Section ---------------------- */
export const PageHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Badges / DataSourceNote under the description. */
  meta?: React.ReactNode;
}> = ({ title, description, actions, meta }) => (
  <header className="ui-page-header">
    <div style={{ minWidth: 0 }}>
      <h1 className="ui-page-header__title">{title}</h1>
      {description && <p className="ui-page-header__desc">{description}</p>}
      {meta && <div className="ui-page-header__meta">{meta}</div>}
    </div>
    {actions && <div className="ui-page-header__actions">{actions}</div>}
  </header>
);

export const Section: React.FC<{
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, description, actions, children, className }) => (
  <section className={cx('ui-section', className)}>
    {(title || actions) && (
      <div className="ui-section__header">
        <div>
          {title && <h2 className="ui-section__title">{title}</h2>}
          {description && <p className="ui-section__desc">{description}</p>}
        </div>
        {actions && <div className="ui-row">{actions}</div>}
      </div>
    )}
    {children}
  </section>
);

/* ---------------------------------- Skeleton ------------------------------- */
export const Skeleton: React.FC<{
  width?: number | string;
  height?: number | string;
  circle?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ width = '100%', height = 14, circle, className, style }) => (
  <span className={cx('ui-skeleton', circle && 'ui-skeleton--circle', className)} style={{ width, height, ...style }} aria-hidden="true" />
);

export const SkeletonText: React.FC<{ lines?: number }> = ({ lines = 3 }) => (
  <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }} role="status">
    {Array.from({ length: lines }, (_, i) => (
      <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
    ))}
  </span>
);

/* --------------------------------- KPI tile -------------------------------- */
export interface KpiDelta {
  /** Signed change, already in display units (e.g. 2.1 for +2.1 pp). */
  value: number | null | undefined;
  /** Pre-formatted text, e.g. "+2,1 đ.%". Falls back to the raw number. */
  text?: string;
  /** Which direction is an improvement. Default 'up'. Use 'none' for neutral metrics. */
  goodWhen?: 'up' | 'down' | 'none';
  label?: string;
}

export interface KpiTileProps {
  label: React.ReactNode;
  /** Pre-formatted value (use useFormat()). null/undefined renders "—". */
  value?: React.ReactNode | null;
  unit?: React.ReactNode;
  delta?: KpiDelta;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  loading?: boolean;
  /** Set when the number cannot be computed: shows "—" and the reason (never 0). */
  unavailableReason?: React.ReactNode;
  className?: string;
}

export const KpiTile: React.FC<KpiTileProps> = ({ label, value, unit, delta, hint, icon, loading, unavailableReason, className }) => {
  const t = useT();
  const na = unavailableReason !== undefined || value === null || value === undefined || value === '';
  const dir = delta && typeof delta.value === 'number' && Number.isFinite(delta.value) ? Math.sign(delta.value) : null;
  const good = delta?.goodWhen ?? 'up';
  const tone = dir === null || dir === 0 || good === 'none' ? 'flat' : (dir > 0) === (good === 'up') ? 'good' : 'bad';
  return (
    <div className={cx('ui-card', 'ui-kpi', className)} aria-busy={loading || undefined}>
      <div className="ui-kpi__label">
        {icon}
        <span>{label}</span>
      </div>
      {loading ? (
        <>
          <Skeleton width="55%" height={28} />
          <Skeleton width="40%" height={12} />
        </>
      ) : (
        <>
          <div className={cx('ui-kpi__value', na && 'ui-kpi__value--na')}>
            {na ? '—' : value}
            {!na && unit && <span className="ui-kpi__unit">{unit}</span>}
          </div>
          <div className="ui-kpi__foot">
            {na ? (
              <span>{unavailableReason ? t('common.state.unavailable_reason', { reason: String(unavailableReason) }) : t('common.state.unavailable')}</span>
            ) : (
              <>
                {delta && dir !== null && (
                  <span className={cx('ui-kpi__delta', `ui-kpi__delta--${tone}`)}>
                    {dir > 0 ? <ArrowUpRight size={13} /> : dir < 0 ? <ArrowDownRight size={13} /> : <Minus size={13} />}
                    {delta.text ?? delta.value}
                    {delta.label && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> {delta.label}</span>}
                  </span>
                )}
                {hint && <span>{hint}</span>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/* ---------------------------------- Tooltip -------------------------------- */
export const Tooltip: React.FC<{
  content: React.ReactNode;
  side?: 'top' | 'bottom' | 'right';
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
}> = ({ content, side = 'top', children }) => {
  const id = useId();
  return (
    <span className={cx('ui-tooltip', side !== 'top' && `ui-tooltip--${side}`)}>
      {React.cloneElement(children, { 'aria-describedby': id })}
      <span role="tooltip" id={id} className="ui-tooltip__bubble">
        {content}
      </span>
    </span>
  );
};

/* ------------------------------- DataSourceNote ---------------------------- */
/** Provenance line under data: "Nguồn: …". Every chart/table should carry one. */
export const DataSourceNote: React.FC<{
  /** Endpoint or dataset name, e.g. "/dashboard/kpi, kho CA_1". */
  source: string;
  /** Pre-formatted "as of" date. */
  asOf?: React.ReactNode;
  note?: React.ReactNode;
  className?: string;
}> = ({ source, asOf, note, className }) => {
  const t = useT();
  return (
    <p className={cx('ui-source', className)}>
      <Database size={12} aria-hidden="true" />
      <span>{t('common.data.source', { source })}</span>
      {asOf && <span>· {asOf}</span>}
      {note && <span>· {note}</span>}
    </p>
  );
};
