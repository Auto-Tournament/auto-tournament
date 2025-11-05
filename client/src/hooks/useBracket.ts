import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { io, type Socket } from 'socket.io-client';
import type { Match, Tournament } from '../types';


export const useBracket = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [totalRounds, setTotalRounds] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startSuccess, setStartSuccess] = useState('');
  const [startError, setStartError] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);

  const loadBracket = async () => {
    setLoading(true);
    setError('');

    try {
      const response: {
        success: boolean;
        tournament?: Tournament;
        matches?: Match[];
        totalRounds?: number;
      } = await api.get('/api/tournament/bracket');

      if (response.success && response.tournament) {
        setTournament(response.tournament);
        setMatches(response.matches || []);
        setTotalRounds(response.totalRounds || 0);
      } else {
        // No tournament yet - not an error, just empty state
        setTournament(null);
        setMatches([]);
        setTotalRounds(0);
      }
    } catch (err) {
      const error = err as Error;
      // Handle 404 gracefully - tournament doesn't exist yet (empty state)
      if (error.message.includes('404') || error.message.includes('No tournament')) {
        setTournament(null);
        setMatches([]);
        setTotalRounds(0);
      } else {
        // Real error - network issue, server error, etc.
        setError(error.message || 'Failed to load bracket');
      }
    } finally {
      setLoading(false);
    }
  };

  const startTournament = async () => {
    setStarting(true);
    setStartError('');
    setStartSuccess('');

    try {
      const baseUrl = window.location.origin;
      const response: {
        success: boolean;
        message?: string;
        allocated?: number;
      } = await api.post('/api/tournament/start', { baseUrl });

      if (response.success) {
        setStartSuccess(
          `Tournament started! ${response.allocated || 0} matches allocated to servers.`
        );
        setTimeout(() => {
          setStartSuccess('');
        }, 5000);
        await loadBracket();
      } else {
        setStartError(response.message || 'Failed to start tournament');
      }
    } catch (err) {
      const error = err as Error;
      setStartError(error.message || 'Failed to start tournament');
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    loadBracket();

    // Setup Socket.IO connection
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('match_update', () => {
      loadBracket();
    });

    newSocket.on('bracket_update', () => {
      loadBracket();
    });

    return () => {
      newSocket.close();
    };
  }, []);

  return {
    loading,
    error,
    tournament,
    matches,
    totalRounds,
    starting,
    startSuccess,
    startError,
    socket,
    loadBracket,
    startTournament,
  };
};
