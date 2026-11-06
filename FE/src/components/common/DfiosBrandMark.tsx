import React from 'react';

export const DfiosBrandMark: React.FC<{ size?: number; className?: string }> = ({ 
  size = 18, 
  className = '' 
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M3.5 14.5L8.2 9.8L11.8 12.2L16.5 5.5"
      stroke="#2dd4bf"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.2 5.5H16.5V8.8"
      stroke="#2dd4bf"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="3.5" cy="14.5" r="1.6" fill="#e2e8f0" />
    <circle cx="8.2" cy="9.8" r="1.6" fill="#5eead4" />
    <circle cx="11.8" cy="12.2" r="1.6" fill="#2dd4bf" />
  </svg>
);

