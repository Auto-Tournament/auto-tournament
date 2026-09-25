import { createContext, useContext, useLayoutEffect, useState, ReactNode } from 'react';

/**
 * The admin shell's left column, lent to a page that brings its own.
 *
 * Every admin page renders beside the Manage rail (`Layout`). The tournament
 * setup wizard takes the page over instead (layout "C"): while it is open the
 * rail makes way, and the column shows the wizard's own "← Manage" link and
 * step list. A page claims the column with `useShellColumn()`; the shell then
 * renders an empty column element and the page portals into it, so the shell
 * keeps one layout and the page keeps its state and handlers.
 */
interface ShellColumnContextType {
  /** Pages holding the column; the rail shows when none does. */
  claims: number;
  claim: () => () => void;
  /** The column element to portal into, once the shell has rendered it. */
  column: HTMLElement | null;
  setColumn: (element: HTMLElement | null) => void;
}

const ShellColumnContext = createContext<ShellColumnContextType | undefined>(undefined);

export function ShellColumnProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState(0);
  const [column, setColumn] = useState<HTMLElement | null>(null);
  const [claim] = useState(() => () => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  });
  return (
    <ShellColumnContext.Provider value={{ claims, claim, column, setColumn }}>
      {children}
    </ShellColumnContext.Provider>
  );
}

/** The shell's side: whether a page holds the column, and where to render it. */
export function useShellColumnSlot(): {
  claimed: boolean;
  setColumn: (element: HTMLElement | null) => void;
} {
  const context = useContext(ShellColumnContext);
  return { claimed: (context?.claims ?? 0) > 0, setColumn: context?.setColumn ?? noop };
}

/**
 * Take the shell's left column while the calling component is mounted.
 *
 * `inShell` is false outside the admin shell (a test harness, a page rendered
 * on its own): the caller then renders its column inline. Inside it, `column`
 * is null for the one render before the shell has swapped the rail out.
 */
export function useShellColumn(): { inShell: boolean; column: HTMLElement | null } {
  const context = useContext(ShellColumnContext);
  const claim = context?.claim;
  // Before paint, so the rail never flashes in the column the page took.
  useLayoutEffect(() => claim?.(), [claim]);
  return { inShell: !!context, column: context?.column ?? null };
}

function noop() {}
