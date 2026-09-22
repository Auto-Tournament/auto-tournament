import React from 'react';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import type { MatchTemplate } from './useCreateManualMatchModal';
import { useTranslation } from 'react-i18next';

interface ManualMatchChooseModeStepProps {
  templates: MatchTemplate[];
  selectedTemplateId: string;
  onTemplateChange: (templateId: string) => void;
}

export const ManualMatchChooseModeStep: React.FC<ManualMatchChooseModeStepProps> = ({
  templates,
  selectedTemplateId,
  onTemplateChange,
}) => {
  const { t } = useTranslation();

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Typography variant="subtitle1" fontWeight={600}>
        {t('manualMatchModal.chooseMode.heading')}
      </Typography>

      <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={2}>
        <Card
          variant="outlined"
          sx={{
            flex: 1,
          }}
        >
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {t('manualMatchModal.chooseMode.template.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('manualMatchModal.chooseMode.template.description')}
            </Typography>
            <FormControl fullWidth disabled={templates.length === 0}>
              <InputLabel>{t('manualMatchModal.chooseMode.template.label')}</InputLabel>
              <Select
                label={t('manualMatchModal.chooseMode.template.label')}
                value={selectedTemplateId}
                onChange={(e) => onTemplateChange(e.target.value as string)}
              >
                <MenuItem value="">
                  <em>{t('manualMatchModal.chooseMode.template.none')}</em>
                </MenuItem>
                {templates.map((template) => (
                  <MenuItem key={template.id} value={template.id}>
                    {template.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {templates.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                {t('manualMatchModal.chooseMode.template.empty')}
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card
          variant="outlined"
          sx={{
            flex: 1,
            borderColor: selectedTemplateId === '' ? 'primary.main' : 'divider',
          }}
        >
          <CardActionArea
            onClick={() => {
              // Clear template selection to indicate a fresh custom setup.
              onTemplateChange('');
            }}
            sx={{ height: '100%' }}
          >
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t('manualMatchModal.chooseMode.custom.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('manualMatchModal.chooseMode.custom.description')}
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Box>

    </Box>
  );
};
