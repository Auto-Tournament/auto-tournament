import { createTheme } from '@mui/material/styles';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import { moduleIconVars } from './moduleIcons';
import { tokens, fontBody, fontDisplay, fontMono, withAlpha } from './tokens';

export {
  tokens,
  fontBody,
  fontDisplay,
  fontMono,
  mono,
  withAlpha,
  gameTintPalette,
  activeThemeId,
  setTheme,
} from './tokens';
export { THEME_IDS, THEME_NAMES, THEME_COLORS, type ThemeId } from './themes';

// Extra surface levels on `background`, so components can ask for a raised
// surface (`surface2`, `surface3`) without reaching for a colour.
declare module '@mui/material/styles' {
  interface TypeBackground {
    surface1: string;
    surface2: string;
    surface3: string;
  }
}

const { color, radius, ease, duration } = tokens;

const headingBase = {
  fontFamily: fontDisplay,
  fontWeight: 700,
  letterSpacing: '-0.02em',
  lineHeight: 1.15,
} as const;

/**
 * Status colours used on tinted chips and alerts: a faint wash of the colour
 * with the colour itself as text.
 */
const tint = (main: string) => ({
  backgroundColor: withAlpha(main, 0.14),
  color: main,
});

/**
 * The app theme, built from the website tokens. Dark only: the app has no
 * theme switch, and the brand is designed on dark paper.
 */
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: color.accent, light: color.accent2, dark: color.accent, contrastText: color.accentInk },
    secondary: { main: color.ink2, light: color.ink, dark: color.muted, contrastText: color.accentInk },
    success: { main: color.live, contrastText: color.accentInk },
    error: { main: color.ban, contrastText: color.accentInk },
    warning: { main: color.warning, contrastText: color.accentInk },
    info: { main: color.info, contrastText: color.accentInk },
    background: {
      default: color.paper,
      paper: color.paper2,
      surface1: color.paper2,
      surface2: color.paper3,
      surface3: color.paper3,
    },
    text: { primary: color.ink, secondary: color.ink2, disabled: color.muted },
    divider: color.rule,
    action: {
      hover: withAlpha(color.ink, 0.06),
      selected: withAlpha(color.accent, 0.14),
      focus: withAlpha(color.accent, 0.16),
      disabled: withAlpha(color.ink, 0.3),
      disabledBackground: withAlpha(color.ink, 0.08),
    },
  },
  // The base unit stays at the small radius (8px) so existing numeric
  // `borderRadius: n` in component sx keep their size (1 = 8px, 2 = 16px,
  // 3 = 24px). Surfaces set the 14px and 22px radii explicitly below.
  shape: { borderRadius: radius.sm },
  typography: {
    fontFamily: fontBody,
    h1: { ...headingBase, letterSpacing: '-0.03em', lineHeight: 1.05, fontSize: '2.75rem' },
    h2: { ...headingBase, letterSpacing: '-0.03em', lineHeight: 1.05, fontSize: '2.25rem' },
    h3: { ...headingBase, fontSize: '1.875rem' },
    h4: { ...headingBase, fontSize: '1.75rem' },
    h5: { ...headingBase, fontSize: '1.375rem' },
    h6: { ...headingBase, fontWeight: 600, letterSpacing: '-0.01em', fontSize: '1.125rem' },
    subtitle1: { fontFamily: fontDisplay, fontWeight: 600, fontSize: '1rem' },
    subtitle2: { fontWeight: 600 },
    body1: { lineHeight: 1.55 },
    body2: { lineHeight: 1.55 },
    overline: { fontFamily: fontMono, letterSpacing: '0.06em', fontWeight: 500 },
    caption: { lineHeight: 1.45 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  transitions: {
    easing: { easeOut: ease.out, easeIn: ease.in, easeInOut: ease.inOut, sharp: ease.out },
    duration: {
      shortest: duration.fast,
      shorter: duration.fast,
      short: duration.base,
      standard: duration.base,
      complex: duration.slow,
      enteringScreen: duration.base,
      leavingScreen: duration.fast,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Token values as CSS variables, for the plain CSS/SCSS that styles
        // the third-party bracket viewer (index.css, brackets-viewer/style.scss).
        ':root': {
          colorScheme: 'dark',
          '--at-paper': color.paper,
          '--at-paper2': color.paper2,
          '--at-paper3': color.paper3,
          '--at-ink': color.ink,
          '--at-ink2': color.ink2,
          '--at-muted': color.muted,
          '--at-rule': color.rule,
          '--at-accent': color.accent,
          '--at-accent2': color.accent2,
          '--at-accent-ink': color.accentInk,
          '--at-live': color.live,
          '--at-ban': color.ban,
          '--at-radius-sm': `${radius.sm}px`,
          '--at-radius-md': `${radius.md}px`,
          '--at-radius-lg': `${radius.lg}px`,
          '--at-font-body': fontBody,
          '--at-font-display': fontDisplay,
          '--at-font-mono': fontMono,
          // The module tiles' own palette (theme/moduleIcons.ts). The tiles
          // are SVGs written entirely in `var(--at-ember…)` and
          // `var(--at-ink-…)`, inlined by `ModuleIcon` so that these reach
          // them; that is the whole of how they follow the theme.
          ...moduleIconVars,
        },
        body: {
          backgroundColor: color.paper,
          scrollbarColor: `${color.rule} transparent`,
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': { width: 10, height: 10, backgroundColor: 'transparent' },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: radius.pill,
            backgroundColor: color.rule,
            border: `2px solid ${color.paper}`,
            minHeight: 24,
          },
          '&::-webkit-scrollbar-thumb:hover, & *::-webkit-scrollbar-thumb:hover': { backgroundColor: color.muted },
          '&::-webkit-scrollbar-corner, & *::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },
        },
        ':focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 3 },
        '::selection': { backgroundColor: withAlpha(color.accent, 0.35), color: color.ink },
        'h1, h2, h3': { overflowWrap: 'anywhere', minWidth: 0 },
        a: { color: color.accent2 },
      },
    },

    // Buttons: pills. Contained primary is the brand orange with the lighter
    // hover; outlined is a quiet rule-bordered pill.
    MuiButton: {
      defaultProps: { disableElevation: true, disableFocusRipple: true },
      styleOverrides: {
        root: {
          borderRadius: radius.pill,
          padding: '0.5rem 1.1rem',
          transition: `background-color ${duration.fast}ms ${ease.out}, border-color ${duration.fast}ms ${ease.out}, box-shadow ${duration.base}ms ${ease.out}, transform ${duration.fast}ms ${ease.out}`,
          '&:active': { transform: 'translateY(1px)' },
        },
        containedPrimary: {
          '&:hover': { backgroundColor: color.accent2 },
        },
        outlinedPrimary: {
          borderColor: color.rule,
          color: color.ink,
          '&:hover': { borderColor: color.rule, backgroundColor: color.paper3 },
        },
        outlinedInherit: {
          borderColor: color.rule,
          '&:hover': { borderColor: color.rule, backgroundColor: color.paper3 },
        },
        outlinedSecondary: {
          borderColor: color.rule,
          color: color.ink2,
          '&:hover': { borderColor: color.rule, backgroundColor: color.paper3 },
        },
        textPrimary: { color: color.accent2 },
        sizeSmall: { padding: '0.3rem 0.85rem', fontSize: '0.8125rem' },
        sizeLarge: { padding: '0.75rem 1.4rem' },
      },
    },
    MuiIconButton: {
      defaultProps: { disableFocusRipple: true },
      styleOverrides: {
        root: { '&:hover': { backgroundColor: color.paper3 } },
      },
    },
    MuiFab: {
      styleOverrides: { primary: { '&:hover': { backgroundColor: color.accent2 } } },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderColor: color.rule,
          color: color.ink2,
          textTransform: 'none',
          '&.Mui-selected': {
            backgroundColor: withAlpha(color.accent, 0.14),
            color: color.ink,
            '&:hover': { backgroundColor: withAlpha(color.accent, 0.2) },
          },
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: { borderRadius: radius.pill },
        firstButton: { borderTopLeftRadius: radius.pill, borderBottomLeftRadius: radius.pill },
        lastButton: { borderTopRightRadius: radius.pill, borderBottomRightRadius: radius.pill },
      },
    },

    // Surfaces: paper2 with a 1px rule border instead of drop shadows.
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        rounded: { borderRadius: radius.md },
        outlined: { borderColor: color.rule },
        elevation1: { border: `1px solid ${color.rule}`, boxShadow: 'none' },
        elevation2: { border: `1px solid ${color.rule}`, boxShadow: 'none' },
        elevation3: { border: `1px solid ${color.rule}`, boxShadow: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: color.paper2,
          border: `1px solid ${color.rule}`,
          borderRadius: radius.lg,
          boxShadow: 'none',
          transition: `background-color ${duration.base}ms ${ease.out}, border-color ${duration.base}ms ${ease.out}`,
          // Clickable cards stay flat: a slightly lighter surface on hover.
          '&:has(> .MuiCardActionArea-root):hover': { backgroundColor: color.paper3 },
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        title: { fontFamily: fontDisplay, fontWeight: 600, fontSize: '1rem' },
        subheader: { color: color.muted, fontSize: '0.8125rem' },
      },
    },
    MuiCardActionArea: {
      styleOverrides: { focusHighlight: { backgroundColor: color.accent } },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true },
      styleOverrides: {
        root: {
          backgroundColor: color.paper2,
          border: `1px solid ${color.rule}`,
          boxShadow: 'none',
          '&::before': { display: 'none' },
          // Every accordion is its own rounded panel, stacked or not.
          borderRadius: radius.md,
          '&:first-of-type, &:last-of-type': { borderRadius: radius.md },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: { '&:hover': { backgroundColor: withAlpha(color.ink, 0.03) } },
        expandIconWrapper: { color: color.muted },
      },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: color.rule } },
    },

    // Chrome: the app bar and drawer sit on glass/paper with rule edges.
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: color.navGlass,
          backdropFilter: 'blur(14px)',
          color: color.ink,
          borderBottom: `1px solid ${color.rule}`,
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: color.paper,
          backgroundImage: 'none',
          borderColor: color.rule,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': {
            backgroundColor: withAlpha(color.accent, 0.14),
            '&:hover': { backgroundColor: withAlpha(color.accent, 0.2) },
          },
        },
      },
    },
    MuiListSubheader: {
      styleOverrides: {
        root: {
          backgroundColor: 'transparent',
          fontFamily: fontMono,
          fontSize: '0.6875rem',
          fontWeight: 500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: color.muted,
          lineHeight: '36px',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { marginTop: 4 },
        list: { padding: 6 },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          backgroundColor: color.paper2,
          border: `1px solid ${color.rule}`,
          borderRadius: radius.md,
          boxShadow: `0 24px 60px -24px ${color.shadow}`,
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: radius.sm,
          '&:hover': { backgroundColor: color.paper3 },
          '&.Mui-selected': { backgroundColor: withAlpha(color.accent, 0.14) },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: color.paper3,
          color: color.ink,
          border: `1px solid ${color.rule}`,
          borderRadius: radius.sm,
          fontSize: '0.75rem',
          fontWeight: 500,
        },
        arrow: { color: color.paper3 },
      },
    },

    // Dialogs: large rounded cards over a dark scrim.
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: color.paper2,
          border: `1px solid ${color.rule}`,
          borderRadius: radius.lg,
          boxShadow: `0 40px 120px -40px ${color.shadow}`,
        },
        paperFullScreen: { borderRadius: 0, border: 0 },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: {
          '&:not(.MuiBackdrop-invisible)': { backgroundColor: color.scrim, backdropFilter: 'blur(2px)' },
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontFamily: fontDisplay, fontWeight: 700, letterSpacing: '-0.01em', fontSize: '1.25rem' },
      },
    },
    MuiDialogActions: {
      styleOverrides: { root: { padding: '12px 24px 20px', gap: 8 } },
    },

    // Chips: Geist Mono labels on paper3; primary is solid orange; status
    // colours are a faint tint so orange stays reserved for the key state.
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: fontMono,
          fontSize: '0.75rem',
          fontWeight: 500,
          borderRadius: radius.pill,
        },
        sizeSmall: { height: 24 },
        outlined: { borderColor: color.rule },
        clickable: { '&:hover': { filter: 'brightness(1.12)' } },
        deleteIcon: { color: 'inherit', opacity: 0.7, '&:hover': { color: 'inherit', opacity: 1 } },
        icon: { color: 'inherit' },
      },
      variants: [
        { props: { variant: 'filled', color: 'default' }, style: { backgroundColor: color.paper3, color: color.ink2 } },
        { props: { variant: 'filled', color: 'primary' }, style: { backgroundColor: color.accent, color: color.accentInk } },
        { props: { variant: 'filled', color: 'secondary' }, style: { backgroundColor: color.paper3, color: color.ink } },
        { props: { variant: 'filled', color: 'success' }, style: tint(color.live) },
        { props: { variant: 'filled', color: 'error' }, style: tint(color.ban) },
        { props: { variant: 'filled', color: 'warning' }, style: tint(color.warning) },
        { props: { variant: 'filled', color: 'info' }, style: tint(color.info) },
      ],
    },
    MuiBadge: {
      styleOverrides: { badge: { fontFamily: fontMono, fontWeight: 600 } },
    },

    // Inputs: 14px corners, rule outline, orange focus.
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: radius.md,
          backgroundColor: withAlpha(color.paper, 0.5),
          '& .MuiOutlinedInput-notchedOutline': { borderColor: color.rule },
          '&:hover:not(.Mui-disabled):not(.Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: color.muted },
          '&.Mui-focused:not(.Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: color.accent, borderWidth: 1 },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: { color: color.muted, '&.Mui-focused:not(.Mui-error)': { color: color.accent2 } } },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { color: color.muted } },
    },
    MuiSwitch: {
      styleOverrides: {
        track: { backgroundColor: color.rule, opacity: 1 },
        switchBase: {
          '&.Mui-checked + .MuiSwitch-track': { opacity: 1 },
        },
        thumb: { boxShadow: 'none' },
      },
    },
    MuiSlider: {
      styleOverrides: { rail: { backgroundColor: color.rule, opacity: 1 } },
    },

    // Tabs: muted labels, ink when selected, a short orange underline.
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44 },
        indicator: { height: 2, borderRadius: 2, backgroundColor: color.accent },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          minHeight: 44,
          color: color.muted,
          '&.Mui-selected': { color: color.ink },
          '&:hover': { color: color.ink },
        },
      },
    },

    // Tables: mono column headings, rule separators, a quiet row hover.
    MuiTableContainer: {
      styleOverrides: { root: { borderRadius: radius.lg } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${color.rule}` },
        head: {
          fontFamily: fontMono,
          fontSize: '0.75rem',
          fontWeight: 500,
          color: color.muted,
          letterSpacing: '0.02em',
          backgroundColor: 'transparent',
        },
        stickyHeader: { backgroundColor: color.paper2 },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': { backgroundColor: withAlpha(color.ink, 0.03) },
          '&:last-child > .MuiTableCell-body': { borderBottom: 0 },
        },
      },
    },
    MuiTablePagination: {
      styleOverrides: { root: { borderTop: `1px solid ${color.rule}` } },
    },

    // Alerts: a faint wash of the status colour with a matching border.
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: radius.md, alignItems: 'flex-start' },
        standardSuccess: { backgroundColor: withAlpha(color.live, 0.08), border: `1px solid ${withAlpha(color.live, 0.32)}`, color: color.ink },
        standardError: { backgroundColor: withAlpha(color.ban, 0.08), border: `1px solid ${withAlpha(color.ban, 0.32)}`, color: color.ink },
        standardWarning: { backgroundColor: withAlpha(color.warning, 0.08), border: `1px solid ${withAlpha(color.warning, 0.32)}`, color: color.ink },
        standardInfo: { backgroundColor: withAlpha(color.info, 0.07), border: `1px solid ${withAlpha(color.info, 0.28)}`, color: color.ink },
        outlined: { backgroundColor: 'transparent' },
        filled: { fontWeight: 600 },
        icon: { opacity: 1 },
      },
    },
    MuiAlertTitle: {
      styleOverrides: { root: { fontFamily: fontDisplay, fontWeight: 600 } },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: { backgroundColor: color.paper3, color: color.ink, border: `1px solid ${color.rule}`, borderRadius: radius.md },
      },
    },

    // Progress and steppers.
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: radius.pill, backgroundColor: color.rule },
        bar: { borderRadius: radius.pill },
      },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: color.rule,
          '&.Mui-active': { color: color.accent },
          '&.Mui-completed': { color: color.accent },
          '&.Mui-active .MuiStepIcon-text': { fill: color.accentInk },
        },
        text: { fill: color.ink, fontFamily: fontMono, fontWeight: 600 },
      },
    },
    MuiStepLabel: {
      styleOverrides: {
        label: { color: color.muted, '&.Mui-active, &.Mui-completed': { color: color.ink } },
      },
    },
    MuiStepConnector: {
      styleOverrides: { line: { borderColor: color.rule } },
    },
    MuiSkeleton: {
      styleOverrides: { root: { backgroundColor: withAlpha(color.ink, 0.07) } },
    },
    MuiAvatar: {
      styleOverrides: { colorDefault: { backgroundColor: color.paper3, color: color.ink2 } },
    },
  },
});
