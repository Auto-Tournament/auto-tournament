/**
 * Team › Manage: one member's teammate colour in this team's CS2 matches, as a row of dots. ✕
 * keeps their colour preference (its dot shown faded, and named under the dots); a colour dot sets
 * the team's pick for them, which wins. `resolveTeamColors`
 * mirrors the server's rule (fleet/assignConfig.ts withColors), so a clash shows here before the
 * match: their pick is taken by a teammate, and CS2 picks for them.
 */
import { Box, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme/tokens';
import { TEAMMATE_COLORS } from '../account/teammateColors';

const { color: c } = tokens;

export interface ColorMember {
  set: string | null;
  own: string | null;
  captain: boolean;
}

export type ColorSource = 'team' | 'own' | 'taken' | 'cs2';

/** Per member (same order): the colour they get and why. The team's colours first, then their own picks, captains first. */
export function resolveTeamColors(
  members: readonly ColorMember[]
): { color: string | null; source: ColorSource }[] {
  const out = members.map(() => ({ color: null as string | null, source: 'cs2' as ColorSource }));
  const taken = new Set<string>();
  members.forEach((m, i) => {
    if (m.set && !taken.has(m.set)) {
      out[i] = { color: m.set, source: 'team' };
      taken.add(m.set);
    }
  });
  const order = [...members.keys()].sort(
    (a, b) => Number(members[b].captain) - Number(members[a].captain) || a - b
  );
  for (const i of order) {
    const m = members[i];
    if (m.set || !m.own) continue;
    if (taken.has(m.own)) out[i] = { color: null, source: 'taken' };
    else {
      out[i] = { color: m.own, source: 'own' };
      taken.add(m.own);
    }
  }
  return out;
}

const ring = (on: boolean) => ({
  width: 24,
  height: 24,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  border: `2px solid ${on ? c.ink : 'transparent'}`,
  '&.Mui-focusVisible': { outline: `2px solid ${c.focus}`, outlineOffset: 2 },
});

export function MemberColorDots({
  name,
  member,
  resolved,
  onChange,
}: {
  name: string;
  member: ColorMember;
  resolved: { color: string | null; source: ColorSource };
  onChange: (color: string | null) => void;
}) {
  const { t } = useTranslation();
  const pick = (color: string | null) => {
    if (color !== member.set) onChange(color);
  };
  let preference = t('teamManage.colorNoPreference');
  if (member.own) {
    const own = t(`account.color.names.${member.own}`);
    preference =
      resolved.source === 'taken'
        ? t('teamManage.colorTaken', { color: own })
        : t('teamManage.colorPrefers', { color: own });
  }
  return (
    <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
      <Box
        role="radiogroup"
        aria-label={t('teamManage.colorFor', { name })}
        data-testid="team-manage-member-color"
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
      >
        <ButtonBase
          role="radio"
          aria-checked={member.set === null}
          aria-label={t('teamManage.colorOwn')}
          title={t('teamManage.colorOwn')}
          onClick={() => pick(null)}
          sx={{
            ...ring(member.set === null),
            borderStyle: member.set === null ? 'solid' : 'dashed',
            borderColor: member.set === null ? c.ink : c.ink2,
            color: member.set === null ? c.ink : c.ink2,
            fontSize: '0.7rem',
          }}
        >
          ✕
        </ButtonBase>
        {TEAMMATE_COLORS.map((col) => {
          const set = member.set === col.id;
          const theirs = member.set === null && member.own === col.id;
          const label = t(`account.color.names.${col.id}`);
          return (
            <ButtonBase
              key={col.id}
              role="radio"
              aria-checked={set}
              aria-label={label}
              title={label}
              onClick={() => pick(col.id)}
              sx={{ ...ring(set || theirs), opacity: theirs ? 0.55 : 1 }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: col.hex }}
              />
            </ButtonBase>
          );
        })}
      </Box>
      <Typography
        variant="caption"
        sx={{ color: c.ink2 }}
        data-testid="team-manage-member-color-preference"
      >
        {preference}
      </Typography>
    </Box>
  );
}
