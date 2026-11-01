import { useEffect, useState } from 'react';
import { fmtTime } from '../../utils/time';
import {
  Box,
  ButtonBase,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { ThumbsDownIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { PlayerAvatar, SectionTitle, eyebrowSx, panel } from '../tournament/ui/draftUi';
import { ReportPlayerLink } from '../player/profile/ReportPlayerButton';
import { radii, tokens } from '../../theme/tokens';
import { COMMEND_ICONS } from '../matchmaking/commendIcons';

export const COMMEND_KINDS = ['friendly', 'leader', 'teacher', 'good_sport'] as const;
export type CommendKind = (typeof COMMEND_KINDS)[number];
const NEGATIVE_KINDS = ['toxic', 'griefing', 'unhelpful', 'bad_sport'] as const;
type GivenKind = CommendKind | (typeof NEGATIVE_KINDS)[number];

/** Each kind's dot colour, on the profile and wherever counts show. */
export const commendColor: Record<CommendKind, string> = {
  friendly: tokens.color.live,
  leader: tokens.color.accent,
  teacher: tokens.color.sideCt,
  good_sport: tokens.color.medalGold,
};

interface CommendSide {
  teamId: string | null;
  teamName: string | null;
  players: Array<{ id: string; name: string; avatar: string | null }>;
}

interface CommendState {
  open: boolean;
  closesAt: number | null;
  max: number;
  given: Record<string, GivenKind>;
  sides: CommendSide[];
}

/** "today 17:42", "tomorrow 17:42". */
function closesLabel(at: number, lang: string, t: TFunction): string {
  const when = new Date(at * 1000);
  const time = fmtTime(when, lang);
  const today = new Date();
  const sameDay = when.toDateString() === today.toDateString();
  return sameDay ? t('commends.closesToday', { time }) : t('commends.closesTomorrow', { time });
}

/**
 * "Commend players from this match" (the match room, after the match): each
 * player from it with four buttons, Friendly, Leader, Teacher and Good sport,
 * and a menu for a negative one. Up to three players, one kind each, for 24
 * hours; nobody sees who gave what. "Report a player" under it stays a separate, private report.
 */
export function CommendPanel({
  matchSlug,
  viewerTeamId,
}: {
  matchSlug: string;
  viewerTeamId: string;
}) {
  const { t, i18n } = useTranslation();
  const { playerSteamId } = useAuth();
  const { showError } = useSnackbar();
  const [state, setState] = useState<CommendState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [negative, setNegative] = useState<{ el: HTMLElement; id: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean } & CommendState>(
        `/api/commends/match/${encodeURIComponent(matchSlug)}`
      )
      .then((res) => !cancelled && setState(res))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [matchSlug, playerSteamId]);

  if (!state || !state.open || !state.closesAt) return null;

  const count = Object.keys(state.given).length;
  const full = count >= state.max;
  // Your team first, then the opponents.
  const sides = [...state.sides].sort(
    (a, b) => Number(b.teamId === viewerTeamId) - Number(a.teamId === viewerTeamId)
  );
  const everyone = sides.flatMap((s) => s.players);

  const pick = async (playerId: string, kind: GivenKind) => {
    const next = state.given[playerId] === kind ? null : kind;
    setBusy(playerId);
    try {
      const res = await api.put<{ success: boolean } & CommendState>(
        `/api/commends/match/${encodeURIComponent(matchSlug)}/${encodeURIComponent(playerId)}`,
        { kind: next }
      );
      setState(res);
    } catch (err) {
      showError(apiErrorMessage(err, t('commends.failed')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box
      component="section"
      aria-labelledby="match-commend"
      data-testid="match-commends"
      sx={panel}
    >
      <SectionTitle
        id="match-commend"
        title={t('commends.title')}
        note={`${t('commends.givenOf', { count, max: state.max })} · ${closesLabel(state.closesAt, i18n.language, t)}`}
      />
      <Typography sx={{ m: 0, fontSize: '0.875rem', color: tokens.color.ink2 }}>
        {t('commends.intro', { max: state.max })}
      </Typography>
      {sides.map((side) => {
        const players = side.players.filter((p) => p.id !== playerSteamId);
        if (players.length === 0) return null;
        const mine = side.teamId === viewerTeamId;
        return (
          <Box
            key={side.teamId ?? side.teamName ?? (mine ? 'mine' : 'them')}
            sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            <Typography component="h3" sx={{ ...eyebrowSx, m: 0 }}>
              {mine
                ? t('commends.yourTeam', { name: side.teamName ?? '' })
                : t('commends.opponents', { name: side.teamName ?? '' })}
            </Typography>
            {players.map((p) => {
              const given = state.given[p.id];
              return (
                <Box
                  key={p.id}
                  data-testid={`commend-row-${p.id}`}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '32px minmax(0, 1fr)',
                      sm: '32px minmax(0, 1fr) auto',
                    },
                    gap: 1.5,
                    alignItems: 'center',
                    px: 1.5,
                    py: 1,
                    borderRadius: radii.md,
                    bgcolor: tokens.color.paper3,
                  }}
                >
                  <PlayerAvatar id={p.id} name={p.name} avatar={p.avatar} />
                  <Typography sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {p.name}
                  </Typography>
                  <Box
                    role="group"
                    aria-label={t('commends.groupLabel', { name: p.name })}
                    sx={{
                      gridColumn: { xs: '1 / -1', sm: 'auto' },
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 0.75,
                      justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                    }}
                  >
                    {COMMEND_KINDS.map((kind) => {
                      const on = given === kind;
                      const locked = !on && !given && full;
                      return (
                        <ButtonBase
                          key={kind}
                          aria-pressed={on}
                          disabled={locked || busy === p.id}
                          onClick={() => void pick(p.id, kind)}
                          data-testid={`commend-${p.id}-${kind}`}
                          sx={{
                            minHeight: 36,
                            px: 1.5,
                            borderRadius: radii.pill,
                            border: `2px solid ${on ? tokens.color.accent : tokens.color.rule}`,
                            bgcolor: on ? tokens.color.accent : 'transparent',
                            color: on ? tokens.color.accentInk : tokens.color.ink2,
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            '&:hover': { borderColor: tokens.color.accent },
                            '&:focus-visible': {
                              outline: `2px solid ${tokens.color.focus}`,
                              outlineOffset: 2,
                            },
                            '&.Mui-disabled': { opacity: 0.45 },
                          }}
                        >
                          {t(`commends.kinds.${kind}`)}
                        </ButtonBase>
                      );
                    })}
                    <Tooltip title={t('commends.negative')}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label={t('commends.negativeFor', { name: p.name })}
                          aria-haspopup="menu"
                          aria-pressed={(NEGATIVE_KINDS as readonly string[]).includes(given ?? '')}
                          color={
                            (NEGATIVE_KINDS as readonly string[]).includes(given ?? '')
                              ? 'error'
                              : 'default'
                          }
                          disabled={(!given && full) || busy === p.id}
                          onClick={(e) => setNegative({ el: e.currentTarget, id: p.id })}
                          data-testid={`commend-${p.id}-negative`}
                          sx={{ width: 36, height: 36 }}
                        >
                          <ThumbsDownIcon size={18} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
              );
            })}
          </Box>
        );
      })}
      <Menu
        anchorEl={negative?.el}
        open={!!negative}
        onClose={() => setNegative(null)}
        data-testid="commend-negative-menu"
      >
        {NEGATIVE_KINDS.map((kind) => {
          const Icon = COMMEND_ICONS[kind];
          return (
            <MenuItem
              key={kind}
              selected={!!negative && state.given[negative.id] === kind}
              data-testid={`commend-negative-${kind}`}
              onClick={() => {
                if (negative) void pick(negative.id, kind);
                setNegative(null);
              }}
            >
              <ListItemIcon>{Icon && <Icon size={18} aria-hidden />}</ListItemIcon>
              {t(`matchmaking.profile.tag.${kind}`)}
            </MenuItem>
          );
        })}
      </Menu>
      <ReportPlayerLink players={everyone} />
    </Box>
  );
}
