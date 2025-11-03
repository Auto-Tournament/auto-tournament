import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { io, type Socket } from 'socket.io-client';

interface Team {
  id: string;
  name: string;
  tag?: string;
}

interface PlayerStats {
  name: string;
  steamId: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshots: number;
}

export interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  status: 'pending' | 'ready' | 'live' | 'completed' | 'loaded';
  team1?: Team;
  team2?: Team;
  winner?: Team;
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  team1Score?: number;
  team2Score?: number;
  team1Players?: PlayerStats[];
  team2Players?: PlayerStats[];
  config?: {
    maplist?: string[];
    num_maps?: number;
    team1?: { name: string };
    team2?: { name: string };
  };
}

export interface Tournament {
  id: number;
  name: string;
  type: string;
  format: string;
  status: string;
  maps: string[];
  teamIds: string[];
  teams?: Team[];
}

export interface BracketData {
  tournament: Tournament;
  matches: Match[];
  totalRounds: number;
}

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
        setError('No tournament found. Please create a tournament first.');
      }
    } catch (err) {
      const error = err as Error;
      // Handle 404 more gracefully - tournament doesn't exist yet
      if (error.message.includes('404') || error.message.includes('No tournament')) {
        setError('No tournament has been created yet. Create one to view the bracket.');
      } else {
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
