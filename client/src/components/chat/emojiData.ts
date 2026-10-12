/**
 * The chat's emoji: common ones by category, each with the words a search
 * finds it by. Kept small on purpose (no emoji library in the bundle).
 */

export interface Emoji {
  char: string;
  words: string;
}

export interface EmojiCategory {
  id:
    | 'smileys'
    | 'gestures'
    | 'people'
    | 'animals'
    | 'food'
    | 'activity'
    | 'travel'
    | 'objects'
    | 'symbols';
  emoji: Emoji[];
}

// "char words words|char words…": one string per category keeps this readable.
const RAW: Record<EmojiCategory['id'], string> = {
  smileys:
    '😀 grinning smile happy|😃 smiley happy|😄 smile laugh|😁 grin beaming|😆 laughing lol|😅 sweat smile relief|🤣 rofl rolling laughing|😂 joy tears laughing lol|🙂 slight smile|🙃 upside down|😉 wink|😊 blush smile|😇 innocent halo angel|🥰 love hearts|😍 heart eyes love|🤩 star struck wow|😘 kiss|😋 yum tasty|😛 tongue|😜 wink tongue crazy|🤪 zany crazy|😝 squint tongue|🤑 money|🤗 hug|🤭 oops giggle|🤫 shush quiet|🤔 thinking hmm|🤐 zipper mouth|🤨 raised eyebrow sus|😐 neutral|😑 expressionless|😶 no mouth|😏 smirk|😒 unamused|🙄 eye roll|😬 grimace awkward|😮‍💨 exhale phew|🤥 lying|😌 relieved|😔 pensive sad|😪 sleepy|🤤 drool|😴 sleeping zzz|😷 mask sick|🤒 thermometer sick|🤕 bandage hurt|🤢 nauseated sick|🤮 vomit|🥵 hot|🥶 cold freezing|🥴 woozy dizzy|😵 dizzy dead|🤯 mind blown exploding|🤠 cowboy|🥳 party celebrate|😎 cool sunglasses|🤓 nerd|🧐 monocle|😕 confused|😟 worried|🙁 frown|😮 open mouth wow|😯 hushed|😲 astonished shocked|😳 flushed|🥺 pleading puppy|😦 frowning|😧 anguished|😨 fearful scared|😰 anxious sweat|😥 sad relieved|😢 cry tear sad|😭 sob crying|😱 scream fear|😖 confounded|😣 persevere|😞 disappointed|😓 downcast sweat|😩 weary|😫 tired|🥱 yawn bored|😤 triumph huff|😡 pout angry rage|😠 angry mad|🤬 cursing swearing|😈 devil smiling|👿 imp angry devil|💀 skull dead|☠️ skull crossbones|💩 poop|🤡 clown|👻 ghost|👽 alien|🤖 robot bot|😺 cat smile|😹 cat joy',
  gestures:
    '👍 thumbs up yes good like|👎 thumbs down no bad|👌 ok perfect|🤌 pinched fingers|✌️ peace victory|🤞 fingers crossed luck|🤟 love you|🤘 rock horns metal|🤙 call me shaka|👈 left point|👉 right point|👆 up point|👇 down point|☝️ index up|✋ hand stop high five|🤚 raised back hand|🖐️ hand fingers splayed|🖖 vulcan|👋 wave hello bye|🤝 handshake deal|👏 clap applause|🙌 raised hands hooray|👐 open hands|🤲 palms up|🙏 pray please thanks|✍️ writing|💪 muscle strong flex|🫡 salute|🫶 heart hands|👊 fist bump punch|✊ raised fist|🤛 left fist|🤜 right fist|🖕 middle finger|👀 eyes looking|👁️ eye|🧠 brain|🫠 melting',
  people:
    '👶 baby|🧒 child|👦 boy|👧 girl|🧑 person|👨 man|👩 woman|🧓 older person|👴 old man|👵 old woman|🧔 beard|👮 police cop|🕵️ detective spy|💂 guard|🥷 ninja|👷 construction worker|🤴 prince|👸 princess|🦸 superhero|🦹 supervillain|🧙 mage wizard|🧛 vampire|🧟 zombie|🙋 raising hand|🙆 ok gesture|🙅 no gesture|🤷 shrug idk|🤦 facepalm|💁 tipping hand|🙇 bow sorry|🏃 running|🚶 walking|🕺 dancing man|💃 dancing woman|👯 party bunny|🧘 yoga calm|👥 people group|🫂 hug people',
  animals:
    '🐶 dog puppy|🐱 cat kitty|🐭 mouse|🐹 hamster|🐰 rabbit bunny|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🙈 see no evil monkey|🙉 hear no evil|🙊 speak no evil|🐔 chicken|🐧 penguin|🐦 bird|🦅 eagle|🦆 duck|🦉 owl|🐺 wolf|🐗 boar|🐴 horse|🦄 unicorn|🐝 bee|🐛 bug|🦋 butterfly|🐌 snail|🐞 ladybug|🐢 turtle|🐍 snake|🦖 t-rex dinosaur|🐙 octopus|🦀 crab|🐟 fish|🐬 dolphin|🐳 whale|🦈 shark|🐊 crocodile|🐐 goat goat|🐀 rat|🌵 cactus|🌲 tree|🍀 clover luck|🌹 rose|🌻 sunflower|🌸 blossom|🔥 fire lit hot|⭐ star|🌟 glowing star|✨ sparkles|⚡ lightning zap|🌈 rainbow|☀️ sun|🌙 moon|❄️ snow|🌊 wave water',
  food: '🍏 green apple|🍎 apple|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🍒 cherries|🍑 peach|🍍 pineapple|🥑 avocado|🍅 tomato|🌶️ hot pepper spicy|🌽 corn|🥕 carrot|🥔 potato|🍞 bread|🧀 cheese|🥚 egg|🍳 cooking egg|🥓 bacon|🍔 burger|🍟 fries|🍕 pizza|🌭 hot dog|🌮 taco|🌯 burrito|🥗 salad|🍝 pasta spaghetti|🍜 ramen noodles|🍣 sushi|🍤 shrimp|🍦 ice cream|🍩 donut|🍪 cookie|🎂 birthday cake|🍰 cake|🧁 cupcake|🍫 chocolate|🍬 candy|🍿 popcorn|☕ coffee|🍵 tea|🥤 soda cup|🧃 juice|🍺 beer|🍻 cheers beers|🥂 cheers glasses|🍷 wine|🥃 whisky|🍾 champagne',
  activity:
    '⚽ soccer football|🏀 basketball|🏈 american football|⚾ baseball|🎾 tennis|🏐 volleyball|🏓 ping pong|🏸 badminton|🥊 boxing|🥋 martial arts|🎯 target bullseye aim headshot|🎮 game controller gaming|🕹️ joystick|🎲 dice|♟️ chess|🧩 puzzle|🎳 bowling|🏆 trophy win|🥇 gold first|🥈 silver second|🥉 bronze third|🏅 medal|🎖️ military medal|🎉 party popper tada|🎊 confetti|🎈 balloon|🎁 gift present|🎤 microphone|🎧 headphones|🎵 music note|🎶 music notes|🎸 guitar|🥁 drum|🎬 clapper film|🎨 art palette|🏁 checkered flag finish|🚩 red flag|🏳️ white flag surrender|💣 bomb|🔫 water pistol gun|🗡️ dagger knife|⚔️ swords|🛡️ shield|🪖 helmet|🧨 firecracker|💥 boom collision|💯 hundred perfect',
  travel:
    '🚗 car|🚕 taxi|🚌 bus|🏎️ race car|🚓 police car|🚑 ambulance|🚒 fire engine|🚚 truck|🚲 bike|🛵 scooter|🏍️ motorcycle|✈️ airplane|🚀 rocket|🛸 ufo|🚁 helicopter|⛵ sailboat|🚢 ship|⚓ anchor|🗺️ map|🧭 compass|🏔️ mountain|🌋 volcano|🏕️ camping|🏖️ beach|🏜️ desert|🏝️ island|🏠 house home|🏢 office building|🏰 castle|🗼 tower|🗽 statue liberty|⛩️ shrine|🌃 night city|🌆 dusk city|🎡 ferris wheel|🎢 roller coaster',
  objects:
    '⌚ watch|📱 phone mobile|💻 laptop computer|⌨️ keyboard|🖥️ desktop pc|🖱️ mouse computer|💾 floppy save|💿 disc|📷 camera|🎥 movie camera|📺 tv|📻 radio|⏰ alarm clock|⏳ hourglass waiting|⌛ hourglass done|🔋 battery|🔌 plug|💡 bulb idea|🔦 flashlight|🕯️ candle|💸 money flying|💵 dollar|💰 money bag|💎 gem diamond|🔧 wrench|🔨 hammer|🛠️ tools|⚙️ gear settings|🔗 link|🧲 magnet|🔪 knife|🧪 test tube|📡 satellite|💉 syringe|💊 pill|🚪 door|🛏️ bed|🛒 cart|📦 box package|📫 mailbox|📝 memo note|📅 calendar|📌 pin|📎 paperclip|✂️ scissors|🔒 lock|🔓 unlock|🔑 key|🗝️ old key|🔔 bell|📣 megaphone|📢 loudspeaker|🎫 ticket|🧸 teddy bear',
  symbols:
    '❤️ red heart love|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🖤 black heart|🤍 white heart|💔 broken heart|❣️ heart exclamation|💕 two hearts|💖 sparkling heart|✅ check yes done|☑️ ballot check|✔️ check mark|❌ cross no wrong|❎ cross button|➕ plus|➖ minus|❓ question|❗ exclamation|‼️ double exclamation|⁉️ interrobang|⚠️ warning|🚫 prohibited|⛔ no entry|🔴 red circle|🟠 orange circle|🟡 yellow circle|🟢 green circle|🔵 blue circle|🟣 purple circle|⚫ black circle|⚪ white circle|🔺 red triangle up|🔻 red triangle down|▶️ play|⏸️ pause|⏹️ stop|⏩ fast forward|🔁 repeat|🔄 refresh|🆗 ok button|🆕 new|🆒 cool button|🔝 top|💤 zzz sleep|💢 anger|💬 speech bubble|💭 thought bubble|🗯️ anger bubble|♻️ recycle|🔰 beginner|➡️ right arrow|⬅️ left arrow|⬆️ up arrow|⬇️ down arrow|↩️ return|🔜 soon|🏳️‍🌈 rainbow flag pride',
};

