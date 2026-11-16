/** Modal, Drawer, ConfirmDialog + useConfirm (in-app, never window.confirm). */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import { Button, IconButton, cx } from './primitives.tsx';
import './ui.css';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogBaseProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** Ignore Esc / backdrop click (e.g. while a request is running). */
  dismissible?: boolean;
  className?: string;
}

interface OverlayProps extends DialogBaseProps {
  variant: 'modal' | 'drawer' | 'drawer-left';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  role?: 'dialog' | 'alertdialog';
}

const Overlay: React.FC<OverlayProps> = ({ open, onClose, title, description, footer, children, dismissible = true, className, variant, size = 'md', role = 'dialog' }) => {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;
  const isDrawer = variant !== 'modal';
  return createPortal(
    <div
      className={cx('ui-overlay', isDrawer && 'ui-overlay--drawer', variant === 'drawer-left' && 'ui-overlay--drawer-left')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx('ui-modal', `ui-modal--${size}`, isDrawer && 'ui-modal--drawer', variant === 'drawer-left' && 'ui-modal--drawer-left', className)}
      >
        <header className="ui-modal__header">
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} className="ui-modal__title">
              {title}
            </h2>
            {description && (
              <p id={descId} className="ui-modal__desc">
                {description}
              </p>
            )}
          </div>
          {dismissible && <IconButton size="sm" label={t('common.actions.close')} icon={<X size={16} />} onClick={onClose} />}
        </header>
        <div className="ui-modal__body">{children}</div>
        {footer && <footer className="ui-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};

export const Modal: React.FC<DialogBaseProps & { size?: 'sm' | 'md' | 'lg' | 'xl' }> = (props) => <Overlay variant="modal" {...props} />;

export const Drawer: React.FC<DialogBaseProps & { side?: 'right' | 'left'; size?: 'md' | 'lg' }> = ({ side = 'right', ...props }) => (
  <Overlay variant={side === 'left' ? 'drawer-left' : 'drawer'} {...props} />
);

/* ------------------------------- ConfirmDialog ----------------------------- */
export interface ConfirmDialogProps {
  open: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' = destructive (red confirm button). */
  tone?: 'default' | 'danger';
  /** May return a promise: the dialog shows a spinner and closes when it settles. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  children?: React.ReactNode;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ open, title, description, confirmLabel, cancelLabel, tone = 'default', onConfirm, onCancel, children }) => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Overlay
      variant="modal"
      size="sm"
      role="alertdialog"
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      title={title ?? t('common.confirm.title')}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t('common.actions.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={run} data-autofocus>
            {confirmLabel ?? t('common.actions.confirm')}
          </Button>
        </>
      }
    >
      {children}
    </Overlay>
  );
};

export interface ConfirmOptions {
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

/**
 * Promise based confirmation:
 *   const { confirm, dialog } = useConfirm();
 *   if (await confirm({ title, description, tone: 'danger' })) doIt();
 *   return <>{...}{dialog}</>;
 */
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions = {}) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );
  const settle = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };
  const dialog = (
    <ConfirmDialog
      open={state !== null}
      title={state?.title}
      description={state?.description}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      tone={state?.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return { confirm, dialog };
}
