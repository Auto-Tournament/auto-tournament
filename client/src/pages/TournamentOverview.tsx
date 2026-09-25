import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { FactGrid, SectionHead, type Fact } from '../components/common/ui';
import { MapPool } from '../components/tournament/overview/MapPool';
import { RulesList } from '../components/tournament/overview/RulesList';
import { SchedulePanel } from '../components/tournament/overview/SchedulePanel';
import { PrizesCard } from '../components/tournament/overview/PrizesCard';
import {
  RequirementsCard,
  type Requirement,
} from '../components/tournament/overview/RequirementsCard';
import { LiveStrip } from '../components/tournament/overview/LiveStrip';
import { YourePlayingPanel } from '../components/tournament/page/YourePlayingPanel';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { isLiveMatch } from '../components/tournament/page/matchHelpers';
import { usePublicBracket } from '../hooks/usePublicBracket';
import { getMapDisplayName } from '../constants/maps';
import { useIntegrationFor } from '../integrations/registry';
import { MATCH_FORMATS } from '../constants/tournament';
import { compareMatchOrder } from '../utils/matchUtils';
import { tournamentTabPath } from '../paths';
import { tokens, textSize } from '../theme/tokens';

/**
 * The tournament page's Overview tab: what it is, how it's played and what's
 * at stake (the draft's `tournament.html`), a strip of the matches live right
 * now, and "You're playing" for a player whose team is in it.
 */
