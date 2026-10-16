import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { RoundRobinStanding } from '../../types';
import { SectionTitle, TeamLogo, panel, tableTh } from './ui/draftUi';
import { mono, tokens } from '../../theme/tokens';

const { color } = tokens;

export interface GroupStandingSet {
  group: string;
  done: boolean;
  standings: RoundRobinStanding[];
}

/**
 * Groups, then playoffs: one table per group (the 3.0 draft's Standings),
 * the teams that go through in bold above a green line.
 */
export function GroupTables({
  groups,
  teams,
  advancePerGroup,
  viewerTeamId,
  compact = false,
}: {
  groups: GroupStandingSet[];
  teams: Map<string, { name: string; tag?: string }>;
  advancePerGroup: number;
  viewerTeamId?: string | null;
  /** The overview: no section frame of its own per table. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const th = tableTh;
  return (
    <Box
      data-testid="group-tables"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
        gap: 2.5,
      }}
    >
      {groups.map((g) => (
        <Box
          key={g.group}
          component="section"
          aria-labelledby={`group-${g.group}`}
          data-testid={`group-table-${g.group}`}
          sx={compact ? { display: 'flex', flexDirection: 'column', gap: 1 } : panel}
        >
          <SectionTitle
            id={`group-${g.group}`}
            title={t('groups.groupN', { letter: g.group })}
            note={g.done ? t('groups.done') : t('groups.through', { count: advancePerGroup })}
          />
          <Box
            component="table"
            sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem' }}
          >
            <thead>
              <tr>
                <Box component="th" scope="col" sx={{ ...th, textAlign: 'left', width: 32 }}>
                  #
                </Box>
                <Box component="th" scope="col" sx={{ ...th, textAlign: 'left' }}>
                  {t('leaderboardPage.team')}
                </Box>
                <Box component="th" scope="col" sx={th}>
                  {t('liveOverview.wl')}
                </Box>
                <Box component="th" scope="col" sx={th}>
                  {t('liveOverview.rounds')}
                </Box>
              </tr>
            </thead>
            <tbody>
              {g.standings.map((s, i) => {
                const through = i < advancePerGroup;
                const team = teams.get(s.teamId);
                const me = s.teamId === viewerTeamId;
                // The line under the last team through.
                const cut = i === advancePerGroup - 1;
                const td = {
                  py: 1.25,
                  px: 1,
                  borderTop: `1px solid ${color.rule}`,
                  borderBottom: cut ? `2px solid ${color.live}` : undefined,
                  textAlign: 'right' as const,
                  ...mono,
                };
                return (
                  <Box
                    component="tr"
                    key={s.teamId}
                    data-through={through ? 'true' : 'false'}
                    sx={{ bgcolor: me ? color.paper3 : 'transparent' }}
                  >
                    <Box
                      component="td"
                      sx={{
                        ...td,
                        textAlign: 'left',
                        color: through ? color.live : color.muted,
                        fontWeight: 600,
                      }}
                    >
                      {i + 1}
                    </Box>
                    <Box
                      component="td"
                      sx={{
                        ...td,
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        fontWeight: through || me ? 700 : 500,
                      }}
                    >
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                        <TeamLogo
                          team={{ id: s.teamId, name: team?.name ?? s.teamId, tag: team?.tag }}
                          size="sm"
                        />
                        {team?.name ?? s.teamId}
                      </Box>
                    </Box>
                    <Box component="td" sx={td}>
                      {s.wins}–{s.losses}
                    </Box>
                    <Box
                      component="td"
                      sx={{
                        ...td,
                        color:
                          s.roundDiff > 0 ? color.live : s.roundDiff < 0 ? color.ban : color.ink2,
                      }}
                    >
                      {s.roundDiff > 0 ? '+' : s.roundDiff < 0 ? '−' : ''}
                      {Math.abs(s.roundDiff)}
                    </Box>
                  </Box>
                );
              })}
            </tbody>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
