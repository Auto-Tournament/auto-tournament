import { createTheme } from '@mui/material/styles';

// Material Design 3 Purple theme with maximum roundness
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#D0BCFF', // M3 Purple
      light: '#E8DEF8',
      dark: '#9C88D6',
      contrastText: '#381E72',
    },
    secondary: {
      main: '#CCC2DC',
      light: '#E8DEF8',
      dark: '#9F91B0',
      contrastText: '#332D41',
    },
    error: {
      main: '#F2B8B5',
      light: '#FFDAD6',
      dark: '#C8827F',
      contrastText: '#601410',
    },
    warning: {
      main: '#E8C18D',
      light: '#FFDDB3',
      dark: '#B18E5F',
      contrastText: '#2B1700',
    },
    info: {
      main: '#A8C7FA',
      light: '#D3E3FD',
      dark: '#7F99C4',
      contrastText: '#003258',
    },
    success: {
      main: '#79DD72',
      light: '#B7F397',
      dark: '#5CA857',
      contrastText: '#003A03',
    },
    background: {
      default: '#1C1B1F', // M3 Dark background
      paper: '#2B2930',
    },
    text: {
      primary: '#E6E1E5',
      secondary: '#CAC4D0',
      disabled: '#938F99',
    },
  },
  shape: {
    borderRadius: 8, // Default minimal roundness
  },
  typography: {
    fontFamily: [
      'Roboto',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
    button: {
      textTransform: 'none', // M3 style - no uppercase
      fontWeight: 500,
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableRipple: false,
        disableFocusRipple: true, // Disable focus ripple by default
      },
      styleOverrides: {
        root: {
          borderRadius: 44, // Rounded but not fully pill-shaped
          padding: '10px 24px',
          fontSize: '0.875rem',
          fontWeight: 500,
          // Make focus state same as hover state
          '&:focus-visible': {
            backgroundColor: 'rgba(208, 188, 255, 0.08)', // Same as hover for contained buttons
          },
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          },
          '&:focus-visible': {
            backgroundColor: '#9C88D6', // Same as hover (primary.dark)
            boxShadow: 'none',
          },
        },
        outlined: {
          '&:focus-visible': {
            backgroundColor: 'rgba(208, 188, 255, 0.08)',
          },
        },
        text: {
          '&:focus-visible': {
            backgroundColor: 'rgba(208, 188, 255, 0.08)',
          },
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        disableFocusRipple: true, // Disable focus ripple for icon buttons too
      },
      styleOverrides: {
        root: {
          // Make focus state same as hover state
          '&:focus-visible': {
            backgroundColor: 'rgba(208, 188, 255, 0.08)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 28, // Rounded text fields
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {},
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
});
