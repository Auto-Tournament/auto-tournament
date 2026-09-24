import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientGameIntegration } from '../../integrations/types';
import { useModuleState } from '../../module-loader/useModuleState';
import { modulesMayArrive } from '../../module-loader/moduleState';

/**
 * Says that the tournament's game module is not installed, when the registry
 * answered with its placeholder (`utils/moduleResolution`), and renders
 * nothing for a real module.
 *
 * The placeholder leaves every slot empty, so the pages around it already
 * render nothing game-specific. This is the line that says why, so an empty
 * page does not read as a broken one.
 *
 * While the module may still be loading (`useIntegration` answered the
 * pending placeholder) it is a loading state instead, and the caller
 * re-renders into the module's slots, or into this notice, once the modules
 * settle.
 */
export function ModuleNotInstalledNotice({
  integration,
}: {
  integration: ClientGameIntegration | null | undefined;
}) {
  const { t } = useTranslation();
  if (integration?.modulePending) return <ModulePendingNotice integration={integration} />;

  const game = integration?.notInstalled;
  if (!game) return null;

  const name = t(`modulesPage.module.${game}.name`, { defaultValue: game });
  return (
    <Alert severity="warning" data-testid="module-not-installed">
      <AlertTitle>{t('modulesPage.notInstalled.title', { game: name })}</AlertTitle>
      {t('modulesPage.notInstalled.body')}
    </Alert>
  );
}

/** A small inline loading line, drawn only once the manifest has listed a code module. */
function PendingLine({ label, testId }: { label: string; testId: string }) {
  const { manifest } = useModuleState();
  // Until the manifest answers, nothing: an instance with no code module must
  // never draw a loading state, and it only learns it has none from the answer.
  if (manifest !== 'listed') return null;
  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid={testId}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, color: 'text.secondary' }}
    >
      <CircularProgress size={16} />
      <Typography variant="body2">{label}</Typography>
    </Box>
  );
}

/**
 * The loading state for a game's module-owned slots, while `useIntegration`
 * answers the pending placeholder. Nothing for any other integration.
 */
export function ModulePendingNotice({
  integration,
}: {
  integration: ClientGameIntegration | null | undefined;
}) {
  const { t } = useTranslation();
  const game = integration?.modulePending;
  if (!game) return null;
  const name = t(`modulesPage.module.${game}.name`, { defaultValue: game });
  return <PendingLine label={t('modulesPage.pending', { game: name })} testId="module-pending" />;
}

/**
 * For a path no route matched while a code module may still add one: a
 * loading state, then (the routes re-render when the module arrives) its page
 * or `fallback`.
 */
export function ModulePendingRoute({ fallback }: { fallback: ReactElement }) {
  const { t } = useTranslation();
  const state = useModuleState();
  if (!modulesMayArrive(state)) return fallback;
  return (
    <Box sx={{ p: 3 }}>
      <PendingLine label={t('modulesPage.pendingRoute')} testId="module-route-pending" />
    </Box>
  );
}
