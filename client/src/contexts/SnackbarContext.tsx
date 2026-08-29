import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import {
  SnackbarProvider as NotistackProvider,
  enqueueSnackbar,
  closeSnackbar,
  VariantType,
  SnackbarKey,
} from 'notistack';
import { Alert, GlobalStyles, IconButton, Slide, TransitionProps } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

type ShowSnackbarOptions = {
  /**
   * When true, the snackbar will stay on screen until it is programmatically closed.
   */
  persist?: boolean;
  /**
   * Optional stable key so callers can update/close a specific snackbar.
   */
  key?: SnackbarKey;
};

interface SnackbarContextType {
  showSnackbar: (
    message: ReactNode,
    severity?: VariantType,
    options?: ShowSnackbarOptions
  ) => SnackbarKey;
  showSuccess: (message: ReactNode) => SnackbarKey;
  showError: (message: ReactNode) => SnackbarKey;
  showWarning: (message: ReactNode) => SnackbarKey;
  showPersistentError: (message: ReactNode, key?: SnackbarKey) => SnackbarKey;
  closeSnackbar: (key?: SnackbarKey) => void;
}

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

// Custom snackbar components with forwardRef for notistack.
//
// Important: keep snackbars from affecting layout/scrollbars. Use a responsive
// width so the toast never overflows the viewport (which can cause "page jump").
const SNACKBAR_SX = {
  // Pointer-events for the whole toast subtree are handled globally in the
  // provider below — a toast must never steal a click from the page.
  width: 'min(500px, calc(100vw - 24px))',
  minWidth: 0,
  maxWidth: '500px',
  borderRadius: 2,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  fontWeight: 500,
  '& .MuiAlert-icon': {
    color: 'inherit',
  },
  '& .MuiAlert-action .MuiIconButton-root': {
    color: 'inherit',
    '&:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
} as const;

type SnackbarComponentProps = {
  id: SnackbarKey;
  message: ReactNode;
};

/**
 * Dismiss control for every snackbar.
 *
 * Persistent snackbars (see `showPersistentError`) stay until closed. Without a
 * close button they permanently cover the bottom-right of the viewport and
 * intercept clicks on anything underneath — dialog Save buttons in particular.
 */
function SnackbarCloseButton({ id }: { id: SnackbarKey }) {
  return (
    <IconButton
      size="small"
      color="inherit"
      aria-label="Dismiss notification"
      data-testid="snackbar-close-button"
      onClick={() => closeSnackbar(id)}
    >
      <CloseIcon fontSize="small" />
    </IconButton>
  );
}

function createSnackbarVariant(
  severity: 'success' | 'error' | 'warning' | 'info',
  displayName: string
) {
  const Component = React.forwardRef<HTMLDivElement, SnackbarComponentProps>(
    ({ id, message }, ref) => (
      <Alert
        ref={ref}
        severity={severity}
        variant="filled"
        action={<SnackbarCloseButton id={id} />}
        sx={{
          ...SNACKBAR_SX,
          // Use theme colors so this matches the global palette
          backgroundColor: `${severity}.main`,
          color: `${severity}.contrastText`,
        }}
      >
        {message}
      </Alert>
    )
  );
  Component.displayName = displayName;
  return Component;
}

const SuccessSnackbar = createSnackbarVariant('success', 'SuccessSnackbar');
const ErrorSnackbar = createSnackbarVariant('error', 'ErrorSnackbar');
const WarningSnackbar = createSnackbarVariant('warning', 'WarningSnackbar');
const InfoSnackbar = createSnackbarVariant('info', 'InfoSnackbar');

// Custom Slide transition with smooth easing for snackbars
const SlideTransition = React.forwardRef<
  unknown,
  TransitionProps & { children: React.ReactElement }
>((props, ref) => {
  return (
    <Slide
      {...props}
      ref={ref}
      // Use vertical motion to avoid horizontal overflow/scrollbar shifts.
      direction="up"
      timeout={{
        enter: 400,
        exit: 300,
      }}
      easing={{
        enter: 'cubic-bezier(0.0, 0, 0.2, 1)',
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
      }}
    />
  );
});
SlideTransition.displayName = 'SlideTransition';

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const showSnackbar = useCallback(
    (
      msg: ReactNode,
      variant: VariantType = 'success',
      options?: ShowSnackbarOptions
    ): SnackbarKey => {
      return enqueueSnackbar(msg, {
        variant,
        persist: options?.persist === true,
        autoHideDuration: options?.persist === true ? undefined : 6000,
        key: options?.key,
        anchorOrigin: {
          vertical: 'bottom',
          horizontal: 'right',
        },
      });
    },
    []
  );

  const showSuccess = useCallback(
    (msg: ReactNode): SnackbarKey => {
      return showSnackbar(msg, 'success');
    },
    [showSnackbar]
  );

  const showError = useCallback(
    (msg: ReactNode): SnackbarKey => {
      return showSnackbar(msg, 'error');
    },
    [showSnackbar]
  );

  const showWarning = useCallback(
    (msg: ReactNode): SnackbarKey => {
      return showSnackbar(msg, 'warning');
    },
    [showSnackbar]
  );

  const showPersistentError = useCallback(
    (msg: ReactNode, key?: SnackbarKey): SnackbarKey => {
      return showSnackbar(msg, 'error', { persist: true, key });
    },
    [showSnackbar]
  );

  const handleCloseSnackbar = useCallback((key?: SnackbarKey) => {
    closeSnackbar(key);
  }, []);

  return (
    <>
      {/*
        Keep toasts underneath MUI's modal layer (zIndex 1300).

        Toasts are anchored bottom-right and the stack grows upward, so with two
        or three showing it reaches the action row of a tall dialog — measured at
        y 620-664 for the map modal's Update button, against a toast stack
        spanning y 497-706. Which button gets covered just depends on the corner:
        Save sits bottom-right, Delete bottom-left (`mr: 'auto'`), so moving the
        anchor only moves the problem.

        A modal dialog is by definition the focused interaction, so it should own
        its own clicks; a toast raised behind one is still there when it closes.
        With no dialog open — the common case — nothing changes.

        This has to be a global rule rather than the provider's `style` prop:
        notistack applies `style` to each snackbar item, not to the container,
        so setting zIndex there silently does nothing and the container keeps
        MUI's snackbar layer (1400) — above the dialog. `div.` makes the
        selector specific enough to win without `!important`.
      */}
      <GlobalStyles
        styles={{
          // A toast must never steal a click.
          //
          // Toasts float bottom-right, which is exactly where primary actions
          // live — a dialog's Save button, the tournament wizard's Next button.
          // A persistent toast (see `showPersistentError`) sits there
          // indefinitely, so anything it covers becomes permanently
          // unclickable.
          //
          // notistack already makes its container inert, but then sets
          // `pointer-events: all` on each item so toasts stay clickable. That
          // is a reasonable default and the wrong one here, so override it —
          // `!important` because the library's own rule has equal specificity
          // and is injected later. Only the action area stays interactive: the
          // close button and any action a caller supplies.
          'div.notistack-SnackbarContainer, div.notistack-SnackbarContainer *': {
            pointerEvents: 'none !important',
          },
          'div.notistack-SnackbarContainer .MuiAlert-action, div.notistack-SnackbarContainer .MuiAlert-action *':
            {
              pointerEvents: 'auto !important',
            },
          // Below MUI's modal layer (1300) as well, so a dialog is never
          // visually obscured by a toast either.
          'div.notistack-SnackbarContainer': {
            zIndex: 1200,
          },
        }}
      />
      <NotistackProvider
        maxSnack={5}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        autoHideDuration={6000}
        TransitionComponent={SlideTransition}
        dense={false}
        Components={{
          success: SuccessSnackbar,
          error: ErrorSnackbar,
          warning: WarningSnackbar,
          info: InfoSnackbar,
        }}
      >
        <SnackbarContext.Provider
          value={{
            showSnackbar,
            showSuccess,
            showError,
            showWarning,
            showPersistentError,
            closeSnackbar: handleCloseSnackbar,
          }}
        >
          {children}
        </SnackbarContext.Provider>
      </NotistackProvider>
    </>
  );
}

export function useSnackbar() {
  const context = useContext(SnackbarContext);
  if (context === undefined) {
    throw new Error('useSnackbar must be used within a SnackbarProvider');
  }
  return context;
}
