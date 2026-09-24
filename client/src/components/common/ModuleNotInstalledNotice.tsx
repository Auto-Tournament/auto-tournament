import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { useTranslation } from 'react-i18next';
import type { ClientGameIntegration } from '../../integrations/types';

/**
 * Says that the tournament's game module is not installed, when the registry
 * answered with its placeholder (`utils/moduleResolution`), and renders
 * nothing for a real module.
 *
 * The placeholder leaves every slot empty, so the pages around it already
 * render nothing game-specific. This is the line that says why, so an empty
 * page does not read as a broken one.
 */
export function ModuleNotInstalledNotice({
  integration,
}: {
  integration: ClientGameIntegration | null | undefined;
}) {
  const { t } = useTranslation();
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
