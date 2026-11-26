/** CS2's teammate colours (radar, scoreboard), the order and ids the API uses (services/teammateColors.ts). */
export const TEAMMATE_COLORS = [
  { id: 'blue', hex: '#4da3ff' },
  { id: 'green', hex: '#1fc45a' },
  { id: 'yellow', hex: '#f2d43a' },
  { id: 'orange', hex: '#f28c28' },
  { id: 'purple', hex: '#a45cf0' },
] as const;

export type TeammateColor = (typeof TEAMMATE_COLORS)[number]['id'];
