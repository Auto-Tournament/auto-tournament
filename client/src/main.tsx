import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { zhCN, enUS } from '@mui/material/locale';
import App from './App';
import './index.css';
import i18n from './i18n';
import { theme as baseTheme } from './theme';
import { createTheme } from '@mui/material/styles';

const getMuiLocale = (lang: string) => {
  if (lang.startsWith('zh')) return zhCN;
  return enUS;
};

const Root: React.FC = () => {
  const [muiTheme, setMuiTheme] = React.useState(() =>
    createTheme(baseTheme, getMuiLocale(i18n.language))
  );

  React.useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      setMuiTheme(createTheme(baseTheme, getMuiLocale(lng)));
    };

    i18n.on('languageChanged', handleLanguageChange);
    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  return (
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={muiTheme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </I18nextProvider>
    </React.StrictMode>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
