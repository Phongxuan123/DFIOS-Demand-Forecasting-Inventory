import React from 'react';

/**
 * Wrapper for pages that have not been rewritten on the new design system yet.
 * Their CSS hard-codes light colours, so the subtree is pinned to the light theme
 * (data-theme="light") and stays readable when the app is in dark mode.
 * Remove the wrapper (in App.tsx) when you rewrite a page.
 */
export const LegacyPage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="legacy-page" data-theme="light">
    {children}
  </div>
);
