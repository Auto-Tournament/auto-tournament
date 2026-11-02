import type { ComponentProps } from 'react';
import {
  RatingChart as AtRatingChart,
  type RatingChartPoint,
  type RatingChartProps,
} from '@auto-tournament/ui';
import { useTranslation } from 'react-i18next';

export type { RatingChartPoint, RatingChartProps };

/** The design system's rating chart, in our translations. */
export function RatingChart(props: ComponentProps<typeof AtRatingChart>) {
  const { t, i18n } = useTranslation();
  return (
    <AtRatingChart
      locale={i18n.language}
      noHistoryText={t('playerPage.ratingChart.noHistory')}
      chartLabel={(from, to) => t('playerPage.ratingChart.ariaLabel', { from, to })}
      {...props}
    />
  );
}
