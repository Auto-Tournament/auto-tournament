import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';

/**
 * Saves the language the site is shown in on the signed-in player
 * (`/api/me/language`), so game servers can speak it to them. Once per
 * player and language in this browser; never while impersonating.
 * Renders nothing.
 */
export function SaveLanguage() {
  const { i18n } = useTranslation();
  const { playerSteamId, impersonation, isLoading } = useAuth();
  const language = i18n.resolvedLanguage;
  useEffect(() => {
    if (isLoading || !playerSteamId || impersonation || !language) return;
    const key = `at:language-saved:${playerSteamId}`;
    try {
      if (localStorage.getItem(key) === language) return;
    } catch {
      // No storage: save every time instead.
    }
    api
      .put('/api/me/language', { language })
      .then(() => {
        try {
          localStorage.setItem(key, language);
        } catch {
          // Saved on the server; only the "already sent" note is lost.
        }
      })
      .catch(() => {
        // Not worth a message: the next page load tries again.
      });
  }, [isLoading, playerSteamId, impersonation, language]);
  return null;
}
