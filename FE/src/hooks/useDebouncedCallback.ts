import { useCallback, useEffect, useRef } from 'react';

/**
 * Debounce with leading AND trailing edge (P-42): the first call in a burst runs
 * immediately, further calls inside `waitMs` collapse into one trailing call.
 * The pending timer is cleared on unmount.
 */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, waitMs: number) {
  const fnRef = useRef(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgs = useRef<A | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      if (timer.current === null) {
        fnRef.current(...args); // leading
        pendingArgs.current = null;
      } else {
        pendingArgs.current = args;
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        if (pendingArgs.current) {
          const a = pendingArgs.current;
          pendingArgs.current = null;
          fnRef.current(...a); // trailing
        }
      }, waitMs);
    },
    [waitMs],
  );
}
