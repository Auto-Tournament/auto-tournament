import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Chip,
  Stack,
  CircularProgress,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { api } from '../utils/api';
import type { TournamentTemplate } from '../types/tournament.types';

const TOURNAMENT_TYPE_LABELS: Record<string, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  round_robin: 'Round Robin',
  swiss: 'Swiss',
};

const FORMAT_LABELS: Record<string, string> = {
  bo1: 'BO1',
  bo3: 'BO3',
  bo5: 'BO5',
};

export default function Templates() {
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<TournamentTemplate | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TournamentTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    document.title = 'Tournament Templates';
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<{ success: boolean; templates: TournamentTemplate[] }>(
        '/api/templates'
      );
      if (response.success) {
        setTemplates(response.templates);
      }
    } catch (err) {
      setError('Failed to load templates');
      console.error('Error loading templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!templateToDelete) return;

    try {
      await api.delete(`/api/templates/${templateToDelete.id}`);
      setSuccess(`Template "${templateToDelete.name}" deleted successfully`);
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
      loadTemplates();
    } catch (err) {
      setError('Failed to delete template');
      console.error('Error deleting template:', err);
    }
  };

  const handleEdit = (template: TournamentTemplate) => {
    setEditingTemplate(template);
    setEditName(template.name);
    setEditDescription(template.description || '');
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingTemplate) return;

    try {
      await api.put(`/api/templates/${editingTemplate.id}`, {
        name: editName,
        description: editDescription || undefined,
      });
      setSuccess(`Template "${editName}" updated successfully`);
      setEditDialogOpen(false);
      setEditingTemplate(null);
      loadTemplates();
    } catch (err) {
      setError('Failed to update template');
      console.error('Error updating template:', err);
    }
  };

  const handleCreateFromTemplate = (template: TournamentTemplate) => {
    // Navigate to tournament page with template data
    const params = new URLSearchParams({
      template: template.id.toString(),
    });
    window.location.href = `/tournament?${params.toString()}`;
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight={600}>
          Tournament Templates
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => (window.location.href = '/tournament?saveTemplate=true')}
        >
          Create Template
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {templates.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="body1" color="text.secondary" align="center" py={4}>
              No templates yet. Create your first template from the Tournament page.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {templates.map((template) => (
            <Grid item xs={12} md={6} key={template.id}>
              <Card>
                <CardContent>
                  <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {template.name}
                      </Typography>
                      {template.description && (
                        <Typography variant="body2" color="text.secondary" mt={0.5}>
                          {template.description}
                        </Typography>
                      )}
                    </Box>
                    <Box>
                      <IconButton
                        size="small"
                        onClick={() => handleEdit(template)}
                        sx={{ mr: 0.5 }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          setTemplateToDelete(template);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                  <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" gap={1}>
                    <Chip
                      label={TOURNAMENT_TYPE_LABELS[template.type] || template.type}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    <Chip
                      label={FORMAT_LABELS[template.format] || template.format}
                      size="small"
                      color="secondary"
                      variant="outlined"
                    />
                    {template.maps.length > 0 && (
                      <Chip
                        label={`${template.maps.length} map${template.maps.length !== 1 ? 's' : ''}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Stack>

                  <Button
                    variant="contained"
                    fullWidth
                    startIcon={<CopyIcon />}
                    onClick={() => handleCreateFromTemplate(template)}
                  >
                    Create Tournament from Template
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Template</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the template "{templateToDelete?.name}"? This action
            cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Template</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Template Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Description (optional)"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            margin="normal"
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveEdit} variant="contained" disabled={!editName.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

