import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Description as DescriptionIcon,
  EmojiEvents as EmojiEventsIcon,
} from '@mui/icons-material';
import { api } from '../../utils/api';
import type { TournamentTemplate } from '../../types/tournament.types';

interface TournamentWelcomeScreenProps {
  onCreateNew: () => void;
  onLoadTemplate: (template: TournamentTemplate) => void;
}

export function TournamentWelcomeScreen({
  onCreateNew,
  onLoadTemplate,
}: TournamentWelcomeScreenProps) {
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await api.get<{ success: boolean; templates: TournamentTemplate[] }>(
        '/api/templates'
      );
      if (response.success) {
        setTemplates(response.templates);
      }
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadTemplate = () => {
    if (selectedTemplateId) {
      const template = templates.find((t) => t.id === selectedTemplateId);
      if (template) {
        onLoadTemplate(template);
      }
    }
  };

  return (
    <Card>
      <CardContent>
        <Box textAlign="center" mb={4}>
          <EmojiEventsIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" fontWeight={600} gutterBottom>
            Create Tournament
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Choose how you'd like to create your tournament
          </Typography>
        </Box>

        <Grid container spacing={3} justifyContent="center">
          <Grid item xs={12} sm={templates.length > 0 && !loading ? 6 : 12}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: 'primary.main',
                  boxShadow: 2,
                },
              }}
              onClick={onCreateNew}
            >
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <AddIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  Create New Tournament
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Start from scratch and configure all tournament settings manually
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {!loading && templates.length > 0 && (
            <Grid item xs={12} sm={6}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Box textAlign="center" mb={3}>
                    <DescriptionIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      Load from Template
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={3}>
                      Use a saved template to quickly create a tournament
                    </Typography>
                  </Box>

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Select Template</InputLabel>
                    <Select
                      value={selectedTemplateId}
                      label="Select Template"
                      onChange={(e) => setSelectedTemplateId(e.target.value as number | '')}
                    >
                      {templates.map((template) => (
                        <MenuItem key={template.id} value={template.id}>
                          {template.name}
                          {template.description && ` - ${template.description}`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={handleLoadTemplate}
                    disabled={!selectedTemplateId}
                  >
                    Load Template
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          )}

          {loading && (
            <Grid item xs={12} sm={6}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Box textAlign="center" mb={3}>
                    <DescriptionIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      Load from Template
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={3}>
                      Use a saved template to quickly create a tournament
                    </Typography>
                  </Box>
                  <Box display="flex" justifyContent="center" py={2}>
                    <CircularProgress size={24} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
}

