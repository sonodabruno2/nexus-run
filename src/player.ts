import {
  baseStats,
  baseUpgradeBonus,
  type CharacterDef,
  type Stats,
  type WeaponInst,
} from "./types";
import { PASSIVES, MAX_PASSIVE_LEVEL } from "./content/passives";
import { WEAPONS, BASE_WEAPONS, FUSIONS, MAX_WEAPON_LEVEL } from "./content/weapons";
import { WEAPON_UPGRADES } from "./content/weapon_upgrades";
import { rng } from "./core/rng";
import type { MetaState } from "./meta";
import { upgradeLevel } from "./meta";

export const MAX_WEAPON_SLOTS = 6;
export const MAX_PASSIVE_SLOTS = 6;
// as 4 armas "principais" (cada personagem começa com uma) — priorizadas como
// opção de nova arma nas cartas de nível, pra você poder trocar/combinar
export const MAIN_WEAPON_IDS = ["pulse_rifle", "shotgun", "burst", "hammer"];

// cria a instância de uma arma já com o pente cheio (se tiver munição)
export function makeWeapon(defId: string): WeaponInst {
  const def = WEAPONS[defId];
  return { defId, level: 1, timer: 0, ammo: def?.mag ?? 0, reloadTimer: 0, up: baseUpgradeBonus(), taken: {} };
}

export interface Player {
  char: CharacterDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  shield: number;
  speed: number;
  level: number;
  xp: number;
  xpToNext: number;
  credits: number;
  invuln: number;
  weapons: WeaponInst[];
  passives: Record<string, number>; // id -> nível
  stats: Stats;
  ultCharge: number; // 0..1 (carrega MATANDO inimigos, devagar)
  ultReadyTime: number; // segundos com a ult cheia (auto-dispara após X)
  ultActive: number; // segundos restantes de ultimate
  rerolls: number;
  facing: number; // sempre 1 (corpo olha pra frente/direita)
  aimAngle: number; // direção da mira (radianos), controlada pelo mouse
}

export function createPlayer(char: CharacterDef, meta: MetaState): Player {
  const vit = upgradeLevel(meta, "vitality");
  const shieldLvl = upgradeLevel(meta, "shield");
  const maxHp = 100 + vit * 20;
  const p: Player = {
    char,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 15,
    hp: maxHp,
    maxHp,
    shield: shieldLvl * 15,
    speed: 230,
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    credits: 0,
    invuln: 0,
    weapons: [makeWeapon(char.startWeapon)],
    passives: {},
    stats: baseStats(),
    ultCharge: 0,
    ultReadyTime: 0,
    ultActive: 0,
    rerolls: upgradeLevel(meta, "reroll"),
    facing: 1,
    aimAngle: 0,
  };
  if (char.startPassive) p.passives[char.startPassive] = 1;
  recomputeStats(p, meta);
  return p;
}

export function recomputeStats(p: Player, meta: MetaState) {
  const s = baseStats();
  // bônus permanentes
  s.damageMul *= 1 + 0.06 * upgradeLevel(meta, "power");
  s.fireRateMul *= 1 + 0.05 * upgradeLevel(meta, "cadence");
  s.pickupRangeMul *= 1 + 0.32 * upgradeLevel(meta, "magnet");
  // passivas
  for (const [id, lvl] of Object.entries(p.passives)) {
    const def = PASSIVES[id];
    if (!def) continue;
    for (let i = 0; i < lvl; i++) def.apply(s);
  }
  p.stats = s;
  const newMax = (100 + upgradeLevel(meta, "vitality") * 20) + s.maxHpAdd;
  if (newMax !== p.maxHp) {
    const ratio = p.hp / p.maxHp;
    p.maxHp = newMax;
    p.hp = Math.min(newMax, ratio * newMax);
  }
  p.speed = 230 * s.moveSpeedMul;
}

export function xpForLevel(level: number): number {
  return Math.floor(10 + level * 8 + level * level * 2.2);
}

// ---------------- Cartas de level-up ----------------

export type Card =
  | { kind: "weapon-new"; id: string; name: string; desc: string; color: string }
  | { kind: "weapon-up"; id: string; name: string; desc: string; color: string }
  | { kind: "weapon-mod"; weaponId: string; upId: string; name: string; desc: string; color: string }
  | { kind: "passive-new"; id: string; name: string; desc: string; color: string }
  | { kind: "passive-up"; id: string; name: string; desc: string; color: string }
  | { kind: "fusion"; result: string; base: string; name: string; desc: string; color: string }
  | { kind: "heal"; name: string; desc: string; color: string };

