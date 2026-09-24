/**
 * The RCON commands CS2's Admin tools section offers.
 *
 * Labels, descriptions and input labels live in CS2's locale files (namespace
 * `cs2`) under `adminTools.commands.<i18nKey>` (label / description /
 * inputLabel), and category titles under `adminTools.categories.<i18nKey>`.
 */
export interface AdminCommand {
  id: string;
  i18nKey: string;
  command: string;
  requiresInput?: boolean;
  inputType?: 'text' | 'number';
  color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  icon?: string;
}

export interface AdminCommandCategory {
  id: string;
  i18nKey: string;
  icon: string;
  commands: AdminCommand[];
}

export const ADMIN_COMMAND_CATEGORIES: AdminCommandCategory[] = [
  {
    id: 'match-control',
    i18nKey: 'matchControl',
    icon: 'play',
    commands: [
      {
        id: 'match-start',
        i18nKey: 'matchStart',
        command: 'start',
        color: 'success',
      },
      {
        id: 'match-end',
        i18nKey: 'matchEnd',
        command: 'restart',
        color: 'error',
      },
      {
        id: 'force-pause',
        i18nKey: 'forcePause',
        command: 'forcepause',
        color: 'warning',
      },
      {
        id: 'force-unpause',
        i18nKey: 'forceUnpause',
        command: 'forceunpause',
        color: 'success',
      },
    ],
  },
  {
    id: 'match-settings',
    i18nKey: 'matchSettings',
    icon: 'settings',
    commands: [
      {
        id: 'skip-veto',
        i18nKey: 'skipVeto',
        command: 'skipveto',
      },
      {
        id: 'toggle-knife',
        i18nKey: 'toggleKnife',
        command: 'roundknife',
      },
      {
        id: 'toggle-playout',
        i18nKey: 'togglePlayout',
        command: 'playout',
      },
      {
        id: 'toggle-whitelist',
        i18nKey: 'toggleWhitelist',
        command: 'whitelist',
      },
      {
        id: 'show-settings',
        i18nKey: 'showSettings',
        command: 'settings',
      },
      {
        id: 'reload-admins',
        i18nKey: 'reloadAdmins',
        command: 'reload_admins',
      },
      {
        id: 'ready-required',
        i18nKey: 'readyRequired',
        command: 'readyrequired',
        requiresInput: true,
        inputType: 'number',
      },
    ],
  },
  {
    id: 'backup-restore',
    i18nKey: 'backupRestore',
    icon: 'restore',
    commands: [
      {
        id: 'restore-backup',
        i18nKey: 'restoreBackup',
        command: 'restore',
        requiresInput: true,
        inputType: 'number',
        color: 'warning',
      },
    ],
  },
  {
    id: 'server-mgmt',
    i18nKey: 'serverMgmt',
    icon: 'dns',
    commands: [
      {
        id: 'clean-servers',
        i18nKey: 'cleanServers',
        command: 'restart',
        color: 'error',
      },
      {
        id: 'change-map',
        i18nKey: 'changeMap',
        command: 'map',
        requiresInput: true,
        inputType: 'text',
      },
    ],
  },
  {
    id: 'team-mgmt',
    i18nKey: 'teamMgmt',
    icon: 'groups',
    commands: [
      {
        id: 'team1-name',
        i18nKey: 'team1Name',
        command: 'team1',
        requiresInput: true,
        inputType: 'text',
      },
      {
        id: 'team2-name',
        i18nKey: 'team2Name',
        command: 'team2',
        requiresInput: true,
        inputType: 'text',
      },
    ],
  },
  {
    id: 'practice-mode',
    i18nKey: 'practiceMode',
    icon: 'sports',
    commands: [
      {
        id: 'start-practice',
        i18nKey: 'startPractice',
        command: 'prac',
        color: 'info',
      },
      {
        id: 'exit-practice',
        i18nKey: 'exitPractice',
        command: 'exitprac',
        color: 'warning',
      },
    ],
  },
  {
    id: 'admin-comm',
    i18nKey: 'adminComm',
    icon: 'campaign',
    commands: [
      {
        id: 'broadcast',
        i18nKey: 'broadcast',
        command: 'asay',
        requiresInput: true,
        inputType: 'text',
        color: 'primary',
      },
    ],
  },
  {
    id: 'advanced',
    i18nKey: 'advanced',
    icon: 'code',
    commands: [
      {
        id: 'custom-rcon',
        i18nKey: 'customRcon',
        command: 'custom',
        requiresInput: true,
        inputType: 'text',
        color: 'error',
      },
    ],
  },
];