export const EMOJI_CATEGORIES: EmojiCategory[] = (Object.keys(RAW) as EmojiCategory['id'][]).map(
  (id) => ({
    id,
    emoji: RAW[id].split('|').map((entry) => {
      const space = entry.indexOf(' ');
      return { char: entry.slice(0, space), words: entry.slice(space + 1) };
    }),
  })
);

const ALL: Emoji[] = EMOJI_CATEGORIES.flatMap((c) => c.emoji);

/** Emoji whose words start with every word of the query ("thumb up" finds 👍), first matches first. */
export function searchEmoji(query: string, limit = 64): Emoji[] {
  const parts = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const seen = new Set<string>();
  const out: Emoji[] = [];
  for (const e of ALL) {
    if (seen.has(e.char)) continue;
    const words = e.words.split(' ');
    if (parts.every((p) => words.some((w) => w.startsWith(p)))) {
      seen.add(e.char);
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The emoji picked lately, newest first, without repeats, at most `max`. */
export function pushRecent(recent: string[], char: string, max = 16): string[] {
  return [char, ...recent.filter((c) => c !== char)].slice(0, max);
}

/** Put `text` into `value` at the caret (or over the selection); where the caret goes after. */
export function insertAt(
  value: string,
  text: string,
  start: number | null,
  end: number | null
): { value: string; caret: number } {
  const from = start ?? value.length;
  const to = end ?? from;
  return { value: value.slice(0, from) + text + value.slice(to), caret: from + text.length };
}
