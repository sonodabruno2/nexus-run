// ============================================================
// NEXUS RUN — tipos centrais
// Espaço de mundo: x cresce para a DIREITA (sentido do avanço).
// A câmera (camera.x = borda esquerda) avança sozinha; o jogador
// é "carregado" e o clamp o mantém na tela. A Barreira de Purga
// fica na borda esquerda da tela.
// ============================================================

export type Vec2 = { x: number; y: number };

// ---------- Conteúdo (data-driven) ----------

export type WeaponBehavior =
  | "frontal" // tiro mirado (rifle/shotgun/rajada), com munição+recarga
  | "melee" // martelo: bate em arco à frente
  | "rail" // feixe perfurante horizontal
  | "ricochet" // projétil que ricocheteia nas paredes sup/inf
  | "mine" // solta minas atrás (esquerda)
  | "drone" // invoca drone que atira sozinho
  | "chain" // raio que pula entre inimigos
  | "gravity" // onda/área que puxa e dá dano
  | "nanite" // projétil teleguiado que aplica dano contínuo
  | "orbital" // lâminas/satélites girando ao redor
  | "area"; // cria zona no chão

export interface WeaponDef {
  id: string;
  name: string;
  behavior: WeaponBehavior;
  desc: string;
  color: string;
  cooldown: number; // segundos entre disparos (nível 1)
  damage: number; // dano base por acerto/tick
  speed: number; // velocidade do projétil (px/s) quando aplicável
  // parâmetros opcionais por arquétipo:
  count?: number; // nº de projéteis/drones/minas/órbitas
  pierce?: number; // quantos inimigos atravessa
  bounces?: number; // ricochetes
  radius?: number; // raio de área/explosão/órbita/alcance do martelo
  duration?: number; // duração de área/mina/efeito
  knockback?: number;
  chainJumps?: number;
  // ---- munição/recarga (armas principais) ----
  mag?: number; // tamanho do pente; sem mag = dispara sem munição (secundárias)
  reload?: number; // tempo de recarga (s)
  pellets?: number; // balas por disparo (shotgun)
  burst?: number; // balas por disparo gastando TODO o pente (rajada)
  spread?: number; // abertura angular do disparo (rad)
  arc?: number; // ângulo do golpe melee (rad)
  range?: number; // alcance da bala (px); 0/ausente = longo. Shotgun = curto.
  evolvesTo?: string; // id da fusão quando requisito é cumprido
  evolveReq?: { passive?: string; weapon?: string }; // pré-requisito da fusão
  evolved?: boolean; // já é uma fusão (não aparece como arma básica)
  mods?: WeaponMods; // modificadores especiais de fusão
}

// Modificadores ativados por fusões (lidos pelo sistema de armas).
export interface WeaponMods {
  elitePriority?: boolean; // mira em elites/chefes
  frontalSpread?: number; // disparos diagonais extras
  verticalFragments?: boolean; // rail solta fragmentos cima/baixo
  bounceLightning?: boolean; // ricochete solta raio
  returnCrit?: boolean; // crítico ao voltar (boomerang)
  minePull?: number; // mina puxa antes de explodir
  mineToxic?: boolean; // mina deixa poça tóxica
  duplicateChance?: number; // corrente pode duplicar
  blackHole?: boolean; // gravidade vira micro-singularidade
  infectSpread?: boolean; // nanites espalham ao matar
  boomerang?: boolean; // disco volta ao jogador
}

export interface PassiveDef {
  id: string;
  name: string;
  desc: string;
  // efeitos acumulados em Stats por nível:
  apply: (s: Stats) => void;
}

export interface CharacterDef {
  id: string;
  name: string;
  title: string;
  color: string;
  startWeapon: string;
  startPassive?: string;
  passiveDesc: string;
  ultName: string;
  ultDesc: string;
  ult: WeaponBehavior | "overdrive" | "drones" | "heal" | "singularity" | "reflect";
}

export interface EnemyDef {
  id: string;
  name: string;
  color: string;
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  xp: number;
  credits: number;
  behavior:
    | "cube" // cubo sólido em formação; estático no mundo (deriva pela velocidade da fase)
    | "rushFront" // vem da direita reto
    | "rushPlayer" // persegue o jogador
    | "fromDoor" // entra por porta sup/inf
    | "shooter" // fica à direita e atira
    | "tank" // lento, blindado
    | "exploder" // corre e explode
    | "splitter" // divide ao morrer
    | "shield" // protege vizinhos
    | "pusher"; // vem pela esquerda empurrando
  ranged?: boolean;
  splitInto?: string;
}

// ---------- Stats derivados (recomputados a cada mudança de build) ----------

export interface Stats {
  damageMul: number;
  frontalDamageMul: number;
  fireRateMul: number; // >1 = mais rápido
  areaMul: number;
  durationMul: number;
  projectileAdd: number; // +projéteis em armas frontais
  ricochetDamageMul: number;
  ricochetBonusBounces: number;
  pullMul: number;
  droneAdd: number;
  dotMul: number; // dano contínuo (nanites/área)
  critChance: number;
  moveSpeedMul: number;
  pickupRangeMul: number;
  maxHpAdd: number;
  targetElite: boolean; // mira neural
}

export function baseStats(): Stats {
  return {
    damageMul: 1,
    frontalDamageMul: 1,
    fireRateMul: 1,
    areaMul: 1,
    durationMul: 1,
    projectileAdd: 0,
    ricochetDamageMul: 1,
    ricochetBonusBounces: 0,
    pullMul: 1,
    droneAdd: 0,
    dotMul: 1,
    critChance: 0,
    moveSpeedMul: 1,
    pickupRangeMul: 1,
    maxHpAdd: 0,
    targetElite: false,
  };
}

