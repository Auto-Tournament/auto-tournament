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
import { ManualMatchChooseModeStep } from './ManualMatchChooseModeStep';
import { ManualMatchBasicsStep } from './ManualMatchBasicsStep';
import { ManualMatchMapsRulesStep } from './ManualMatchMapsRulesStep';
import { ManualMatchMapsStep } from './ManualMatchMapsStep';
import { ManualMatchReviewStep } from './ManualMatchReviewStep';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
      teams,
      loadingTeams,
      saving,
      slug,
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
      // team1,
      // team2,
      requiredMaps,
      selectedMapsCount,
      hasVetoMapCountError,
      hasSeriesMapCountError,
      previewConfig,
      team1Mode,
      team2Mode,
      players,
      busyPlayerIds,
      busyTeamIds,
      team1NewPlayerIds,
      team2NewPlayerIds,
      team1NewName,
      team2NewName,
    },
    actions: {
      // setSlug,
      setTeam1Id,
      setTeam2Id,
      setMaps,
      // setSelectedMapPool,
      setPlayersPerTeam,
      setBestOf,
      // setKnifeMode,
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
      setTeam1Mode,
      setTeam2Mode,
      setTeam1NewPlayerIds,
      setTeam2NewPlayerIds,
      // setTeam1NewName,
      // setTeam2NewName,
    },
  } = useCreateManualMatchModal({ open, onCreated, onClose });

  return (
    <>
      <Dialog open={open} onClose={handleDialogClose} fullWidth maxWidth="sm" disableEscapeKeyDown>
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pr: 2,
          }}
        >
          <Typography variant="h6" component="span" fontWeight={600}>
            {t('manualMatchModal.title')}
          </Typography>
          <IconButton aria-label="close" onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 2 }}>
            <Step>
              <StepLabel>{t('manualMatchModal.steps.matchSetup')}</StepLabel>
            </Step>
            <Step>
              <StepLabel>{t('manualMatchModal.steps.rules')}</StepLabel>
            </Step>
            <Step>
              <StepLabel>{t('manualMatchModal.steps.maps')}</StepLabel>
            </Step>
            <Step>
              <StepLabel>{t('manualMatchModal.steps.teams')}</StepLabel>
            </Step>
            <Step>
              <StepLabel>{t('manualMatchModal.steps.review')}</StepLabel>
            </Step>
          </Stepper>

          <Stack spacing={2} mt={1}>
            <Typography variant="body2" color="text.secondary">
              {t('manualMatchModal.description')}
            </Typography>

            {activeStep === 0 && (
              <ManualMatchChooseModeStep
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onTemplateChange={handleTemplateChange}
              />
            )}

            {activeStep === 1 && (
              <ManualMatchMapsRulesStep
                activeStep={activeStep}
                useVeto={useVeto}
                onUseVetoChange={setUseVeto}
                bestOf={bestOf}
                onBestOfChange={(format) => setBestOf(format)}
                requiredMaps={requiredMaps}
                selectedMapsCount={selectedMapsCount}
                hasVetoMapCountError={hasVetoMapCountError}
                hasSeriesMapCountError={hasSeriesMapCountError}
                startingSide={startingSide}
                onStartingSideChange={setStartingSide}
                mapSideSelections={mapSideSelections}
                onMapSideSelectionsChange={(index, side) =>
                  setMapSideSelections((prev) => {
                    const next = [...prev];
                    next[index] = side;
                    return next as Array<'knife' | 'team1_ct' | 'team2_ct'>;
                  })
                }
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
              <ManualMatchMapsStep
                activeStep={activeStep}
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
              />
            )}

            {activeStep === 3 && (
              <ManualMatchBasicsStep
                submitAttempted={submitAttempted}
                teams={teams}
                team1Id={team1Id}
                team2Id={team2Id}
                onTeam1Change={setTeam1Id}
                onTeam2Change={setTeam2Id}
                loadingTeams={loadingTeams}
                team1Mode={team1Mode}
                team2Mode={team2Mode}
                onTeam1ModeChange={setTeam1Mode}
                onTeam2ModeChange={setTeam2Mode}
                playersPerTeam={playersPerTeam}
                players={players}
                busyPlayerIds={busyPlayerIds}
                busyTeamIds={busyTeamIds}
                team1NewPlayerIds={team1NewPlayerIds}
                onTeam1NewPlayerIdsChange={setTeam1NewPlayerIds}
                team2NewPlayerIds={team2NewPlayerIds}
                onTeam2NewPlayerIdsChange={setTeam2NewPlayerIds}
                team1NewName={team1NewName}
                team2NewName={team2NewName}
              />
            )}

            {activeStep === 4 && (
              <ManualMatchReviewStep
                slug={slug}
                config={previewConfig}
                onOpenSaveTemplate={handleOpenSaveTemplate}
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
            {t('common.cancel')}
          </Button>
          {activeStep === 0 && (
            <Button
              variant="contained"
              onClick={handleNextStep}
              disabled={saving}
            >
              {t('manualMatchModal.buttons.next')}
            </Button>
          )}
          {activeStep === 1 && (
            <>
              <Button onClick={() => setActiveStep(0)} disabled={saving}>
                {t('manualMatchModal.buttons.back')}
              </Button>
              <Button
                variant="contained"
                onClick={handleNextStep}
                disabled={saving}
              >
                {t('manualMatchModal.buttons.next')}
              </Button>
            </>
          )}
          {activeStep === 2 && (
            <>
              <Button onClick={() => setActiveStep(1)} disabled={saving}>
                {t('manualMatchModal.buttons.back')}
              </Button>
              <Button
                variant="contained"
                onClick={handleNextStep}
                disabled={saving || !previewConfig}
              >
                {t('manualMatchModal.buttons.next')}
              </Button>
            </>
          )}
          {activeStep === 3 && (
            <>
              <Button onClick={() => setActiveStep(2)} disabled={saving}>
                {t('manualMatchModal.buttons.back')}
              </Button>
              <Button
                variant="contained"
                onClick={handleNextStep}
                disabled={saving || !previewConfig}
              >
                {t('manualMatchModal.buttons.next')}
              </Button>
            </>
          )}
          {activeStep === 4 && (
            <>
              <Button onClick={() => setActiveStep(3)} disabled={saving}>
                {t('manualMatchModal.buttons.back')}
              </Button>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={saving || !previewConfig}
              >
                {saving
                  ? t('manualMatchModal.buttons.creating')
                  : t('manualMatchModal.buttons.create')}
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
        <DialogTitle>{t('manualMatchModal.saveTemplate.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField
              label={t('manualMatchModal.saveTemplate.nameLabel')}
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              fullWidth
              autoFocus
              helperText={t('manualMatchModal.saveTemplate.nameHelper')}
            />
            <Typography variant="body2" color="text.secondary">
              {t('manualMatchModal.saveTemplate.description')}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveTemplateDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveTemplate}
            disabled={!newTemplateName.trim() || maps.length === 0}
          >
            {t('manualMatchModal.saveTemplate.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
