export type PlayerProfile = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  // Optional displayName if you want nickname flavor:
  displayName?: string;
};

const FIRST_NAMES = [
  'Alex',
  'Jamie',
  'Taylor',
  'Jordan',
  'Sam',
  'Casey',
  'Morgan',
  'Riley',
  'Avery',
  'Cameron',
];

const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Lopez',
  'Wilson',
];

function pickRandom<T>(values: T[]): T {
  if (values.length === 0) {
    throw new Error('pickRandom called with empty array');
  }
  const index = Math.floor(Math.random() * values.length);
  return values[index]!;
}

/**
 * Lightweight player profile generator for backend tests and dev helpers.
 *
 * NOTE: This intentionally avoids @faker-js/faker so it works cleanly in
 * Node/CommonJS test runners without ESM interop issues.
 */
export function generatePlayerProfile(_locale: string = 'en'): PlayerProfile {
  const firstName = pickRandom(FIRST_NAMES);
  const lastName = pickRandom(LAST_NAMES);

  return {
    id: `player-${Math.random().toString(36).slice(2, 10)}`,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
  };
}

