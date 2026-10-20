/**
 * The data TournamentSetup loads and saves next to its form (moved out of
 * TournamentSetup.tsx): the site's match rules the steps mention, the
 * templates to start from, and a saved tournament's sign-up and teams, which
 * save on their own.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import type { TournamentTemplate } from '../../../types/tournament.types';
import { signupOf, signupSettingsPatch, useSavedSignup } from './SignupSettings';
import type { SetupFormHandlers, SetupFormValues, SetupTournament } from './TournamentSetup';

/** The site's match rules the Schedule and Extras steps mention (CS2: the break between matches, spectators in GOTV). */
export function useSiteRules() {
  const [siteRules, setSiteRules] = useState<{
    matchBreakMinutes?: number;
    gotvSpectators?: number;
    gotvDelay?: number;
  } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<{ settings?: Record<string, unknown> } & Record<string, unknown>>('/api/settings')
      .then((res) => {
        const s = (res.settings ?? res) as Record<string, unknown>;
        if (!live) return;
        setSiteRules({
          matchBreakMinutes:
            typeof s.matchBreakMinutes === 'number' ? s.matchBreakMinutes : undefined,
          gotvSpectators: typeof s.gotvSpectators === 'number' ? s.gotvSpectators : undefined,
          gotvDelay: typeof s.gotvDelay === 'number' ? s.gotvDelay : undefined,
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return siteRules;
}

/**
 * A saved tournament's sign-up settings save on their own; its teams are
 * added and removed one at a time, so a team signing up meanwhile is never
 * dropped by a save that still held the old list.
 */
export function useSetupSignup({
  tournament,
  form,
  handlers,
  onRefreshTeams,
}: {
  tournament: SetupTournament | null;
  form: SetupFormValues;
  handlers: SetupFormHandlers;
  onRefreshTeams: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { showError: toastError, showSuccess: toastSuccess } = useSnackbar();
  const savedSignup = useSavedSignup(signupOf(tournament?.settings, tournament?.teamSize));
  const signup = tournament ? savedSignup.value : form.signup;
  const [savingSignup, setSavingSignup] = useState(false);
  // Shuffle: players join on their own (the tournament page's Join) while sign-up is open.
  const [shuffleSignupOpen, setShuffleSignupOpen] = useState(
    tournament?.settings?.registrationOpen === true
  );
  const setShuffleSignup = async (open: boolean) => {
    if (!tournament) {
      handlers.onSignupChange({ ...form.signup, registrationOpen: open });
      return;
    }
    setShuffleSignupOpen(open);
    try {
      await api.put('/api/tournament', { settings: { registrationOpen: open } });
      toastSuccess(t('tournament.setup.signup.saved'));
      await onRefreshTeams();
    } catch (error) {
      setShuffleSignupOpen(!open);
      toastError((error as Error).message);
    }
  };
  const saveSignup = async () => {
    setSavingSignup(true);
    try {
      await api.put('/api/tournament', {
        settings: signupSettingsPatch(savedSignup.value),
        teamSize: savedSignup.value.teamSize,
      });
      toastSuccess(t('tournament.setup.signup.saved'));
      await onRefreshTeams();
    } catch (error) {
      toastError((error as Error).message);
    } finally {
      setSavingSignup(false);
    }
  };
  const [changingTeams, setChangingTeams] = useState(false);
  const changeTeams = async (next: string[]) => {
    if (!tournament) {
      handlers.onTeamsChange(next);
      return;
    }
    const current = form.selectedTeams;
    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));
    setChangingTeams(true);
    try {
      for (const teamId of added)
        await api.post(`/api/tournaments/${tournament.id}/teams`, { teamId });
      for (const teamId of removed)
        await api.delete(`/api/tournaments/${tournament.id}/teams/${encodeURIComponent(teamId)}`);
    } catch (error) {
      toastError((error as Error).message);
    } finally {
      setChangingTeams(false);
      await onRefreshTeams();
    }
  };
  return {
    signup,
    savedSignup,
    savingSignup,
    saveSignup,
    shuffleSignupOpen,
    setShuffleSignup,
    changingTeams,
    changeTeams,
  };
}

/** "Start from a template": the saved templates, for a tournament not created yet. */
export function useSetupTemplates(tournament: SetupTournament | null) {
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [templateMenu, setTemplateMenu] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (tournament) return;
    let cancelled = false;
    api
      .get<{ success: boolean; templates: TournamentTemplate[] }>('/api/templates')
      .then((response) => {
        if (!cancelled && response.success) setTemplates(response.templates);
      })
      .catch((error) => console.error('Error loading templates:', error));
    return () => {
      cancelled = true;
    };
  }, [tournament]);
  return { templates, templateMenu, setTemplateMenu };
}
