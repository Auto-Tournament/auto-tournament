import React, { createContext, useContext, useState, ReactNode } from 'react';

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

export function usePageHeader() {
  const context = useContext(PageHeaderContext);
  if (context === undefined) {
    throw new Error('usePageHeader must be used within a PageHeaderProvider');
  }
  return context;
}

