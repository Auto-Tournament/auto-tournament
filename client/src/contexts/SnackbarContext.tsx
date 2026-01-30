import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import { SnackbarProvider as NotistackProvider, enqueueSnackbar, closeSnackbar, VariantType, SnackbarKey } from 'notistack';
import { Alert, Slide, TransitionProps } from '@mui/material';

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
  showSnackbar: (message: ReactNode, severity?: VariantType, options?: ShowSnackbarOptions) => SnackbarKey;
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

const SuccessSnackbar = React.forwardRef<HTMLDivElement, { message: ReactNode }>(({ message }, ref) => (
  <Alert
    ref={ref}
    severity="success"
    variant="filled"
    sx={{
      ...SNACKBAR_SX,
      // Use theme success colors so this matches the global palette
      backgroundColor: 'success.main',
      color: 'success.contrastText',
    }}
  >
    {message}
  </Alert>
));
SuccessSnackbar.displayName = 'SuccessSnackbar';

const ErrorSnackbar = React.forwardRef<HTMLDivElement, { message: ReactNode }>(({ message }, ref) => (
  <Alert
    ref={ref}
    severity="error"
    variant="filled"
    sx={{
      ...SNACKBAR_SX,
      backgroundColor: 'error.main',
      color: 'error.contrastText',
    }}
  >
    {message}
  </Alert>
));
ErrorSnackbar.displayName = 'ErrorSnackbar';

const WarningSnackbar = React.forwardRef<HTMLDivElement, { message: ReactNode }>(({ message }, ref) => (
  <Alert
    ref={ref}
    severity="warning"
    variant="filled"
    sx={{
      ...SNACKBAR_SX,
      backgroundColor: 'warning.main',
      color: 'warning.contrastText',
    }}
  >
    {message}
  </Alert>
));
WarningSnackbar.displayName = 'WarningSnackbar';

const InfoSnackbar = React.forwardRef<HTMLDivElement, { message: ReactNode }>(({ message }, ref) => (
  <Alert
    ref={ref}
    severity="info"
    variant="filled"
    sx={{
      ...SNACKBAR_SX,
      backgroundColor: 'info.main',
      color: 'info.contrastText',
    }}
  >
    {message}
  </Alert>
));
InfoSnackbar.displayName = 'InfoSnackbar';

// Custom Slide transition with smooth easing for snackbars
const SlideTransition = React.forwardRef<unknown, TransitionProps & { children: React.ReactElement }>(
  (props, ref) => {
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
  }
);
SlideTransition.displayName = 'SlideTransition';

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const showSnackbar = useCallback(
    (msg: ReactNode, variant: VariantType = 'success', options?: ShowSnackbarOptions): SnackbarKey => {
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
  );
}

export function useSnackbar() {
  const context = useContext(SnackbarContext);
  if (context === undefined) {
    throw new Error('useSnackbar must be used within a SnackbarProvider');
  }
  return context;
}
