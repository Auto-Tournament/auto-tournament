import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Box, ButtonBase, MenuItem, Select, Typography } from '@mui/material';
import {
  ArrowUpIcon,
  CloudIcon,
  CrosshairIcon,
  EyeSlashIcon,
  LightningIcon,
  PauseIcon,
  PlayIcon,
  SunIcon,
  WallIcon,
} from '@phosphor-icons/react';
import {
  api,
  mono,
  Panel,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
  withAlpha,
} from '../../../module-sdk';
import { ReplayTimeline, type TimelineMark } from './ReplayTimeline';

const { color } = tokens;

/** [x, y, yaw, health, side (2 T, 3 CT), z]; older replays have no z. */
type Pos = [number, number, number, number, number, number?];

interface Replay {
  map: string;
  tickrate: number;
  step: number;
  players: Array<{ id: string; name: string }>;
  frames: Array<[number, Array<Pos | null>]>;
  rounds: Array<{ number: number; startTick: number; endTick: number; winner: string | null }>;
  kills: Array<{
    tick: number;
    attacker: string | null;
    victim: string;
    weapon: string;
    headshot: boolean;
    pos?: [number, number];
    assister?: string | null;
    assistedFlash?: boolean;
    penetrated?: boolean;
    throughSmoke?: boolean;
    noScope?: boolean;
    attackerBlind?: boolean;
    inAir?: boolean;
  }>;
  /** [tick, player index, x, y, yaw, hit x | null, hit y | null] (analyzer v3 on). */
  shots?: Array<[number, number, number, number, number, number | null, number | null]>;
  grenades?: Array<{ type: string; thrower: number; path: Array<[number, number, number]> }>;
  effects?: Array<{ type: string; start: number; end: number; x: number; y: number }>;
  /** [player index, from tick, to tick] */
  blinds?: Array<[number, number, number]>;
  bomb?: Array<{ tick: number; kind: string; site: string; x: number; y: number }>;
  /** [tick, player index, health lost, 1 for a headshot] */
  damage?: Array<[number, number, number, number]>;
}

interface RadarLevel {
  level: string;
  posX: number;
  posY: number;
  scale: number;
  altitudeMin: number | null;
  altitudeMax: number | null;
  image: string;
}

const SIZE = 1024;
const SPEEDS = [0.5, 1, 2, 4, 8];
/** Grenade colours on the map. */
const NADE: Record<string, string> = {
  smoke: '#c7ccd4',
  flash: '#ffffff',
  he: '#ff5a4a',
  molotov: '#ff9a3c',
  fire: '#ff7a1a',
  decoy: '#b08a5a',
};
/** Smoke and fire cover about this many game units around where they went off. */
const SMOKE_RADIUS = 144;
const FIRE_RADIUS = 120;
/** A grenade's path stays on the map this long after it went off. */
const TRAIL_TICKS = 64;

/** The kill feed: this many rows, each for this long. */
const FEED_ROWS = 5;
const FEED_SECONDS = 6;
/** CS2's kill feed name colours, by side (2 T, 3 CT). */
const FEED_SIDE: Record<number, string> = { 2: '#eac65a', 3: '#8fc0f2' };

/** "weapon_ak47" or "AK-47" -> what the feed shows. */
function weaponName(w: string): string {
  return w.replace(/^weapon_/, '').replace(/_/g, ' ');
}

/** A damage number flies for this long. */
const DAMAGE_TICKS = 48;

/** A stable direction per hit, so a number flies the same way on every redraw. */
function hitAngle(tick: number, who: number): number {
  const h = Math.sin(tick * 12.9898 + who * 78.233) * 43758.5453;
  return -Math.PI / 2 + (h - Math.floor(h) - 0.5) * 1.6;
}

/** A shot's streak takes this long from the gun to where it ended; a hit then sparks. */
const FLIGHT_TICKS = 4;
const SPARK_TICKS = 6;
/** The streak's length on the canvas. */
const TRAIL_PX = 40;
/** A miss is drawn this far along the aim, in game units. */
const MISS_UNITS = 900;
/** A kill's cross stays on the map this long. */
const KILL_SHOWN_TICKS = 3 * 64;

/** A loaded image (the DOM type, through window: eslint has no browser globals here). */
type HTMLImageElementLike = InstanceType<typeof window.Image>;

