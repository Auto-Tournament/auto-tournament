import type { ReactNode } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { FloppyDiskIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { TournamentReview } from '../TournamentReview';
import { TournamentFormActions } from '../TournamentFormActions';
import { ShufflePlayerRegistration } from '../ShufflePlayerRegistration';
import { ShuffleTournamentStats } from '../ShuffleTournamentStats';
import { ShuffleMapsCard } from '../ShuffleMapsCard';
import { useIntegration } from '../../../integrations/registry';
import type { TournamentSetupRow } from '../../../integrations/types';
import type { Team } from '../../../types';

export interface ReviewTournament {
  id: number;
  name: string;
  type: string;
  format: string;
  teams: Array<{ id: string; name: string }>;
  maps: string[];
  teamSize?: number;
}

interface ReviewStepProps {
  tournament: ReviewTournament | null;
  /**
   * The game being set up, as `tournament.game` stores it. Decides which rows
   * this review has: a manually reported tournament has no servers to wait
   * for, no map pool and no round limit (3.0 phase D, PR D9).
   */
  game: string;
  canEdit: boolean;
  saving: boolean;
  starting: boolean;
  hasChanges: boolean;
  hasBracket: boolean;
  registeredPlayerCount?: number;
  /** Current form values, for the review of a tournament not created yet. */
  form: {
    name: string;
    type: string;
    format: string;
    selectedTeams: string[];
    teamSize: number;
  };
  /** The game module's review rows (CS2: match rules), from its setup model. */
  gameReviewRows: TournamentSetupRow[];
  /** The game module's own review lines that need its data (CS2: the maps by name). */
  gameReview: ReactNode;
  /**
   * Why the game's settings cannot be saved yet (CS2: the map pool does not
   * fit the format), or null.
   */
  gameSettingsError: string | null;
  /** Shuffle: rounds the game's settings give (CS2: one per map), or null. */
  roundCount: number | null;
  teams: Team[];
  serverCount: number;
  onSave: () => void;
  onDiscardChanges: () => void;
  onDelete: () => void;
  onSaveTemplate: () => void;
  onEdit: () => void;
  onStart: () => void;
  onRegenerate: () => void;
  onBulkCreateShuffleMatches: () => void;
  onPlayersUpdated: () => void;
}

/**
 * Last step. Before the tournament exists: what will be created, and the
 * Create button. Afterwards: the existing review card with Start, or the save
 * actions while there are unsaved edits (the tournament can't start from an
 * unsaved form).
 */
export function ReviewStep(props: ReviewStepProps) {
  const { t } = useTranslation();
  const { tournament, form } = props;
  const isShuffle = form.type === 'shuffle';
  const integration = useIntegration(props.game);
  const hasMaps = Boolean(integration.tournamentSetupSteps.content);

  const formActions = (
    <TournamentFormActions
      tournamentExists={!!tournament}
      saving={props.saving}
      hasChanges={props.hasChanges}
      settingsError={props.gameSettingsError}
      canEdit={props.canEdit}
      onSave={props.onSave}
      onCancel={tournament ? props.onDiscardChanges : undefined}
      onDelete={props.onDelete}
      onSaveTemplate={props.onSaveTemplate}
    />
  );

  if (!tournament) {
    return (
      <Box sx={{ display: 'grid', gap: 3 }}>
        <NewTournamentDetails {...props} />
        {formActions}
      </Box>
    );
  }

  if (props.hasChanges && props.canEdit) {
    return (
      <Box sx={{ display: 'grid', gap: 3 }}>
        <Alert severity="warning" data-testid="tournament-unsaved-changes">
          {t('tournament.setup.review.unsaved')}
        </Alert>
        {formActions}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {tournament.type === 'shuffle' && (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
          }}
        >
          <ShufflePlayerRegistration
            tournamentId={tournament.id}
            teamSize={tournament.teamSize || 5}
            onPlayersUpdated={props.onPlayersUpdated}
          />
          <ShuffleTournamentStats
            playerCount={props.registeredPlayerCount || 0}
            teamSize={tournament.teamSize || 5}
          />
          <ShuffleMapsCard maps={tournament.maps || []} />
        </Box>
      )}
      <TournamentReview
        tournament={{
          name: tournament.name,
          type: tournament.type,
          format: tournament.format,
          teams: tournament.teams || [],
          maps: hasMaps ? tournament.maps : [],
          teamSize: tournament.teamSize,
        }}
        starting={props.starting}
        saving={props.saving}
        registeredPlayerCount={isShuffle ? props.registeredPlayerCount : undefined}
        hasBracket={props.hasBracket}
        onEdit={props.canEdit ? props.onEdit : undefined}
        onStart={props.onStart}
        onRegenerate={props.onRegenerate}
        onDelete={props.onDelete}
        onBulkCreateShuffleMatches={
          tournament.type === 'shuffle' ? props.onBulkCreateShuffleMatches : undefined
        }
      />
      <Box>
        <Button
          variant="outlined"
          startIcon={<FloppyDiskIcon />}
          onClick={props.onSaveTemplate}
          disabled={props.saving}
        >
          {t('tournament.formActions.saveAsTemplate')}
        </Button>
      </Box>
    </Box>
  );
}

