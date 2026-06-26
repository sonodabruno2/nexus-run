import type { MechBonus } from "../types";

// ============================================================
// MECH — o robô gigante dono do personagem. Acompanha a fase,
// tem um PODER periódico, e melhora com itens roguelike (de baús).
// ============================================================

export const MECH_BASE_DAMAGE = 26; // dano do poder (feixe)
export const MECH_BASE_CD = 7; // segundos entre poderes

export interface MechUpgradeDef {
  id: string;
  name: string;
  desc: string;
  apply: (m: MechBonus) => void;
}

// Upgrades ROGUELIKE (durante a partida, vindos de baús)
export const MECH_UPGRADES: MechUpgradeDef[] = [
  { id: "cannon", name: "Canhão Sobrecarregado", desc: "+25% dano do poder do mech.", apply: (m) => (m.powerDamageMul *= 1.25) },
  { id: "reactor", name: "Reator Acelerado", desc: "+18% frequência do poder.", apply: (m) => (m.powerRateMul *= 0.82) },
  { id: "wave", name: "Onda Ampliada", desc: "+30% área do poder.", apply: (m) => (m.powerAreaMul *= 1.3) },
  { id: "armor", name: "Blindagem do Mech", desc: "+25 de escudo.", apply: (m) => (m.shieldAdd += 25) },
  { id: "core", name: "Núcleo Regenerativo", desc: "+1.5 vida/seg.", apply: (m) => (m.regen += 1.5) },
  { id: "collector", name: "Coletor do Mech", desc: "+40% alcance de coleta de XP.", apply: (m) => (m.magnetMul *= 1.4) },
];
