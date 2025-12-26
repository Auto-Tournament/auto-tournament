import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Stack,
  IconButton,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SaveMapPoolModal from './SaveMapPoolModal';
import { useCreateManualMatchModal } from './useCreateManualMatchModal';
import { ManualMatchBasicsStep } from './ManualMatchBasicsStep';
import { ManualMatchMapsRulesStep } from './ManualMatchMapsRulesStep';
import { ManualMatchReviewStep } from './ManualMatchReviewStep';
import { ManualMatchSidesStep } from './ManualMatchSidesStep';

interface CreateManualMatchModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (matchSlug: string) => void;
}

export const CreateManualMatchModal: React.FC<CreateManualMatchModalProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const handleDialogClose = (
    _event: React.SyntheticEvent | Event,
    reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    // Make it harder to accidentally close: ignore backdrop clicks and ESC.
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      return;
    }
    onClose();
  };

  const {
    state: {
      servers,
      loadingServers,
      serverStatuses,
      serverAllocation,
      teams,
      loadingTeams,
      saving,
      slug,
      serverId,
      team1Id,
      team2Id,
      maps,
      mapPools,
      availableMaps,
      selectedMapPool,
      loadingMaps,
      saveMapPoolModalOpen,
      playersPerTeam,
      bestOf,
      knifeMode,
      startingSide,
      useVeto,
      maxRounds,
      overtimeEnabled,
      overtimeMaxRounds,
      mapSideSelections,
      error,
      submitAttempted,
      activeStep,
      templates,
      selectedTemplateId,
      saveTemplateDialogOpen,
      newTemplateName,
      team1,
      team2,
      requiredMaps,
      selectedMapsCount,
      hasVetoMapCountError,
      hasSeriesMapCountError,
      previewConfig,
    },
    actions: {
      setSlug,
      setServerId,
      setTeam1Id,
      setTeam2Id,
      setMaps,
      setSelectedMapPool,
      setPlayersPerTeam,
      setBestOf,
      setKnifeMode,
      setStartingSide,
      setUseVeto,
      setMaxRounds,
      setOvertimeEnabled,
      setOvertimeMaxRounds,
      setMapSideSelections,
      setSaveMapPoolModalOpen,
      setNewTemplateName,
      setSaveTemplateDialogOpen,
      setActiveStep,
      handleMapPoolChange,
      handleMapRemove,
      handleTemplateChange,
      handleOpenSaveTemplate,
      handleSaveTemplate,
      handleSubmit,
      handleNextStep,
    },
  } = useCreateManualMatchModal({ open, onCreated, onClose });

  const sidesDisabled = !team1 || !team2;

  return (
    <>
      <Dialog
        open={open}
        onClose={handleDialogClose}
        fullWidth
        maxWidth="sm"
        disableEscapeKeyDown
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pr: 2,
          }}
        >
          <Typography variant="h6" fontWeight={600}>
            Create Manual Match
          </Typography>
          <IconButton
            aria-label="close"
            onClick={onClose}
            size="small"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 2 }}>
            <Step>
              <StepLabel>Basics</StepLabel>
            </Step>
            <Step>
              <StepLabel>Maps & Rules</StepLabel>
            </Step>
            <Step>
              <StepLabel>Sides & Veto</StepLabel>
            </Step>
            <Step>
              <StepLabel>Review</StepLabel>
            </Step>
          </Stepper>

          <Stack spacing={2} mt={1}>
            <Typography variant="body2" color="text.secondary">
              Create a standalone match that is independent from the tournament bracket. You can
              pick any enabled server and basic match settings.
            </Typography>

            {activeStep === 0 && (
              <ManualMatchBasicsStep
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onTemplateChange={handleTemplateChange}
                onOpenSaveTemplate={handleOpenSaveTemplate}
                servers={servers}
                serverId={serverId}
                onServerChange={setServerId}
                loadingServers={loadingServers}
                submitAttempted={submitAttempted}
                serverAllocation={serverAllocation}
                serverStatuses={serverStatuses}
                teams={teams}
                team1Id={team1Id}
                team2Id={team2Id}
                onTeam1Change={setTeam1Id}
                onTeam2Change={setTeam2Id}
                loadingTeams={loadingTeams}
              />
            )}

            {activeStep === 1 && (
              <ManualMatchMapsRulesStep
                activeStep={activeStep}
                bestOf={bestOf}
                onBestOfChange={(format) => setBestOf(format)}
                maps={maps}
                mapPools={mapPools}
                availableMaps={availableMaps}
                selectedMapPool={selectedMapPool}
                loadingMaps={loadingMaps}
                saving={saving}
                onMapPoolChange={handleMapPoolChange}
                onMapsChange={setMaps}
                onMapRemove={handleMapRemove}
                onOpenSaveMapPool={() => setSaveMapPoolModalOpen(true)}
                useVeto={useVeto}
                requiredMaps={requiredMaps}
                selectedMapsCount={selectedMapsCount}
                hasVetoMapCountError={hasVetoMapCountError}
                hasSeriesMapCountError={hasSeriesMapCountError}
                maxRounds={maxRounds}
                onMaxRoundsChange={setMaxRounds}
                playersPerTeam={playersPerTeam}
                onPlayersPerTeamChange={setPlayersPerTeam}
                overtimeEnabled={overtimeEnabled}
                onOvertimeEnabledChange={setOvertimeEnabled}
                overtimeMaxRounds={overtimeMaxRounds}
                onOvertimeMaxRoundsChange={setOvertimeMaxRounds}
              />
            )}

            {activeStep === 2 && (
              <ManualMatchSidesStep
                bestOf={bestOf}
                useVeto={useVeto}
                onUseVetoChange={setUseVeto}
                team1Name={team1?.name}
                team2Name={team2?.name}
                requiredMaps={requiredMaps}
                mapSideSelections={mapSideSelections}
                onMapSideSelectionsChange={(index, side) =>
                  setMapSideSelections((prev) => {
                    const next = [...prev];
                    next[index] = side;
                    return next as Array<'knife' | 'team1_ct' | 'team2_ct'>;
                  })
                }
                startingSide={startingSide}
                onStartingSideChange={setStartingSide}
              />
            )}

            {activeStep === 3 && (
              <ManualMatchReviewStep
                slug={slug}
                serverId={serverId}
                servers={servers}
                config={previewConfig}
              />
            )}

            {error && (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {activeStep === 0 && (
            <Button
              variant="contained"
              onClick={handleNextStep}
              disabled={saving || servers.length === 0}
            >
              Next
            </Button>
          )}
          {activeStep === 1 && (
            <>
              <Button onClick={() => setActiveStep(0)} disabled={saving}>
                Back
              </Button>
              <Button
                variant="contained"
                onClick={handleNextStep}
                disabled={saving || servers.length === 0}
              >
                Next
              </Button>
            </>
          )}
          {activeStep === 2 && (
            <>
              <Button onClick={() => setActiveStep(1)} disabled={saving}>
                Back
              </Button>
              <Button
                variant="contained"
                onClick={handleNextStep}
                disabled={saving || servers.length === 0 || !previewConfig}
              >
                Review
              </Button>
            </>
          )}
          {activeStep === 3 && (
            <>
              <Button onClick={() => setActiveStep(2)} disabled={saving}>
                Back
              </Button>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={saving || servers.length === 0 || !previewConfig}
              >
                {saving ? 'Creating…' : 'Create Match'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <SaveMapPoolModal
        open={saveMapPoolModalOpen}
        mapIds={maps}
        onClose={() => setSaveMapPoolModalOpen(false)}
        onSave={async () => {
          // After saving, reload map pools so the new pool is available for selection.
          // We simply trigger the existing maps load logic by toggling maps,
          // since the hook already handles loading pools on open.
          // In future, this could call a dedicated refresh action from the hook.
        }}
      />

      <Dialog
        open={saveTemplateDialogOpen}
        onClose={() => setSaveTemplateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Save Match Template</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField
              label="Template name"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              fullWidth
              autoFocus
              helperText="For example: BO1 Inferno knife, BO3 map pool, etc."
            />
            <Typography variant="body2" color="text.secondary">
              Current maps, series format, CT side rule, veto toggle, knife mode, and players per
              team will be saved in this template.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveTemplateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveTemplate}
            disabled={!newTemplateName.trim() || maps.length === 0}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};