// ---------- Instâncias em runtime ----------

export interface WeaponInst {
  defId: string;
  level: number;
  timer: number;
  ammo: number; // munição atual (armas com mag)
  reloadTimer: number; // >0 = recarregando
  up: UpgradeBonus; // bônus acumulados dos upgrades DEDICADOS da arma
  taken: Record<string, number>; // id do upgrade → quantas vezes pego
}

// Bônus dos upgrades dedicados de cada arma (acumulados na WeaponInst).
export interface UpgradeBonus {
  damageMul: number;
  cooldownMul: number; // <1 = mais rápido
  reloadMul: number; // <1 = recarrega mais rápido
  magAdd: number;
  pelletsAdd: number;
  burstAdd: number;
  pierceAdd: number;
  bouncesAdd: number;
  rangeMul: number; // multiplica o alcance da bala
  spreadMul: number; // multiplica a abertura do leque
  knockbackMul: number;
  arcAdd: number; // +arco do martelo
  reachAdd: number; // +alcance do martelo
  critChance: number; // chance de crítico (×2 dano)
  projSizeMul: number; // tamanho da bala
}

export function baseUpgradeBonus(): UpgradeBonus {
  return {
    damageMul: 1, cooldownMul: 1, reloadMul: 1, magAdd: 0, pelletsAdd: 0,
    burstAdd: 0, pierceAdd: 0, bouncesAdd: 0, rangeMul: 1, spreadMul: 1,
    knockbackMul: 1, arcAdd: 0, reachAdd: 0, critChance: 0, projSizeMul: 1,
  };
}

export interface Enemy {
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeX: number; // posição-"lar" (cinética): pra onde volta após ser empurrado/puxado
  homeY: number;
  hp: number;
  maxHp: number;
  def: EnemyDef;
  radius: number;
  flash: number;
  slow: number; // 0..1 fração de lentidão temporária
  slowTimer: number;
  dotDps: number; // dano contínuo aplicado (nanites)
  dotTimer: number;
  fireTimer: number;
  dying: number; // >0 = morto mas ainda animando a morte (voa com o empurrão e some)
  elite: boolean;
  boss: boolean;
  bossPhase?: number;
  bossT?: number; // tempo de vida do chefe (pra movimento/oscilação)
  bossAtk?: number; // índice do ataque atual no ciclo
  dead: boolean;
}

export type ProjKind =
  | "bullet"
  | "rail"
  | "disc"
  | "nanite"
  | "missile"
  | "enemy"; // projétil inimigo

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  pierce: number;
  bounces: number;
  life: number;
  kind: ProjKind;
  color: string;
  homing: number; // força de perseguição (0 = reto)
  ricochetDmgMul: number;
  hitDamageGain: number; // ganho de dano por ricochete
  dead: boolean;
  hitSet?: Set<Enemy>; // pra perfuração não acertar 2x
}

export interface Drone {
  x: number;
  y: number;
  angle: number;
  fireTimer: number;
  weaponDefId: string;
  life: number; // <0 = permanente
  copies: boolean; // copia arma frontal
}

export type AreaKind = "gravity" | "toxic" | "tesla" | "heal" | "singularity";

export interface AreaFx {
  x: number;
  y: number;
  radius: number;
  dps: number;
  life: number;
  maxLife: number;
  kind: AreaKind;
  follow: boolean; // segue o jogador
  pull: number; // força de atração (gravidade)
  color: string;
}

export interface Mine {
  x: number;
  y: number;
  arm: number;
  trigger: number;
  damage: number;
  radius: number;
  pull: number;
  toxic: boolean;
  color: string;
}

export type PickupKind = "xp" | "heal" | "mech"; // mech = item de baú que melhora o robô

// Bônus roguelike do MECH (acumulados na partida via itens de baú).
export interface MechBonus {
  powerDamageMul: number;
  powerRateMul: number; // <1 = poder mais frequente
  powerAreaMul: number;
  shieldAdd: number; // escudo extra que o mech concede
  regen: number; // vida/seg
  magnetMul: number; // alcance de coleta
}

export function baseMechBonus(): MechBonus {
  return { powerDamageMul: 1, powerRateMul: 1, powerAreaMul: 1, shieldAdd: 0, regen: 0, magnetMul: 1 };
}

// XP/cura ficam CAÍDAS no chão; ao entrar no raio do ímã, são ATRAÍDAS
// e voam até o jogador numa curva (bezier) com ease-in (lento→rápido).
export interface Pickup {
  kind: PickupKind;
  x: number; // posição atual (mundo)
  y: number;
  x0: number; // origem da atração
  y0: number;
  cx: number; // ponto de controle (curva)
  cy: number;
  age: number;
  dur: number;
  value: number;
  homing: boolean; // false = parada no chão; true = sendo atraída
  bob: number; // fase do flutuar no chão
}

// Moeda de recompensa: voa em coords de TELA até a pílula ❖ da HUD.
export interface Coin {
  x: number; // tela
  y: number;
  x0: number;
  y0: number;
  cx: number; // controle (arco)
  cy: number;
  age: number;
  dur: number;
  value: number;
}

// peça de desintegração (animação de morte): caquinho de cubo que salta e cai
export interface Fragment {
  x: number; // mundo (espalha + herda o empurrão)
  y: number;
  vx: number;
  vy: number;
  oy: number; // deslocamento vertical de TELA (salta e cai)
  ovy: number;
  rot: number;
  rotV: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface FloatText {
  x: number; // mundo (projetado no desenho)
  y: number;
  oy: number; // deslocamento de tela (sobe ao longo do tempo)
  vy: number; // velocidade do deslocamento (px/s, negativo = sobe)
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
}