export default function TournamentOverview() {
  const { t } = useTranslation();
  const { tournament, viewerTeam, viewerHasSteamIdentity } = useTournamentPage();
  const gameIntegration = useIntegrationFor(tournament);
  // Live matches for the strip, and the viewer's own match for "You're playing".
  const { matches } = usePublicBracket(tournament.id);
  const liveMatches = matches.filter(isLiveMatch).sort(compareMatchOrder);

  const settings = tournament.settings;
  const isShuffle = tournament.type === 'shuffle';
  const typeLabelKey = `tournament.typeSelector.types.${tournament.type}.label`;
  const typeLabel = t(typeLabelKey) === typeLabelKey ? tournament.type : t(typeLabelKey);

  // A map veto and an overtime policy are Counter-Strike 2's. A game the
  // platform cannot watch has neither, and a fact line saying "Map veto:
  // Standard" about a chess cup is simply wrong (3.0 phase D, PR D10).
  const capabilities = gameIntegration.capabilities;
  // Overtime is a match rule the game module asks for in setup; a module that
  // asks for none has none to report.
  const hasMatchRules = Boolean(gameIntegration.tournamentSetupSteps.rules);

  const seriesCount = parseInt(tournament.format.replace('bo', ''), 10) || 1;
  const hasCustomVeto = Boolean(
    (settings?.customVetoOrder as Record<string, unknown> | undefined)?.[tournament.format]
  );

  const facts: Fact[] = [];
  if (!isShuffle && tournament.teamIds.length > 0) {
    facts.push({
      label: t('overviewPage.facts.teams'),
      value: t('overviewPage.facts.teamsValue', { count: tournament.teamIds.length }),
    });
  }
  if (tournament.teamSize) {
    facts.push({
      label: t('overviewPage.facts.teamSize'),
      value: t('overviewPage.facts.teamSizeValue', { count: tournament.teamSize }),
    });
  }
  facts.push({ label: t('overviewPage.facts.format'), value: typeLabel });
  facts.push({
    label: t('overviewPage.facts.series'),
    value:
      MATCH_FORMATS.find((f) => f.value === tournament.format)?.label ??
      t('overviewPage.facts.seriesValue', { count: seriesCount }),
  });
  if (!isShuffle && capabilities.veto) {
    facts.push({
      label: t('overviewPage.facts.mapVeto'),
      value: hasCustomVeto
        ? t('overviewPage.facts.mapVetoCustom')
        : t('overviewPage.facts.mapVetoStandard'),
    });
  }
  if (tournament.overtimeMode && hasMatchRules) {
    facts.push({
      label: t('overviewPage.facts.overtime'),
      value:
        tournament.overtimeMode === 'disabled'
          ? t('overviewPage.facts.overtimeDisabled')
          : tournament.overtimeSegments
            ? t('overviewPage.facts.overtimeEnabledSegments', {
                count: tournament.overtimeSegments,
              })
            : t('overviewPage.facts.overtimeEnabledUnlimited'),
    });
  }

  const mapNames = (tournament.maps || []).map(getMapDisplayName);

  const requirements: Requirement[] = [
    {
      label: viewerHasSteamIdentity
        ? t('overviewPage.requirements.steamLinkedOk')
        : t('overviewPage.requirements.steamLinkedNeutral'),
      state: viewerHasSteamIdentity ? 'ok' : 'neutral',
    },
    {
      label: viewerTeam
        ? t('overviewPage.requirements.onRosterOk')
        : t('overviewPage.requirements.onRosterNeutral'),
      state: viewerTeam ? 'ok' : 'neutral',
    },
  ];

  return (
    <Box data-testid="public-tournament-overview">
      <LiveStrip
        matches={liveMatches}
        linkLabel={t('overviewPage.allMatches')}
        linkTo={tournamentTabPath(tournament.id, 'matches')}
      />

      {/* Two columns from md up: the event on the left, the side cards on the
          right. "You're playing" is its own grid item so that on a phone it
          comes first, above the event text, rather than after all of it. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.7fr) minmax(0, 1fr)' },
          gridTemplateRows: { md: 'auto 1fr' },
          columnGap: 6,
          rowGap: { xs: 4, md: 3 },
          mt: { xs: 3, md: 6 },
          alignItems: 'start',
        }}
      >
        {viewerTeam && (
          <Box sx={{ minWidth: 0, gridColumn: { md: 2 }, gridRow: { md: 1 } }}>
            <YourePlayingPanel tournament={tournament} team={viewerTeam} matches={matches} />
          </Box>
        )}

        <Stack
          spacing={6}
          sx={{ minWidth: 0, gridColumn: { md: 1 }, gridRow: { md: '1 / span 2' } }}
        >
          {settings?.description && (
            <Box
              component="section"
              aria-label={t('overviewPage.about')}
              data-testid="overview-about"
            >
              <Typography
                sx={{
                  whiteSpace: 'pre-wrap',
                  color: tokens.color.ink2,
                  fontSize: textSize.lg,
                  lineHeight: 1.6,
                  maxWidth: '64ch',
                }}
              >
                {settings.description}
              </Typography>
            </Box>
          )}

          <Box component="section" aria-labelledby="overview-how">
            <SectionHead id="overview-how" title={t('overviewPage.howItsPlayed')} />
            <FactGrid variant="fact" items={facts} data-testid="overview-facts" />
          </Box>

          {mapNames.length > 0 && (
            <Box component="section" aria-labelledby="overview-maps">
              <SectionHead id="overview-maps" title={t('overviewPage.mapPool')} />
              <MapPool mapNames={mapNames} />
            </Box>
          )}

          {settings?.rules && settings.rules.length > 0 && (
            <Box component="section" aria-labelledby="overview-rules-title">
              <SectionHead id="overview-rules-title" title={t('overviewPage.rules')} />
              <RulesList
                rules={settings.rules}
                rulebookUrl={settings.rulebookUrl}
                rulebookLinkLabel={t('overviewPage.fullRulebook')}
              />
            </Box>
          )}

          {settings?.schedule && settings.schedule.length > 0 && (
            <Box component="section" aria-labelledby="overview-schedule-title">
              <SectionHead id="overview-schedule-title" title={t('overviewPage.schedule')} />
              <SchedulePanel schedule={settings.schedule} />
            </Box>
          )}
        </Stack>

        <Stack
          component="aside"
          spacing={3}
          sx={{
            minWidth: 0,
            gridColumn: { md: 2 },
            gridRow: { md: viewerTeam ? 2 : '1 / span 2' },
            position: { md: 'sticky' },
            top: { md: 96 },
          }}
        >
          <PrizesCard
            title={t('overviewPage.prizes.title')}
            prizes={settings?.prizes ?? []}
            note={t('overviewPage.prizes.note')}
          />

          <RequirementsCard
            title={t('overviewPage.requirements.title')}
            requirements={requirements}
          />
        </Stack>
      </Box>
    </Box>
  );
}
