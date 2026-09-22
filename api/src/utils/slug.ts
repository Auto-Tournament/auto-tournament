/**
 * Slugify a display name into the lowercase, hyphenated form used as a
 * `games.slug` (and shared by anything else that wants an IGDB/Wikidata-style
 * slug). Diacritics are stripped rather than kept or transliterated, so
 * "Pokémon" becomes "pokemon".
 *
 * Pulled out of gameCatalogService so wikidataService can use it too without
 * the two services importing each other.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
