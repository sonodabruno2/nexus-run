// ============================================================
// Progressão permanente (Abrigo NEXUS) — créditos + upgrades.
// Persistido em localStorage.
// ============================================================

export interface MetaUpgradeDef {
  id: string;
  name: string;
  desc: string;
  max: number;
  baseCost: number;
  costStep: number; // custo sobe a cada nível
}

export const META_UPGRADES: MetaUpgradeDef[] = [
  { id: "vitality", name: "Centro de Treinamento — Vitalidade", desc: "+20 vida inicial por nível.", max: 5, baseCost: 60, costStep: 50 },
  { id: "power", name: "Centro de Treinamento — Potência", desc: "+6% dano inicial por nível.", max: 5, baseCost: 80, costStep: 60 },
  { id: "cadence", name: "Centro de Treinamento — Cadência", desc: "+5% cadência inicial por nível.", max: 5, baseCost: 80, costStep: 60 },
  { id: "magnet", name: "Ímã de Coleta", desc: "+32% alcance pra puxar a XP do chão, por nível.", max: 5, baseCost: 50, costStep: 45 },
  { id: "greed", name: "Radar de Rotas", desc: "+12% créditos por run.", max: 4, baseCost: 70, costStep: 55 },
  { id: "reroll", name: "Núcleo de IA Capturado", desc: "+1 reroll de carta por run.", max: 3, baseCost: 120, costStep: 90 },
  { id: "shield", name: "Blindagem de Entrada", desc: "+15 escudo inicial por nível.", max: 4, baseCost: 70, costStep: 55 },
  { id: "recover", name: "Recuperação de Dados", desc: "Recupera créditos que saem da tela.", max: 1, baseCost: 150, costStep: 0 },
  // ---- MECH (robô-dono) ----
  { id: "mech_cannon", name: "Mech — Canhão", desc: "+12% dano do poder do mech por nível.", max: 5, baseCost: 90, costStep: 70 },
  { id: "mech_reactor", name: "Mech — Reator", desc: "+8% frequência do poder do mech por nível.", max: 4, baseCost: 100, costStep: 70 },
  { id: "mech_armor", name: "Mech — Blindagem", desc: "+18 de escudo inicial (do mech) por nível.", max: 4, baseCost: 80, costStep: 60 },
];

export interface MetaState {
  credits: number;
  upgrades: Record<string, number>;
  bestTime: number;
  runs: number;
}

const KEY = "nexus_run_meta_v1";

export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const m = JSON.parse(raw) as MetaState;
      m.upgrades = m.upgrades || {};
      return m;
    }
  } catch {
    /* ignora */
  }
  return { credits: 0, upgrades: {}, bestTime: 0, runs: 0 };
}

export function saveMeta(m: MetaState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ignora */
  }
}

export function upgradeLevel(m: MetaState, id: string): number {
  return m.upgrades[id] || 0;
}

export function upgradeCost(def: MetaUpgradeDef, level: number): number {
  return def.baseCost + def.costStep * level;
}

export function buyUpgrade(m: MetaState, def: MetaUpgradeDef): boolean {
  const lvl = upgradeLevel(m, def.id);
  if (lvl >= def.max) return false;
  const cost = upgradeCost(def, lvl);
  if (m.credits < cost) return false;
  m.credits -= cost;
  m.upgrades[def.id] = lvl + 1;
  saveMeta(m);
  return true;
}
