import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { ExternalLink } from '../../components/common/ExternalLink';

/**
 * The team's Discord channel while its tournament runs (the Discord add-on's
 * team channels), for one of its own players. Nothing while the add-on is off
 * (its API answers 404) or the team has no channel.
 */
export function TeamDiscordLink({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<{ url: string | null }>(`/api/addons/discord/team-channel/${encodeURIComponent(teamId)}`)
      .then((r) => live && setUrl(r.url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [teamId]);
  if (!url) return null;
  return (
    <ExternalLink href={url} data-testid="team-discord-link">
      {t('discordBot.teamChannels.link')}
    </ExternalLink>
  );
}
