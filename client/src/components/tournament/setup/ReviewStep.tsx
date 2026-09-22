import { Alert, Box, Button, Typography } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { useTranslation } from 'react-i18next';
import { TournamentReview } from '../TournamentReview';
import { TournamentFormActions } from '../TournamentFormActions';
import { ShufflePlayerRegistration } from '../ShufflePlayerRegistration';
import { ShuffleTournamentStats } from '../ShuffleTournamentStats';
import { ShuffleMapsCard } from '../ShuffleMapsCard';
import { deriveOvertimeOption } from '../ShuffleTournamentConfigStep';
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
    maps: string[];
    selectedTeams: string[];
    maxRounds: number;
    overtimeMode?: 'enabled' | 'disabled';
    overtimeSegments?: number | null;
    teamSize: number;
  };
  teams: Team[];
  mapName: (mapId: string) => string;
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

  const formActions = (
    <TournamentFormActions
      tournamentExists={!!tournament}
      saving={props.saving}
      hasChanges={props.hasChanges}
      type={form.type}
      format={form.format}
      mapsCount={form.maps.length}
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
          maps: tournament.maps,
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
          startIcon={<SaveIcon />}
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
function NewTournamentDetails({ form, teams, mapName, serverCount }: ReviewStepProps) {
  const { t } = useTranslation();
  const isShuffle = form.type === 'shuffle';
  const overtimeOption = deriveOvertimeOption(form.overtimeMode, form.overtimeSegments);
  const requiredServers = Math.max(1, Math.ceil(form.selectedTeams.length / 2));
  const hasEnoughServers = serverCount >= requiredServers;

  const overtimeLine =
    overtimeOption === 'enabled'
      ? t('tournament.matchRules.overtimeEnabled')
      : overtimeOption === 'disabledNoDraws'
        ? t('tournament.matchRules.overtimeDisabledNoDraws')
        : t('tournament.matchRules.overtimeDisabled');

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
    {
      key: 'rules',
      label: t('tournament.labels.matchRules'),
      value: [
        isShuffle
          ? t('tournament.wizard.roundLimitValue', { count: form.maxRounds })
          : t('tournament.matchRules.value', {
              maxRounds: form.maxRounds,
              winRounds: Math.floor(form.maxRounds / 2) + 1,
            }),
        overtimeLine,
        ...(isShuffle ? [t('tournament.matchRules.teamSizeValue', { size: form.teamSize })] : []),
      ].join(' · '),
    },
  ];

  if (!isShuffle) {
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
      value: t('tournament.wizard.playerRegistrationInfo', { count: form.maps.length }),
    });
  }

  rows.push({
    key: 'maps',
    label: t('tournament.wizard.mapsHeading', { total: form.maps.length }),
    value: form.maps.map(mapName).join(', ') || t('tournament.wizard.noMapsSelected'),
  });

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
      </Box>
    </Box>
  );
}