/** Dot radius, and how far the view cone reaches, in canvas pixels. */
const DOT = 15;
const CONE = 70;
const CONE_HALF_ANGLE = (38 * Math.PI) / 180;

const sideColor = (side: number) => (side === 3 ? color.sideCt : color.sideT);

/**
 * The 2D replay (board 6c): every player's dot and view direction on the
 * map's radar, kills marked where they fell, played at 0.5x to 8x with a
 * round picker and a scrubber. Frames are 4 a second; positions in between
 * are blended so the dots glide.
 *
 * Without a radar (the instance's worker has no CS2 install, or a workshop
 * map without one) the map is a plain grid fitted to where players went.
 */
export function ReplayViewer({
  matchSlug,
  mapNumber,
  team1Ids,
  avatars = {},
}: {
  matchSlug: string;
  mapNumber: number;
  team1Ids: Set<string>;
  /** Player id -> avatar URL; players without one get the site's generated avatar. */
  avatars?: Record<string, string | null>;
}) {
  const { t } = useModuleTranslation('cs2');
  // Each player's avatar, loaded once, drawn inside their dot.
  const [faces, setFaces] = useState<Record<string, HTMLImageElementLike>>({});
  const canvasRef = useRef<ComponentRef<'canvas'>>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [missing, setMissing] = useState(false);
  const [levels, setLevels] = useState<RadarLevel[]>([]);
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [level, setLevel] = useState('default');
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/game/cs2/matches/${encodeURIComponent(matchSlug)}/maps/${mapNumber}/replay`, {
      credentials: 'same-origin',
    })
      .then((r) =>
        r.ok ? (r.json() as Promise<Replay>) : Promise.reject(new Error(String(r.status)))
      )
      .then((r) => {
        if (cancelled) return;
        setReplay(r);
        setTick(r.rounds[0]?.startTick ?? r.frames[0]?.[0] ?? 0);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [matchSlug, mapNumber]);

  useEffect(() => {
    if (!replay) return;
    let cancelled = false;
    for (const p of replay.players) {
      const img = new window.Image();
      img.onload = () => !cancelled && setFaces((prev) => ({ ...prev, [p.id]: img }));
      img.src = avatars[p.id] || `/api/players/${encodeURIComponent(p.id)}/avatar.svg`;
    }
    return () => {
      cancelled = true;
    };
    // Avatars only change with the replay's players.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  useEffect(() => {
    if (!replay?.map) return;
    let cancelled = false;
    api
      .get<{ levels: RadarLevel[] }>(`/api/game/cs2/radars/${encodeURIComponent(replay.map)}`)
      .then((res) => {
        if (cancelled) return;
        setLevels(res.levels);
        for (const l of res.levels) {
          const img = new window.Image();
          img.onload = () => !cancelled && setImages((prev) => ({ ...prev, [l.level]: img }));
          img.src = l.image;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [replay?.map]);

  const first = replay?.frames[0]?.[0] ?? 0;
  const last = replay?.frames[replay.frames.length - 1]?.[0] ?? 0;

  // Playback: advance by real time × speed.
  useEffect(() => {
    if (!playing || !replay) return;
    let frame = 0;
    let prev = window.performance.now();
    const loop = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      setTick((tk) => {
        const next = tk + dt * replay.tickrate * speed;
        if (next >= last) {
          setPlaying(false);
          return last;
        }
        return next;
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, replay, speed, last]);

  // Without a radar: fit every position into the canvas.
  const bounds = useMemo(() => {
    if (!replay) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, row] of replay.frames) {
      for (const p of row) {
        if (!p) continue;
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
    }
    const span = Math.max(maxX - minX, maxY - minY, 1) * 1.1;
    return {
      posX: (minX + maxX) / 2 - span / 2,
      posY: (minY + maxY) / 2 + span / 2,
      scale: span / SIZE,
    };
  }, [replay]);

  const radar = levels.find((l) => l.level === level) ?? levels[0] ?? null;
  const transform = radar ?? bounds;
  const onLevel = useCallback(
    (z: number | undefined) => {
      if (levels.length < 2 || z === undefined) return true;
      const here = levels.find((l) => l.level === level);
      if (!here || here.altitudeMin === null || here.altitudeMax === null) return true;
      return z >= here.altitudeMin && z < here.altitudeMax;
    },
    [levels, level]
  );

  // Positions at the current tick, blended between the two nearest frames.
  const state = useMemo(() => {
    if (!replay || replay.frames.length === 0) return [];
    let lo = 0;
    let hi = replay.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (replay.frames[mid]![0] <= tick) lo = mid;
      else hi = mid - 1;
    }
    const [t0, a] = replay.frames[lo]!;
    const next = replay.frames[lo + 1];
    const f = next ? Math.min(1, Math.max(0, (tick - t0) / (next[0] - t0))) : 0;
    return replay.players.map((pl, i) => {
      const p = a[i];
      if (!p) return null;
      const q = next?.[1][i];
      if (!q) return { ...pl, p };
      let dyaw = q[2] - p[2];
      if (dyaw > 180) dyaw -= 360;
      if (dyaw < -180) dyaw += 360;
      const blend: Pos = [
        p[0] + (q[0] - p[0]) * f,
        p[1] + (q[1] - p[1]) * f,
        p[2] + dyaw * f,
        p[3],
        p[4],
        p[5],
      ];
      return { ...pl, p: blend };
    });
  }, [replay, tick]);

  // The timeline's marks: kills in the killer's side colour, and the bomb.
  const marks = useMemo<TimelineMark[]>(() => {
    if (!replay) return [];
    const ids = replay.players.map((p) => p.id);
    const sideAt = (id: string | null, at: number): number | null => {
      const i = id ? ids.indexOf(id) : -1;
      if (i < 0) return null;
      let lo = 0;
      let hi = replay.frames.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (replay.frames[mid]![0] <= at) lo = mid;
        else hi = mid - 1;
      }
      for (let f = lo; f >= 0 && f > lo - 20; f -= 1) {
        const p = replay.frames[f]![1][i];
        if (p) return p[4];
      }
      return null;
    };
    const name = (id: string | null) => replay.players.find((p) => p.id === id)?.name ?? '—';
    return [
      ...replay.kills.map((k) => ({
        tick: k.tick,
        kind: 'kill' as const,
        side: sideAt(k.attacker, k.tick),
        headshot: k.headshot,
        label: `${name(k.attacker)} › ${name(k.victim)}`,
      })),
      ...(replay.bomb ?? []).map((b) => ({
        tick: b.tick,
        kind: b.kind as TimelineMark['kind'],
        label: t(`analysis.replay.bomb.${b.kind}`, { defaultValue: b.kind }),
      })),
    ];
  }, [replay, t]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !replay || !transform) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const img = radar ? images[radar.level] : undefined;
    if (img) ctx.drawImage(img, 0, 0, SIZE, SIZE);
    else {
      ctx.strokeStyle = withAlpha(color.ink, 0.06);
      for (let g = 0; g <= SIZE; g += 64) {
        ctx.beginPath();
        ctx.moveTo(g, 0);
        ctx.lineTo(g, SIZE);
        ctx.moveTo(0, g);
        ctx.lineTo(SIZE, g);
        ctx.stroke();
      }
    }
    const px = (x: number) => (x - transform.posX) / transform.scale;
    const py = (y: number) => (transform.posY - y) / transform.scale;

    // Smoke and fire: the area they cover while they last, fading out.
    const scaleR = (units: number) => units / transform.scale;
    for (const fx of replay.effects ?? []) {
      if (tick < fx.start || tick > fx.end) continue;
      const x = px(fx.x);
      const y = py(fx.y);
      const age = (tick - fx.start) / Math.max(1, fx.end - fx.start);
      if (fx.type === 'smoke' || fx.type === 'fire') {
        const grow = Math.min(1, (tick - fx.start) / 40);
        const fade = Math.min(1, (fx.end - tick) / 128);
        const r = scaleR(fx.type === 'smoke' ? SMOKE_RADIUS : FIRE_RADIUS) * (0.6 + 0.4 * grow);
        ctx.fillStyle = withAlpha(NADE[fx.type]!, (fx.type === 'smoke' ? 0.55 : 0.35) * fade);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = withAlpha(NADE[fx.type]!, 0.8 * fade);
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // A pop: a ring that grows and fades.
        ctx.strokeStyle = withAlpha(NADE[fx.type] ?? '#fff', 1 - age);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, 10 + 50 * age, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = withAlpha(NADE[fx.type] ?? '#fff', 0.5 * (1 - age));
        ctx.fill();
      }
    }

    // Grenades in flight: the path so far, dashed, and the grenade.
    for (const g of replay.grenades ?? []) {
      const start = g.path[0]![0];
      const end = g.path[g.path.length - 1]![0];
      if (tick < start || tick > end + TRAIL_TICKS) continue;
      const fade = tick > end ? 1 - (tick - end) / TRAIL_TICKS : 1;
      const c = NADE[g.type] ?? '#fff';
      ctx.strokeStyle = withAlpha(c, 0.75 * fade);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      let head: [number, number] | null = null;
      for (let i = 0; i < g.path.length; i += 1) {
        const [pt, gx, gy] = g.path[i]!;
        if (pt > tick) {
          // Blend to where it is between two samples.
          const prev = g.path[i - 1];
          if (prev) {
            const f = (tick - prev[0]) / Math.max(1, pt - prev[0]);
            head = [px(prev[1] + (gx - prev[1]) * f), py(prev[2] + (gy - prev[2]) * f)];
            ctx.lineTo(head[0], head[1]);
          }
          break;
        }
        if (i === 0) ctx.moveTo(px(gx), py(gy));
        else ctx.lineTo(px(gx), py(gy));
        head = [px(gx), py(gy)];
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (head && tick <= end) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(head[0], head[1], 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0b0d10';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // The bomb: planted (red, pulsing) until it is defused (green) or goes off.
    const roundNow = replay.rounds.find((r) => tick >= r.startTick && tick <= r.endTick);
    const plant = (replay.bomb ?? []).find(
      (b) =>
        b.kind === 'planted' &&
        b.tick <= tick &&
        (!roundNow || (b.tick >= roundNow.startTick && b.tick <= roundNow.endTick))
    );
    if (plant) {
      const after = (replay.bomb ?? []).find(
        (b) => b.kind !== 'planted' && b.tick >= plant.tick && b.tick <= tick
      );
      const x = px(plant.x);
      const y = py(plant.y);
      if (after?.kind === 'exploded') {
        const age = Math.min(1, (tick - after.tick) / 64);
        ctx.fillStyle = withAlpha('#ff7a1a', 0.5 * (1 - age));
        ctx.beginPath();
        ctx.arc(x, y, 30 + 120 * age, 0, Math.PI * 2);
        ctx.fill();
      }
      const pulse = after ? 0 : (Math.sin(tick / 8) + 1) / 2;
      ctx.fillStyle =
        after?.kind === 'defused' ? color.pick : withAlpha('#ff3b30', 0.75 + 0.25 * pulse);
      ctx.fillRect(x - 10, y - 7, 20, 14);
      ctx.strokeStyle = '#0b0d10';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 10, y - 7, 20, 14);
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('C4', x, y + 4);
    }

    // Tracers: a short yellow streak flying from the gun to where the shot
    // ended (the hit, or along the aim for a miss), then a spark on a hit.
    for (const shot of replay.shots ?? []) {
      const [st, , sx, sy, syaw, hx, hy] = shot;
      if (st > tick || tick - st > FLIGHT_TICKS + SPARK_TICKS) continue;
      const x1 = px(sx);
      const y1 = py(sy);
      const a = (syaw * Math.PI) / 180;
      const x2 = hx !== null ? px(hx) : px(sx + Math.cos(a) * MISS_UNITS);
      const y2 = hy !== null ? py(hy) : py(sy + Math.sin(a) * MISS_UNITS);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const f = Math.min(1, (tick - st) / FLIGHT_TICKS);
      if (f < 1) {
        const hxp = x1 + (x2 - x1) * f;
        const hyp = y1 + (y2 - y1) * f;
        const back = Math.min(TRAIL_PX, len * f) / len;
        const txp = hxp - (x2 - x1) * back;
        const typ = hyp - (y2 - y1) * back;
        const trail = ctx.createLinearGradient(txp, typ, hxp, hyp);
        trail.addColorStop(0, 'rgba(255, 214, 90, 0)');
        trail.addColorStop(1, 'rgba(255, 236, 150, 0.95)');
        ctx.strokeStyle = trail;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(txp, typ);
        ctx.lineTo(hxp, hyp);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (hx !== null) {
        const age = (tick - st - FLIGHT_TICKS) / SPARK_TICKS;
        ctx.fillStyle = `rgba(255, 220, 120, ${0.9 * (1 - age)})`;
        ctx.beginPath();
        ctx.arc(x2, y2, 3 + 6 * age, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Recent kills: a cross where the victim fell.
    for (const k of replay.kills) {
      if (!k.pos || k.tick > tick || tick - k.tick > KILL_SHOWN_TICKS) continue;
      const alpha = 1 - (tick - k.tick) / KILL_SHOWN_TICKS;
      const x = px(k.pos[0]);
      const y = py(k.pos[1]);
      ctx.strokeStyle = withAlpha(color.ban, alpha);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 9);
      ctx.lineTo(x + 9, y + 9);
      ctx.moveTo(x + 9, y - 9);
      ctx.lineTo(x - 9, y + 9);
      ctx.stroke();
    }

    for (const s of state) {
      if (!s) continue;
      const [x0, y0, yaw, hp, side, z] = s.p;
      const x = px(x0);
      const y = py(y0);
      const here = onLevel(z);
      ctx.globalAlpha = here ? 1 : 0.3;
      const c = sideColor(side);
      // Where they look: a soft cone, and a pointer on the ring.
      const a = (-yaw * Math.PI) / 180;
      if (hp > 0) {
        const cone = ctx.createRadialGradient(x, y, DOT, x, y, CONE);
        cone.addColorStop(0, withAlpha(c, 0.45));
        cone.addColorStop(1, withAlpha(c, 0));
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, CONE, a - CONE_HALF_ANGLE, a + CONE_HALF_ANGLE);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (DOT + 9), y + Math.sin(a) * (DOT + 9));
        ctx.lineTo(x + Math.cos(a + 0.5) * (DOT + 1), y + Math.sin(a + 0.5) * (DOT + 1));
        ctx.lineTo(x + Math.cos(a - 0.5) * (DOT + 1), y + Math.sin(a - 0.5) * (DOT + 1));
        ctx.closePath();
        ctx.fill();
      }
      // The avatar inside a ring of the side's colour; the ring's white part is health.
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, DOT + 2, 0, Math.PI * 2);
      ctx.fill();
      const face = faces[s.id];
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, DOT - 1, 0, Math.PI * 2);
      ctx.clip();
      if (face && face.complete && face.naturalWidth > 0) {
        ctx.drawImage(face, x - DOT + 1, y - DOT + 1, (DOT - 1) * 2, (DOT - 1) * 2);
      } else {
        ctx.fillStyle = '#1b1f26';
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, DOT + 3, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * hp) / 100);
      ctx.stroke();
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(s.name.slice(0, 14), x, y - DOT - 10);
      ctx.shadowBlur = 0;
      // Flashed: a white burst above them, shrinking as the blindness wears off.
      const blind = (replay.blinds ?? []).find(
        ([who, from, to]) => replay.players[who]?.id === s.id && tick >= from && tick < to
      );
      if (blind) {
        const left = (blind[2] - tick) / Math.max(1, blind[2] - blind[1]);
        const bx = x + DOT + 8;
        const by = y - DOT - 4;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        for (let r = 0; r < 8; r += 1) {
          const ra = (r * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(bx + Math.cos(ra) * 6, by + Math.sin(ra) * 6);
          ctx.lineTo(bx + Math.cos(ra) * (6 + 6 * left), by + Math.sin(ra) * (6 + 6 * left));
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fill();
        // The avatar washes out while they are blind.
        ctx.fillStyle = withAlpha('#ffffff', 0.6 * left);
        ctx.beginPath();
        ctx.arc(x, y, DOT - 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Damage numbers: each hit flies out of the player, pops, and fades.
    for (const [dt, who, amount, hs] of replay.damage ?? []) {
      if (dt > tick || tick - dt > DAMAGE_TICKS) continue;
      const at = state[who];
      if (!at) continue;
      const life = (tick - dt) / DAMAGE_TICKS;
      const ease = 1 - (1 - life) * (1 - life);
      const a = hitAngle(dt, who);
      const x = px(at.p[0]) + Math.cos(a) * (DOT + 6 + 46 * ease);
      const y = py(at.p[1]) + Math.sin(a) * (DOT + 6 + 46 * ease) - 18 * ease;
      const pop = life < 0.15 ? 0.6 + (life / 0.15) * 0.9 : 1.5 - Math.min(0.5, (life - 0.15) * 2);
      const size = (18 + Math.min(amount, 100) * 0.16) * pop;
      ctx.globalAlpha = life < 0.6 ? 1 : 1 - (life - 0.6) / 0.4;
      ctx.font = `800 ${size.toFixed(1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#0b0d10';
      ctx.strokeText(`-${amount}`, x, y);
      ctx.fillStyle = hs ? '#ff3b30' : amount >= 50 ? '#ffb020' : '#ffe9a8';
      ctx.fillText(`-${amount}`, x, y);
      ctx.globalAlpha = 1;
    }
  }, [replay, state, tick, transform, radar, images, onLevel, faces]);

  if (missing) return null;
  if (!replay) return null;

  const round = replay.rounds.find((r) => tick >= r.startTick && tick <= r.endTick) ?? null;
  // The kill feed, as CS2 shows it: the last kills of the past few seconds.
  const feed = replay.kills
    .filter((k) => k.tick <= tick && tick - k.tick < FEED_SECONDS * replay.tickrate)
    .slice(-FEED_ROWS);
  const sideOf = (id: string | null) => state.find((x) => x?.id === id)?.p[4] ?? null;
  const feedName = (id: string | null) => (
    <Box component="span" sx={{ fontWeight: 600, color: FEED_SIDE[sideOf(id) ?? 0] ?? '#fff' }}>
      {nameOf(id)}
    </Box>
  );
  const nameOf = (id: string | null) => replay.players.find((p) => p.id === id)?.name ?? '—';
  const alive = (team1: boolean) => state.filter((s) => s && team1Ids.has(s.id) === team1);

  return (
    <Panel sx={{ p: { xs: 1.5, md: 2.5 }, mt: 2 }} data-testid="replay-viewer">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 260px' },
          gap: 2,
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            borderRadius: radii.md,
            overflow: 'hidden',
            bgcolor: color.paper3,
          }}
        >
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            role="img"
            aria-label={t('analysis.replay.aria', { map: replay.map })}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              display: 'grid',
              gap: 0.5,
              maxWidth: '60%',
            }}
          >
            {feed.map((k, i) => (
              <Box
                key={`${k.tick}-${i}`}
                data-testid="replay-killfeed-row"
                sx={{
                  justifySelf: 'end',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1,
                  py: 0.4,
                  borderRadius: '3px',
                  bgcolor: 'rgba(0, 0, 0, 0.62)',
                  color: '#fff',
                  fontSize: textSize.xs,
                  whiteSpace: 'nowrap',
                  animation: 'feedIn 160ms ease-out',
                  '@keyframes feedIn': {
                    from: { opacity: 0, transform: 'translateX(12px)' },
                    to: { opacity: 1, transform: 'none' },
                  },
                }}
              >
                {k.attackerBlind && (
                  <SunIcon size={12} weight="fill" aria-label={t('analysis.feed.blind')} />
                )}
                {k.attacker ? feedName(k.attacker) : null}
                {k.assister && k.assister !== k.attacker && (
                  <>
                    <Box component="span" sx={{ opacity: 0.7 }}>
                      +
                    </Box>
                    {k.assistedFlash && (
                      <LightningIcon
                        size={12}
                        weight="fill"
                        aria-label={t('analysis.feed.flashAssist')}
                      />
                    )}
                    {feedName(k.assister)}
                  </>
                )}
                <Box
                  component="span"
                  sx={{ opacity: 0.85, fontFamily: mono.fontFamily, fontSize: '0.7rem' }}
                >
                  {weaponName(k.weapon)}
                </Box>
                {k.inAir && <ArrowUpIcon size={12} aria-label={t('analysis.feed.inAir')} />}
                {k.noScope && <EyeSlashIcon size={12} aria-label={t('analysis.feed.noScope')} />}
                {k.throughSmoke && (
                  <CloudIcon size={12} weight="fill" aria-label={t('analysis.feed.smoke')} />
                )}
                {k.penetrated && <WallIcon size={12} aria-label={t('analysis.feed.wallbang')} />}
                {k.headshot && (
                  <CrosshairIcon
                    size={12}
                    weight="bold"
                    color="#ff5a4a"
                    aria-label={t('analysis.feed.headshot')}
                  />
                )}
                {feedName(k.victim)}
              </Box>
            ))}
          </Box>
          {!radar && (
            <Typography
              sx={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                fontSize: textSize.xs,
                color: color.muted,
              }}
            >
              {t('analysis.replay.noRadar')}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
          {[true, false].map((team1) => (
            <Box key={String(team1)} sx={{ display: 'grid', gap: 0.5 }}>
              <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>
                {t(team1 ? 'analysis.team1' : 'analysis.team2')}
              </Typography>
              {replay.players
                .filter((p) => team1Ids.has(p.id) === team1)
                .map((p) => {
                  const s = state.find((x) => x?.id === p.id);
                  const hp = s?.p[3] ?? 0;
                  return (
                    <Box
                      key={p.id}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) 2.5rem',
                        gap: 1,
                        alignItems: 'center',
                        opacity: hp > 0 ? 1 : 0.4,
                        fontSize: textSize.sm,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Box
                          sx={{
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.name}
                        </Box>
                        <Box sx={{ height: 3, borderRadius: 2, bgcolor: color.paper3, mt: 0.25 }}>
                          <Box
                            sx={{
                              height: 3,
                              width: `${hp}%`,
                              borderRadius: 2,
                              bgcolor: s ? sideColor(s.p[4]) : color.rule,
                            }}
                          />
                        </Box>
                      </Box>
                      <Box
                        sx={{ fontFamily: mono.fontFamily, textAlign: 'right', color: color.ink2 }}
                      >
                        {hp}
                      </Box>
                    </Box>
                  );
                })}
              {alive(team1).length === 0 && (
                <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>—</Typography>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2, flexWrap: 'wrap' }}>
        <ButtonBase
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? t('analysis.replay.pause') : t('analysis.replay.play')}
          data-testid="replay-play"
          sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            bgcolor: color.accent,
            color: '#fff',
            flex: 'none',
          }}
        >
          {playing ? <PauseIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />}
        </ButtonBase>
        <Select
          size="small"
          value={round?.number ?? ''}
          displayEmpty
          onChange={(e) => {
            const r = replay.rounds.find((x) => x.number === Number(e.target.value));
            if (r) setTick(r.startTick);
          }}
          inputProps={{ 'aria-label': t('analysis.rounds') }}
          sx={{ minWidth: 120 }}
        >
          {replay.rounds.map((r) => (
            <MenuItem key={r.number} value={r.number}>
              {t('analysis.roundLabel', { n: r.number })}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          inputProps={{ 'aria-label': t('analysis.replay.speed') }}
        >
          {SPEEDS.map((s) => (
            <MenuItem key={s} value={s}>
              {s}×
            </MenuItem>
          ))}
        </Select>
        {levels.length > 1 && (
          <Select
            size="small"
            value={level}
            onChange={(e) => setLevel(String(e.target.value))}
            inputProps={{ 'aria-label': t('analysis.replay.level') }}
          >
            {levels.map((l) => (
              <MenuItem key={l.level} value={l.level}>
                {t(`analysis.replay.levels.${l.level}`, { defaultValue: l.level })}
              </MenuItem>
            ))}
          </Select>
        )}
        <Box
          sx={{
            fontFamily: mono.fontFamily,
            fontSize: textSize.xs,
            color: color.muted,
            minWidth: 48,
            textAlign: 'right',
          }}
        >
          {round
            ? (() => {
                const s = Math.max(0, Math.round((tick - round.startTick) / replay.tickrate));
                return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
              })()
            : ''}
        </Box>
      </Box>
      <ReplayTimeline
        first={first}
        last={last}
        tick={tick}
        tickrate={replay.tickrate}
        rounds={replay.rounds}
        marks={marks}
        label={t('analysis.replay.scrub')}
        roundLabel={(n) => t('analysis.roundLabel', { n })}
        onSeek={setTick}
      />
    </Panel>
  );
}
