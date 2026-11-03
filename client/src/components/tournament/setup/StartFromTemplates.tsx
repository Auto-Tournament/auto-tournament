/**
 * Step 1's "Start from" (Claude Design "Tournament settings with esports preset", Setup › Game):
 * Blank, the game module's built-in templates (CS2: Valve official esports), then the site's
 * saved ones. Picking one fills in the steps after it; every one of them can still change it.
 */
import { useState } from 'react';
import { Box, ButtonBase, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TournamentTemplate } from '../../../types/tournament.types';
import { mono, radii, tokens } from '../../../theme/tokens';
import { DEFAULT_FORM } from './tournamentForm';

function Card({
  name,
  tag,
  tagAccent,
  help,
  facts,
  picked,
  onPick,
}: {
  name: string;
  tag: string;
  tagAccent: boolean;
  help: string;
  facts: string[];
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <ButtonBase
      role="radio"
      aria-checked={picked}
      aria-label={name}
      onClick={onPick}
      data-testid="tournament-start-from-card"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        textAlign: 'left',
        gap: 1,
        p: 2,
        borderRadius: radii.lg,
        border: `2px solid ${picked ? tokens.color.accent : tokens.color.rule}`,
        bgcolor: tokens.color.paper2,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography fontWeight={600}>{name}</Typography>
        <Typography
          component="span"
          sx={{
            ...mono,
            fontSize: 11,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: tagAccent ? 'primary.main' : 'text.secondary',
          }}
        >
          {tag}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {help}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {facts.map((f) => (
          <Box
            key={f}
            component="span"
            sx={{ fontSize: 12, px: 1.1, py: 0.4, borderRadius: 999, bgcolor: tokens.color.paper3 }}
          >
            {f}
          </Box>
        ))}
      </Box>
    </ButtonBase>
  );
}

export function StartFromTemplates({
  templates,
  onPick,
}: {
  templates: TournamentTemplate[];
  onPick: (template: TournamentTemplate | null) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<number | 'blank'>('blank');
  const factsOf = (type: string, format: string) => [
    t(`tournament.typeSelector.types.${type}.label`, { defaultValue: type }),
    format.charAt(0).toUpperCase() + format.slice(1),
  ];
  return (
    <Box sx={{ display: 'grid', gap: 1.5, mt: 3 }} data-testid="tournament-start-from">
      <Box>
        <Typography component="h2" variant="h6" fontWeight={600}>
          {t('tournament.setup.startFrom.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('tournament.setup.startFrom.help')}
        </Typography>
      </Box>
      <Box
        role="radiogroup"
        aria-label={t('tournament.setup.startFrom.title')}
        sx={{
          display: 'grid',
          gap: 1.75,
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        }}
      >
        <Card
          name={t('tournament.setup.startFrom.blank')}
          tag={t('tournament.setup.startFrom.siteDefaults')}
          tagAccent={false}
          help={t('tournament.setup.startFrom.blankHelp')}
          facts={[
            ...factsOf(DEFAULT_FORM.type, DEFAULT_FORM.format),
            t('tournament.setup.startFrom.standardRules'),
          ]}
          picked={picked === 'blank'}
          onPick={() => {
            setPicked('blank');
            onPick(null);
          }}
        />
        {templates.map((tpl) => (
          <Card
            key={tpl.id}
            name={tpl.name}
            tag={t(
              tpl.id < 0 ? 'tournament.setup.startFrom.builtIn' : 'tournament.setup.startFrom.saved'
            )}
            tagAccent={tpl.id < 0}
            help={tpl.description ?? ''}
            facts={[...factsOf(tpl.type, tpl.format), ...(tpl.facts ?? [])]}
            picked={picked === tpl.id}
            onPick={() => {
              setPicked(tpl.id);
              onPick(tpl);
            }}
          />
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary">
        <Trans
          t={t}
          i18nKey="tournament.setup.startFrom.ownTemplates"
          components={{ link: <Link component={RouterLink} to="/manage/templates" /> }}
        />
      </Typography>
    </Box>
  );
}
