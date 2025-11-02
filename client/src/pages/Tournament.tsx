import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Container, Alert, CircularProgress } from '@mui/material';
import { TournamentStepper } from '../components/tournament/TournamentStepper';
import { TournamentForm } from '../components/tournament/TournamentForm';
import { TournamentReview } from '../components/tournament/TournamentReview';
import { TournamentLive } from '../components/tournament/TournamentLive';
import { TournamentDialogs } from '../components/tournament/TournamentDialogs';
import TournamentChangePreviewModal from '../components/modals/TournamentChangePreviewModal';
import { useTournament } from '../hooks/useTournament';
import { validateTeamCountForType } from '../utils/tournamentValidation';

interface TournamentChange {
  field: string;
  label?: string;
  oldValue?: string | string[];
  newValue?: string | string[];
  from?: string | string[];
  to?: string | string[];
}

const Tournament: React.FC = () => {
  const navigate = useNavigate();
  const {
    tournament,
    teams,
    loading,
    error,
    setError,
    saveTournament,
    deleteTournament,
    regenerateBracket,
    resetTournament,
    startTournament,
    refreshData,
  } = useTournament();

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState('single_elimination');
  const [format, setFormat] = useState('bo3');
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [maps, setMaps] = useState<string[]>([]);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);

  // Action state
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [success, setSuccess] = useState('');

  // Dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showChangePreview, setShowChangePreview] = useState(false);
  const [changes, setChanges] = useState<TournamentChange[]>([]);

  // Sync tournament data to form when loaded
  React.useEffect(() => {
    if (tournament) {
      setName(tournament.name);
      setType(tournament.type);
      setFormat(tournament.format);
      setSelectedTeams(tournament.teamIds || []);
      setMaps(tournament.maps || []);
      setIsEditing(false); // Close edit mode when tournament loads
    } else {
      setIsEditing(true); // Show form when creating new tournament
    }
  }, [tournament]);

  // Determine current step
  const getCurrentStep = (): number => {
    if (!tournament) return 0;
    if (tournament.status === 'setup') return 1;
    if (tournament.status === 'in_progress' || tournament.status === 'completed') return 2;
    return 1;
  };

  const canEdit = !tournament || tournament.status === 'setup';

  // Check if form has changes compared to tournament
  const hasChanges = (): boolean => {
    if (!tournament) return true; // Creating new tournament

    if (name !== tournament.name) return true;
    if (type !== tournament.type) return true;
    if (format !== tournament.format) return true;
    if (JSON.stringify(selectedTeams.sort()) !== JSON.stringify(tournament.teamIds.sort()))
      return true;
    if (JSON.stringify(maps.sort()) !== JSON.stringify(tournament.maps.sort())) return true;

    return false;
  };

  const handleSave = async () => {
    // Validate before saving
    const validation = validateTeamCountForType(type, selectedTeams.length);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid team count');
      return;
    }

    if (!name.trim()) {
      setError('Tournament name is required');
      return;
    }

    if (selectedTeams.length === 0) {
      setError('Please select at least 2 teams');
      return;
    }

    if (maps.length === 0) {
      setError('Please select at least 1 map');
      return;
    }

    // Check for changes if editing
    if (tournament) {
      const detectedChanges: TournamentChange[] = [];

      if (name !== tournament.name) {
        detectedChanges.push({
          field: 'name',
          label: 'Tournament Name',
          oldValue: tournament.name,
          newValue: name,
        });
      }
      if (type !== tournament.type) {
        detectedChanges.push({
          field: 'type',
          label: 'Tournament Type',
          oldValue: tournament.type,
          newValue: type,
        });
      }
      if (format !== tournament.format) {
        detectedChanges.push({
          field: 'format',
          label: 'Match Format',
          oldValue: tournament.format,
          newValue: format,
        });
      }
      if (JSON.stringify(selectedTeams.sort()) !== JSON.stringify(tournament.teamIds.sort())) {
        const oldTeams = teams.filter((t) => tournament.teamIds.includes(t.id)).map((t) => t.name);
        const newTeams = teams.filter((t) => selectedTeams.includes(t.id)).map((t) => t.name);
        detectedChanges.push({
          field: 'teamIds',
          label: 'Teams',
          oldValue: oldTeams,
          newValue: newTeams,
        });
      }
      if (JSON.stringify(maps.sort()) !== JSON.stringify(tournament.maps.sort())) {
        detectedChanges.push({
          field: 'maps',
          label: 'Map Pool',
          oldValue: tournament.maps,
          newValue: maps,
        });
      }

      if (detectedChanges.length > 0) {
        setChanges(detectedChanges);
        setShowChangePreview(true);
        return;
      }
    }

    // No changes or creating new tournament
    await saveChanges();
  };

  const saveChanges = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    setShowChangePreview(false);

    try {
      const payload = {
        name,
        type,
        format,
        maps,
        teamIds: selectedTeams,
        settings: { seedingMethod: 'random' },
      };

      const response = await saveTournament(payload);

      if (response.success) {
        setSuccess(
          tournament ? 'Tournament updated & brackets regenerated!' : 'Tournament created!'
        );
        await refreshData();
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(response.error || 'Failed to save tournament');
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to save tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError('');
    setShowDeleteConfirm(false);

    try {
      await deleteTournament();
      setSuccess('Tournament deleted successfully');
      setTimeout(() => setSuccess(''), 3000);
      await refreshData();
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to delete tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setSaving(true);
    setError('');
    setShowRegenerateConfirm(false);

    try {
      await regenerateBracket(true);
      setSuccess('Brackets regenerated successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to regenerate brackets');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError('');
    setShowResetConfirm(false);

    try {
      await resetTournament();
      setSuccess('Tournament reset to setup mode');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to reset tournament');
    } finally {
      setSaving(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setError('');
    setShowStartConfirm(false);

    try {
      const baseUrl = window.location.origin;
      const response = await startTournament(baseUrl);

      if (response.success) {
        setSuccess(`Tournament started! ${response.allocated} matches allocated to servers`);
        setTimeout(() => {
          setSuccess('');
          navigate('/bracket');
        }, 2000);
      } else {
        setError(response.message || 'Failed to start tournament');
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to start tournament');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Stepper */}
      <TournamentStepper currentStep={getCurrentStep()} />

      {/* Feedback Messages */}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* Step 1: Create/Edit Tournament */}
      {(!tournament || (tournament.status === 'setup' && isEditing)) && (
        <TournamentForm
          name={name}
          type={type}
          format={format}
          selectedTeams={selectedTeams}
          maps={maps}
          teams={teams}
          canEdit={canEdit}
          saving={saving}
          tournamentExists={!!tournament}
          hasChanges={hasChanges()}
          onNameChange={setName}
          onTypeChange={setType}
          onFormatChange={setFormat}
          onTeamsChange={setSelectedTeams}
          onMapsChange={setMaps}
          onSave={handleSave}
          onCancel={() => {
            // Reset form to tournament values
            if (tournament) {
              setName(tournament.name);
              setType(tournament.type);
              setFormat(tournament.format);
              setSelectedTeams(tournament.teamIds || []);
              setMaps(tournament.maps || []);
            }
            setIsEditing(false);
          }}
          onDelete={() => setShowDeleteConfirm(true)}
        />
      )}

      {/* Step 2: Review & Start (tournament is in 'setup' mode after creation) */}
      {tournament && tournament.status === 'setup' && !isEditing && (
        <TournamentReview
          tournament={{
            name: tournament.name,
            type: tournament.type,
            format: tournament.format,
            teams: tournament.teams || [],
            maps: tournament.maps,
          }}
          starting={starting}
          saving={saving}
          onEdit={() => setIsEditing(true)}
          onStart={() => setShowStartConfirm(true)}
          onViewBracket={() => navigate('/bracket')}
          onRegenerate={() => setShowRegenerateConfirm(true)}
          onDelete={() => setShowDeleteConfirm(true)}
        />
      )}

      {/* Step 3: Live Tournament */}
      {tournament && (tournament.status === 'in_progress' || tournament.status === 'completed') && (
        <TournamentLive
          tournament={{
            name: tournament.name,
            type: tournament.type,
            format: tournament.format,
            status: tournament.status,
            teams: tournament.teams || [],
          }}
          saving={saving}
          onViewBracket={() => navigate('/bracket')}
          onReset={() => setShowResetConfirm(true)}
          onDelete={() => setShowDeleteConfirm(true)}
        />
      )}

      {/* Dialogs */}
      <TournamentDialogs
        deleteOpen={showDeleteConfirm}
        regenerateOpen={showRegenerateConfirm}
        resetOpen={showResetConfirm}
        startOpen={showStartConfirm}
        tournamentName={tournament?.name}
        tournamentStatus={tournament?.status}
        onDeleteConfirm={handleDelete}
        onDeleteCancel={() => setShowDeleteConfirm(false)}
        onRegenerateConfirm={handleRegenerate}
        onRegenerateCancel={() => setShowRegenerateConfirm(false)}
        onResetConfirm={handleReset}
        onResetCancel={() => setShowResetConfirm(false)}
        onStartConfirm={handleStart}
        onStartCancel={() => setShowStartConfirm(false)}
      />

      <TournamentChangePreviewModal
        open={showChangePreview}
        changes={changes}
        isLive={tournament?.status === 'in_progress' || tournament?.status === 'completed'}
        onConfirm={saveChanges}
        onCancel={() => setShowChangePreview(false)}
      />
    </Container>
  );
};

export default Tournament;
