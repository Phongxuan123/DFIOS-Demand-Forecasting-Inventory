import React, { useEffect, useRef } from 'react';

/**
 * Anchor for a dropdown panel: closes on outside click and Escape. Controlled by the parent:
 *   const [open, setOpen] = useState(false);
 *   <Popover open={open} onOpenChange={setOpen}> <button onClick=… /> {open && <div className="shell-popover">…</div>} </Popover>
 */
export const Popover: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }> = ({ open, onOpenChange, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);
  return (
    <div className="shell-popover-anchor" ref={ref}>
      {children}
    </div>
  );
};
