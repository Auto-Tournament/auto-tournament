import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Box,
  Paper,
  Typography,
  Chip,
  IconButton,
} from '@mui/material';
import {
  DragHandle as DragHandleIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import type { Map as MapType } from '../../types/api.types';

interface SortableMapListProps {
  maps: string[];
  availableMaps: MapType[];
  onMapsReorder: (newOrder: string[]) => void;
  onMapRemove?: (mapId: string) => void;
  disabled?: boolean;
}

interface SortableMapItemProps {
  mapId: string;
  index: number;
  displayName: string;
  onRemove?: (mapId: string) => void;
  disabled?: boolean;
}

function SortableMapItem({ mapId, index, displayName, onRemove, disabled }: SortableMapItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: mapId, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      elevation={isDragging ? 8 : 1}
      sx={{
        p: 2,
        mb: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        cursor: disabled ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
        bgcolor: isDragging ? 'action.selected' : 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        '&:hover': {
          bgcolor: disabled ? 'background.paper' : 'action.hover',
        },
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{
          display: 'flex',
          alignItems: 'center',
          color: 'text.secondary',
          cursor: disabled ? 'not-allowed' : 'grab',
          '&:active': {
            cursor: disabled ? 'not-allowed' : 'grabbing',
          },
        }}
      >
        <DragHandleIcon />
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flex: 1,
        }}
      >
        <Chip
          label={index + 1}
          size="small"
          color="primary"
          sx={{ minWidth: 32, fontWeight: 600 }}
        />
        <Typography variant="body1" fontWeight={500}>
          {displayName}
        </Typography>
      </Box>
      {onRemove && (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(mapId);
          }}
          disabled={disabled}
          sx={{
            color: 'text.secondary',
            '&:hover': {
              color: 'error.main',
              bgcolor: 'action.hover',
            },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </Paper>
  );
}

export function SortableMapList({
  maps,
  availableMaps,
  onMapsReorder,
  onMapRemove,
  disabled = false,
}: SortableMapListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getMapDisplayName = (mapId: string): string => {
    const map = availableMaps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = maps.indexOf(active.id as string);
      const newIndex = maps.indexOf(over.id as string);
      const newOrder = arrayMove(maps, oldIndex, newIndex);
      onMapsReorder(newOrder);
    }
  };

  if (maps.length === 0) {
    return null;
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Drag and drop to reorder maps. Maps will be played in this sequence.
      </Typography>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={maps} strategy={verticalListSortingStrategy}>
          {maps.map((mapId, index) => (
            <SortableMapItem
              key={mapId}
              mapId={mapId}
              index={index}
              displayName={getMapDisplayName(mapId)}
              onRemove={onMapRemove}
              disabled={disabled}
            />
          ))}
        </SortableContext>
      </DndContext>
    </Box>
  );
}

