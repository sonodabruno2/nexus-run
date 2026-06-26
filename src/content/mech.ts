import type { MechBonus } from "../types";

// ============================================================
// MECH — o robô gigante dono do personagem. Acompanha a fase,
// tem um PODER periódico, e melhora com itens roguelike (de baús).
// ============================================================

export const MECH_BASE_DAMAGE = 26; // dano do poder (feixe)
export const MECH_BASE_CD = 7; // segundos entre poderes
export const MECH_BASE_HP = 140; // vida do mech (game over se zerar)

export interface MechUpgradeDef {
  id: string;
  name: string;
  desc: string;
  apply: (m: MechBonus) => void;
}

// Upgrades ROGUELIKE do mech. Vêm de BAÚS RAROS — por isso cada um é
// FORTE e você ESCOLHE entre 3 (como as cartas de nível).
export const MECH_UPGRADES: MechUpgradeDef[] = [
  { id: "cannon", name: "Canhão Sobrecarregado", desc: "+45% de dano do feixe do mech.", apply: (m) => (m.powerDamageMul *= 1.45) },
  { id: "reactor", name: "Reator Acelerado", desc: "+28% de frequência do feixe.", apply: (m) => (m.powerRateMul *= 0.72) },
  { id: "wave", name: "Onda de Choque", desc: "+55% de área (largura) do feixe.", apply: (m) => (m.powerAreaMul *= 1.55) },
  { id: "twin", name: "Feixe Duplo", desc: "+1 feixe: o mech varre outra faixa do cenário.", apply: (m) => (m.beams += 1) },
  { id: "war", name: "Protocolo de Guerra", desc: "+25% de dano E +20% de frequência do feixe.", apply: (m) => { m.powerDamageMul *= 1.25; m.powerRateMul *= 0.8; } },
  { id: "armor", name: "Blindagem Pesada", desc: "+70 de vida máxima do mech (e cura).", apply: (m) => (m.hpAdd += 70) },
  { id: "core", name: "Núcleo Regenerativo", desc: "+3 vida/seg para o personagem.", apply: (m) => (m.regen += 3) },
  { id: "collector", name: "Coletor Gravitacional", desc: "+80% de alcance de coleta de XP.", apply: (m) => (m.magnetMul *= 1.8) },
];

// sorteia N upgrades DISTINTOS pra tela de escolha
export function pickMechChoices(n: number, rand: () => number): MechUpgradeDef[] {
  const pool = MECH_UPGRADES.slice();
  const out: MechUpgradeDef[] = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}
