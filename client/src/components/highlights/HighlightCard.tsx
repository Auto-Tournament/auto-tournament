import type { ComponentProps } from 'react';
import {
  FavouriteChip as AtFavouriteChip,
  HighlightCard as AtHighlightCard,
} from '@auto-tournament/ui';
import { useTranslation } from 'react-i18next';

export {
  VideoThumb,
  CLIP_THUMB_AT,
  REEL_THUMB_AT,
  thumbAt,
  RecordingDot,
  RecordingCard,
  type HighlightCardProps,
} from '@auto-tournament/ui';

/** The design system's clip card, in our translations. */
export function HighlightCard(props: ComponentProps<typeof AtHighlightCard>) {
  const { t } = useTranslation();
  return (
    <AtHighlightCard
      labels={{
        favourite: t('videoHighlights.makeFavourite'),
        unfavourite: t('videoHighlights.unfavourite'),
      }}
      {...props}
    />
  );
}

export function FavouriteChip() {
  const { t } = useTranslation();
  return <AtFavouriteChip label={t('videoHighlights.favourite')} />;
}
