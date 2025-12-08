export interface AdminCommand {
  id: string;
  label: string;
  command: string;
  description?: string;
  requiresInput?: boolean;
  inputLabel?: string;
  inputType?: 'text' | 'number';
  color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  icon?: string;
}

export interface AdminCommandCategory {
  id: string;
  title: string;
  icon: string;
  commands: AdminCommand[];
}

export const ADMIN_COMMAND_CATEGORIES: AdminCommandCategory[] = [
  {
    id: 'match-control',
    title: 'Match Control',
    icon: 'play',
    commands: [
      {
        id: 'match-start',
        label: 'Start Match',
        command: 'start',
        description: 'Start the match immediately',
        color: 'success',
      },
      {
        id: 'match-end',
        label: 'End Match (css_restart)',
        command: 'restart',
        description:
          'Force end the current match on the selected server(s) and reset them back to warmup using css_restart.',
        color: 'error',
      },
      {
        id: 'force-pause',
        label: 'Force Pause',
        command: 'forcepause',
        description: 'Force pause the match',
        color: 'warning',
      },
      {
        id: 'force-unpause',
        label: 'Force Unpause',
        command: 'forceunpause',
        description: 'Force unpause the match',
        color: 'success',
      },
    ],
  },
  {
    id: 'match-settings',
    title: 'Match Settings',
    icon: 'settings',
    commands: [
      {
        id: 'skip-veto',
        label: 'Skip Veto',
        command: 'skipveto',
        description: 'Skip the veto phase',
      },
      {
        id: 'toggle-knife',
        label: 'Toggle Knife Round',
        command: 'roundknife',
        description: 'Enable/disable knife round for side choice (alias: rk)',
      },
      {
        id: 'toggle-playout',
        label: 'Toggle Playout',
        command: 'playout',
        description: 'Enable/disable playing out all rounds',
      },
      {
        id: 'toggle-whitelist',
        label: 'Toggle Whitelist',
        command: 'whitelist',
        description: 'Enable/disable team whitelist',
      },
      {
        id: 'show-settings',
        label: 'Show Settings',
        command: 'settings',
        description: 'Display current match settings',
      },
      {
        id: 'reload-admins',
        label: 'Reload Admins',
        command: 'reload_admins',
        description: 'Reload admin list from admins.json',
      },
      {
        id: 'ready-required',
        label: 'Set Ready Required',
        command: 'readyrequired',
        description: 'Set number of players required to ready up',
        requiresInput: true,
        inputLabel: 'Number of players',
        inputType: 'number',
      },
    ],
  },
  {
    id: 'backup-restore',
    title: 'Backup & Restore',
    icon: 'restore',
    commands: [
      {
        id: 'restore-backup',
        label: 'Restore Round Backup',
        command: 'restore',
        description: 'Restore match to a specific round',
        requiresInput: true,
        inputLabel: 'Round number',
        inputType: 'number',
        color: 'warning',
      },
    ],
  },
  {
    id: 'server-mgmt',
    title: 'Server Management',
    icon: 'dns',
    commands: [
      {
        id: 'clean-servers',
        label: 'Clean Servers (css_restart)',
        command: 'restart',
        description:
          'Destructively end any running match on the selected server(s) and reset them back to warmup using css_restart.',
        color: 'error',
      },
      {
        id: 'change-map',
        label: 'Change Map',
        command: 'map',
        description: 'Change to a different map (css_map <mapname>)',
        requiresInput: true,
        inputLabel: 'Map name (de_dust2)',
        inputType: 'text',
      },
    ],
  },
  {
    id: 'team-mgmt',
    title: 'Team Management',
    icon: 'groups',
    commands: [
      {
        id: 'team1-name',
        label: 'Set Team 1 Name',
        command: 'team1',
        description: 'Set the name for Team 1',
        requiresInput: true,
        inputLabel: 'Team name',
        inputType: 'text',
      },
      {
        id: 'team2-name',
        label: 'Set Team 2 Name',
        command: 'team2',
        description: 'Set the name for Team 2',
        requiresInput: true,
        inputLabel: 'Team name',
        inputType: 'text',
      },
    ],
  },
  {
    id: 'practice-mode',
    title: 'Practice Mode',
    icon: 'sports',
    commands: [
      {
        id: 'start-practice',
        label: 'Start Practice Mode',
        command: 'prac',
        description: 'Enable practice mode with .commands',
        color: 'info',
      },
      {
        id: 'exit-practice',
        label: 'Exit Practice Mode',
        command: 'exitprac',
        description: 'Disable practice mode',
        color: 'warning',
      },
    ],
  },
  {
    id: 'admin-comm',
    title: 'Admin Communication',
    icon: 'campaign',
    commands: [
      {
        id: 'broadcast',
        label: 'Broadcast Message',
        command: 'asay',
        description: 'Send an admin message to all players',
        requiresInput: true,
        inputLabel: 'Message',
        inputType: 'text',
        color: 'primary',
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced RCON',
    icon: 'code',
    commands: [
      {
        id: 'custom-rcon',
        label: 'Execute Custom RCON',
        command: 'custom',
        description: 'Execute any RCON command directly',
        requiresInput: true,
        inputLabel: 'RCON command',
        inputType: 'text',
        color: 'error',
      },
    ],
  },
];
