import React from 'react';
import { useClock } from '../../context/ClockContext.tsx';
import { useElapsed } from '../../hooks/useElapsed.ts';
import { useI18n } from '../../i18n/index.tsx';

/**
 * Feedback while POST /clock/advance runs (U-15): real elapsed seconds plus the measured duration of the
 * previous advance in this session. No fake percentage (the server reports no progress).
 * The live region announces the start once; the ticking counter is hidden from screen readers.
 */
export const AdvanceProgress: React.FC<{ className?: string }> = ({ className }) => {
  const { t, fmt } = useI18n();
  const { advancing, lastTiming } = useClock();
  const elapsed = useElapsed(advancing);
  return (
    <div className={className} aria-live="polite" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
      {advancing && (
        <>
          <span>{t('shell.clock.advancing')}</span>{' '}
          <span aria-hidden="true">{t('shell.clock.advancing_elapsed', { seconds: fmt.integer(elapsed) })}</span>{' '}
          <span>
            {lastTiming
              ? t('shell.clock.advancing_estimate', { days: fmt.integer(lastTiming.days), seconds: fmt.number(lastTiming.seconds, { digits: 1 }) })
              : t('shell.clock.advancing_no_estimate')}
          </span>
        </>
      )}
    </div>
  );
};
