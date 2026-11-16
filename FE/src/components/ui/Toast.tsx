/**
 * Toasts. <ToastProvider> lives once in the app root.
 *   const toast = useToast();
 *   toast.success('Đã lưu');  toast.error(apiErrorMessage(err, t));
 *   toast.show({ tone: 'warning', title, description, duration: 8000 });
 * The provider also turns `dfios:forbidden` (403 on a user-initiated mutation, see apiClient)
 * into a toast, so pages never need to handle that case themselves.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import { AUTH_FORBIDDEN_EVENT, type ForbiddenEventDetail } from '../../services/session.ts';
import { IconButton, cx } from './primitives.tsx';
import './ui.css';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastInput {
  tone?: ToastTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** ms; 0 = sticky. Default 5000 (errors 8000). */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  tone: ToastTone;
}

export interface ToastApi {
  show: (toast: ToastInput) => number;
  success: (title: React.ReactNode, description?: React.ReactNode) => number;
  error: (title: React.ReactNode, description?: React.ReactNode) => number;
  warning: (title: React.ReactNode, description?: React.ReactNode) => number;
  info: (title: React.ReactNode, description?: React.ReactNode) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 4;
const ICONS: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error: <AlertCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const tone = input.tone ?? 'info';
      const duration = input.duration ?? (tone === 'error' ? 8000 : 5000);
      setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { ...input, id, tone }]);
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, description) => show({ tone: 'success', title, description }),
      error: (title, description) => show({ tone: 'error', title, description }),
      warning: (title, description) => show({ tone: 'warning', title, description }),
      info: (title, description) => show({ tone: 'info', title, description }),
    }),
    [show, dismiss],
  );

  // 403 on a user-initiated mutation (apiClient).
  useEffect(() => {
    const onForbidden = (e: Event) => {
      const detail = (e as CustomEvent<ForbiddenEventDetail>).detail;
      show({ tone: 'error', title: t('common.errors.forbidden'), description: detail?.message || undefined });
    };
    window.addEventListener(AUTH_FORBIDDEN_EVENT, onForbidden);
    return () => window.removeEventListener(AUTH_FORBIDDEN_EVENT, onForbidden);
  }, [show, t]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => clearTimeout(timer));
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-region" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <div key={item.id} className={cx('ui-toast', `ui-toast--${item.tone}`)} role={item.tone === 'error' ? 'alert' : 'status'}>
            <span className="ui-toast__icon">{ICONS[item.tone]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ui-toast__title">{item.title}</div>
              {item.description && <div className="ui-toast__desc">{item.description}</div>}
            </div>
            <IconButton size="sm" label={t('common.misc.dismiss')} icon={<X size={14} />} onClick={() => dismiss(item.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
