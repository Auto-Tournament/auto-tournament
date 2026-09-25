import { createContext, useContext, useState, ReactNode } from 'react';

/**
 * Deprecated: buttons a page hands the admin shell.
 *
 * The shell used to print each page's title with these buttons beside it. It
 * prints no title any more (design audit chunk 1): a page renders its own
 * `PageHead`, buttons included. Core's pages and CS2's no longer use this.
 * It stays for code modules built against client API 0.2.x, whose buttons
 * the shell still shows in a plain row above the page, and goes at the next
 * breaking bump.
 */
interface PageHeaderContextType {
  headerActions: ReactNode | null;
  setHeaderActions: (actions: ReactNode | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextType | undefined>(undefined);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null);

  return (
    <PageHeaderContext.Provider value={{ headerActions, setHeaderActions }}>
      {children}
    </PageHeaderContext.Provider>
  );
}

/** @deprecated Render `PageHead` with the buttons as its `actions` instead. */
export function usePageHeader() {
  const context = useContext(PageHeaderContext);
  if (context === undefined) {
    throw new Error('usePageHeader must be used within a PageHeaderProvider');
  }
  return context;
}
