import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { fmtDayTime, fmtWeekdayTime } from '../utils/time';
import { useTranslation } from 'react-i18next';
import { RulesList } from '../components/tournament/overview/RulesList';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { tokens, fontDisplay, radii, textSize } from '../theme/tokens';
import { useIntegrationFor } from '../integrations/registry';
import { MATCH_FORMATS } from '../constants/tournament';
import { MapTile, panel } from '../components/tournament/ui/draftUi';
import { panelSx } from '../components/common/ui';

const { color } = tokens;

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <Box
      component="section"
      id={id}
      aria-labelledby={`${id}-title`}
      sx={{ ...panel, scrollMarginTop: '96px' }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <Typography
          id={`${id}-title`}
          component="h2"
          sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 700 }}
        >
          {title}
        </Typography>
        {note && <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{note}</Typography>}
      </Box>
      {children}
    </Box>
  );
}

/**
 * The tournament page's Rules tab (the drafts' Rules board): the facts at a
 * glance, a contents list, then how a match is played (from the settings,
 * always current), the organizer's description, schedule, map pool and own
 * rules with the rulebook link, and the prizes.
 */
export default function TournamentRulesTab() {
  const { t } = useTranslation();
  const { tournament } = useTournamentPage();
  const settings = tournament.settings;
  const description = settings?.description?.trim();
  const hasRules = Boolean(settings?.rules?.length || settings?.rulebookUrl);
  const integration = useIntegrationFor(tournament);
  const RulesView = integration.tournamentRulesView;
  const PrizesView = integration.tournamentPrizesView;
  const schedule = [...(settings?.schedule ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const maps = tournament.maps ?? [];

  const typeKey = `tournament.typeSelector.types.${tournament.type}.label`;
  const typeLabel = t(typeKey) === typeKey ? tournament.type : t(typeKey);
  const series = MATCH_FORMATS.find((f) => f.value === tournament.format)?.label;
  const rounds = tournament.maxRounds;
  const overtime =
    tournament.overtimeMode === 'disabled'
      ? t('rulesTab.facts.noOvertime')
      : tournament.overtimeSegments
        ? t('rulesTab.facts.overtimeSegments', { count: tournament.overtimeSegments })
        : t('rulesTab.facts.overtimeUnlimited');
  const facts = [
    { label: t('overviewPage.facts.format'), value: typeLabel, note: series ?? '' },
    ...(tournament.type !== 'shuffle'
      ? [
          {
            label: t('overviewPage.facts.teams'),
            value: String(tournament.teamIds.length),
            note: tournament.teamSize
              ? t('overviewPage.facts.teamSizeValue', { count: tournament.teamSize })
              : '',
          },
        ]
      : []),
    ...(rounds
      ? [
          {
            label: t('rulesTab.facts.map'),
            value: `MR${rounds / 2}`,
            note: t('rulesTab.facts.firstTo', { count: rounds / 2 + 1 }),
          },
        ]
      : []),
    {
      label: t('overviewPage.facts.overtime'),
      value: overtime,
      note: tournament.overtimeMode === 'disabled' ? '' : t('rulesTab.facts.thenDamage'),
    },
    ...(maps.length
      ? [
          {
            label: t('overviewPage.mapPool'),
            value: t('rulesTab.facts.mapCount', { count: maps.length }),
            note: '',
          },
        ]
      : []),
    ...(schedule.length
      ? [
          {
            label: t('overviewPage.schedule'),
            value: fmtWeekdayTime(schedule[0].at),
            note: schedule[0].label,
          },
        ]
      : []),
  ];

  const formatKey = tournament.type;
  const showTies = formatKey === 'swiss' || formatKey === 'round_robin' || formatKey === 'groups';
  const swissRounds = Math.max(1, Math.ceil(Math.log2(Math.max(tournament.teamIds.length, 2))));
  const formatIntro =
    formatKey === 'swiss'
      ? t('rulesTab.format.swiss', { count: swissRounds })
      : formatKey === 'groups'
        ? t('standingsTab.intro.groups')
        : t(`rulesTab.format.${formatKey}`);
  const grandFinal =
    formatKey === 'double_elimination' ? (tournament.settings?.grandFinalMode ?? 'simple') : null;
  const bestOf = tournament.format.replace('bo', 'Bo');
  // The server's damage decider: overtime capped at N segments, or none with
  // 0 segments set (assignConfig.ts). Unlimited overtime never needs it.
  const segments = tournament.overtimeSegments;
  const damageDecides =
    tournament.overtimeMode === 'disabled'
      ? segments === 0
      : segments !== undefined && segments > 0;

  const sections = [
    { id: 'rules-format', title: t('rulesTab.format.navTitle') },
    RulesView && { id: 'rules-how', title: t('overviewPage.howItsPlayed') },
    description && { id: 'rules-about', title: t('overviewPage.about') },
    schedule.length > 0 && { id: 'rules-schedule', title: t('overviewPage.schedule') },
    maps.length > 0 && { id: 'rules-maps', title: t('overviewPage.mapPool') },
    hasRules && { id: 'rules-organizer', title: t('rulesTab.organizer') },
    PrizesView && { id: 'rules-prizes', title: t('overviewPage.prizes.title') },
  ].filter(Boolean) as Array<{ id: string; title: string }>;

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
      data-testid="tournament-rules-tab"
    >
      <Box
        component="section"
        aria-label={t('rulesTab.atAGlance')}
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: 'repeat(auto-fit, minmax(12rem, 1fr))',
          },
          gap: 1.5,
        }}
      >
        {facts.map((f) => (
          <Box
            key={f.label}
            sx={{ ...panelSx, p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}
          >
            <Typography
              component="span"
              sx={{
                fontSize: textSize.xs,
                color: color.muted,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {f.label}
            </Typography>
            <Typography
              component="span"
              sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 700 }}
            >
              {f.value}
            </Typography>
            {f.note && (
              <Typography component="span" sx={{ fontSize: textSize.sm, color: color.ink2 }}>
                {f.note}
              </Typography>
            )}
          </Box>
        ))}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
        <Box
          component="nav"
          aria-label={t('rulesTab.onThisPage')}
          sx={{
            flex: '1 1 200px',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            position: { md: 'sticky' },
            top: { md: 88 },
          }}
        >
          {sections.map((s) => (
            <Box
              key={s.id}
              component="a"
              href={`#${s.id}`}
              sx={{
                px: 1.5,
                py: 1,
                borderRadius: radii.sm,
                color: color.ink2,
                textDecoration: 'none',
                fontSize: '0.875rem',
                '&:hover': { bgcolor: color.paper2, color: color.ink },
              }}
            >
              {s.title}
            </Box>
          ))}
        </Box>

        <Box
          sx={{
            flex: '999 1 560px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <Section id="rules-format" title={t('rulesTab.format.title')}>
            <Typography sx={{ color: color.ink2, maxWidth: '68ch' }}>{formatIntro}</Typography>
            {grandFinal && (
              <Typography sx={{ color: color.ink2, maxWidth: '68ch' }}>
                {t(`tournament.setup.format.grandFinalHelp.${grandFinal}`)}
              </Typography>
            )}
            {showTies && (
              <Typography sx={{ color: color.ink2, maxWidth: '68ch' }}>
                {t(`liveOverview.ties.${formatKey}`)}
              </Typography>
            )}
            {rounds ? (
              <Typography sx={{ color: color.ink2, maxWidth: '68ch' }}>
                {t('rulesTab.format.matches', {
                  series: bestOf,
                  mr: rounds / 2,
                  overtime,
                })}
              </Typography>
            ) : null}
            {damageDecides && (
              <Typography sx={{ color: color.ink2, maxWidth: '68ch' }}>
                {t('rulesTab.format.damage')}
              </Typography>
            )}
          </Section>
          {RulesView && (
            <Section
              id="rules-how"
              title={t('overviewPage.howItsPlayed')}
              note={t('rulesTab.fromSettings')}
            >
              <RulesView tournament={tournament} />
            </Section>
          )}
          {description && (
            <Section id="rules-about" title={t('overviewPage.about')}>
              <Typography
                sx={{
                  whiteSpace: 'pre-wrap',
                  color: color.ink2,
                  fontSize: '1rem',
                  lineHeight: 1.6,
                  maxWidth: '68ch',
                }}
              >
                {description}
              </Typography>
            </Section>
          )}
          {schedule.length > 0 && (
            <Section id="rules-schedule" title={t('overviewPage.schedule')}>
              <Box
                component="ol"
                sx={{
                  listStyle: 'none',
                  m: 0,
                  p: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))',
                  gap: 1.25,
                }}
              >
                {schedule.map((s) => (
                  <Box
                    component="li"
                    key={`${s.at}-${s.label}`}
                    sx={{
                      borderRadius: radii.md,
                      bgcolor: color.paper3,
                      p: 1.75,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.5,
                    }}
                  >
                    <Typography component="span" sx={{ fontSize: textSize.xs, color: color.muted }}>
                      {fmtDayTime(s.at)}
                    </Typography>
                    <Typography component="span" sx={{ fontWeight: 700 }}>
                      {s.label}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Section>
          )}
          {maps.length > 0 && (
            <Section
              id="rules-maps"
              title={t('overviewPage.mapPool')}
              note={t('overviewPage.mapPoolNote')}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 9rem), 1fr))',
                  gap: 1,
                }}
              >
                {maps.map((m) => (
                  <MapTile key={m} map={m} aspect="16 / 9" />
                ))}
              </Box>
            </Section>
          )}
          {hasRules && (
            <Section id="rules-organizer" title={t('rulesTab.organizer')}>
              <RulesList
                rules={settings?.rules ?? []}
                rulebookUrl={settings?.rulebookUrl}
                rulebookLinkLabel={t('overviewPage.fullRulebook')}
              />
            </Section>
          )}
          {PrizesView && (
            <Box id="rules-prizes" sx={{ scrollMarginTop: '96px' }}>
              <PrizesView tournament={tournament} />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
