import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

/**
 * Counts the admin rail shows next to its items.
 *
 * The rail is in the admin shell, on every admin page, but the only count
 * with real data behind it ("Needs you") is computed by the Manage page from
 * the data it already polls. Rather than poll that on every admin page,
 * Manage hands its count up here while it is mounted; everywhere else the
 * item shows no badge, as #268 did.
 */
interface ManageRailContextType {
  needsYouCount: number | null;
  setNeedsYouCount: (count: number | null) => void;
}

const ManageRailContext = createContext<ManageRailContextType | undefined>(undefined);

export function ManageRailProvider({ children }: { children: ReactNode }) {
  const [needsYouCount, setNeedsYouCount] = useState<number | null>(null);
  return (
    <ManageRailContext.Provider value={{ needsYouCount, setNeedsYouCount }}>
      {children}
    </ManageRailContext.Provider>
  );
}

/** The rail's counts; null outside a provider (the rail then shows none). */
export function useManageRailCounts(): { needsYouCount: number | null } {
  const context = useContext(ManageRailContext);
  return { needsYouCount: context?.needsYouCount ?? null };
}

/** Publish the "Needs you" count while the calling page is mounted. */
export function usePublishNeedsYouCount(count: number | null): void {
  const setNeedsYouCount = useContext(ManageRailContext)?.setNeedsYouCount;
  useEffect(() => {
    setNeedsYouCount?.(count);
  }, [count, setNeedsYouCount]);
  useEffect(() => {
    if (!setNeedsYouCount) return;
    return () => setNeedsYouCount(null);
  }, [setNeedsYouCount]);
}
