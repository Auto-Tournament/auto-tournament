# App icon sources

Where every file in this folder came from. Each is the game's own square
icon — the one players see on their phone, desktop or launcher — scaled to
128 × 128 and saved as WebP (at most 25 KB). Nothing here is a slice of a
wordmark.

**Game icons are trademarks of their owners.** They are used only to
identify the game a player picks; no endorsement is implied, and a rights
holder who wants theirs removed only has to open an issue.

Sources, in order of preference — all public, no API key, nothing behind a
login:

1. **Steam client icon.** `https://api.steamcmd.net/v1/info/<appid>` →
   `common.clienticon` → `https://shared.fastly.steamstatic.com/community_assets/images/apps/<appid>/<hash>.ico`
   (the older `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/<appid>/<hash>.ico`
   path still answers for older games but 404s for newer ones, such as
   Battlefield 6); the largest frame (256 or 512 px). The small `common.icon`
   JPEG is 32 px and not used. Where the `.ico` is gone,
   `common.linuxclienticon` (a zip of PNGs).
2. **App Store icon** for mobile-first games. `https://itunes.apple.com/lookup?id=<id>`
   → `artworkUrl512` (requested at 256 px, PNG).
3. **Nintendo eShop square image** for Nintendo-only games — the square
   picture the Switch shows for the game. Nintendo of Europe's game search
   (`searching.nintendo-europe.com`), field `image_url_sq_s`.
4. Otherwise, a square icon published by the game's own store page, its
   launcher or Wikimedia Commons, noted per game below. Where that is a mark
   on a transparent background, it is set on the colour the game's launcher
   tile uses, the way the launcher shows it.
5. **Chess** has no brand — it is a game, not a product — so its icon is ours:
   a knight drawn in the same flat, faceted style and palette as the pack's
   tile (`icons/chess.svg`).

Wikidata has no square-icon statement (P2910) for any of these games, and its
logo (P154) is the wide wordmark, so it is not a source except where the logo
is itself the square icon (osu!).

