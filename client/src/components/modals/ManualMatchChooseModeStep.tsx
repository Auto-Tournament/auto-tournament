import React from 'react';
import { Box, Card, CardActionArea, CardContent, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import type { MatchTemplate } from './useCreateManualMatchModal';

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
  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Typography variant="subtitle1" fontWeight={600}>
        How would you like to create this match?
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
              Choose template
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Load a preset for maps, format, and rules, then choose the teams.
            </Typography>
            <FormControl fullWidth disabled={templates.length === 0}>
              <InputLabel>Match template</InputLabel>
              <Select
                label="Match template"
                value={selectedTemplateId}
                onChange={(e) => onTemplateChange(e.target.value as string)}
              >
                <MenuItem value="">
                  <em>None</em>
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
                No templates saved yet. Configure a match and save it as a template.
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
                Create new match
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Configure maps, rules, sides, and teams from scratch.
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Box>

    </Box>
  );
};
