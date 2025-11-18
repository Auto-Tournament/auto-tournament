import '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Palette {
    background: {
      default: string;
      paper: string;
      surface0?: string;
      surface1?: string;
      surface2?: string;
      surface3?: string;
      surface4?: string;
      surface5?: string;
      surface6?: string;
      surface7?: string;
    };
  }

  interface PaletteOptions {
    background?: {
      default?: string;
      paper?: string;
      surface0?: string;
      surface1?: string;
      surface2?: string;
      surface3?: string;
      surface4?: string;
      surface5?: string;
      surface6?: string;
      surface7?: string;
    };
  }
}

