import React from 'react';

/** DFIOS mark: a rising demand line over a baseline. Uses currentColor so it follows the theme. */
export const DfiosBrandMark: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <path d="M3.5 14.5L8.2 9.8L11.8 12.2L16.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="16.5" cy="5.5" r="1.6" fill="currentColor" />
    <path d="M3.5 17.5H16.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
  </svg>
);
