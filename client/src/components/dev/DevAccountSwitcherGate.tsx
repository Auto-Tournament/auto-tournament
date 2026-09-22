import React from 'react';

/**
 * Renders `DevAccountSwitcher` only in local dev.
 *
 * `import.meta.env.DEV` is statically replaced by Vite, so the `import()`
 * below is dead code in a production build and gets tree-shaken away —
 * `DevAccountSwitcher` (and its `/api/test/*` calls) never end up in the
 * production bundle. See client/dist grep check in the PR description.
 */
const LazyDevAccountSwitcher = import.meta.env.DEV
  ? React.lazy(() =>
      Promise.all([
        import('./DevAccountSwitcher'),
        import('./devAccountSwitcherI18n').then((mod) => mod.registerDevAccountSwitcherTranslations()),
      ]).then(([mod]) => ({ default: mod.DevAccountSwitcher }))
    )
  : null;

export const DevAccountSwitcherGate: React.FC = () => {
  if (!import.meta.env.DEV || !LazyDevAccountSwitcher) {
    return null;
  }

  return (
    <React.Suspense fallback={null}>
      <LazyDevAccountSwitcher />
    </React.Suspense>
  );
};
