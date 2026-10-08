# Third-party media

## Reel music: bring your own

Auto Tournament ships no music and downloads none. Each install's admin adds the tracks reels may play (Match rules › Highlight videos), and is responsible for having the rights to use them in videos. The tracks stay on that install; Auto Tournament's license does not cover them.

How the platform uses an admin's tracks:

- A reel plays its own mix of a track: cut to the reel, evened out in loudness with the other tracks, louder under the intro and faded. The player never gets the track's file; only an admin can fetch that, to listen before picking.
- A download comes with or without the music. With it, the music is mixed under the game's sound, the same mix the player plays.
- A track can be marked as registered with YouTube Content ID. The download menu then warns that a YouTube upload with it can get a claim (ads on the video, no strike); a download without music avoids it.

## Suggested tracks (Pixabay)

To help find music that fits, the admin page lists tracks we picked on [Pixabay](https://pixabay.com) ([musicSuggestions.ts](api/src/integrations/cs2/demos/musicSuggestions.ts)). These are links only. The admin opens a page, downloads the track there under the [Pixabay Content License](https://pixabay.com/service/license-summary/) and adds it like any other track.

What that license says, as Pixabay's [Terms of Service](https://pixabay.com/service/terms/) read on 8 October 2026:

- Content may be used for free, for personal and commercial purposes, and modified or adapted into new works.
- Attribution is not required. Pixabay suggests "by [Contributor] via Pixabay"; the table below credits every suggested track that way.
- Content may not be sold or distributed on a **Standalone** basis: as an audio file in substantially the same form as on Pixabay, including through a stock media platform.
- Bulk, large-scale or systematic copying of Content is prohibited without Pixabay's explicit permission, and so is automated collection from the site.

This is a summary for convenience, not legal advice; the license itself is what applies.

## Crowd

The crowd under reels is one recording, "Crowd Cheering in Stadium" by vishiv via Pixabay ([435357](https://pixabay.com/sound-effects/people-crowd-cheering-in-stadium-435357/)). Each recorder downloads it once to build reels' crowd tracks, where it is cut, gated by the game's sound and mixed into a new track; it is never offered as a file.

## Suggested tracks, credited

Credited as "title by artist via Pixabay". The ID column links to the track's page.

| Track                                                    | Artist              | Pixabay                                                                                                                      | Content ID |
| -------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Vocal House                                              | 9JackJack8          | [301199](https://pixabay.com/music/house-vocal-house-301199/)                                                                | yes        |
| Aggressive Brazilian Phonk 3                             | AbsoluteSound       | [514615](https://pixabay.com/music/phonk-aggressive-brazilian-phonk-3-514615/)                                               | yes        |
| Action Chase Sequence Drive                              | alex-morgan         | [573649](https://pixabay.com/music/electro-action-chase-sequence-drive-573649/)                                              | yes        |
| Beautiful Melody                                         | alex-morgan         | [587414](https://pixabay.com/music/house-beautiful-melody-emotional-background-music-587414/)                                | no         |
| Bebop Coffee Shop                                        | alex-morgan         | [517090](https://pixabay.com/music/traditional-jazz-bebop-coffee-shop-517090/)                                               | yes        |
| Phonk Aggressive Drift Night                             | alex-morgan         | [573644](https://pixabay.com/music/phonk-phonk-aggressive-drift-night-573644/)                                               | yes        |
| Phonk Aura Drift Night Ride                              | alex-morgan         | [587401](https://pixabay.com/music/phonk-phonk-aura-drift-night-ride-587401/)                                                | no         |
| Breakbeat so Breakbeat                                   | AudioDollar         | [614331](https://pixabay.com/music/drum-n-bass-breakbeat-so-breakbeat-614331/)                                               | yes        |
| Minimal House                                            | Aurec               | [612631](https://pixabay.com/music/electronic-minimal-house-612631/)                                                         | yes        |
| Hopeless Drum and Bass Full                              | catch22music        | [369496](https://pixabay.com/music/drum-n-bass-hopeless-drum-and-bass-full-369496/)                                          | yes        |
| Astral Realms & Ziyal - Binary Galaxies                  | Daljit_Kundi        | [467548](https://pixabay.com/music/drum-n-bass-astral-realms-amp-ziyal-binary-galaxies-467548/)                              | no         |
| Astral Realms & Ziyal - Voices From Within               | Daljit_Kundi        | [467544](https://pixabay.com/music/drum-n-bass-astral-realms-amp-ziyal-voices-from-within-467544/)                           | no         |
| The Outerworld - Astral Projections                      | Daljit_Kundi        | [480607](https://pixabay.com/music/drum-n-bass-the-outerworld-astral-projections-480607/)                                    | no         |
| The Outerworld - Pulsar                                  | Daljit_Kundi        | [480605](https://pixabay.com/music/upbeat-the-outerworld-pulsar-480605/)                                                     | no         |
| The Outerworld - Space & Aviation                        | Daljit_Kundi        | [462059](https://pixabay.com/music/drum-n-bass-the-outerworld-space-amp-aviation-462059/)                                    | no         |
| The Outerworld - Under The Stars                         | Daljit_Kundi        | [462050](https://pixabay.com/music/ambient-the-outerworld-under-the-stars-462050/)                                           | no         |
| The Outerworld - Voices From The Past                    | Daljit_Kundi        | [480603](https://pixabay.com/music/drum-n-bass-the-outerworld-voices-from-the-past-480603/)                                  | yes        |
| Jungle Waves (Drum&Bass Electronic Inspiring Promo)      | DIMMYSAD            | [345013](https://pixabay.com/music/drum-n-bass-jungle-waves-drumampbass-electronic-inspiring-promo-345013/)                  | yes        |
| Electronic - Golden                                      | Easy_Eva            | [564082](https://pixabay.com/music/electronic-electronic-golden-564082/)                                                     | no         |
| Emotional                                                | Easy_Eva            | [605988](https://pixabay.com/music/house-emotional-605988/)                                                                  | no         |
| Emotional - Emotional Music                              | Easy_Eva            | [605991](https://pixabay.com/music/small-emotions-emotional-emotional-music-605991/)                                         | no         |
| Emotional - Just Friends                                 | Easy_Eva            | [605987](https://pixabay.com/music/house-emotional-just-friends-605987/)                                                     | no         |
| Feel Good - It Feels So Good                             | Easy_Eva            | [605779](https://pixabay.com/music/house-feel-good-it-feels-so-good-605779/)                                                 | no         |
| Happiness                                                | Easy_Eva            | [606742](https://pixabay.com/music/orchestral-happiness-606742/)                                                             | no         |
| Happiness - Let It Go                                    | Easy_Eva            | [606741](https://pixabay.com/music/orchestral-happiness-let-it-go-606741/)                                                   | no         |
| Inspiring Emotional                                      | Easy_Eva            | [605990](https://pixabay.com/music/small-emotions-inspiring-emotional-605990/)                                               | no         |
| July                                                     | Easy_Eva            | [605765](https://pixabay.com/music/electronic-house-july-605765/)                                                            | no         |
| Pop - Friends Like Us                                    | Easy_Eva            | [564013](https://pixabay.com/music/pop-pop-friends-like-us-564013/)                                                          | no         |
| Upbeat - Get It                                          | Easy_Eva            | [564064](https://pixabay.com/music/beats-upbeat-get-it-564064/)                                                              | no         |
| Uplifting - Friend                                       | Easy_Eva            | [605770](https://pixabay.com/music/corporate-uplifting-friend-605770/)                                                       | no         |
| Drum And Bass Jungle                                     | echoes_of_lumen     | [583440](https://pixabay.com/music/future-bass-drum-and-bass-jungle-583440/)                                                 | yes        |
| Sport Phonk                                              | echoes_of_lumen     | [584900](https://pixabay.com/music/phonk-sport-phonk-584900/)                                                                | yes        |
| Techno No Copyright (Entropy)                            | Evgeny_Bardyuzha    | [15944](https://pixabay.com/music/techno-trance-techno-no-copyright-entropy-15944/)                                          | yes        |
| Escape Your Love (Upbeat Fashion Pop Dance)              | FASSounds           | [412230](https://pixabay.com/music/pop-escape-your-love-upbeat-fashion-pop-dance-412230/)                                    | yes        |
| Chaos                                                    | Grand_Project       | [399944](https://pixabay.com/music/build-up-scenes-chaos-399944/)                                                            | yes        |
| Winning Elevation                                        | Hot_Dope            | [111355](https://pixabay.com/music/main-title-winning-elevation-111355/)                                                     | yes        |
| Soulsweeper                                              | ItsWatR             | [252499](https://pixabay.com/music/dubstep-soulsweeper-252499/)                                                              | no         |
| Runaway Lights                                           | jakob_welik         | [463852](https://pixabay.com/music/dance-runaway-lights-463852/)                                                             | yes        |
| Action Music                                             | kiravale            | [598107](https://pixabay.com/music/techno-trance-action-music-598107/)                                                       | yes        |
| Phonk Music                                              | kiravale            | [593661](https://pixabay.com/music/phonk-phonk-music-593661/)                                                                | yes        |
| Phonk Songs                                              | kiravale            | [593656](https://pixabay.com/music/phonk-phonk-songs-593656/)                                                                | yes        |
| Funk Breakbeat                                           | Kulakovka           | [266615](https://pixabay.com/music/funk-funk-breakbeat-266615/)                                                              | yes        |
| Atmosphere Pulse                                         | leberch             | [263075](https://pixabay.com/music/pulses-atmosphere-pulse-263075/)                                                          | yes        |
| Documentary Tension                                      | leberch             | [256156](https://pixabay.com/music/build-up-scenes-documentary-tension-256156/)                                              | yes        |
| Mysterious Cinematic                                     | leberch             | [255712](https://pixabay.com/music/mystery-mysterious-cinematic-255712/)                                                     | yes        |
| Brazilian Phonk - Phonk                                  | MondaMusic          | [542543](https://pixabay.com/music/phonk-brazilian-phonk-phonk-542543/)                                                      | yes        |
| Acid Bonus (Liquid Breakbeat Jungle Drum And Bass)       | Musinova            | [354206](https://pixabay.com/music/drum-n-bass-acid-bonus-liquid-breakbeat-jungle-drum-and-bass-354206/)                     | no         |
| Clear Horizons (Liquid Jungle Breakbeat Drum And Bass)   | Musinova            | [356507](https://pixabay.com/music/drum-n-bass-clear-horizons-liquid-jungle-breakbeat-drum-and-bass-356507/)                 | no         |
| Digital Elements (Liquid Jungle Breakbeat Drum And Bass) | Musinova            | [356516](https://pixabay.com/music/drum-n-bass-digital-elements-liquid-jungle-breakbeat-drum-and-bass-356516/)               | no         |
| Hyper Garden (Jungle Breakbeat Drum And Bass)            | Musinova            | [356528](https://pixabay.com/music/drum-n-bass-hyper-garden-jungle-breakbeat-drum-and-bass-loop-edit-356528/)                | no         |
| Hyper Garden (Jungle Breakbeat Drum And Bass)            | Musinova            | [356529](https://pixabay.com/music/drum-n-bass-hyper-garden-jungle-breakbeat-drum-and-bass-356529/)                          | no         |
| Information Flow (Liquid Jungle Breakbeat Drum And Bass) | Musinova            | [358432](https://pixabay.com/music/drum-n-bass-information-flow-liquid-jungle-breakbeat-drum-and-bass-358432/)               | no         |
| Neon Sky (Liquid Jungle Breakbeat Drum and Bass)         | Musinova            | [356503](https://pixabay.com/music/drum-n-bass-neon-sky-liquid-jungle-breakbeat-drum-and-bass-356503/)                       | no         |
| Neon Surfer (Liquid Breakbeat Jungle Drum & Bass)        | Musinova            | [354198](https://pixabay.com/music/drum-n-bass-neon-surfer-liquid-breakbeat-jungle-drum-amp-bass-354198/)                    | no         |
| Riding My Bike (Jazzy Liquid Jungle DnB)                 | Musinova            | [354215](https://pixabay.com/music/drum-n-bass-riding-my-bike-jazzy-liquid-jungle-dnb-354215/)                               | no         |
| German Techno Cowboy / Uplifting Trance Journey          | NickPanek           | [300653](https://pixabay.com/music/techno-trance-german-techno-cowboy-uplifting-trance-journey-300653/)                      | no         |
| Evaporate (Abstract Future Garage)                       | NverAvetyanMusic    | [612778](https://pixabay.com/music/future-bass-evaporate-abstract-future-garage-612778/)                                     | yes        |
| Hypnosis (Deep Techno House)                             | NverAvetyanMusic    | [614495](https://pixabay.com/music/deep-house-hypnosis-deep-techno-house-614495/)                                            | yes        |
| Modulator (Funky Music)                                  | NverAvetyanMusic    | [613481](https://pixabay.com/music/funk-modulator-funky-music-613481/)                                                       | yes        |
| Proximity (Liquid Drum and Bass)                         | penguinmusic        | [186378](https://pixabay.com/music/drum-n-bass-proximity-liquid-drum-and-bass-186378/)                                       | no         |
| Dark Ambient                                             | sharvarion          | [126122](https://pixabay.com/music/ambient-dark-ambient-126122/)                                                             | yes        |
| Phonk Instrumental                                       | Sub_Clair           | [588308](https://pixabay.com/music/phonk-phonk-instrumental-588308/)                                                         | yes        |
| Adventure Journey                                        | The_Mountain        | [317774](https://pixabay.com/music/main-title-adventure-journey-317774/)                                                     | yes        |
| Phonk                                                    | The_Mountain        | [567414](https://pixabay.com/music/phonk-phonk-567414/)                                                                      | yes        |
| Phonk - Phonk Music                                      | The_Mountain        | [496450](https://pixabay.com/music/phonk-phonk-phonk-music-496450/)                                                          | yes        |
| Upbeat Music                                             | The_Mountain        | [567448](https://pixabay.com/music/old-school-rnb-upbeat-upbeat-music-567448/)                                               | yes        |
| Action Drive Racing Music                                | ViacheslavStarostin | [429957](https://pixabay.com/music/upbeat-action-drive-racing-music-429957/)                                                 | yes        |
| Harambee - Africa Swahili Drum and Bass                  | vjgalaxy            | [594062](https://pixabay.com/music/drum-n-bass-harambee-africa-swahili-drum-and-bass-594062/)                                | no         |
| Drum & Bass - DnB Music                                  | Watermello          | [488391](https://pixabay.com/music/drum-n-bass-drum-amp-bass-dnb-music-dampb-drum-and-bass-488391/)                          | yes        |
| Apocalypse (Epic Background Music)                       | White_Records       | [465492](https://pixabay.com/music/modern-classical-apocalypse-epic-background-music-for-video-stories-full-version-465492/) | yes        |
| Shound - Highlights                                      | WildSpeedRecords    | [477396](https://pixabay.com/music/electronic-shound-highlights-477396/)                                                     | yes        |
| Shound - Jazzed Up                                       | WildSpeedRecords    | [477394](https://pixabay.com/music/electronic-shound-jazzed-up-477394/)                                                      | yes        |
| Shound - New Paths                                       | WildSpeedRecords    | [477414](https://pixabay.com/music/electronic-shound-new-paths-477414/)                                                      | no         |
| Phonk Music - Phonk                                      | XXXDOLM             | [480283](https://pixabay.com/music/phonk-phonk-music-phonk-480283/)                                                          | yes        |
