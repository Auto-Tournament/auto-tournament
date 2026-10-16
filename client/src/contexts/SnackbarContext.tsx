import React, { createContext, useContext, useCallback, useRef, ReactNode } from 'react';
import {
  SnackbarProvider as NotistackProvider,
  enqueueSnackbar,
  closeSnackbar,
  VariantType,
  SnackbarKey,
} from 'notistack';
import { Alert, GlobalStyles, IconButton, Slide, TransitionProps } from '@mui/material';
import { XIcon } from '@phosphor-icons/react';
import { tokens, withAlpha, radii, siteEdgeRight } from '../theme/tokens';

declare module 'notistack' {
  interface VariantOverrides {
    /** The message is the whole toast (a module's own, like CS2's skin to pick). */
    plain: true;
  }
}

type ShowSnackbarOptions = {
  /**
   * When true, the snackbar will stay on screen until it is programmatically closed.
   */
  persist?: boolean;
  /** How long it stays before it hides itself (default 6 s; ignored with `persist`). */
  autoHideMs?: number;
  /**
   * Optional stable key so callers can update/close a specific snackbar.
   */
  key?: SnackbarKey;
  /** Called once the snackbar has closed, however it was closed. */
  onClose?: () => void;
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
  showPersistentError: (
    message: ReactNode,
    key?: SnackbarKey,
    options?: Pick<ShowSnackbarOptions, 'onClose'>
  ) => SnackbarKey;
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
  borderRadius: radii.md,
  boxShadow: `0 18px 40px -18px ${tokens.color.shadow}`,
  fontWeight: 500,
  '& .MuiAlert-icon': {
    color: 'inherit',
  },
  '& .MuiAlert-action .MuiIconButton-root': {
    color: 'inherit',
    '&:hover': {
      backgroundColor: withAlpha(tokens.color.accentInk, 0.12),
    },
  },
} as const;

type SnackbarComponentProps = {
  id: SnackbarKey;
  message: ReactNode;
  /** The transition's style (its slide): forwarded, or the toast stays where the slide began. */
  style?: React.CSSProperties;
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
      <XIcon size={20} />
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

/** A toast that is its message: it styles itself, and its buttons take clicks. */
const PlainSnackbar = React.forwardRef<HTMLDivElement, SnackbarComponentProps>(
  ({ message, style }, ref) => (
    <div ref={ref} className="toast-plain" style={{ ...style, maxWidth: 'calc(100vw - 24px)' }}>
      {message}
    </div>
  )
);
PlainSnackbar.displayName = 'PlainSnackbar';

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
      direction="down"
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

/** At most this many toasts show at once; older ones fold into "+N more". */
const VISIBLE_TOASTS = 3;

export function SnackbarProvider({ children }: { children: ReactNode }) {
  // Keys of the toasts on screen, shown or folded, for the "+N more" line.
  const open = useRef(new Set<SnackbarKey>());
  const syncMore = useCallback(() => {
    const hidden = open.current.size - VISIBLE_TOASTS;
    const root = document.documentElement;
    if (hidden > 0) root.style.setProperty('--toast-more', `"+${hidden} more"`);
    else root.style.removeProperty('--toast-more');
  }, []);

  const showSnackbar = useCallback(
    (
      msg: ReactNode,
      variant: VariantType = 'success',
      options?: ShowSnackbarOptions
    ): SnackbarKey => {
      const key = enqueueSnackbar(msg, {
        variant,
        persist: options?.persist === true,
        autoHideDuration: options?.persist === true ? undefined : (options?.autoHideMs ?? 6000),
        key: options?.key,
        onClose: options?.onClose ? () => options.onClose?.() : undefined,
        // Top right, under the navbar: the chat button owns the bottom right.
        anchorOrigin: {
          vertical: 'top',
          horizontal: 'right',
        },
      });
      return key;
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
      // Errors stay until closed: one that goes by itself is easily missed.
      return showSnackbar(msg, 'error', { persist: true });
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
    (
      msg: ReactNode,
      key?: SnackbarKey,
      options?: Pick<ShowSnackbarOptions, 'onClose'>
    ): SnackbarKey => {
      return showSnackbar(msg, 'error', { persist: true, key, onClose: options?.onClose });
    },
    [showSnackbar]
  );

  const handleCloseSnackbar = useCallback((key?: SnackbarKey) => {
    closeSnackbar(key);
  }, []);

  return (
    <>
      {/*
        Toasts sit above MUI's modal layer (1300): most feedback comes from an
        action inside a dialog (restore, pause, move match), and a toast behind
        the dialog is never seen. They used to sit below it so a stack of toasts
        could not cover a dialog's action row (bottom-right, where Save is); the
        rule below lets every click except the toast's own close button pass
        through, so a covered button still works.
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
          // Links and buttons in a toast's message (an update's release notes,
          // "Open modules") are actions too; the rest of the toast stays inert.
          'div.notistack-SnackbarContainer .MuiAlert-message a, div.notistack-SnackbarContainer .MuiAlert-message a *, div.notistack-SnackbarContainer .MuiAlert-message button, div.notistack-SnackbarContainer .MuiAlert-message button *':
            {
              pointerEvents: 'auto !important',
            },
          // A plain toast is its own UI: all of it takes clicks.
          'div.notistack-SnackbarContainer .toast-plain, div.notistack-SnackbarContainer .toast-plain *':
            {
              pointerEvents: 'auto !important',
            },
          'div.notistack-SnackbarContainer': {
            // Above MUI's modal layer (1300), so feedback from a dialog shows.
            zIndex: 1400,
            // Clear of the navbar (it floats 12 px down, about 64 px tall).
            top: 'calc(84px + env(safe-area-inset-top, 0px)) !important',
            bottom: 'auto !important',
            // In line with the navbar's right edge, not the screen's (a 4K screen is wide).
            right: `${siteEdgeRight} !important`,
            // Newest on top.
            flexDirection: 'column-reverse !important',
          },
          // At most three show; the older ones fold into "+N more" under them.
          [`div.notistack-SnackbarContainer > div:nth-last-of-type(n+${VISIBLE_TOASTS + 1})`]: {
            display: 'none !important',
          },
          'div.notistack-SnackbarContainer::after': {
            content: 'var(--toast-more, none)',
            order: -1,
            alignSelf: 'flex-end',
            margin: '2px 4px 0',
            padding: '4px 12px',
            borderRadius: radii.pill,
            background: tokens.color.paper3,
            color: tokens.color.ink2,
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.4,
            boxShadow: `0 8px 20px -12px ${tokens.color.shadow}`,
          },
          // Phones: full width under the top bar, 12 px from each side.
          '@media (max-width: 599.95px)': {
            'div.notistack-SnackbarContainer': {
              left: '12px !important',
              right: '12px !important',
              width: 'auto !important',
              maxWidth: 'none !important',
              top: 'calc(72px + env(safe-area-inset-top, 0px)) !important',
            },
            'div.notistack-SnackbarContainer .MuiAlert-root': {
              width: '100%',
              maxWidth: 'none',
            },
          },
        }}
      />
      <NotistackProvider
        // Folding (above) caps what shows; a high cap here keeps notistack
        // from closing older toasts, errors included, on its own.
        maxSnack={50}
        onEnter={(_node, _appearing, key) => {
          open.current.add(key);
          syncMore();
        }}
        onExited={(_node, key) => {
          open.current.delete(key);
          syncMore();
        }}
        anchorOrigin={{
          vertical: 'top',
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
          plain: PlainSnackbar,
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
