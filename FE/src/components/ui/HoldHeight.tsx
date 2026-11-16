import React, { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Tab panel wrapper that prevents the "scroll jump" when tabs swap content (U-15).
 * The panel height and the window scroll offset are tracked continuously; when `activeKey` changes, the panel
 * keeps the previous height as a min-height (set before paint) until the new content has loaded or `holdMs`
 * passed, and the scroll offset is restored. So the document never shrinks under the reader and the browser
 * does not clamp the scroll to the top.
 */
export const HoldHeight: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { activeKey: string; holdMs?: number; children: React.ReactNode }
> = ({ activeKey, holdMs = 1500, children, ...rest }) => {
  const ref = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const scrollY = useRef(0);
  const holding = useRef(false);
  const first = useRef(true);

  // Track the last stable height and scroll offset (outside render).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    height.current = el.offsetHeight;
    scrollY.current = window.scrollY;
    const onScroll = () => {
      if (!holding.current) scrollY.current = window.scrollY;
    };
    // Snapshot right at the user's click/key (capture phase on document runs before React's handlers),
    // so the hold uses the layout the user was looking at, never a stale or still-loading height.
    const snapshot = () => {
      if (holding.current || !ref.current) return;
      height.current = ref.current.offsetHeight;
      scrollY.current = window.scrollY;
    };
    document.addEventListener('click', snapshot, true);
    document.addEventListener('keydown', snapshot, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (!holding.current && ref.current) height.current = ref.current.offsetHeight;
    }) : null;
    ro?.observe(el);
    return () => {
      document.removeEventListener('click', snapshot, true);
      document.removeEventListener('keydown', snapshot, true);
      window.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, []);

  // On a tab change: hold the previous height before the browser paints, restore the scroll offset.
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    holding.current = true;
    el.style.minHeight = `${height.current}px`;
    if (Math.abs(window.scrollY - scrollY.current) > 1) window.scrollTo({ top: scrollY.current });
    const id = window.setTimeout(() => {
      el.style.minHeight = '';
      holding.current = false;
      height.current = el.offsetHeight;
      scrollY.current = window.scrollY;
    }, holdMs);
    return () => window.clearTimeout(id);
  }, [activeKey, holdMs]);

  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  );
};
