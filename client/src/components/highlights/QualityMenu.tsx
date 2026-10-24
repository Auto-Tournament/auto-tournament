/**
 * The highlight player's quality: Auto, the video as made (its highest
 * quality) or one of the lower ones the recorder cut from it.
 */
import { useState } from 'react';
import { ButtonBase, Menu, MenuItem } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { mono, radii } from '../../theme/tokens';
import type { QualityPick, VideoCut } from './qualitySource';

const cutName = (c: VideoCut) => `${c.height === 2160 ? '4K' : `${c.height}p`} · ${c.fps} fps`;

export function QualityMenu({
  cuts,
  pick,
  onPick,
  container,
}: {
  cuts: VideoCut[];
  pick: QualityPick;
  onPick: (pick: QualityPick) => void;
  container: HTMLElement | null;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = cuts.find((c) => c.url === pick);
  let label = t('videoHighlights.player.quality.auto');
  if (pick === 'highest') label = t('videoHighlights.player.quality.highest');
  else if (current) label = cutName(current);
  const options: Array<{ pick: QualityPick; text: string }> = [
    { pick: 'auto', text: t('videoHighlights.player.quality.auto') },
    { pick: 'highest', text: t('videoHighlights.player.quality.highest') },
    ...cuts.map((c) => ({ pick: c.url, text: cutName(c) })),
  ];
  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={t('videoHighlights.player.quality.label', { quality: label })}
        aria-haspopup="menu"
        data-testid="highlight-quality"
        sx={{
          height: 32,
          px: 1.5,
          borderRadius: radii.pill,
          border: '1px solid rgba(244,237,235,0.3)',
          color: '#f4edeb',
          ...mono,
          fontSize: '0.8125rem',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        container={container}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        data-testid="highlight-quality-menu"
      >
        {options.map((o) => (
          <MenuItem
            key={o.pick}
            selected={o.pick === pick}
            onClick={() => {
              setAnchor(null);
              onPick(o.pick);
            }}
          >
            {o.text}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