export function generateCards(p: Player, count: number): Card[] {
  const pool: Card[] = [];

  // Fusões disponíveis (prioridade alta, aparecem sempre que possível)
  const fusionCards: Card[] = [];
  for (const f of FUSIONS) {
    const baseInst = p.weapons.find((w) => w.defId === f.base);
    if (!baseInst || baseInst.level < MAX_WEAPON_LEVEL) continue;
    const hasReqWeapon = f.req.weapon ? p.weapons.some((w) => w.defId === f.req.weapon) : true;
    const hasReqPassive = f.req.passive ? (p.passives[f.req.passive] || 0) > 0 : true;
    if (hasReqWeapon && hasReqPassive) {
      const def = WEAPONS[f.result];
      fusionCards.push({
        kind: "fusion",
        result: f.result,
        base: f.base,
        name: "⚡ " + def.name,
        desc: "FUSÃO — " + def.desc,
        color: def.color,
      });
    }
  }

  // Upgrades de arma existente
  for (const w of p.weapons) {
    const def = WEAPONS[w.defId];
    if (def.evolved) continue;
    if (w.level < MAX_WEAPON_LEVEL) {
      pool.push({
        kind: "weapon-up",
        id: w.defId,
        name: `${def.name} ${roman(w.level + 1)}`,
        desc: levelUpDesc(def.behavior),
        color: def.color,
      });
    }
  }
  // Upgrades DEDICADOS de cada arma que o jogador tem (1 garantido por escolha)
  const modCards: Card[] = [];
  for (const w of p.weapons) {
    const ups = WEAPON_UPGRADES[w.defId];
    if (!ups) continue;
    const def = WEAPONS[w.defId];
    for (const u of ups) {
      if ((w.taken[u.id] || 0) >= u.max) continue;
      modCards.push({ kind: "weapon-mod", weaponId: w.defId, upId: u.id, name: `${def.name}: ${u.name}`, desc: u.desc, color: def.color });
    }
  }
  // Novas armas
  if (p.weapons.length < MAX_WEAPON_SLOTS) {
    for (const def of BASE_WEAPONS) {
      if (p.weapons.some((w) => w.defId === def.id)) continue;
      pool.push({ kind: "weapon-new", id: def.id, name: def.name, desc: def.desc, color: def.color });
    }
  }
  // Upgrades de passiva
  for (const [id, lvl] of Object.entries(p.passives)) {
    if (lvl < MAX_PASSIVE_LEVEL) {
      const def = PASSIVES[id];
      pool.push({ kind: "passive-up", id, name: `${def.name} ${roman(lvl + 1)}`, desc: def.desc, color: "#cbd5e1" });
    }
  }
  // Novas passivas
  if (Object.keys(p.passives).length < MAX_PASSIVE_SLOTS) {
    for (const def of Object.values(PASSIVES)) {
      if (p.passives[def.id]) continue;
      pool.push({ kind: "passive-new", id: def.id, name: def.name, desc: def.desc, color: "#cbd5e1" });
    }
  }

  const chosen: Card[] = [];
  // Garante até 1 fusão se houver
  if (fusionCards.length) chosen.push(rng.pick(fusionCards));
  // Garante até 1 upgrade DEDICADO de arma se houver
  if (modCards.length && chosen.length < count) chosen.push(rng.pick(modCards));
  // Garante a opção de PEGAR OUTRA ARMA (prioriza as 4 principais) enquanto
  // houver slot — assim dá pra montar a build com várias armas e, depois,
  // as melhorias dedicadas de cada uma vão aparecendo.
  let workPool = pool;
  const newWeaponCards = pool.filter((c) => c.kind === "weapon-new");
  if (newWeaponCards.length && chosen.length < count) {
    const mains = newWeaponCards.filter((c) => c.kind === "weapon-new" && MAIN_WEAPON_IDS.includes(c.id));
    const pickedWeapon = rng.pick(mains.length ? mains : newWeaponCards);
    chosen.push(pickedWeapon);
    workPool = pool.filter((c) => c !== pickedWeapon); // não repete na amostragem
  }
  const remaining = count - chosen.length;
  const sampled = rng.sample(workPool, Math.max(0, remaining));
  chosen.push(...sampled);

  // fallback se faltou opção
  while (chosen.length < count) {
    chosen.push({ kind: "heal", name: "Reparo de Emergência", desc: "Recupera 35% da vida.", color: "#7CFF8E" });
    break;
  }
  return chosen;
}

export function applyCard(p: Player, c: Card, meta: MetaState) {
  switch (c.kind) {
    case "weapon-new":
      p.weapons.push(makeWeapon(c.id));
      break;
    case "weapon-up": {
      const w = p.weapons.find((x) => x.defId === c.id);
      if (w) w.level++;
      break;
    }
    case "weapon-mod": {
      const w = p.weapons.find((x) => x.defId === c.weaponId);
      const u = WEAPON_UPGRADES[c.weaponId]?.find((x) => x.id === c.upId);
      if (w && u) { u.apply(w.up); w.taken[c.upId] = (w.taken[c.upId] || 0) + 1; }
      break;
    }
    case "passive-new":
      p.passives[c.id] = 1;
      break;
    case "passive-up":
      p.passives[c.id] = (p.passives[c.id] || 0) + 1;
      break;
    case "fusion": {
      const w = p.weapons.find((x) => x.defId === c.base);
      if (w) {
        w.defId = c.result;
        w.level = MAX_WEAPON_LEVEL;
        w.ammo = WEAPONS[c.result]?.mag ?? 0;
        w.reloadTimer = 0;
      }
      break;
    }
    case "heal":
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
      break;
  }
  recomputeStats(p, meta);
}

function roman(n: number): string {
  return ["", "I", "II", "III", "IV", "V", "VI"][n] || String(n);
}

function levelUpDesc(behavior: string): string {
  switch (behavior) {
    case "frontal": return "+dano, +pente e recarga mais rápida.";
    case "melee": return "+dano, +alcance e golpe mais rápido.";
    case "rail": return "+dano e recarga mais rápida.";
    case "ricochet": return "+1 ricochete e +dano.";
    case "mine": return "+dano e mais minas.";
    case "drone": return "+dano e mais cadência.";
    case "chain": return "+saltos e +dano.";
    case "gravity": return "+raio e +dano.";
    case "nanite": return "+nanites e +dano contínuo.";
    default: return "+dano.";
  }
}
