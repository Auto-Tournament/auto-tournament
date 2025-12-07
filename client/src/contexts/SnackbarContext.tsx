import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import { SnackbarProvider as NotistackProvider, enqueueSnackbar, VariantType } from 'notistack';
import { Alert, Slide, TransitionProps } from '@mui/material';

interface SnackbarContextType {
  showSnackbar: (message: string, severity?: VariantType) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
}

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

// Custom snackbar components with forwardRef for notistack
const SuccessSnackbar = React.forwardRef<HTMLDivElement, { message: string }>(({ message }, ref) => (
  <Alert
    ref={ref}
    severity="success"
    variant="filled"
    sx={{
      minWidth: '300px',
      maxWidth: '500px',
      borderRadius: 2,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      fontWeight: 500,
      backgroundColor: '#4CAF50',
      color: '#FFFFFF',
      '& .MuiAlert-icon': {
        color: '#FFFFFF',
      },
      '& .MuiAlert-action .MuiIconButton-root': {
        color: '#FFFFFF',
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
        },
      },
    }}
  >
    {message}
  </Alert>
));
SuccessSnackbar.displayName = 'SuccessSnackbar';

const ErrorSnackbar = React.forwardRef<HTMLDivElement, { message: string }>(({ message }, ref) => (
  <Alert
    ref={ref}
    severity="error"
    variant="filled"
    sx={{
      minWidth: '300px',
      maxWidth: '500px',
      borderRadius: 2,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      fontWeight: 500,
      backgroundColor: '#EF5350',
      color: '#FFFFFF',
      '& .MuiAlert-icon': {
        color: '#FFFFFF',
      },
      '& .MuiAlert-action .MuiIconButton-root': {
        color: '#FFFFFF',
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
        },
      },
    }}
  >
    {message}
  </Alert>
));
ErrorSnackbar.displayName = 'ErrorSnackbar';

const WarningSnackbar = React.forwardRef<HTMLDivElement, { message: string }>(({ message }, ref) => (
  <Alert
    ref={ref}
    severity="warning"
    variant="filled"
    sx={{
      minWidth: '300px',
      maxWidth: '500px',
      borderRadius: 2,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      fontWeight: 500,
      backgroundColor: '#FF9800',
      color: '#FFFFFF',
      '& .MuiAlert-icon': {
        color: '#FFFFFF',
      },
      '& .MuiAlert-action .MuiIconButton-root': {
        color: '#FFFFFF',
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
        },
      },
    }}
  >
    {message}
  </Alert>
));
WarningSnackbar.displayName = 'WarningSnackbar';

const InfoSnackbar = React.forwardRef<HTMLDivElement, { message: string }>(({ message }, ref) => (
  <Alert
    ref={ref}
    severity="info"
    variant="filled"
    sx={{
      minWidth: '300px',
      maxWidth: '500px',
      borderRadius: 2,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      fontWeight: 500,
      backgroundColor: '#2196F3',
      color: '#FFFFFF',
      '& .MuiAlert-icon': {
        color: '#FFFFFF',
      },
      '& .MuiAlert-action .MuiIconButton-root': {
        color: '#FFFFFF',
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
        },
      },
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
        direction="left"
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
  const showSnackbar = useCallback((msg: string, variant: VariantType = 'success') => {
    enqueueSnackbar(msg, {
      variant,
      autoHideDuration: 6000,
      anchorOrigin: {
        vertical: 'bottom',
        horizontal: 'right',
      },
    });
  }, []);

  const showSuccess = useCallback(
    (msg: string) => {
      showSnackbar(msg, 'success');
    },
    [showSnackbar]
  );

  const showError = useCallback(
    (msg: string) => {
      showSnackbar(msg, 'error');
    },
    [showSnackbar]
  );

  const showWarning = useCallback(
    (msg: string) => {
      showSnackbar(msg, 'warning');
    },
    [showSnackbar]
  );

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
      <SnackbarContext.Provider value={{ showSnackbar, showSuccess, showError, showWarning }}>
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
