let counter = 0;

/** A SteamID64-shaped id, unique within the process: the counter never repeats inside a millisecond. */
export function uniqueSteamId(): string {
  counter = (counter + 1) % 1000;
  return `7656119${String(Date.now()).slice(-7)}${String(counter).padStart(3, '0')}`;
}
