/**
 * Matchmaking's highlight budget (the API's `highlights_mm*`): matchmaking
 * plays many matches, so each gets only a few of its best plays.
 */
import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '../components/common/SegmentedControl';
import { SwitchRow } from '../components/common/ui';

export interface MatchmakingHighlightValues {
  highlightsMatchmaking: boolean;
  /** 0: every play that qualifies. */
  highlightsMatchmakingClips: number;
  /** 5: an ace. */
  highlightsMatchmakingMinKills: number;
  highlightsMatchmakingClutch: boolean;
}

const CLIPS = [1, 2, 3, 5, 10, 0];
const MIN_KILLS = [2, 3, 4, 5];

export function MatchmakingHighlightsSetting({
  vals,
  save,
}: {
  vals: MatchmakingHighlightValues;
  save: (patch: Partial<MatchmakingHighlightValues>) => void;
}) {
  const { t } = useTranslation();
  const k = 'highlightsPage.matchmaking';
  const kills = t(`${k}.killsInline.${vals.highlightsMatchmakingMinKills}`);
  return (
    <Box
      data-testid="highlights-matchmaking"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Box>
        <Typography variant="subtitle2">{t(`${k}.title`)}</Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {t(`${k}.description`)}
        </Typography>
      </Box>
      <SwitchRow
        label={t(`${k}.on`)}
        help={t(`${k}.onHelp`)}
        checked={vals.highlightsMatchmaking}
        onChange={(e) => save({ highlightsMatchmaking: e.target.checked })}
        size="small"
        data-testid="highlights-matchmaking-on"
      />
      {vals.highlightsMatchmaking && (
        <>
          <Box>
            <Typography variant="body2" fontWeight={600}>
              {t(`${k}.clips`)}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {t(`${k}.clipsHelp`)}
            </Typography>
            <SegmentedControl
              label={t(`${k}.clips`)}
              value={String(vals.highlightsMatchmakingClips)}
              onChange={(v) => save({ highlightsMatchmakingClips: Number(v) })}
              options={CLIPS.map((n) => ({
                value: String(n),
                label: n === 0 ? t(`${k}.all`) : String(n),
              }))}
              size="small"
              testId="highlights-matchmaking-clips"
            />
          </Box>
          <TextField
            select
            label={t(`${k}.minKills`)}
            helperText={t(`${k}.minKillsHelp`)}
            value={vals.highlightsMatchmakingMinKills}
            onChange={(e) => save({ highlightsMatchmakingMinKills: Number(e.target.value) })}
            size="small"
            sx={{ maxWidth: 320 }}
            slotProps={{ htmlInput: { 'data-testid': 'highlights-matchmaking-min-kills' } }}
          >
            {MIN_KILLS.map((n) => (
              <MenuItem key={n} value={n}>
                {t(`${k}.kills.${n}`)}
              </MenuItem>
            ))}
          </TextField>
          <SwitchRow
            label={t(`${k}.clutch`)}
            help={t(`${k}.clutchHelp`)}
            checked={vals.highlightsMatchmakingClutch}
            onChange={(e) => save({ highlightsMatchmakingClutch: e.target.checked })}
            size="small"
            data-testid="highlights-matchmaking-clutch"
          />
          <Typography
            variant="body2"
            sx={{ px: 2, py: 1.5, borderRadius: 2, bgcolor: 'background.surface3' }}
          >
            {t(vals.highlightsMatchmakingClutch ? `${k}.summaryClutch` : `${k}.summary`, {
              count: vals.highlightsMatchmakingClips,
              clips:
                vals.highlightsMatchmakingClips === 0
                  ? t(`${k}.summaryEvery`)
                  : t(`${k}.summaryBest`, { count: vals.highlightsMatchmakingClips }),
              kills,
            })}
          </Typography>
        </>
      )}
    </Box>
  );
}
