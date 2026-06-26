import type { CharacterDef } from "../types";

// ============================================================
// PERSONAGENS (4 do MVP). Cada um: arma inicial, passiva, ultimate.
// ============================================================

export const CHARACTERS: CharacterDef[] = [
  {
    id: "vega",
    name: "Vega",
    title: "Assalto Frontal",
    color: "#5cf2ff",
    startWeapon: "pulse_rifle",
    startPassive: "neural_aim",
    passiveDesc: "Armas frontais causam +15% de dano.",
    ultName: "Sobrecarga Tática",
    ultDesc: "Cadência, perfuração e crítico nas armas por alguns segundos.",
    ult: "overdrive",
  },
  {
    id: "rook",
    name: "Rook",
    title: "Dispersor Pesado",
    color: "#ff9f4d",
    startWeapon: "shotgun",
    startPassive: "drone_proc",
    passiveDesc: "Especial: invoca drones que atacam e coletam.",
    ultName: "Fábrica de Drones",
    ultDesc: "Invoca vários drones temporários que atacam e coletam XP.",
    ult: "drones",
  },
  {
    id: "nyra",
    name: "Nyra",
    title: "Rajada Biotec",
    color: "#7CFF8E",
    startWeapon: "burst",
    startPassive: "bio_cat",
    passiveDesc: "Especial: campo que cura você e dissolve inimigos.",
    ultName: "Campo Regenerativo Letal",
    ultDesc: "Cria uma área que cura você e dissolve inimigos.",
    ult: "heal",
  },
  {
    id: "orion",
    name: "Orion",
    title: "Martelo Gravitacional",
    color: "#b98cff",
    startWeapon: "hammer",
    startPassive: "grav_motor",
    passiveDesc: "Especial: buraco negro que puxa os inimigos.",
    ultName: "Singularidade",
    ultDesc: "Cria um buraco negro à frente, puxando inimigos.",
    ult: "singularity",
  },
];

export const CHAR_BY_ID: Record<string, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);
