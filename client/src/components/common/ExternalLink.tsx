import { ExternalLink as AtExternalLink, type ExternalLinkProps } from '@auto-tournament/ui';
import { useTranslation } from 'react-i18next';

export { visuallyHidden, type ExternalLinkProps } from '@auto-tournament/ui';

/** The design system's link out of the app, with our translation of its screen reader note. */
export function ExternalLink(props: ExternalLinkProps) {
  const { t } = useTranslation();
  return <AtExternalLink newTabLabel={t('common.opensInNewTab')} {...props} />;
}
