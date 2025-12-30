import { uniqueNamesGenerator } from 'unique-names-generator';

const csAdjectives = [
  // Aggression / Power
  'Crimson',
  'Ruthless',
  'Relentless',
  'Vicious',
  'Savage',
  'Brutal',
  'Merciless',
  'Ferocious',
  'Feral',
  'Bloodied',
  'Dominant',
  'Unforgiving',

  // Tactical / Military
  'Tactical',
  'Covert',
  'Strategic',
  'Calculated',
  'Disciplined',
  'Precision',
  'Elite',
  'Veteran',
  'Hardened',
  'Armored',
  'Ballistic',
  'Mobile',
  'Frontline',
  'Stealth',
  'Shadow',
  'Silent',
  'Nocturnal',

  // Cold / Dark
  'Cold',
  'Frozen',
  'Icy',
  'Glacial',
  'Black',
  'Obsidian',
  'Midnight',
  'Void',
  'Abyssal',
  'Nocturne',
  'Grim',
  'Bleak',
  'Dread',
  'Infernal',
  'Hellbound',

  // Metal / Industry
  'Iron',
  'Steel',
  'Titanium',
  'Chrome',
  'Carbon',
  'Forged',
  'Tempered',
  'Rustless',
  'Ballistic',

  // Speed / Lethality
  'Swift',
  'Rapid',
  'Blitz',
  'Lightning',
  'Flash',
  'Deadly',
  'Lethal',
  'Killer',
  'Executioner',
  'Sniper',

  // Psychological / Presence
  'Phantom',
  'Spectral',
  'Haunted',
  'Fearless',
  'Unseen',
  'Unknown',
  'Rogue',
  'Renegade',
  'Lawless',
  'Unbroken',
  'Undefeated',

  // Authority / Scale
  'Supreme',
  'Prime',
  'Alpha',
  'Omega',
  'Final',
  'Eternal',
  'Ascendant',
  'Dominion',
  'Sovereign',
  'Imperial',
];

const csNouns = [
  // Creatures / Predators
  'Reapers',
  'Vipers',
  'Wolves',
  'Ravens',
  'Falcons',
  'Hawks',
  'Cobras',
  'Panthers',
  'Jaguars',
  'Hyenas',
  'Scorpions',
  'Serpents',
  'Widows',
  'Sharks',

  // Military / Units
  'Sentinels',
  'Raiders',
  'Legion',
  'Battalion',
  'Regiment',
  'Division',
  'Commandos',
  'Operators',
  'Enforcers',
  'Vanguards',
  'Wardens',
  'Rangers',
  'Guards',
  'Phalanx',

  // Criminal / Rogue
  'Renegades',
  'Outlaws',
  'Marauders',
  'Mercenaries',
  'Corsairs',
  'Rebels',
  'Anarchists',
  'Smugglers',
  'Cartel',
  'Syndicate',

  // Abstract / Psychological
  'Spectres',
  'Shadows',
  'Phantoms',
  'Nightmares',
  'Apparitions',
  'Echoes',
  'Reckoning',
  'Dominion',
  'Judgement',

  // Power / Mythic-leaning but grounded
  'Titans',
  'Colossi',
  'Behemoths',
  'Leviathans',
  'Overlords',
  'Conquerors',

  // Combat Roles
  'Snipers',
  'Assassins',
  'Hunters',
  'Predators',
  'Executioners',
  'Slayers',
  'Killers',
  'Strikers',
  'Breakers',

  // Tech / Modern
  'Drones',
  'Protocols',
  'Systems',
  'Fireteams',
  'Killzone',
  'Operators',
  'Assets',
];

export function generateTeamName(): string {
  return uniqueNamesGenerator({
    dictionaries: [csAdjectives, csNouns],
    separator: ' ',
    style: 'capital',
  });
}

/**
 * Ensures uniqueness within the provided Set.
 * For cross-process / cross-session uniqueness, enforce uniqueness in DB and retry on conflict.
 */
export function generateUniqueTeamName(used: Set<string>, maxAttempts = 50): string {
  for (let i = 0; i < maxAttempts; i += 1) {
    const name = generateTeamName();
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }

  throw new Error(`Failed to generate unique team name after ${maxAttempts} attempts.`);
}
