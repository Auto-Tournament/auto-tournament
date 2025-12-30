import { createTheme } from '@mui/material/styles';
import type {} from '@mui/lab/themeAugmentation';

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
      // Softer, more purple-leaning danger to better match the primary palette
      main: '#FFB4AB',
      light: '#FFDAD6',
      dark: '#C7756A',
      contrastText: '#31111D',
    },
    warning: {
      // Warm but muted amber that plays nicer with the purple background
      main: '#F7CF9A',
      light: '#FFE2B8',
      dark: '#BC8F5A',
      contrastText: '#2B1700',
    },
    info: {
      main: '#A8C7FA',
      light: '#D3E3FD',
      dark: '#7F99C4',
      contrastText: '#003258',
    },
    success: {
      // Mint-teal accent tuned to feel softer next to the purple primary
      main: '#A6E3D0',
      light: '#C9F0E1',
      dark: '#5AAEA1',
      contrastText: '#00382F',
    },
    background: {
      default: '#1C1B1F', // M3 Dark background
      paper: '#2B2930',
      // Surface levels for Material Design 3 elevation system (0-7)
      surface0: '#2B2930', // Level 0 (same as paper)
      surface1: '#332D3C', // Level 1
      surface2: '#3A3542', // Level 2
      surface3: '#2B2930', // Level 3 (default container)
      surface4: '#25232A', // Level 4
      surface5: '#1F1D24', // Level 5
      surface6: '#332D3C', // Level 6
      surface7: '#3A3542', // Level 7
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
      'Inter',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
    button: {
      textTransform: 'none', // M3 style - no uppercase
      fontWeight: 500,
    },
    h1: { lineHeight: 1.1 },
    h2: { lineHeight: 1.1 },
    h3: { lineHeight: 1.1 },
    h4: { lineHeight: 1.1 },
    h5: { lineHeight: 1.1 },
    h6: { lineHeight: 1.1 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: '#6b6b6b #2b2b2b',
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
            backgroundColor: '#2b2b2b',
          },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 8,
            backgroundColor: '#6b6b6b',
            minHeight: 24,
            border: '3px solid #2b2b2b',
          },
          '&::-webkit-scrollbar-thumb:focus, & *::-webkit-scrollbar-thumb:focus': {
            backgroundColor: '#959595',
          },
          '&::-webkit-scrollbar-thumb:active, & *::-webkit-scrollbar-thumb:active': {
            backgroundColor: '#959595',
          },
          '&::-webkit-scrollbar-thumb:hover, & *::-webkit-scrollbar-thumb:hover': {
            backgroundColor: '#959595',
          },
          '&::-webkit-scrollbar-corner, & *::-webkit-scrollbar-corner': {
            backgroundColor: '#2b2b2b',
          },
        },
      },
    },
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