| Game | File | Source | URL |
| --- | --- | --- | --- |
| age-of-empires-ii | `age-of-empires-ii.webp` | Steam client icon (app 813780, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/813780/7559e80083c6d4bd482aa61242300d0b32c65652.ico> |
| apex-legends | `apex-legends.webp` | Steam client icon (app 1172470, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1172470/8986dd626da56db5f3fe09bc1b8871739de8b00d.ico> |
| battlefield-6 | `battlefield-6.webp` | Steam client icon (app 2807960, 256px frame of `common.clienticon`; the old Cloudflare path 404s for it) | <https://shared.fastly.steamstatic.com/community_assets/images/apps/2807960/2a8344dc3c4b5d552cb0b6adec0f32fcd687308d.ico> |
| brawl-stars | `brawl-stars.webp` | App Store icon, "Brawl Stars" by Supercell Oy (iTunes Lookup id 1229016807) | <https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ee/a7/00/eea700d3-6cec-f063-b86c-3dfd251c95bd/AppIcon-0-0-1x_U007epad-0-1-85-220.png/256x256bb.png> |
| call-of-duty | `call-of-duty.webp` | Steam client icon (app 1938090, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1938090/62d857e14896e4f7010ebedc8842b1e48898a18c.ico> |
| chess | `chess.webp` | Our own: a chess knight in the pack tile's flat, faceted style, on the tile's orange #FA632A | — |
| clash-royale | `clash-royale.webp` | App Store icon, "Clash Royale" by Supercell Oy (iTunes Lookup id 1053012308) | <https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/77/45/d0/7745d02a-8eac-2295-b062-73bb93e90506/AppIcon-0-0-1x_U007emarketing-0-7-0-85-220.png/256x256bb.png> |
| counter-strike-2 | `counter-strike-2.webp` | Steam client icon (app 730, 512px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/730/324b323045b09bace182f928f4104dfcd93cb7f3.ico> |
| deadlock | `deadlock.webp` | Steam client icon (app 1422450, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1422450/d84198725616ae43a74222f559e0fe710c3bb18b.ico> |
| dota-2 | `dota-2.webp` | Steam Linux client icon (app 570, `dota_256.png` from `common.linuxclienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/570/e1c520b6a98b1fed674a117e9356cdb9ddc6d40c.zip> |
| ea-sports-fc-25 | `ea-sports-fc-25.webp` | Steam client icon (app 2669320, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/2669320/f5ae366e7c1592e711c6f1ecb3553f1bd474d90a.ico> |
| fortnite | `fortnite.webp` | App Store icon, "Fortnite" by Epic Games Sweden AB (iTunes Lookup id 6483539426) | <https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/a0/1d/74/a01d74d6-5975-c315-7db7-faa54a254b28/AppIcon-0-0-1x_U007epad-0-1-85-220.png/256x256bb.png> |
| guilty-gear-strive | `guilty-gear-strive.webp` | Steam client icon (app 1384160, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1384160/9ba9925e7c37710a4e165916dd01e10c2eded18f.ico> |
| halo-infinite | `halo-infinite.webp` | Steam client icon (app 1240440, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1240440/f02816fc405709ccfa88ba3afa0943a190554486.ico> |
| hearthstone | `hearthstone.webp` | App Store icon, "Hearthstone" by Blizzard Entertainment, Inc. (iTunes Lookup id 625257520) | <https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/06/ba/fc/06bafcc9-e4a7-1f5b-51fd-2687232ab434/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/256x256bb.png> |
| league-of-legends | `league-of-legends.webp` | The League "L" crest from leagueoflegends.com's own site icon (SVG), set on League's dark blue #0A1428 — the tile the Riot Client shows. Not on Steam or the App Store; the Epic Games Store listing has only box art and the wordmark | <https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/d3b7bd9decb1e1672dcb80be4f8bc1aa05490dc1-110x70.svg> |
| mario-kart-8-deluxe | `mario-kart-8-deluxe.webp` | Nintendo eShop square image (Nintendo of Europe game search, `image_url_sq_s`) | <https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_5/SQ_NSwitch_MarioKart8Deluxe_image500w.jpg> |
| marvel-rivals | `marvel-rivals.webp` | Steam client icon (app 2767030, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/2767030/bd22e45404f4ed4f3c549b575e23ce76fe03fb07.ico> |
| minecraft | `minecraft.webp` | App Store icon, "Minecraft: Play with Friends!" by Mojang AB (iTunes Lookup id 479516143) | <https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/6c/04/5b/6c045bf2-3400-f6cb-37e7-30b3f945b024/AppIcon-0-0-1x_U007emarketing-0-10-0-85-220.png/256x256bb.png> |
| mobile-legends-bang-bang | `mobile-legends-bang-bang.webp` | App Store icon, "Mobile Legends: Bang Bang" by YOUNGJOY TECHNOLOGY LIMITED (iTunes Lookup id 1160056295) | <https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/d9/88/76/d9887647-00fd-09c8-8a61-c6c31a1bfe2a/AppIcon-0-0-1x_U007emarketing-0-7-0-85-220.png/256x256bb.png> |
| mortal-kombat-1 | `mortal-kombat-1.webp` | Steam client icon (app 1971870, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1971870/fa7894d0d339239667a8fe34af4fae43a2a9bd8c.ico> |
| osu | `osu.webp` | Wikimedia Commons, "Osu! logo 2024.png" (Wikidata Q307441, P154); the circle logo is the game's own app icon | <https://commons.wikimedia.org/wiki/Special:FilePath/Osu!%20logo%202024.png?width=256> |
| overwatch-2 | `overwatch-2.webp` | Steam client icon (app 2357570, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/2357570/c05905cbf26020ffefcae9b39038d9ad523e2d68.ico> |
| pubg-battlegrounds | `pubg-battlegrounds.webp` | Steam client icon (app 578080, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/578080/f962202b06de547cf47c156bdd7aaa5bf7f2cdbb.ico> |
| rainbow-six-siege | `rainbow-six-siege.webp` | Steam client icon (app 359550, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/359550/0f02b60c4e54a254f99ce6d38f16e6fadb504e54.ico> |
| rocket-league | `rocket-league.webp` | Steam client icon (app 252950, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/252950/3ea06e4358d60a692914fd961298de33ad4073b2.ico> |
| splatoon-3 | `splatoon-3.webp` | Nintendo eShop square image (Nintendo of Europe game search, `image_url_sq_s`) | <https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_5/1x1_nswitch_splatoon3_old/1x1_NSwitch_Splatoon3_image500w.jpg> |
| starcraft-ii | `starcraft-ii.webp` | Battle.net shop game icon (SVG, the SC mark the Battle.net launcher lists the game with), set on dark blue #0C1524. Battle.net only, not on Steam | <https://blz-contentstack-images.akamaized.net/v3/assets/bltf408a0557f4e4998/bltcadd0c49e316fea2/60db86c9ce1eb95db45df71f/starcraft-ii.svg> |
| street-fighter-6 | `street-fighter-6.webp` | Steam client icon (app 1364780, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1364780/1bad0a68346084e54d68a802f20aeab68c951f05.ico> |
| super-smash-bros-ultimate | `super-smash-bros-ultimate.webp` | Nintendo eShop square image (Nintendo of Europe game search, `image_url_sq_s`) | <https://www.nintendo.com/eu/media/images/11_square_images/games_18/nintendo_switch_5/SQ_NSwitch_SuperSmashBrosUltimate_02_image500w.jpg> |
| team-fortress-2 | `team-fortress-2.webp` | Steam client icon (app 440, 512px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/440/f568912870a4684f9ec76277a1a404dda6bab213.ico> |
| teamfight-tactics | `teamfight-tactics.webp` | App Store icon, "TFT: Teamfight Tactics" by Riot Games (iTunes Lookup id 1480616748) | <https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b5/ac/f9/b5acf9df-ecc7-cf86-a3c2-3912d607067f/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/256x256bb.png> |
| tekken-8 | `tekken-8.webp` | Steam client icon (app 1778820, 256px frame of `common.clienticon`) | <https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1778820/3ffacb2d80bbe1d77f006ce9244db1fc75ee7759.ico> |
| trackmania | `trackmania.webp` | Microsoft Store square box art, "Trackmania" (product 9N01MR5LF53S, `BoxArt`); Steam only has a 32 px icon | <https://store-images.s-microsoft.com/image/apps.3045.13929807647902137.38a53ce6-26b2-46d3-a4f5-54b363f7efcd.f838da9c-face-4bea-ad15-1f3ca55d64fd?w=256&h=256&format=png> |
| valorant | `valorant.webp` | Epic Games Store product icon (`ic1`, white V mark), cropped to the V and set on VALORANT red #FF4655 — the tile the Riot Client shows | <https://cdn2.unrealengine.com/egs-valorant-riotgames-ic1-400x400-2ccfb0dd75ae.png> |

`counter-strike-2.webp` is here for the record; the platform ships it with the
CS2 module (`client/public/games/counter-strike-2-app-icon.webp`), since CS2 is
a code module, not a pack.
