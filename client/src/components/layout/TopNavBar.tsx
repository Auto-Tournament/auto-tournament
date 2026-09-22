import React from 'react';
import { AppBar, Toolbar } from '@mui/material';
import { SharedNavBar } from './SharedNavBar';

export const TopNavBar: React.FC = () => {
  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <SharedNavBar />
      </Toolbar>
    </AppBar>
  );
};

