# i18n “0 English fallbacks” tracker

This doc tracks progress toward making `cd client && npm run -s i18n:fallback` report **0** identical-to-English strings (excluding values that are intentionally OK to match English, like placeholders-only strings and proper nouns).

## Current status (2026-01-28)

- **Key coverage**: ✅ `npm run -s i18n:missing` reports `0 missing, 0 extra` (leaf paths).
- **Duplicate keys**: ✅ `npm run -s i18n:check` reports no duplicate JSON keys.
- **Remaining identical-to-English strings (filtered)**: **1505**

Locales progress:
- ✅ `zh-CN`: **0**
- ✅ `nb`: **0**
- ✅ `de`: **0**
- ✅ `fr`: **0**
- ✅ `nl`: **0**
- ✅ `it`: **0**
- ⏳ `pl`: **394** (in progress; `pl/mapsTemplatesElo.json` translated, remaining is mostly other files like `matchesAndModals.json`)
- ⏳ `es`: **533**
- ⏳ `pt-PT`: **578**

## How to run the checks locally

From repo root:

```bash
cd client
npm run -s i18n:check
npm run -s i18n:missing
npm run -s i18n:fallback
```

Helpful env vars:
- `I18N_FALLBACK_LIMIT=200`: print more than the default number of examples per locale
- `I18N_FALLBACK_LOCALES=pl` (comma-separated): focus on specific locale(s) while iterating

Examples:

```bash
cd client
I18N_FALLBACK_LOCALES=pl I18N_FALLBACK_LIMIT=200 npm run -s i18n:fallback
I18N_FALLBACK_LOCALES=pl npm run -s i18n:fallback
```

## Safe translation rules (do not break tokens)

Only edit translation **values** under:
- `client/src/locales/<locale>/translation/*.json`

Preserve tokens exactly:
- i18next interpolation: `{{count}}`, `{{name}}`, `{{value}}`, etc.
- MatchZy tokens: `{TIME}`, `{MATCH_ID}`, `{MAP}`, `{MAPNUMBER}`, `{TEAM1}`, `{TEAM2}`
- Bracketed prefixes: `[ADMIN]`, `[MatchZy]`

Avoid:
- Markup injection (no `<...>` / HTML / XML)
- Changing JSON keys/structure

## Automation note (MyMemory quota)

The current auto-translation backend (MyMemory free API) frequently hits daily quota (HTTP 429).
Until a paid/unlimited provider is wired into `client/scripts/auto-translate-fallbacks.mjs`, the reliable workflow is **manual translation in small batches**:
- pick one locale
- translate one file fully (e.g. `mapsTemplatesElo.json`)
- re-run `I18N_FALLBACK_LOCALES=<locale> npm run -s i18n:fallback`

