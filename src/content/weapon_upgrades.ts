import type { UpgradeBonus } from "../types";

// ============================================================
// UPGRADES DEDICADOS por arma (cartas "★ MOD DE ARMA").
// REGRA: cada poder tem 20+ melhorias na cadeia (somando os `max`).
// ============================================================

export interface WeaponUpgradeDef {
  id: string;
  name: string;
  desc: string;
  max: number;
  apply: (u: UpgradeBonus) => void;
}

// ---- bloco compartilhado por TODAS as armas de tiro (rifle/shotgun/rajada) ----
const RANGED: WeaponUpgradeDef[] = [
  { id: "dmg", name: "Munição Pesada", desc: "+18% de dano.", max: 5, apply: (u) => (u.damageMul *= 1.18) },
  { id: "cad", name: "Gatilho Leve", desc: "+15% de cadência.", max: 4, apply: (u) => (u.cooldownMul *= 0.85) },
  { id: "reload", name: "Recarga Tática", desc: "+15% de velocidade de recarga.", max: 3, apply: (u) => (u.reloadMul *= 0.85) },
  { id: "mag", name: "Pente Estendido", desc: "+3 de munição.", max: 3, apply: (u) => (u.magAdd += 3) },
  { id: "pierce", name: "Perfuração", desc: "+1 inimigo perfurado.", max: 3, apply: (u) => (u.pierceAdd += 1) },
  { id: "crit", name: "Mira Crítica", desc: "+12% de crítico (×2 dano).", max: 3, apply: (u) => (u.critChance += 0.12) },
  { id: "bounce", name: "Ricochete", desc: "+1 ricochete na parede.", max: 2, apply: (u) => (u.bouncesAdd += 1) },
  { id: "caliber", name: "Calibre Grosso", desc: "Balas maiores e +10% dano.", max: 2, apply: (u) => { u.projSizeMul *= 1.3; u.damageMul *= 1.1; } },
];

export const WEAPON_UPGRADES: Record<string, WeaponUpgradeDef[]> = {
  // ---- Rifle Cadenciado (28 melhorias) ----
  pulse_rifle: [
    ...RANGED,
    { id: "rf_long", name: "Cano Longo", desc: "+alcance e +1 perfuração.", max: 3, apply: (u) => { u.rangeMul *= 1.2; u.pierceAdd += 1; } },
  ],
  // ---- Dispersor / shotgun (31 melhorias) ----
  shotgun: [
    ...RANGED,
    { id: "sg_pellets", name: "Cano Duplo", desc: "+2 balas por disparo.", max: 3, apply: (u) => (u.pelletsAdd += 2) },
    { id: "sg_choke", name: "Cano Estriado", desc: "+45% alcance e leque mais fechado.", max: 3, apply: (u) => { u.rangeMul *= 1.45; u.spreadMul *= 0.82; } },
  ],
  // ---- Rajada Tripla / burst (29 melhorias) ----
  burst: [
    ...RANGED,
    { id: "br_count", name: "Pente Ampliado", desc: "+1 bala na rajada.", max: 2, apply: (u) => { u.burstAdd += 1; u.magAdd += 1; } },
    { id: "br_focus", name: "Foco", desc: "Leque mais fechado (mais preciso).", max: 2, apply: (u) => (u.spreadMul *= 0.8) },
  ],
  // ---- Martelo de Choque (24 melhorias) ----
  hammer: [
    { id: "hm_dmg", name: "Cabeça de Aço", desc: "+20% de dano.", max: 5, apply: (u) => (u.damageMul *= 1.2) },
    { id: "hm_reach", name: "Cabo Longo", desc: "+alcance do golpe.", max: 4, apply: (u) => (u.reachAdd += 22) },
    { id: "hm_arc", name: "Golpe Largo", desc: "+arco (acerta mais inimigos).", max: 3, apply: (u) => (u.arcAdd += 0.4) },
    { id: "hm_fast", name: "Golpe Rápido", desc: "+15% de velocidade do golpe.", max: 4, apply: (u) => (u.cooldownMul *= 0.85) },
    { id: "hm_knock", name: "Empurrão", desc: "+40% de impulso cinético.", max: 3, apply: (u) => (u.knockbackMul *= 1.4) },
    { id: "hm_crit", name: "Esmagamento", desc: "+12% de crítico (×2 dano).", max: 3, apply: (u) => (u.critChance += 0.12) },
    { id: "hm_heavy", name: "Cabeça Pesada", desc: "+15% dano e +empurrão.", max: 2, apply: (u) => { u.damageMul *= 1.15; u.knockbackMul *= 1.3; } },
  ],
};

// total de melhorias (somando max) de um poder — usado pra garantir 20+
export function upgradeChainSize(weaponId: string): number {
  return (WEAPON_UPGRADES[weaponId] || []).reduce((a, u) => a + u.max, 0);
}
