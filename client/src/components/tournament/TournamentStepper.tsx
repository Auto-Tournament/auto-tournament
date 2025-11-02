import React from 'react';
import { Card, CardContent, Stepper, Step, StepLabel } from '@mui/material';

interface TournamentStepperProps {
  currentStep: number;
}

export const TournamentStepper: React.FC<TournamentStepperProps> = ({ currentStep }) => {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stepper activeStep={currentStep} alternativeLabel>
          <Step>
            <StepLabel>Create Tournament</StepLabel>
          </Step>
          <Step>
            <StepLabel>Review & Confirm</StepLabel>
          </Step>
          <Step>
            <StepLabel>Live Tournament</StepLabel>
          </Step>
        </Stepper>
      </CardContent>
    </Card>
  );
};
