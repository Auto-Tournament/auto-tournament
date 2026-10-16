/**
 * A skin to pick, said the same way everywhere (the canvas "Skin to pick",
 * options A and C): "You earned a skin for playing" / "Pick one of three. It
 * stays until you do." The rarity shows only as a hairline in its colour.
 *
 * - `PinnedSkinPicks`: the bell's pinned rows, on top until picked.
 * - `PrizePickRow`: the row on the page where it was earned (a finished
 *   match, the tournament's results).
 */
import { Box, Button, Typography } from '@mui/material';
import { PushPinIcon } from '@phosphor-icons/react';
import { useModuleTranslation, tokens, radii, withAlpha, panelSx } from '../../../module-sdk';
import type { PinnedNoticesProps, PrizePickRowProps } from '../../types';
import { choiceFrom, openSkinPick, useMySkins, useSkinsEnabled, type SkinChoice } from './useSkins';
import { bestRarity, rarityColor } from './rarity';

const { color } = tokens;

/** Title, line and rarity colour for a choice. */
export function useChoiceText() {
  const { t } = useModuleTranslation('cs2');
  return (choice: SkinChoice) => {
    const title =
      choice.source === 'tournament' && choice.place !== null && choice.place !== undefined
        ? choice.place === 99
          ? t('skins.toastWhyMvp')
          : choice.place === 0
            ? t('skins.toastWhyPlayed')
            : t('skins.toastWhyPlace', {
                place: t('skins.prizesManage.placeN', { count: choice.place, ordinal: true }),
              })
        : choice.source === 'level' && /^level:\d+$/.test(choice.sourceRef ?? '')
          ? t('skins.toastWhyLevel', { level: Number(choice.sourceRef!.slice(6)) })
          : t('skins.toastWhyDrop');
    const rarity = bestRarity(choice.options.map((o) => o.rarity));
    return {
      title,
      line: t('skins.toastPick', { count: choice.options.length }),
      tone: rarityColor[rarity] ?? color.accent,
      rarity,
    };
  };
}

function PickButton({
  choiceId,
  onClick,
  testId,
}: {
  choiceId: number;
  onClick?: () => void;
  testId: string;
}) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Button
      variant="outlined"
      data-testid={testId}
      onClick={() => {
        onClick?.();
        openSkinPick(choiceId);
      }}
      sx={{
        minHeight: 36,
        px: 2,
        borderRadius: radii.pill,
        border: `2px solid ${color.rule}`,
        color: color.ink,
        fontSize: '14px',
        fontWeight: 600,
        flexShrink: 0,
        '&:hover': { border: `2px solid ${color.muted}`, bgcolor: 'transparent' },
      }}
    >
      {t('skins.toastChoose')}
    </Button>
  );
}

/** The bell's pinned rows: one per skin to pick, above every notice. */
export function PinnedSkinPicks({ onNavigate }: PinnedNoticesProps) {
  const { t } = useModuleTranslation('cs2');
  const enabled = useSkinsEnabled();
  const { choices } = useMySkins();
  const text = useChoiceText();
  if (!enabled || choices.length === 0) return null;
  return (
    <Box
      data-testid="bell-pinned-skins"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        p: 1,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      {choices.map((choice) => {
        const { title, line, tone } = text(choice);
        return (
          <Box
            key={choice.id}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0, 1fr) auto',
              alignItems: 'center',
              gap: 1.25,
              p: 1.25,
              borderRadius: radii.md,
              bgcolor: color.paper,
              border: `1px solid ${withAlpha(tone, 0.55)}`,
            }}
          >
            <Box
              component="span"
              aria-label={t('skins.pinned')}
              title={t('skins.pinned')}
              sx={{ display: 'inline-flex', color: tone }}
            >
              <PushPinIcon size={16} weight="fill" />
            </Box>
            <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              <Typography sx={{ fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.35 }}>
                {title}
              </Typography>
              <Typography sx={{ fontSize: '13px', lineHeight: 1.4, color: color.ink2 }}>
                {line}
              </Typography>
            </Box>
            <PickButton
              choiceId={choice.id}
              onClick={onNavigate}
              testId={`bell-pick-${choice.id}`}
            />
          </Box>
        );
      })}
    </Box>
  );
}

/** On the page where it was earned: "You earned a skin for playing · Pick". */
export function PrizePickRow({ matchSlug, tournamentId }: PrizePickRowProps) {
  const enabled = useSkinsEnabled();
  const { choices } = useMySkins();
  const text = useChoiceText();
  const here = choices.filter((c) => choiceFrom(c, { matchSlug, tournamentId }));
  if (!enabled || here.length === 0) return null;
  return (
    <Box data-testid="prize-pick-row" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {here.map((choice) => {
        const { title, line, tone } = text(choice);
        return (
          <Box
            key={choice.id}
            sx={{
              ...panelSx,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              p: 2,
              border: `1px solid ${withAlpha(tone, 0.55)}`,
            }}
          >
            <Box
              sx={{
                minWidth: 0,
                flex: '1 1 14rem',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.25,
              }}
            >
              <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
              <Typography sx={{ fontSize: '13px', color: color.ink2 }}>{line}</Typography>
            </Box>
            <PickButton choiceId={choice.id} testId={`prize-pick-${choice.id}`} />
          </Box>
        );
      })}
    </Box>
  );
}