/** The old wizard's review, for a tournament that doesn't exist yet. */
function NewTournamentDetails({
  form,
  teams,
  serverCount,
  game,
  gameReviewRows,
  gameReview,
  roundCount,
}: ReviewStepProps) {
  const { t } = useTranslation();
  const isShuffle = form.type === 'shuffle';
  const integration = useIntegration(game);
  const hasServers = integration.capabilities.servers;
  const requiredServers = Math.max(1, Math.ceil(form.selectedTeams.length / 2));
  const hasEnoughServers = serverCount >= requiredServers;

  const rows: Array<{ key: string; label: string; value: string; tone?: 'warning' }> = [
    {
      key: 'name',
      label: t('tournament.review.summary.nameLabel'),
      value: form.name || t('tournament.review.summary.notSet'),
    },
    {
      key: 'type',
      label: t('tournament.review.summary.typeLabel'),
      value: t(`tournament.typeSelector.types.${form.type}.label`),
    },
    {
      key: 'format',
      label: t('tournament.review.summary.formatLabel'),
      value: form.format.toUpperCase(),
    },
    // The game's rows (CS2: rounds and overtime), with the shuffle team
    // size on its match rules line, where it has always been.
    ...gameReviewRows.map((row) =>
      isShuffle && row.key === 'rules'
        ? {
            ...row,
            value: `${row.value} · ${t('tournament.matchRules.teamSizeValue', { size: form.teamSize })}`,
          }
        : row
    ),
  ];

  if (!isShuffle) {
    if (hasServers) {
      rows.push({
        key: 'servers',
      label: t('tournament.labels.servers'),
      value: t(
        hasEnoughServers
          ? 'tournament.wizard.serversSummary'
          : 'tournament.wizard.serversSummaryQueued',
        {
          servers: t('tournament.counts.servers', { count: serverCount }),
          matches: t('tournament.counts.concurrentMatches', { count: requiredServers }),
        }
      ),
        tone: hasEnoughServers ? undefined : 'warning',
      });
    }
    rows.push({
      key: 'teams',
      label: t('tournament.wizard.teamsHeading', { total: form.selectedTeams.length }),
      value:
        form.selectedTeams.length > 0
          ? teams
              .filter((team) => form.selectedTeams.includes(team.id))
              .map((team) => team.name)
              .join(', ')
          : t('tournament.wizard.noTeamsSelected'),
    });
  } else {
    rows.push({
      key: 'players',
      label: t('tournament.wizard.playerRegistration'),
      value: t('tournament.wizard.playerRegistrationInfo', { count: roundCount ?? 0 }),
    });
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Alert severity="info">
        {t('tournament.review.summary.info', { button: t('tournament.common.createTournament') })}
      </Alert>
      <Box component="dl" sx={{ m: 0, display: 'grid', gap: 2 }}>
        {rows.map((row) => (
          <Box key={row.key}>
            <Typography component="dt" variant="body2" fontWeight={600}>
              {row.label}
            </Typography>
            <Typography
              component="dd"
              variant="body2"
              sx={{ m: 0, color: row.tone === 'warning' ? 'warning.main' : 'text.secondary' }}
            >
              {row.value}
            </Typography>
          </Box>
        ))}
        {gameReview}
      </Box>
    </Box>
  );
}
