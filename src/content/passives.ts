import type { PassiveDef } from "../types";

// ============================================================
// PASSIVAS (8) — acumulam efeito por nível em Stats.
// ============================================================

export const MAX_PASSIVE_LEVEL = 5;

const P: PassiveDef[] = [
  {
    id: "cadence",
    name: "Núcleo de Cadência",
    desc: "+12% velocidade de ataque.",
    apply: (s) => (s.fireRateMul *= 1.12),
  },
  {
    id: "recharge",
    name: "Bobina de Recarga",
    desc: "+8% dano geral.",
    apply: (s) => (s.damageMul *= 1.08),
  },
  {
    id: "area_amp",
    name: "Amplificador de Área",
    desc: "+15% área e +10% duração de efeitos.",
    apply: (s) => {
      s.areaMul *= 1.15;
      s.durationMul *= 1.1;
    },
  },
  {
    id: "neural_aim",
    name: "Mira Neural",
    desc: "+18% dano frontal e prioriza inimigos fortes.",
    apply: (s) => {
      s.frontalDamageMul *= 1.18;
      s.targetElite = true;
    },
  },
  {
    id: "grav_motor",
    name: "Motor Gravitacional",
    desc: "+25% força de puxão/lentidão.",
    apply: (s) => (s.pullMul *= 1.25),
  },
  {
    id: "drone_proc",
    name: "Processador de Drones",
    desc: "+1 drone e +6% dano.",
    apply: (s) => {
      s.droneAdd += 1;
      s.damageMul *= 1.06;
    },
  },
  {
    id: "bio_cat",
    name: "Catalisador Biológico",
    desc: "+30% dano contínuo (nanites/área).",
    apply: (s) => (s.dotMul *= 1.3),
  },
  {
    id: "ricochet_mod",
    name: "Módulo de Ricochete",
    desc: "+1 ricochete e +12% dano em projéteis que batem em parede.",
    apply: (s) => {
      s.ricochetBonusBounces += 1;
      s.ricochetDamageMul *= 1.12;
    },
  },
  {
    id: "magnet_coil",
    name: "Bobina Magnética",
    desc: "+45% alcance pra puxar a XP caída no chão.",
    apply: (s) => (s.pickupRangeMul *= 1.45),
  },
];

export const PASSIVES: Record<string, PassiveDef> = Object.fromEntries(
  P.map((p) => [p.id, p]),
);

export const ALL_PASSIVES = P;
