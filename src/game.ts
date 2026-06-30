import {
  baseUpgradeBonus,
  type AreaFx,
  type Coin,
  type Drone,
  type Enemy,
  type EnemyDef,
  type FloatText,
  type Fragment,
  type Mine,
  type Particle,
  type MechBonus,
  type Pickup,
  type Projectile,
  type UpgradeBonus,
  type WeaponDef,
  type WeaponInst,
} from "./types";
import { WEAPONS } from "./content/weapons";
import { ENEMIES } from "./content/enemies";
import { pickMechChoices, MECH_BASE_DAMAGE, MECH_BASE_CD, MECH_BASE_HP, type MechUpgradeDef } from "./content/mech";
import { clamp, dist2, lerp } from "./core/math";
import { rng } from "./core/rng";
import { Input } from "./core/input";
import { audio } from "./audio";
import {
  applyCard,
  createPlayer,
  generateCards,
  xpForLevel,
  type Card,
  type Player,
} from "./player";
import { baseMechBonus } from "./types";
import {
  loadMeta,
  saveMeta,
  upgradeLevel,
  type MetaState,
} from "./meta";
import type { CharacterDef } from "./types";
import { VW, VH, WALL_TOP, WALL_BOT, setBandHeight } from "./core/constants";

// re-exporta pra quem importava de game.ts
export { VW, VH };
const MIN_PX = 64; // limite esquerdo (mundo) do jogador
// limite direito do jogador: acompanha a largura (anda "o mapa todo"), mantendo
// uma margem da borda direita onde entram as formações.
const maxPx = () => Math.min(VW * 0.7, VW - 240);
const PURGE_PX = 96; // abaixo disso (em mundo-x) começa o dano da Purga
const BOSS_TRIGGER = 150; // ~2,5 min de progressão até o chefe
const GAME_SPEED = 0.75; // jogo 25% mais lento (escala o passo da simulação)
const BASE_PICKUP_RANGE = 58; // raio base do "ímã" pra coletar XP do chão
const DYING_MAX = 0.34; // duração da animação de morte (corpo voa com o empurrão e some)
const MECH_LINE = 30; // tela-x: inimigo que chega aqui bate no mech e causa dano
const FORMATION_ROWS = 6; // fase 1: formações só com 6 fileiras de cubos
const FORMATION_CELL = 38; // = diâmetro do cubo (raio 19): cubos COLADOS, sem folga
// zoom de câmera (mais próximo): escala o render do mundo em torno de um foco.
// Foco calculado AO VIVO (VW muda com o aspecto da janela).
const ZOOM = 1.25;
const zfx = () => VW * 0.38; // foco à esquerda → mantém o mech mais visível
const zfy = () => VH * 0.56;

// ---- Projeção em PERSPECTIVA (a faixa Y vira PROFUNDIDADE) ----
// y=WALL_TOP = fundo (longe, pequeno, no alto); y=WALL_BOT = frente (perto,
// grande, embaixo). Mundo é plano (x = avanço, y = profundidade); só o
// desenho projeta. Câmera inclinada olhando o corredor.
const vanishX = () => VW / 2;
// Perspectiva GENTIL: faixa rasa na tela → cada célula do chão (38×38 mundo)
// projeta ~quadrada (largura ≈ comprimento de um inimigo), organizada.
const FAR_SCALE = 0.72; // escala no fundo (pouca redução = células uniformes)
const NEAR_Y = 435; // y de tela da faixa mais próxima
const FAR_Y = 225; // y de tela da faixa mais ao fundo
const ZFAR = 1 / FAR_SCALE;
const PROJ_C = (NEAR_Y - FAR_Y) / (1 - FAR_SCALE);
const HORIZON = NEAR_Y - PROJ_C;

export type GameStatus = "playing" | "levelup" | "mechpick" | "gameover" | "win";

export class World {
  ctx: CanvasRenderingContext2D;
  input: Input;
  meta: MetaState;
  player!: Player;

  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  enemyProjectiles: Projectile[] = [];
  drones: Drone[] = [];
  areas: AreaFx[] = [];
  mines: Mine[] = [];
  pickups: Pickup[] = [];
  coins: Coin[] = [];
  particles: Particle[] = [];
  fragments: Fragment[] = [];
  texts: FloatText[] = [];
  swings: { x: number; y: number; ang: number; arc: number; reach: number; life: number; maxLife: number; dir: number }[] = [];
  private swingFlip = 1; // alterna o sentido da varredura (vai e volta)

  cameraX = 0;
  scrollSpeed = 64;
  time = 0;
  kills = 0;
  status: GameStatus = "playing";
  pendingCards: Card[] | null = null;
  // escolha de upgrade do MECH (vinda de baú): cartas + fila de itens coletados
  pendingMechCards: MechUpgradeDef[] | null = null;
  pendingMechPicks = 0;
  nextChestAt = 25; // tempo (s) a partir do qual um baú pode aparecer (raro)
  spawnTimer = 0;
  bossSpawned = false;
  bossApproaching = false; // fim da progressão: para de spawnar, espera limpar
  bossApproachTimer = 0;
  boss: Enemy | null = null;
  shake = 0;
  // alvo (em coords lógicas da tela) da pílula ❖ da HUD — moedas voam pra lá.
  creditTargetX = VW - 80;
  creditTargetY = 22;
  private ultWasReady = false;
  // MECH (robô-dono): vida própria + bônus roguelike + estado do poder/visual
  mech: { up: MechBonus; powerTimer: number; hp: number; maxHp: number } =
    { up: baseMechBonus(), powerTimer: MECH_BASE_CD, hp: MECH_BASE_HP, maxHp: MECH_BASE_HP };
  mechBeamYs: number[] = []; // faixas Y dos feixes ativos (1+ com Feixe Duplo)
  mechBeamTimer = 0;
  mechFlash = 0;
  private chestThisFormation = false;
  // destino de movimento por clique do mouse (mundo); só ativo quando setado
  private moveTargetX = 0;
  private moveTargetY = 0;
  moveTargetActive = false;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.input = new Input(ctx.canvas);
    this.meta = loadMeta();
  }

  start(char: CharacterDef) {
    // paredes (faixa jogável) dimensionadas às fileiras da formação:
    // 6 fileiras → corredor justo aos 6; mais fileiras → corredor maior.
    setBandHeight(FORMATION_ROWS * FORMATION_CELL);
    this.player = createPlayer(char, this.meta);
    this.cameraX = 0;
    this.player.x = MIN_PX + 220;
    this.player.y = VH / 2;
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.drones = [];
    this.areas = [];
    this.mines = [];
    this.pickups = [];
    this.coins = [];
    this.particles = [];
    this.fragments = [];
    this.texts = [];
    this.swings = [];
    this.ultWasReady = false;
    this.scrollSpeed = 64;
    this.time = 0;
    this.kills = 0;
    this.spawnTimer = 0;
    this.bossSpawned = false;
    this.bossApproaching = false;
    this.bossApproachTimer = 0;
    this.boss = null;
    this.status = "playing";
    this.pendingCards = null;
    this.pendingMechCards = null;
    this.pendingMechPicks = 0;
    this.nextChestAt = 25;
    // MECH: vida própria + bônus permanentes (loja)
    const mechHp = MECH_BASE_HP + 30 * upgradeLevel(this.meta, "mech_armor");
    this.mech = { up: baseMechBonus(), powerTimer: MECH_BASE_CD, hp: mechHp, maxHp: mechHp };
    this.mech.up.powerDamageMul *= 1 + 0.12 * upgradeLevel(this.meta, "mech_cannon");
    this.mech.up.powerRateMul *= 1 - 0.08 * upgradeLevel(this.meta, "mech_reactor");
    this.mechBeamYs = []; this.mechBeamTimer = 0; this.mechFlash = 0;
    this.moveTargetActive = false;
    // drone inicial pra Rook já entrar com algo visível
    this.syncDrones();
  }

  // -------------------------------------------------------- update

  update(dt: number) {
    if (this.status !== "playing") return;
    // baú coletado → abre a tela de escolha do upgrade do mech (pausa)
    if (this.pendingMechPicks > 0) { this.openMechPick(); return; }
    dt = Math.min(dt, 1 / 30) * GAME_SPEED; // 25% mais lento (escala tudo de uma vez)
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 60);

    // câmera avança, acelera devagar com o tempo
    this.scrollSpeed = 64 + Math.min(70, this.time * 0.25);
    this.cameraX += this.scrollSpeed * dt;

    this.updatePlayer(dt);
    this.updateMech(dt);
    this.updateWeapons(dt);
    this.updateProjectiles(dt);
    this.updateEnemies(dt);
    this.separateEnemies(dt);
    this.updateEnemyProjectiles(dt);
    this.updateDrones(dt);
    this.updateAreas(dt);
    this.updateMines(dt);
    this.updatePickups(dt);
    this.updateCoins(dt);
    this.updateParticles(dt);
    this.spawn(dt);

    // som quando a ultimate fica pronta
    const ready = this.player.ultCharge >= 1 && this.player.ultActive <= 0;
    if (ready && !this.ultWasReady) audio.ultReady();
    this.ultWasReady = ready;

    // game over se a vida do PERSONAGEM ou do MECH zerar
    if (this.player.hp <= 0 || this.mech.hp <= 0) this.endRun(false);
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.ultActive > 0) p.ultActive -= dt;

    // ult carrega MATANDO (em killEnemy); aqui só decide a ativação
    const pressed = this.input.consumeUlt();
    if (p.ultCharge >= 1 && p.ultActive <= 0) {
      p.ultReadyTime += dt;
      // ativa no botão direito (escolha do jogador) OU automaticamente após 12s cheia
      if (pressed || p.ultReadyTime > 12) this.activateUlt();
    }

    // mira pelo mouse: des-ZOOM o ponteiro, des-projeta (tela → mundo) e mira de lá
    const ptr = this.input.pointer();
    const fx = zfx(), fy = zfy();
    const ux = fx + (ptr.x - fx) / ZOOM;
    const uy = fy + (ptr.y - fy) / ZOOM;
    const aw = this.unproject(ux, uy);
    p.aimAngle = Math.atan2(aw.y - p.y, aw.x - p.x);
    p.facing = 1; // corpo sempre olha pra frente (direita)

    // clique ESQUERDO: define destino de movimento (anda até lá)
    if (this.input.consumeClick()) {
      this.moveTargetX = aw.x; this.moveTargetY = aw.y; this.moveTargetActive = true;
    }

    // a câmera CARREGA o jogador (avança sempre, posição de tela constante)
    p.x += this.scrollSpeed * dt;
    const d = this.input.dir();
    if (d.x !== 0 || d.y !== 0) {
      // WASD/arraste tem prioridade e cancela o destino de clique
      this.moveTargetActive = false;
      p.vx = d.x * p.speed; p.vy = d.y * p.speed;
      p.x += p.vx * dt; p.y += p.vy * dt;
    } else if (this.moveTargetActive) {
      // o destino acompanha a câmera (fica na MESMA posição de tela)
      this.moveTargetX += this.scrollSpeed * dt;
      const dx = this.moveTargetX - p.x, dy = this.moveTargetY - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 10) { this.moveTargetActive = false; p.vx = p.vy = 0; }
      else {
        const step = Math.min(dist, p.speed * dt);
        p.x += (dx / dist) * step; p.y += (dy / dist) * step;
        p.vx = (dx / dist) * p.speed; p.vy = (dy / dist) * p.speed;
      }
    } else {
      p.vx = p.vy = 0;
    }

    // colisão SÓLIDA com cubos: a parede bloqueia e empurra o jogador
    for (const e of this.enemies) {
      if (e.dead || e.def.behavior !== "cube") continue;
      const dx = p.x - e.x, dy = p.y - e.y;
      const min = p.radius + e.radius;
      const dd = Math.hypot(dx, dy);
      if (dd < min && dd > 0.001) {
        const push = (min - dd);
        p.x += (dx / dd) * push;
        p.y += (dy / dd) * push;
      }
    }

    // mantém na tela (limites esquerdo/direito em coords de tela)
    p.x = clamp(p.x, this.cameraX + MIN_PX, this.cameraX + maxPx());
    p.y = clamp(p.y, WALL_TOP + p.radius, WALL_BOT - p.radius);

    // Barreira de Purga
    const screenX = p.x - this.cameraX;
    if (screenX < PURGE_PX) {
      const intensity = (PURGE_PX - screenX) / PURGE_PX;
      this.hurtPlayer(28 * intensity * dt, true);
      if (rng.chance(dt * 8)) this.spawnParticles(p.x, p.y, "#ff3860", 1, 60);
    }
  }

  hurtPlayer(dmg: number, fromPurge = false) {
    const p = this.player;
    if (!fromPurge && p.invuln > 0) return;
    if (p.shield > 0) {
      const a = Math.min(p.shield, dmg);
      p.shield -= a;
      dmg -= a;
    }
    if (dmg > 0) p.hp -= dmg;
    if (!fromPurge) {
      p.invuln = 0.55;
      this.shake = Math.max(this.shake, 6);
      audio.hurt();
    }
  }

  // inimigo bateu no mech: dano na vida DO MECH (game over se zerar)
  private hurtMech(dmg: number) {
    this.mech.hp -= dmg;
    this.mechFlash = Math.max(this.mechFlash, 0.3);
    this.shake = Math.max(this.shake, 5);
    audio.hurt();
    if (this.mech.hp <= 0) { this.mech.hp = 0; this.endRun(false); }
  }

  // ---- MECH: regeneração + poder periódico (feixe gigante) ----
  private updateMech(dt: number) {
    const m = this.mech;
    if (this.mechBeamTimer > 0) this.mechBeamTimer -= dt;
    if (this.mechFlash > 0) this.mechFlash -= dt;
    if (m.up.regen > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + m.up.regen * dt);
    m.powerTimer -= dt;
    if (m.powerTimer <= 0) {
      m.powerTimer = MECH_BASE_CD * m.up.powerRateMul;
      this.mechPower();
    }
  }

  private mechPower() {
    const m = this.mech;
    const band = 44 * m.up.powerAreaMul;
    const dmg = MECH_BASE_DAMAGE * m.up.powerDamageMul * (1 + this.time * 0.003);
    const beams = Math.max(1, Math.round(m.up.beams));
    // feixes espaçados em profundidade, centrados no jogador
    this.mechBeamYs = [];
    for (let i = 0; i < beams; i++) {
      const off = beams === 1 ? 0 : (i - (beams - 1) / 2) * (band * 1.9 + 14);
      const y = clamp(this.player.y + off, WALL_TOP + 12, WALL_BOT - 12);
      this.mechBeamYs.push(y);
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (e.x > this.cameraX - 60 && Math.abs(e.y - y) < band + e.radius) {
          this.damageEnemy(e, dmg, false);
          e.vx += 200; // o feixe varre os inimigos pra direita (cinético)
        }
      }
    }
    this.mechBeamTimer = 0.5;
    this.mechFlash = 0.5;
    this.shake = Math.max(this.shake, 9);
    audio.ult();
    this.texts.push({ x: this.player.x, y: WALL_TOP + 26, oy: 0, vy: -8, life: 1.4, maxLife: 1.4, text: beams > 1 ? `⚙ MECH — ${beams}× FEIXE` : "⚙ MECH — FEIXE", color: "#5cf2ff", size: 18 });
  }

  // -------------------------------------------------------- armas

  private updateWeapons(dt: number) {
    const p = this.player;
    for (const w of p.weapons) {
      const def = WEAPONS[w.defId];
      const rt = weaponRuntime(def, w.level, p, w.up);

      if (rt.mag > 0) {
        // arma com MUNIÇÃO: recarrega quando o pente acaba
        if (w.reloadTimer > 0) {
          w.reloadTimer -= dt;
          if (w.reloadTimer <= 0) { w.ammo = rt.mag; audio.reloadDone(); }
          continue;
        }
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer = rt.cooldown;
          this.fireWeapon(def, w, rt);
          w.ammo = def.burst ? 0 : w.ammo - 1; // rajada gasta o pente todo
          if (w.ammo <= 0) { w.reloadTimer = rt.reload; audio.reload(); }
        }
      } else {
        // sem munição (martelo / secundárias): dispara em cadência
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer += rt.cooldown;
          this.fireWeapon(def, w, rt);
        }
      }
    }
    this.syncDrones();
  }

  private fireWeapon(def: WeaponDef, _w: WeaponInst, rt: WeaponRuntime) {
    const p = this.player;
    switch (def.behavior) {
      case "frontal": {
        // tiro MIRADO (mouse) que ricocheteia na parede
        def.behavior === "frontal" && (def.id === "shotgun" ? audio.shotgun() : audio.shoot());
        const baseAng = p.aimAngle;
        const muzx = p.x + Math.cos(baseAng) * 18;
        const muzy = p.y + Math.sin(baseAng) * 18;
        const shots = rt.count;
        const arc = rt.spread; // abertura total do leque (com upgrades)
        const extraSpread = def.mods?.frontalSpread ?? 0;
        for (let i = 0; i < shots; i++) {
          const off = shots > 1 ? (i / (shots - 1) - 0.5) * arc : 0;
          // pequena variação aleatória dá "peso" ao tiro
          this.spawnBullet(muzx, muzy, baseAng + off + (rng.next() - 0.5) * 0.03, def, rt);
        }
        for (let s = 1; s <= extraSpread; s++) {
          this.spawnBullet(muzx, muzy, baseAng + s * 0.35, def, rt);
          this.spawnBullet(muzx, muzy, baseAng - s * 0.35, def, rt);
        }
        break;
      }
      case "melee": {
        this.meleeSwing(rt);
        break;
      }
      case "rail": {
        this.fireRail(p.x, p.y, def, rt);
        break;
      }
      case "ricochet": {
        for (let i = 0; i < rt.count; i++) {
          const ang = (rng.next() - 0.5) * 0.5;
          this.projectiles.push(this.makeDisc(p.x, p.y, ang, def, rt));
        }
        break;
      }
      case "mine": {
        for (let i = 0; i < rt.count; i++) {
          this.mines.push({
            x: p.x - 24 - i * 18,
            y: p.y + (rng.next() - 0.5) * 30,
            arm: 0.4,
            trigger: 46,
            damage: rt.damage,
            radius: rt.radius,
            pull: def.mods?.minePull ?? 0,
            toxic: !!def.mods?.mineToxic,
            color: def.color,
          });
        }
        break;
      }
      case "drone":
        // drones são persistentes (syncDrones); o disparo é deles
        break;
      case "chain":
        this.fireChain(def, rt);
        break;
      case "gravity":
        this.areas.push({
          x: def.mods?.blackHole ? p.x + 180 : p.x,
          y: p.y,
          radius: rt.radius,
          dps: rt.damage,
          life: rt.duration,
          maxLife: rt.duration,
          kind: def.mods?.blackHole ? "singularity" : "gravity",
          follow: !def.mods?.blackHole,
          pull: (def.knockback ? -def.knockback : 120) * p.stats.pullMul * (def.mods?.blackHole ? 2.4 : 1),
          color: def.color,
        });
        break;
      case "nanite": {
        for (let i = 0; i < rt.count; i++) {
          const t = this.acquireTarget(false);
          const ang = t ? Math.atan2(t.y - p.y, t.x - p.x) : rng.range(-Math.PI, Math.PI);
          this.projectiles.push({
            x: p.x, y: p.y,
            vx: Math.cos(ang) * def.speed, vy: Math.sin(ang) * def.speed,
            damage: rt.damage, radius: 6, pierce: 0, bounces: 0,
            life: 4, kind: "nanite", color: def.color, homing: 3.5,
            ricochetDmgMul: 1, hitDamageGain: 0, dead: false, hitSet: new Set(),
          });
        }
        break;
      }
      case "area":
      case "orbital":
        break;
    }
  }

  // martelo: golpe em arco à frente (na direção da mira)
  private meleeSwing(rt: WeaponRuntime) {
    const p = this.player;
    const ang = p.aimAngle;
    const reach = rt.radius || 60;
    const half = (rt.arc || 1.4) / 2;
    audio.melee();
    this.shake = Math.max(this.shake, 4);
    this.swingFlip *= -1; // próxima varredura no sentido inverso (vai e volta)
    this.swings.push({ x: p.x, y: p.y, ang, arc: rt.arc || 1.4, reach, life: 0.3, maxLife: 0.3, dir: this.swingFlip });
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d2 = dist2(e.x, e.y, p.x, p.y);
      if (d2 > (reach + e.radius) ** 2) continue;
      let da = Math.atan2(e.y - p.y, e.x - p.x) - ang;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) <= half) {
        const dd = Math.sqrt(d2) || 1;
        const kb = rt.knockback || 120;
        // IMPULSO cinético ANTES do dano (pra os fragmentos herdarem o empurrão)
        e.vx += ((e.x - p.x) / dd) * kb;
        e.vy += ((e.y - p.y) / dd) * kb * 0.5 + kb * 0.7; // viés pra BAIXO (golpe de cima→baixo)
        const crit = rt.critChance > 0 && rng.chance(rt.critChance);
        this.damageEnemy(e, crit ? rt.damage * 2 : rt.damage, false);
      }
    }
  }

  private spawnBullet(x: number, y: number, ang: number, def: WeaponDef, rt: WeaponRuntime) {
    // alcance curto (shotgun) = vida curta da bala (range / velocidade)
    const life = rt.range > 0 && def.speed > 0 ? rt.range / def.speed : 2.4;
    const crit = rt.critChance > 0 && rng.chance(rt.critChance);
    this.projectiles.push({
      x, y,
      vx: Math.cos(ang) * def.speed,
      vy: Math.sin(ang) * def.speed,
      damage: crit ? rt.damage * 2 : rt.damage, radius: Math.max(3, 5 * rt.projSize),
      pierce: rt.pierce, bounces: rt.bounces,
      life, kind: "bullet", color: crit ? "#ffe066" : def.color, homing: 0,
      ricochetDmgMul: 1, hitDamageGain: 0, dead: false, hitSet: new Set(),
    });
  }

  private makeDisc(x: number, y: number, ang: number, def: WeaponDef, rt: WeaponRuntime): Projectile {
    return {
      x, y,
      vx: Math.cos(ang) * def.speed, vy: Math.sin(ang) * def.speed,
      damage: rt.damage * p_stat_ricochet(this.player), radius: 9,
      pierce: 99, bounces: rt.bounces,
      life: 4, kind: "disc", color: def.color, homing: 0,
      ricochetDmgMul: this.player.stats.ricochetDamageMul,
      hitDamageGain: 0.12, dead: false, hitSet: new Set(),
    };
  }

  private fireRail(x: number, y: number, def: WeaponDef, rt: WeaponRuntime) {
    // feixe instantâneo: acerta todos à direita na faixa horizontal
    const hitY = y;
    const reach = VW;
    for (const e of this.enemies) {
      if (e.x > x && e.x < x + reach && Math.abs(e.y - hitY) < e.radius + 14) {
        this.damageEnemy(e, rt.damage, false);
        if (def.mods?.verticalFragments) {
          for (const dir of [-1, 1]) {
            this.projectiles.push({
              x: e.x, y: e.y, vx: 0, vy: dir * 420,
              damage: rt.damage * 0.4, radius: 5, pierce: 2, bounces: 0,
              life: 0.8, kind: "bullet", color: def.color, homing: 0,
              ricochetDmgMul: 1, hitDamageGain: 0, dead: false, hitSet: new Set(),
            });
          }
        }
      }
    }
    // efeito visual do feixe
    this.areas.push({
      x: x + reach / 2, y: hitY, radius: 0, dps: 0, life: def.duration ?? 0.16,
      maxLife: def.duration ?? 0.16, kind: "tesla", follow: false, pull: 0,
      color: def.color,
    });
    this.shake = Math.max(this.shake, 3);
  }

  private fireChain(def: WeaponDef, rt: WeaponRuntime) {
    const p = this.player;
    let from = this.acquireTarget(false);
    if (!from) return;
    const hit = new Set<Enemy>();
    let jumps = rt.chainJumps;
    let prevX = p.x, prevY = p.y;
    let dmg = rt.damage;
    const jumpRange = def.radius ?? 180;
    while (from && jumps-- > 0) {
      hit.add(from);
      this.damageEnemy(from, dmg, false);
      this.spawnLightning(prevX, prevY, from.x, from.y, def.color);
      prevX = from.x; prevY = from.y;
      dmg *= 0.92;
      // duplica (Tempestade Tesla)
      if (def.mods?.duplicateChance && rng.chance(def.mods.duplicateChance)) {
        const extra = this.nearestEnemy(from.x, from.y, (e) => !hit.has(e), jumpRange);
        if (extra) { hit.add(extra); this.damageEnemy(extra, dmg, false); this.spawnLightning(from.x, from.y, extra.x, extra.y, def.color); }
      }
      from = this.nearestEnemy(prevX, prevY, (e) => !hit.has(e), jumpRange);
    }
  }

  // -------------------------------------------------------- projéteis

  private updateProjectiles(dt: number) {
    for (const pr of this.projectiles) {
      // teleguiado
      if (pr.homing > 0) {
        const t = this.nearestEnemy(pr.x, pr.y, () => true, 600);
        if (t) {
          const ang = Math.atan2(t.y - pr.y, t.x - pr.x);
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          pr.vx += (Math.cos(ang) * sp - pr.vx) * Math.min(1, pr.homing * dt);
          pr.vy += (Math.sin(ang) * sp - pr.vy) * Math.min(1, pr.homing * dt);
        }
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;

      // ricochete nas paredes (disco sempre; bala quando ainda tem ricochete)
      if (pr.kind === "disc" || (pr.kind === "bullet" && pr.bounces > 0)) {
        if (pr.y < WALL_TOP + pr.radius && pr.vy < 0) { pr.vy *= -1; pr.y = WALL_TOP + pr.radius; this.onBounce(pr); }
        if (pr.y > WALL_BOT - pr.radius && pr.vy > 0) { pr.vy *= -1; pr.y = WALL_BOT - pr.radius; this.onBounce(pr); }
      }

      // colisão com inimigos
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (pr.hitSet && pr.hitSet.has(e)) continue;
        if (dist2(pr.x, pr.y, e.x, e.y) < (e.radius + pr.radius) ** 2) {
          this.damageEnemy(e, pr.damage, false);
          if (pr.kind === "nanite") {
            e.dotDps = Math.max(e.dotDps, pr.damage * 1.4 * this.player.stats.dotMul);
            e.dotTimer = 3;
            if (WEAPONS["nanite_plague"] && this.hasWeaponMod("infectSpread")) e.dotDps *= 1.1;
          }
          pr.hitSet?.add(e);
          if (pr.pierce <= 0) { pr.dead = true; break; }
          pr.pierce--;
        }
      }

      const sx = pr.x - this.cameraX;
      if (pr.life <= 0 || sx < -80 || sx > VW + 160 || pr.y < -60 || pr.y > VH + 60) pr.dead = true;
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  private onBounce(pr: Projectile) {
    pr.bounces--;
    pr.damage *= 1 + pr.hitDamageGain * pr.ricochetDmgMul;
    if (pr.kind === "disc") pr.hitSet?.clear();
    this.spawnParticles(pr.x, pr.y, pr.color, 4, 90);
    // Disco Condutor: raio elétrico a cada ricochete
    if (this.hasWeaponMod("bounceLightning")) {
      const t = this.nearestEnemy(pr.x, pr.y, () => true, 200);
      if (t) { this.damageEnemy(t, pr.damage * 0.5, false); this.spawnLightning(pr.x, pr.y, t.x, t.y, "#8cf6ff"); }
    }
    // só o disco "morre"/volta ao esgotar ricochetes; a bala segue voando
    if (pr.kind === "disc" && pr.bounces <= 0) {
      if (this.hasWeaponMod("boomerang")) {
        const ang = Math.atan2(this.player.y - pr.y, this.player.x - pr.x);
        const sp = Math.hypot(pr.vx, pr.vy) * 1.3;
        pr.vx = Math.cos(ang) * sp; pr.vy = Math.sin(ang) * sp;
        pr.bounces = 1; pr.damage *= 1.5;
      } else {
        pr.dead = true;
      }
    }
  }

  // -------------------------------------------------------- inimigos

  private updateEnemies(dt: number) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead) {
        // corpo MORRENDO: continua o empurrão (mostra o contato) e desacelera
        if (e.dying > 0) {
          e.dying -= dt;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          const d = Math.pow(0.02, dt);
          e.vx *= d; e.vy *= d;
        }
        continue;
      }
      // status
      if (e.flash > 0) e.flash -= dt;
      if (e.slowTimer > 0) { e.slowTimer -= dt; if (e.slowTimer <= 0) e.slow = 0; }
      if (e.dotTimer > 0) {
        e.dotTimer -= dt;
        this.damageEnemy(e, e.dotDps * dt, false, true);
        if (e.dotTimer <= 0) e.dotDps = 0;
      }
      const sp = e.def.speed * (1 - e.slow);
      if (e.boss) this.bossUpdate(e, dt); // chefe: movimento + padrões próprios
      else this.enemyAI(e, sp, dt);

      // dano de contato
      if (dist2(e.x, e.y, p.x, p.y) < (e.radius + p.radius) ** 2) {
        if (e.def.behavior === "exploder") {
          this.explode(e.x, e.y, 60, e.def.damage, e.def.color);
          this.hurtPlayer(e.def.damage);
          this.killEnemy(e, false);
        } else {
          this.hurtPlayer(e.def.damage);
        }
      }

      // tiro inimigo (cubos atiradores; o chefe atira no bossUpdate)
      if (e.def.ranged && !e.boss) {
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && e.x - this.cameraX < VW + 40 && e.x > p.x - 40) {
          e.fireTimer = 1.6;
          this.enemyShoot(e);
        }
      }

      // inimigo que chega na LINHA DO MECH bate nele e causa dano (consumido)
      const sx = e.x - this.cameraX;
      if (!e.boss && sx < MECH_LINE) {
        this.hurtMech(e.def.damage);
        e.dead = true; // crash no mech (sem recompensa, sem fragmentos)
      }
    }
    this.enemies = this.enemies.filter((e) => {
      const gone = e.dead && e.dying <= 0; // só remove depois da animação de morte
      if (gone && e === this.boss) this.boss = null;
      return !gone;
    });
  }

  // separação: dois inimigos não ocupam o mesmo lugar (empurrão suave)
  private separateEnemies(dt: number) {
    const arr = this.enemies;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const a = arr[i];
      if (a.dead || a.boss) continue;
      for (let j = i + 1; j < n; j++) {
        const b = arr[j];
        if (b.dead || b.boss) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (min - d) * 14 * dt; // suave: puxões fortes ainda sobrepõem por um instante
          const ux = dx / d, uy = dy / d;
          a.vx -= ux * f; a.vy -= uy * f;
          b.vx += ux * f; b.vy += uy * f;
        }
      }
    }
  }

  private enemyAI(e: Enemy, sp: number, dt: number) {
    const p = this.player;
    switch (e.def.behavior) {
      case "cube": {
        // CINÉTICA: mola amortecida que volta pro "lar" após empurrão/puxão.
        // Em repouso fica parado no lugar; pushes/pulls dão impulso em vx/vy.
        const k = 26, damp = 8;
        e.vx += ((e.homeX - e.x) * k - e.vx * damp) * dt;
        e.vy += ((e.homeY - e.y) * k - e.vy * damp) * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        break;
      }
      case "rushFront":
        e.x -= sp * dt;
        e.y += Math.sin(this.time * 2 + e.x * 0.01) * 18 * dt;
        break;
      case "rushPlayer":
      case "exploder":
      case "pusher": {
        const ang = Math.atan2(p.y - e.y, p.x - e.x);
        e.x += Math.cos(ang) * sp * dt;
        e.y += Math.sin(ang) * sp * dt;
        break;
      }
      case "fromDoor": {
        // entra pela porta (sup/inf) e depois persegue
        const ang = Math.atan2(p.y - e.y, p.x - e.x);
        e.x += Math.cos(ang) * sp * dt;
        e.y += Math.sin(ang) * sp * 0.8 * dt;
        break;
      }
      case "tank":
        e.x -= sp * dt;
        e.y += clamp(p.y - e.y, -sp * dt, sp * dt) * 0.4;
        break;
      case "shooter":
        // mantém distância à direita do jogador
        if (e.x - p.x < 360) e.x += sp * dt;
        else if (e.x - this.cameraX > VW - 60) e.x -= sp * dt;
        e.y += clamp(p.y - e.y, -sp * 0.5 * dt, sp * 0.5 * dt);
        break;
      case "shield":
        e.x -= sp * dt;
        e.y += clamp(p.y - e.y, -sp * dt, sp * dt) * 0.3;
        break;
      case "splitter":
        e.x -= sp * dt;
        break;
    }
    // colisão com paredes do corredor
    e.y = clamp(e.y, WALL_TOP + e.radius, WALL_BOT - e.radius);
  }

  private enemyShoot(e: Enemy) {
    const p = this.player;
    const ang = Math.atan2(p.y - e.y, p.x - e.x);
    const sp = 220;
    this.enemyProjectiles.push({
      x: e.x, y: e.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      damage: Math.max(5, Math.round(e.def.damage * 0.6)), radius: 6, pierce: 0, bounces: 0,
      life: 4, kind: "enemy", color: "#ff8a5c", homing: 0,
      ricochetDmgMul: 1, hitDamageGain: 0, dead: false,
    });
  }

  private updateEnemyProjectiles(dt: number) {
    const p = this.player;
    for (const pr of this.enemyProjectiles) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (dist2(pr.x, pr.y, p.x, p.y) < (p.radius + pr.radius) ** 2) {
        this.hurtPlayer(pr.damage);
        pr.dead = true;
      }
      const sx = pr.x - this.cameraX;
      if (pr.life <= 0 || sx < -40 || sx > VW + 80 || pr.y < -40 || pr.y > VH + 40) pr.dead = true;
    }
    this.enemyProjectiles = this.enemyProjectiles.filter((p) => !p.dead);
  }

  // -------------------------------------------------------- dano/morte

  damageEnemy(e: Enemy, dmg: number, _crit: boolean, silent = false) {
    if (e.dead) return;
    // bônus Orion: inimigos lentos/puxados tomam mais dano
    if (this.player.char.id === "orion" && e.slow > 0) dmg *= 1.2;
    e.hp -= dmg;
    e.flash = 0.08;
    if (!silent) {
      // número de dano acima do inimigo
      this.floatNumber(e.x, e.y - e.radius, String(Math.max(1, Math.round(dmg))), "#ffffff", 15);
      audio.hit();
      if (rng.chance(0.5)) this.spawnParticles(e.x, e.y, e.def.color, 1, 80);
    }
    if (e.hp <= 0) this.killEnemy(e, true);
  }

  // recompensa em ❖ proporcional à dificuldade do inimigo
  private creditReward(e: Enemy): number {
    const d = e.def;
    let base = e.maxHp * 0.06 + d.damage * 0.5 + e.radius * 0.18; // vida + ataque + tamanho/defesa
    if (d.ranged) base += 4; // inimigos que atiram valem mais
    if (e.boss) base *= 6;
    else if (e.elite) base *= 3;
    const greed = 1 + 0.12 * upgradeLevel(this.meta, "greed");
    return Math.max(1, Math.round(base * greed));
  }

  killEnemy(e: Enemy, drops: boolean) {
    if (e.dead) return;
    e.dead = true;
    e.dying = 0; // o corpo some na hora — a morte agora é a DESINTEGRAÇÃO em peças
    this.kills++;
    // ult carrega MATANDO, bem devagar (elite/chefe valem mais)
    const ch = e.boss ? 1 : e.elite ? 0.06 : 0.008;
    this.player.ultCharge = Math.min(1, this.player.ultCharge + ch);
    this.spawnFragments(e); // desintegra: peças herdam o empurrão e saltam/caem
    this.spawnParticles(e.x, e.y, e.def.color, 4, 90);
    audio.breakCube();
    if (e === this.boss) { this.endRun(true); return; }

    if (drops) {
      // XP voa até o jogador (curva, ease-in)
      this.spawnXp(e.x, e.y, e.def.xp);
      // recompensa em moedas → voam até a pílula ❖ da HUD
      const reward = this.creditReward(e);
      this.spawnCoins(e.x, e.y, reward);
      this.floatNumber(e.x, e.y - e.radius - 14, `+❖${reward}`, "#ffe066", 14);
      // BAÚ: solta o item que melhora o MECH (voa até o jogador)
      if (e.def.id === "chest") {
        this.spawnPickup("mech", e.x, e.y - 6, 1);
        this.spawnParticles(e.x, e.y, "#ffe066", 18, 240);
        this.floatNumber(e.x, e.y - e.radius - 30, "⚙ ITEM DO MECH!", "#ffe066", 16);
      }
      // Nyra: infectados soltam cura (também voa ao jogador)
      if (this.player.char.id === "nyra" && e.dotDps > 0 && rng.chance(0.25))
        this.spawnPickup("heal", e.x, e.y - 8, 12);
    }

    // divisão: os filhos SALTAM pra fora do corpo do que quebrou (clareza)
    if (e.def.splitInto) {
      const sub = ENEMIES[e.def.splitInto];
      for (let i = 0; i < 2; i++) {
        const dir = i === 0 ? -1 : 1;
        const child = this.spawnEnemyAt(sub, e.x, e.y, false);
        child.homeX = e.x + dir * 46; // assenta ao lado, não no mesmo lugar
        child.homeY = e.y - 4;
        child.vx = dir * 210 + (rng.next() - 0.5) * 40; // impulso pra FORA
        child.vy = -150 - rng.next() * 70;
        child.flash = 0.12;
      }
      this.spawnParticles(e.x, e.y, "#ffffff", 10, 250);
      this.spawnParticles(e.x, e.y, e.def.color, 12, 200);
      this.floatNumber(e.x, e.y - e.radius, "×2", "#ffffff", 16);
    }
    // Praga Sintética: espalha nanites ao morrer
    if (e.dotDps > 0 && this.hasWeaponMod("infectSpread")) {
      for (const o of this.enemies) {
        if (o === e || o.dead) continue;
        if (dist2(o.x, o.y, e.x, e.y) < 90 ** 2) { o.dotDps = Math.max(o.dotDps, e.dotDps * 0.7); o.dotTimer = 2.5; }
      }
    }
  }

  private explode(x: number, y: number, radius: number, dmg: number, color: string) {
    this.spawnParticles(x, y, color, 16, 200);
    this.shake = Math.max(this.shake, 5);
    for (const e of this.enemies) {
      if (!e.dead && dist2(e.x, e.y, x, y) < (radius + e.radius) ** 2) this.damageEnemy(e, dmg, false);
    }
  }

  // -------------------------------------------------------- drones

  private syncDrones() {
    const p = this.player;
    let want = 0;
    let droneDef: WeaponDef | null = null;
    for (const w of p.weapons) {
      const def = WEAPONS[w.defId];
      if (def.behavior === "drone") {
        droneDef = def;
        want += (def.count ?? 1) + p.stats.droneAdd + (w.level - 1);
      }
    }
    // remove drones temporários expirados são tratados em updateDrones;
    // aqui mantemos os permanentes igual a `want`
    const permanent = this.drones.filter((d) => d.life < 0);
    if (droneDef) {
      while (permanent.length < want) {
        const d: Drone = { x: p.x, y: p.y, angle: rng.range(0, Math.PI * 2), fireTimer: 0, weaponDefId: droneDef.id, life: -1, copies: false };
        permanent.push(d);
        this.drones.push(d);
      }
      while (permanent.length > want) {
        const d = permanent.pop()!;
        const idx = this.drones.indexOf(d);
        if (idx >= 0) this.drones.splice(idx, 1);
      }
    } else {
      // sem arma de drone: remove permanentes
      this.drones = this.drones.filter((d) => d.life >= 0);
    }
  }

  private updateDrones(dt: number) {
    const p = this.player;
    const n = this.drones.length;
    this.drones.forEach((d, i) => {
      d.angle += dt * 1.2;
      const r = 52 + (d.life >= 0 ? 14 : 0);
      const a = d.angle + (i / Math.max(1, n)) * Math.PI * 2;
      const tx = p.x + Math.cos(a) * r;
      const ty = p.y + Math.sin(a) * r * 0.7;
      d.x += (tx - d.x) * Math.min(1, dt * 6);
      d.y += (ty - d.y) * Math.min(1, dt * 6);
      if (d.life >= 0) d.life -= dt;

      d.fireTimer -= dt;
      if (d.fireTimer <= 0) {
        const def = WEAPONS[d.weaponDefId];
        const rt = weaponRuntime(def, 1, p);
        d.fireTimer = rt.cooldown;
        const t = this.nearestEnemy(d.x, d.y, () => true, 520);
        if (t) {
          const ang = Math.atan2(t.y - d.y, t.x - d.x);
          this.projectiles.push({
            x: d.x, y: d.y, vx: Math.cos(ang) * def.speed, vy: Math.sin(ang) * def.speed,
            damage: rt.damage, radius: 5, pierce: 0, bounces: 0, life: 1.6, kind: "bullet",
            color: def.color, homing: 0, ricochetDmgMul: 1, hitDamageGain: 0, dead: false, hitSet: new Set(),
          });
        }
      }
    });
    this.drones = this.drones.filter((d) => d.life < 0 || d.life > 0);
  }

  // -------------------------------------------------------- áreas / minas

  private updateAreas(dt: number) {
    const p = this.player;
    for (const a of this.areas) {
      a.life -= dt;
      if (a.follow) { a.x = p.x; a.y = p.y; }
      if (a.kind === "heal") {
        if (rng.chance(dt * 4)) p.hp = Math.min(p.maxHp, p.hp + 1);
      }
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d2 = dist2(e.x, e.y, a.x, a.y);
        if (d2 < a.radius ** 2) {
          if (a.dps > 0) this.damageEnemy(e, a.dps * dt, false, true);
          if (a.pull !== 0) {
            const dd = Math.sqrt(d2) || 1;
            // IMPULSO cinético: puxa (pull>0) ou empurra (pull<0); a mola devolve depois
            const f = a.pull * dt * 7;
            e.vx += ((a.x - e.x) / dd) * f;
            e.vy += ((a.y - e.y) / dd) * f;
            e.slow = Math.max(e.slow, 0.4); e.slowTimer = 0.3;
          }
        }
      }
    }
    this.areas = this.areas.filter((a) => a.life > 0);
  }

  private updateMines(dt: number) {
    for (const m of this.mines) {
      m.arm -= dt;
      if (m.pull > 0) {
        for (const e of this.enemies) {
          if (e.dead) continue;
          const d2 = dist2(e.x, e.y, m.x, m.y);
          if (d2 < (m.radius * 1.6) ** 2) {
            const dd = Math.sqrt(d2) || 1;
            e.vx += ((m.x - e.x) / dd) * m.pull * dt * 3;
            e.vy += ((m.y - e.y) / dd) * m.pull * dt * 3;
          }
        }
      }
      if (m.arm <= 0) {
        let triggered = false;
        for (const e of this.enemies) {
          if (!e.dead && dist2(e.x, e.y, m.x, m.y) < m.trigger ** 2) { triggered = true; break; }
        }
        if (triggered) {
          this.explode(m.x, m.y, m.radius, m.damage, m.color);
          if (m.toxic) {
            this.areas.push({ x: m.x, y: m.y, radius: m.radius * 0.9, dps: m.damage * 0.4 * this.player.stats.dotMul, life: 3, maxLife: 3, kind: "toxic", follow: false, pull: 0, color: "#b6ff7c" });
          }
          (m as Mine & { dead?: boolean }).dead = true;
        }
      }
      // some atrás da câmera
      if (m.x - this.cameraX < -120) (m as Mine & { dead?: boolean }).dead = true;
    }
    this.mines = this.mines.filter((m) => !(m as Mine & { dead?: boolean }).dead);
  }

  // -------------------------------------------------------- pickups / moedas

  // XP cai espalhada NO CHÃO; só é coletada ao entrar no raio do ímã
  private spawnXp(x: number, y: number, value: number) {
    this.spawnPickup("xp", x + rng.range(-16, 16), y + rng.range(-14, 14), value);
  }
  private spawnPickup(kind: "xp" | "heal" | "mech", x: number, y: number, value: number) {
    this.pickups.push({
      kind, x, y, x0: x, y0: y, cx: x, cy: y,
      age: 0, dur: 0.4, value, homing: false, bob: rng.range(0, 6.28),
    });
  }

  // moedas de recompensa voam (em coords de tela) até a pílula ❖ da HUD
  private spawnCoins(wx: number, wy: number, total: number) {
    const n = Math.max(1, Math.min(6, Math.round(total / 4)));
    const base = Math.floor(total / n);
    const src = this.project(wx, wy);
    for (let i = 0; i < n; i++) {
      const sx0 = src.sx + rng.range(-10, 10);
      const sy0 = src.sy - 12 + rng.range(-8, 8);
      const cx = (sx0 + this.creditTargetX) / 2 + rng.range(-40, 40);
      const cy = Math.min(sy0, this.creditTargetY) - rng.range(30, 80); // arco pra cima
      const value = i === n - 1 ? total - base * (n - 1) : base;
      this.coins.push({ x: sx0, y: sy0, x0: sx0, y0: sy0, cx, cy, age: -i * 0.04, dur: rng.range(0.5, 0.72), value });
    }
  }

  private updatePickups(dt: number) {
    const p = this.player;
    const range = BASE_PICKUP_RANGE * p.stats.pickupRangeMul * this.mech.up.magnetMul;
    const r2 = range * range;
    for (const pk of this.pickups) {
      if (!pk.homing) {
        // item do mech voa SEMPRE (recompensa garantida); resto só perto (raio do ímã)
        if (pk.kind === "mech" || dist2(pk.x, pk.y, p.x, p.y) < r2) {
          // começa a atração: curva (bezier) com ponto de controle lateral
          pk.homing = true; pk.age = 0; pk.x0 = pk.x; pk.y0 = pk.y;
          const ang = Math.atan2(p.y - pk.y, p.x - pk.x) + Math.PI / 2;
          const off = rng.range(18, 50) * (rng.chance(0.5) ? 1 : -1);
          pk.cx = (pk.x + p.x) / 2 + Math.cos(ang) * off;
          pk.cy = (pk.y + p.y) / 2 + Math.sin(ang) * off;
        } else {
          // some se for deixada pra trás (saiu da tela pela esquerda)
          if (this.project(pk.x, pk.y).sx < -40) (pk as Pickup & { dead?: boolean }).dead = true;
          continue;
        }
      }
      // atraída: bezier ease-in (sutil no início, acelera no fim)
      pk.age += dt;
      const t = Math.min(1, pk.age / pk.dur);
      const et = t * t;
      const u = 1 - et;
      pk.x = u * u * pk.x0 + 2 * u * et * pk.cx + et * et * p.x;
      pk.y = u * u * pk.y0 + 2 * u * et * pk.cy + et * et * p.y;
      if (t >= 1) { this.collect(pk); (pk as Pickup & { dead?: boolean }).dead = true; }
    }
    this.pickups = this.pickups.filter((pk) => !(pk as Pickup & { dead?: boolean }).dead);
  }

  private updateCoins(dt: number) {
    for (const c of this.coins) {
      c.age += dt;
      if (c.age < 0) continue;
      const t = Math.min(1, c.age / c.dur);
      const et = t * t; // ease-in: começa sutil, acelera no fim
      const u = 1 - et;
      c.x = u * u * c.x0 + 2 * u * et * c.cx + et * et * this.creditTargetX;
      c.y = u * u * c.y0 + 2 * u * et * c.cy + et * et * this.creditTargetY;
      if (t >= 1) { this.player.credits += c.value; audio.coin(); (c as Coin & { dead?: boolean }).dead = true; }
    }
    this.coins = this.coins.filter((c) => !(c as Coin & { dead?: boolean }).dead);
  }

  private floatNumber(x: number, y: number, text: string, color: string, size: number) {
    if (this.texts.length > 70) return; // anti-spam
    this.texts.push({ x, y, oy: 0, vy: -48, life: 0.6, maxLife: 0.6, text, color, size });
  }

  private collect(pk: Pickup) {
    const p = this.player;
    if (pk.kind === "xp") {
      audio.xp();
      p.xp += pk.value;
      while (p.xp >= p.xpToNext) {
        p.xp -= p.xpToNext;
        p.level++;
        p.xpToNext = xpForLevel(p.level);
        this.queueLevelUp();
      }
    } else if (pk.kind === "heal") {
      p.hp = Math.min(p.maxHp, p.hp + pk.value);
    } else if (pk.kind === "mech") {
      // núcleo de baú (raro): enfileira uma ESCOLHA de upgrade do mech
      this.pendingMechPicks++;
      this.mechFlash = 0.7;
      audio.level();
      this.floatNumber(p.x, p.y - 34, "⚙ NÚCLEO DO MECH", "#5cf2ff", 17);
    }
  }

  private queueLevelUp() {
    const count = 3;
    this.pendingCards = generateCards(this.player, count);
    this.status = "levelup";
    audio.level();
  }

  chooseCard(c: Card) {
    applyCard(this.player, c, this.meta);
    this.pendingCards = null;
    this.status = "playing";
  }

  rerollCards(): boolean {
    if (this.player.rerolls <= 0 || !this.pendingCards) return false;
    this.player.rerolls--;
    this.pendingCards = generateCards(this.player, this.pendingCards.length);
    return true;
  }

  // ---- ESCOLHA de upgrade do MECH (vinda de baú) ----
  private openMechPick() {
    this.pendingMechCards = pickMechChoices(3, () => rng.next());
    this.status = "mechpick";
    audio.level();
  }

  chooseMechUpgrade(u: MechUpgradeDef) {
    u.apply(this.mech.up);
    // recalcula a vida máx do mech (blindagem) e CURA pelo ganho
    const newMax = MECH_BASE_HP + 30 * upgradeLevel(this.meta, "mech_armor") + this.mech.up.hpAdd;
    this.mech.hp += Math.max(0, newMax - this.mech.maxHp);
    this.mech.maxHp = newMax;
    this.mechFlash = 0.7;
    this.floatNumber(this.player.x, this.player.y - 34, `⚙ ${u.name}`, "#5cf2ff", 16);
    this.pendingMechCards = null;
    this.pendingMechPicks = Math.max(0, this.pendingMechPicks - 1);
    this.status = "playing"; // se ainda houver baús na fila, update() reabre
  }

  // -------------------------------------------------------- ultimate

  private activateUlt() {
    const p = this.player;
    p.ultCharge = 0;
    p.ultReadyTime = 0;
    this.shake = 10;
    audio.ult();
    switch (p.char.ult) {
      case "overdrive":
        p.ultActive = 6;
        break;
      case "drones": {
        const def = WEAPONS["drone_sentinel"];
        for (let i = 0; i < 5; i++) {
          const d: Drone = { x: p.x, y: p.y, angle: rng.range(0, 6.28), fireTimer: 0, weaponDefId: def.id, life: 10, copies: false };
          this.drones.push(d);
        }
        break;
      }
      case "heal":
        this.areas.push({ x: p.x, y: p.y, radius: 130, dps: 40 * p.stats.dotMul, life: 6, maxLife: 6, kind: "heal", follow: true, pull: 0, color: "#7CFF8E" });
        break;
      case "singularity":
        this.areas.push({ x: p.x + 200, y: p.y, radius: 200, dps: 30, life: 5, maxLife: 5, kind: "singularity", follow: false, pull: 360 * p.stats.pullMul, color: "#b98cff" });
        break;
      case "reflect":
        p.ultActive = 6;
        break;
    }
  }

  // -------------------------------------------------------- spawn

  // progresso da fase até o chefe (0..1) e estado do chefe — usados pela HUD
  runProgress(): number {
    return this.bossSpawned || this.bossApproaching ? 1 : clamp(this.time / BOSS_TRIGGER, 0, 1);
  }
  bossActive(): boolean {
    return this.bossApproaching || (this.bossSpawned && !!this.boss);
  }

  // estado da arma principal (1º slot) pra HUD: munição / recarga / melee
  mainWeaponInfo(): { name: string; melee: boolean; ammo: number; mag: number; reloading: boolean; reloadFrac: number } {
    const w = this.player.weapons[0];
    const def = WEAPONS[w.defId];
    const rt = weaponRuntime(def, w.level, this.player, w.up);
    if (def.behavior === "melee" || rt.mag <= 0)
      return { name: def.name, melee: true, ammo: 0, mag: 0, reloading: false, reloadFrac: 0 };
    const reloading = w.reloadTimer > 0;
    return {
      name: def.name, melee: false, ammo: Math.max(0, w.ammo), mag: rt.mag,
      reloading, reloadFrac: reloading ? 1 - w.reloadTimer / rt.reload : 1,
    };
  }

  private spawn(dt: number) {
    // durante o chefe: NÃO traz blocos (arena limpa só pra ele)
    if (this.bossSpawned) return;

    // fim da progressão: para de spawnar e espera os blocos saírem
    if (this.bossApproaching) {
      this.bossApproachTimer -= dt;
      const cubesAhead = this.enemies.some(
        (e) => !e.dead && e.def.behavior === "cube" && e.x - this.cameraX > -40,
      );
      if (!cubesAhead || this.bossApproachTimer <= 0) {
        this.bossSpawned = true;
        this.spawnBoss();
      }
      return;
    }
    if (this.time >= BOSS_TRIGGER) {
      this.bossApproaching = true;
      this.bossApproachTimer = 9; // espera no máx 9s a arena limpar
      this.texts.push({ x: this.player.x + 240, y: WALL_TOP + 28, oy: 0, vy: -8, life: 2.8, maxLife: 2.8, text: "SETOR LIMPO — ALVO SE APROXIMA", color: "#ffd65c", size: 22 });
      return;
    }

    // PROGRESSÃO: começa esparso e lento; adensa e acelera até o chefe
    const prog = clamp(this.time / BOSS_TRIGGER, 0, 1);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = lerp(3.6, 1.0, prog);
      this.spawnFormation(undefined, prog);
    }
  }

  // pondera as formas pela intensidade: cedo esparso, tarde paredão
  private pickShape(intensity: number): string {
    // TESTE (pedido 2026-06-29): 6 inimigos por vez em bloco 100% AGRUPADO.
    void intensity;
    return "solid6";
  }

  // Gera uma formação de CUBOS no lado direito; estáticos no mundo, a fase
  // os aproxima. `intensity` (0..1) controla densidade/tamanho/fendas.
  private spawnFormation(forced: string | undefined, intensity: number) {
    this.chestThisFormation = false; // no máx 1 baú por formação
    const cell = FORMATION_CELL;
    const rows = FORMATION_ROWS; // fase 1: só 6 fileiras
    const startY = (WALL_TOP + WALL_BOT) / 2 - (rows * cell) / 2; // bloco centralizado na faixa
    // ancora a formação na GRID do chão: centro de cada coluna = borda da célula +
    // meia célula → cada cubo ocupa exatamente 1 célula da grade.
    const baseX = Math.ceil((this.cameraX + VW + 50) / cell) * cell + cell / 2;
    const shape = forced ?? this.pickShape(intensity);
    const maxCols = 1 + Math.round(intensity * 4); // 1 → 5 colunas

    let cols = 1;
    let place: (c: number, r: number) => boolean = () => true;

    switch (shape) {
      case "solid6": {
        // bloco CHEIO de exatamente 6 cubos (sem fendas), centrado nas 6 faixas
        const [w, h] = rng.pick([[1, 6], [6, 1], [2, 3], [3, 2]]);
        cols = w;
        const start = Math.floor((rows - h) / 2);
        place = (_c, r) => r >= start && r < start + h;
        break;
      }
      case "column": {
        // FASE INICIAL: colunas SÓLIDAS — cada coluna preenche as 6 fileiras,
        // cubos colados um no outro, organizados (sem fendas, sem dispersão).
        cols = rng.int(1, 3);
        place = () => true;
        break;
      }
      case "wall": {
        cols = Math.max(1, Math.min(maxCols, rng.int(1, 2 + Math.round(intensity * 2))));
        // quanto maior a intensidade, MENOS fendas (paredão fecha a fase)
        const gapN = Math.max(0, rng.int(0, 3) - Math.round(intensity * 2));
        const gapStart = rng.int(0, rows - gapN);
        place = (_c, r) => r < gapStart || r >= gapStart + gapN;
        break;
      }
      case "block": {
        cols = Math.min(maxCols, rng.int(2, 4));
        const h = rng.int(2 + Math.round(intensity * 2), rows);
        const start = rng.int(0, rows - h);
        place = (_c, r) => r >= start && r < start + h;
        break;
      }
      case "diag": {
        cols = Math.min(maxCols + 1, rng.int(4, 6));
        const start = rng.int(0, Math.max(0, rows - cols));
        place = (c, r) => r === start + c || r === start + c + 1;
        break;
      }
      case "checker": {
        cols = Math.min(maxCols, rng.int(3, 4));
        const h = rng.int(4, rows);
        const start = rng.int(0, rows - h);
        place = (c, r) => r >= start && r < start + h && (c + r) % 2 === 0;
        break;
      }
      case "arrow": {
        cols = 4;
        const mid = Math.floor(rows / 2);
        place = (c, r) => Math.abs(r - mid) === c || Math.abs(r - mid) === c + 1;
        break;
      }
      default: { // scatter
        cols = Math.min(maxCols, rng.int(2, 4));
        place = () => rng.chance(0.32 + intensity * 0.36);
        break;
      }
    }

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (place(c, r)) this.spawnCube(baseX + c * cell, startY + r * cell + cell / 2, intensity);
      }
    }
  }

  private spawnCube(x: number, y: number, intensity: number) {
    // baú guardado RARO: só depois do cooldown (nextChestAt); ao sair, agenda
    // o próximo bem distante. Cada baú vira uma ESCOLHA forte de upgrade.
    if (!this.chestThisFormation && this.time >= this.nextChestAt && rng.chance(0.10)) {
      this.chestThisFormation = true;
      this.nextChestAt = this.time + 42 + rng.next() * 26; // ~42–68s até o próximo
      this.spawnEnemyAt(ENEMIES["chest"], x, y, false);
      return;
    }
    const roll = rng.next();
    let id = "cube";
    if (intensity > 0.5 && roll < 0.10 + intensity * 0.10) id = "cube_shooter";
    else if (intensity > 0.25 && roll < 0.30) id = "cube_tough";
    else if (roll < 0.10) id = "cube_split";
    this.spawnEnemyAt(ENEMIES[id], x, y, false);
  }

  private spawnEnemyAt(def: EnemyDef, x: number, y: number, elite: boolean): Enemy {
    // dificuldade escala com o tempo
    const t = this.time;
    const hpScale = 1 + t * 0.004;
    const hp = def.hp * hpScale * (elite ? 4 : 1);
    const e: Enemy = {
      x, y, vx: 0, vy: 0, homeX: x, homeY: y, hp, maxHp: hp, def,
      radius: def.radius * (elite ? 1.5 : 1), flash: 0, slow: 0, slowTimer: 0,
      dotDps: 0, dotTimer: 0, fireTimer: rng.range(0.5, 1.8), dying: 0, elite, boss: false, dead: false,
    };
    this.enemies.push(e);
    return e;
  }

  private spawnBoss() {
    const def = ENEMIES["supervisor_alpha"];
    const hp = def.hp * (1 + this.time * 0.002);
    const cy = (WALL_TOP + WALL_BOT) / 2;
    const e: Enemy = {
      x: this.cameraX + VW + 70, y: cy, vx: 0, vy: 0, homeX: this.cameraX + VW + 70, homeY: cy,
      hp, maxHp: hp, def, radius: def.radius, flash: 0, slow: 0, slowTimer: 0, dotDps: 0, dotTimer: 0,
      fireTimer: 2.2, dying: 0, elite: false, boss: true, bossT: 0, bossAtk: -1, dead: false,
    };
    this.boss = e;
    this.enemies.push(e);
    this.shake = 14;
    audio.ult();
    this.texts.push({ x: this.player.x + 240, y: WALL_TOP + 30, oy: 0, vy: -10, life: 3, maxLife: 3, text: "⚠ SUPERVISOR ALPHA", color: "#ff5470", size: 26 });
  }

  // ---- CHEFE 1: órbita CIRCULAR + ONDAS em ESPIRAL com cadência ----
  private bossUpdate(e: Enemy, dt: number) {
    e.bossT = (e.bossT ?? 0) + dt;
    const hpFrac = e.hp / e.maxHp;

    // movimentação CIRCULAR: orbita um centro que avança COM a fase
    const ocx = this.cameraX + VW * 0.7;
    const ocy = (WALL_TOP + WALL_BOT) / 2;
    const rx = VW * 0.12, ry = (WALL_BOT - WALL_TOP) * 0.3;
    const orbit = e.bossT * 1.0;
    const tx = ocx + Math.cos(orbit) * rx;
    const ty = ocy + Math.sin(orbit) * ry;
    e.x += (tx - e.x) * Math.min(1, dt * 2.5);
    e.y += (ty - e.y) * Math.min(1, dt * 2.5);
    e.y = clamp(e.y, WALL_TOP + e.radius, WALL_BOT - e.radius);

    // CADÊNCIA: dispara uma ONDA de espiral, depois DESCANSA (não infinito)
    const inWave = 0.085;            // intervalo entre tiros dentro da onda
    const rest = hpFrac < 0.4 ? 1.1 : 1.7; // pausa entre ondas (mais curta com pouca vida)
    e.fireTimer -= dt;
    if (e.fireTimer <= 0) {
      if ((e.bossAtk ?? 0) > 0) {
        this.bossSpiralShot(e, hpFrac);
        e.bossAtk = (e.bossAtk ?? 0) - 1;
        e.fireTimer = e.bossAtk > 0 ? inWave : rest; // último tiro → descanso
      } else {
        // nova onda
        e.bossAtk = hpFrac < 0.5 ? 22 : 16; // nº de tiros (a espiral gira durante a onda)
        this.bossSpiralShot(e, hpFrac);
        e.bossAtk -= 1;
        e.fireTimer = inWave;
      }
    }
    if (hpFrac < 0.35) this.scrollSpeed += 3 * dt;
  }

  private bossShot(e: Enemy, ang: number, speed: number, dmg: number) {
    this.enemyProjectiles.push({
      x: e.x, y: e.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      damage: dmg, radius: 7, pierce: 0, bounces: 0, life: 6, kind: "enemy",
      color: "#ff5470", homing: 0, ricochetDmgMul: 1, hitDamageGain: 0, dead: false,
    });
  }

  // um "tique" da onda: braços de espiral que giram a cada tiro
  private bossSpiralShot(e: Enemy, hpFrac: number) {
    e.bossPhase = (e.bossPhase ?? 0) + 0.42; // rotação por tique → espiral
    const arms = hpFrac < 0.5 ? 3 : 2;
    for (let a = 0; a < arms; a++) {
      const ang = e.bossPhase + (a / arms) * Math.PI * 2;
      this.bossShot(e, ang, 195, 10);
    }
  }

  // -------------------------------------------------------- fim de run

  private endRun(won: boolean) {
    if (this.status === "gameover" || this.status === "win") return;
    this.status = won ? "win" : "gameover";
    this.meta.credits += this.player.credits;
    this.meta.runs++;
    if (this.time > this.meta.bestTime) this.meta.bestTime = this.time;
    saveMeta(this.meta);
  }

  // -------------------------------------------------------- helpers

  private acquireTarget(elitePriority?: boolean): Enemy | null {
    const p = this.player;
    if (elitePriority || p.stats.targetElite) {
      const strong = this.enemies
        .filter((e) => !e.dead && e.x - this.cameraX < VW + 40)
        .sort((a, b) => b.maxHp - a.maxHp)[0];
      if (strong) return strong;
    }
    // mais próximo à frente
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.x < p.x - 30) continue;
      const d = dist2(e.x, e.y, p.x, p.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) best = this.nearestEnemy(p.x, p.y, () => true, 9999);
    return best;
  }

  nearestEnemy(x: number, y: number, pred: (e: Enemy) => boolean, maxR: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxR * maxR;
    for (const e of this.enemies) {
      if (e.dead || !pred(e)) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private hasWeaponMod(mod: keyof NonNullable<WeaponDef["mods"]>): boolean {
    return this.player.weapons.some((w) => WEAPONS[w.defId].mods?.[mod]);
  }

  // ------ partículas / fx ------
  spawnParticles(x: number, y: number, color: string, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const s = rng.range(speed * 0.3, speed);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rng.range(0.2, 0.6), maxLife: 0.6, color, size: rng.range(1.5, 3.5) });
    }
  }

  // DESINTEGRAÇÃO: o inimigo se quebra em peças que herdam o empurrão, saltam e caem
  private spawnFragments(e: Enemy) {
    if (this.fragments.length > 420) return;
    const n = e.boss ? 24 : 7;
    for (let i = 0; i < n; i++) {
      const sa = rng.range(0, Math.PI * 2);
      const ss = rng.range(40, 170);
      const life = rng.range(0.45, 0.8);
      this.fragments.push({
        x: e.x + rng.range(-1, 1) * e.radius * 0.5,
        y: e.y + rng.range(-1, 1) * e.radius * 0.5,
        vx: e.vx * 0.5 + Math.cos(sa) * ss, // herda metade do empurrão
        vy: e.vy * 0.5 + Math.sin(sa) * ss * 0.5,
        oy: 0, ovy: -rng.range(100, 240), // salta pra cima
        rot: rng.range(0, 6.28), rotV: rng.range(-12, 12),
        size: rng.range(3, 7) * (e.boss ? 2.2 : 1),
        color: rng.chance(0.5) ? e.def.color : shade(e.def.color, 0.7),
        life, maxLife: life,
      });
    }
  }
  private spawnLightning(x1: number, y1: number, x2: number, y2: number, color: string) {
    const seg = 6;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const x = x1 + (x2 - x1) * t + (rng.next() - 0.5) * 12;
      const y = y1 + (y2 - y1) * t + (rng.next() - 0.5) * 12;
      this.particles.push({ x, y, vx: 0, vy: 0, life: 0.12, maxLife: 0.12, color, size: 2.5 });
    }
  }
  private updateParticles(dt: number) {
    for (const pa of this.particles) { pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.life -= dt; pa.vx *= 0.92; pa.vy *= 0.92; }
    this.particles = this.particles.filter((p) => p.life > 0);
    // fragmentos de desintegração: espalham no chão, saltam, caem e quicam
    for (const f of this.fragments) {
      f.x += f.vx * dt; f.y += f.vy * dt;
      const damp = Math.pow(0.05, dt);
      f.vx *= damp; f.vy *= damp;
      f.ovy += 900 * dt; // gravidade de tela
      f.oy += f.ovy * dt;
      if (f.oy > 0) { f.oy = 0; f.ovy *= -0.4; if (Math.abs(f.ovy) < 30) f.ovy = 0; } // quica
      f.rot += f.rotV * dt;
      f.life -= dt;
    }
    this.fragments = this.fragments.filter((f) => f.life > 0);
    for (const t of this.texts) { t.oy += t.vy * dt; t.vy *= 0.92; t.life -= dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const s of this.swings) s.life -= dt;
    this.swings = this.swings.filter((s) => s.life > 0);
  }

  private drawFragments(ctx: CanvasRenderingContext2D) {
    for (const f of this.fragments) {
      const p = this.project(f.x, f.y);
      const sz = Math.max(1.5, f.size * p.sc);
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.translate(p.sx, p.sy + f.oy * p.sc);
      ctx.rotate(f.rot);
      ctx.fillStyle = f.color;
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ======================================================== RENDER
  render() {
    const ctx = this.ctx;
    ctx.save();
    let ox = 0, oy = 0;
    if (this.shake > 0) { ox = (rng.next() - 0.5) * this.shake; oy = (rng.next() - 0.5) * this.shake; }
    ctx.translate(ox, oy);
    // ZOOM (câmera mais próxima): escala o mundo em torno do foco
    const fx = zfx(), fy = zfy();
    ctx.translate(fx, fy); ctx.scale(ZOOM, ZOOM); ctx.translate(-fx, -fy);
    this.drawBackground(ctx);
    this.drawMech(ctx);
    this.drawPickups(ctx);
    this.drawMines(ctx);
    this.drawAreas(ctx);
    this.drawEnemies(ctx);
    this.drawFragments(ctx);
    this.drawProjectiles(ctx);
    this.drawDrones(ctx);
    this.drawPlayer(ctx);
    this.drawSwings(ctx);
    this.drawMoveTarget(ctx);
    this.drawAim(ctx);
    this.drawParticles(ctx);
    this.drawTexts(ctx);
    ctx.restore();
    this.drawCoins(ctx); // moedas voam até a HUD (coords de tela)
    // HUD agora é DOM (pílulas flutuantes) — ver hud.ts
  }

  // ---- Projeção em perspectiva: mundo (x avanço, y profundidade) → tela ----
  project(x: number, y: number): { sx: number; sy: number; sc: number } {
    const t = clamp((y - WALL_TOP) / (WALL_BOT - WALL_TOP), 0, 1);
    const z = ZFAR + t * (1 - ZFAR);
    const sc = 1 / z;
    const sy = HORIZON + PROJ_C * sc;
    const vx = vanishX();
    const sx = vx + (x - this.cameraX - vx) * sc;
    return { sx, sy, sc };
  }
  // tela → mundo (pra mira do mouse)
  unproject(sx: number, sy: number): { x: number; y: number } {
    const sc = clamp((sy - HORIZON) / PROJ_C, FAR_SCALE * 0.8, 1);
    const z = 1 / sc;
    const t = clamp((z - ZFAR) / (1 - ZFAR), 0, 1);
    const y = WALL_TOP + t * (WALL_BOT - WALL_TOP);
    const vx = vanishX();
    const x = this.cameraX + vx + (sx - vx) / sc;
    return { x, y };
  }

  // sombra elíptica no chão (coords de TELA já projetadas); rx escala com sc
  private groundShadow(ctx: CanvasRenderingContext2D, sx: number, sy: number, rx: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, Math.max(1.5, rx * 0.4), 0, 0, 6.28);
    ctx.fill();
    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, VW, VH);

    // ---- PAREDE DO FUNDO (corre ao longo do corredor, no alto) ----
    const wallH = FAR_Y;
    const wg = ctx.createLinearGradient(0, 0, 0, wallH);
    wg.addColorStop(0, "#0a1730"); wg.addColorStop(1, "#16294a");
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, VW, wallH);
    ctx.lineWidth = 1;
    const pOff = -(((this.cameraX * 0.35) % 150) + 150) % 150;
    ctx.strokeStyle = "rgba(45,80,130,0.5)";
    for (let x = pOff; x < VW; x += 150) { ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, wallH - 4); ctx.stroke(); }
    const lOff = -(((this.cameraX * 0.35) % 260) + 260) % 260;
    ctx.fillStyle = "rgba(92,242,255,0.4)";
    for (let x = lOff; x < VW; x += 260) ctx.fillRect(x + 22, wallH * 0.45, 36, 3);

    // ---- CHÃO (faixa = profundidade) ----
    const fg = ctx.createLinearGradient(0, FAR_Y, 0, VH);
    fg.addColorStop(0, "#0a1320"); fg.addColorStop(1, "#0e1a2c");
    ctx.fillStyle = fg;
    ctx.fillRect(0, FAR_Y, VW, VH - FAR_Y);

    // linhas de PROFUNDIDADE = as 6 FAIXAS ÚTEIS (uma por bloco). As bordas
    // (faixa 0 e 6) são a PAREDE, no limite dos 6 blocos: destacadas em ciano.
    const rows = FORMATION_ROWS;
    for (let i = 0; i <= rows; i++) {
      const ly = WALL_TOP + (WALL_BOT - WALL_TOP) * (i / rows);
      const a = this.project(0, ly);
      const edge = i === 0 || i === rows;
      ctx.strokeStyle = edge ? `rgba(92,242,255,${0.30 + 0.35 * a.sc})` : `rgba(80,135,195,${0.12 + 0.18 * a.sc})`;
      ctx.lineWidth = edge ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(0, a.sy); ctx.lineTo(VW, a.sy); ctx.stroke();
    }
    ctx.lineWidth = 1;
    // linhas de AVANÇO (x constante, rolando): grid do chão = LARGURA DE 1 BLOCO,
    // então cada célula tem o tamanho de um inimigo. Convergem ao fundo.
    const gs = FORMATION_CELL;
    const baseX = Math.floor(this.cameraX / gs) * gs;
    ctx.strokeStyle = "rgba(80,135,195,0.16)";
    const cols = Math.ceil(VW / gs) + 6;
    for (let k = -2; k < cols; k++) {
      const wx = baseX + k * gs;
      const bot = this.project(wx, WALL_BOT);
      const top = this.project(wx, WALL_TOP);
      if (bot.sx < -60 && top.sx < -60) continue;
      if (bot.sx > VW + 60 && top.sx > VW + 60) continue;
      ctx.beginPath(); ctx.moveTo(bot.sx, bot.sy); ctx.lineTo(top.sx, top.sy); ctx.stroke();
    }
    // rodapé emissivo na junção parede/chão (fundo da faixa)
    ctx.fillStyle = "#2f6cff"; ctx.fillRect(0, FAR_Y - 2, VW, 2);
    ctx.fillStyle = "rgba(47,108,255,0.2)"; ctx.fillRect(0, FAR_Y, VW, 5);

    // vinheta frontal
    const frontGrad = ctx.createLinearGradient(0, VH - 30, 0, VH);
    frontGrad.addColorStop(0, "rgba(0,0,0,0)");
    frontGrad.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = frontGrad;
    ctx.fillRect(0, VH - 30, VW, 30);
  }

  // o MECH gigante (dono do personagem) à esquerda — acompanha a fase
  private drawMech(ctx: CanvasRenderingContext2D) {
    const eyeOn = this.mechFlash > 0;
    const bob = Math.sin(this.cameraX * 0.02) * 6; // "passo" enquanto avança

    ctx.save();
    // atmosfera/penumbra do mech (gradiente da esquerda)
    const atmo = ctx.createLinearGradient(0, 0, 170, 0);
    atmo.addColorStop(0, "rgba(16,34,62,0.92)");
    atmo.addColorStop(1, "rgba(16,34,62,0)");
    ctx.fillStyle = atmo; ctx.fillRect(0, 0, 170, VH);

    ctx.translate(-8, bob);
    // perna + pé (no chão)
    ctx.fillStyle = "#1a2740"; ctx.fillRect(24, VH * 0.55, 72, VH * 0.5);
    ctx.fillStyle = "#22324f"; ctx.fillRect(8, VH * 0.9, 120, 34);
    // torso
    ctx.fillStyle = "#23344f";
    ctx.beginPath(); ctx.moveTo(-10, VH * 0.18); ctx.lineTo(108, VH * 0.27); ctx.lineTo(118, VH * 0.7); ctx.lineTo(-10, VH * 0.72); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(92,242,255,0.22)"; ctx.lineWidth = 2; ctx.strokeRect(22, VH * 0.32, 74, VH * 0.3);
    // núcleo brilhante
    ctx.fillStyle = eyeOn ? "#ffffff" : "#5cf2ff"; ctx.shadowColor = "#5cf2ff"; ctx.shadowBlur = eyeOn ? 32 : 16;
    ctx.beginPath(); ctx.arc(56, VH * 0.46, eyeOn ? 17 : 11, 0, 6.28); ctx.fill();
    ctx.shadowBlur = 0;
    // ombro/cockpit + olho
    ctx.fillStyle = "#2a3d60"; ctx.fillRect(30, VH * 0.08, 64, VH * 0.14);
    ctx.fillStyle = eyeOn ? "#ffffff" : "#7fd4ff"; ctx.shadowColor = "#7fd4ff"; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(62, VH * 0.15, 7, 0, 6.28); ctx.fill();
    ctx.shadowBlur = 0;
    // braço estendido pra frente (protege o boneco)
    ctx.fillStyle = "#1e2d48"; ctx.fillRect(96, VH * 0.4, 46, 22);
    ctx.fillStyle = "#2a3d60"; ctx.fillRect(134, VH * 0.36, 18, 36);
    ctx.restore();

    // borda do território do mech (onde ficar pra trás machuca)
    const wx = this.cameraX + PURGE_PX;
    const top = this.project(wx, WALL_TOP), bot = this.project(wx, WALL_BOT);
    ctx.save();
    ctx.strokeStyle = "rgba(120,200,255,0.3)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(top.sx, top.sy); ctx.lineTo(bot.sx, bot.sy); ctx.stroke();
    ctx.restore();

    // FEIXE(S) do poder do mech (ativo)
    if (this.mechBeamTimer > 0) {
      const a = Math.max(0, this.mechBeamTimer / 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = "#5cf2ff"; ctx.shadowBlur = 24;
      for (const wy of this.mechBeamYs) {
        const by = this.project(this.player.x, wy).sy;
        const grad = ctx.createLinearGradient(0, by, VW, by);
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(1, "rgba(92,242,255,0.08)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, by - (10 * a + 4), VW, 20 * a + 8);
      }
      ctx.restore();
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D) {
    // ordena por profundidade (inclui corpos MORRENDO, que somem com fade)
    const list = this.enemies.filter((e) => !e.dead || e.dying > 0).sort((a, b) => a.y - b.y);

    for (const e of list) {
      const pr = this.project(e.x, e.y);
      if (pr.sx < -110 || pr.sx > VW + 110) continue;
      const sx = pr.sx;
      const fade = e.dead ? Math.max(0, e.dying / DYING_MAX) : 1; // morrendo → some
      const r = e.radius * pr.sc * (e.dead ? 0.55 + 0.45 * fade : 1); // encolhe ao morrer
      const col = e.flash > 0 ? "#ffffff" : e.def.color;
      // cada cubo = 1 BLOCO uniforme (1 peça por célula da grade; sem esticar)
      if (e.def.behavior === "cube") { this.drawCube(ctx, e, pr.sx, pr.sy, r, fade); continue; }
      const flying = e.def.behavior === "rushFront" || e.def.behavior === "fromDoor" || e.def.behavior === "shooter";
      const lift = e.boss ? r : flying ? r * 1.5 : r * 0.95;

      // sombra no chão (mais fraca/menor pra quem voa)
      if (!e.dead) this.groundShadow(ctx, sx, pr.sy, r * (flying ? 0.72 : 1), flying ? 0.18 : 0.32);

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(sx, pr.sy - lift);
      ctx.shadowColor = e.def.color;
      ctx.shadowBlur = e.boss ? 26 : 9;
      ctx.fillStyle = col;

      if (e.boss) {
        // núcleo flutuante grande
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.28); ctx.fill();
        ctx.fillStyle = "#1a0a12"; ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, 6.28); ctx.fill();
        ctx.fillStyle = "#ff8aa0"; ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, 6.28); ctx.fill();
      } else if (e.def.behavior === "tank" || e.def.behavior === "shield") {
        // caixa com pseudo-3D (face frontal + topo)
        const w = r * 1.1;
        ctx.beginPath();
        ctx.moveTo(-w, lift); ctx.lineTo(-w, -r * 0.6); ctx.lineTo(w, -r * 0.6); ctx.lineTo(w, lift);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = e.flash > 0 ? "#ffffff" : shade(e.def.color, 1.35);
        ctx.beginPath();
        ctx.moveTo(-w, -r * 0.6); ctx.lineTo(-w * 0.7, -r * 1.0); ctx.lineTo(w * 1.3, -r * 1.0); ctx.lineTo(w, -r * 0.6);
        ctx.closePath(); ctx.fill();
      } else if (flying) {
        // drone/craft pairando: corpo achatado + brilho
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.1, r * 0.62, 0, 0, 6.28); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(0, -r * 0.12, r * 0.22, 0, 6.28); ctx.fill();
      } else {
        // unidade "de pé": corpo (cápsula) + cabeça
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.8, r * 1.0, 0, 0, 6.28); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -r * 0.95, r * 0.5, 0, 6.28); ctx.fill();
      }
      // infecção (nanites)
      if (e.dotDps > 0) {
        ctx.shadowBlur = 0; ctx.globalAlpha = 0.55; ctx.fillStyle = "rgba(124,255,142,0.6)";
        ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, 6.28); ctx.fill();
      }
      ctx.restore();

      // barra de vida (não em corpos morrendo)
      const topY = pr.sy - lift - r - 8;
      if (e.dead) { /* sem barra */ }
      else if (e.boss) this.drawBossBar(ctx, e);
      else if (e.maxHp > 40 && e.hp < e.maxHp) {
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(sx - r, topY, r * 2, 4);
        ctx.fillStyle = "#ff5470"; ctx.fillRect(sx - r, topY, r * 2 * (e.hp / e.maxHp), 4);
      }
    }
  }

  // BLOCO que ocupa EXATAMENTE a célula 38×38 do chão, extrudado pra cima →
  // cubos vizinhos se encaixam (100% agrupados). Com HP numerado na face.
  private drawCube(ctx: CanvasRenderingContext2D, e: Enemy, sx: number, _sy: number, r: number, fade = 1) {
    const flash = e.flash > 0;
    const shrink = e.dead ? 0.5 + 0.5 * fade : 1; // encolhe ao morrer
    const hw = (FORMATION_CELL / 2) * shrink;     // meia-célula (mundo)
    // 4 cantos do PISO da célula: f = frente (near, y+), b = fundo (far, y-)
    const fL = this.project(e.x - hw, e.y + hw);
    const fR = this.project(e.x + hw, e.y + hw);
    const bL = this.project(e.x - hw, e.y - hw);
    const bR = this.project(e.x + hw, e.y - hw);
    const H = Math.max(r * 1.4, fR.sx - fL.sx); // altura ≈ largura → cubo
    type P = { sx: number; sy: number };
    const up = (p: P): P => ({ sx: p.sx, sy: p.sy - H });
    const fLt = up(fL), fRt = up(fR), bLt = up(bL), bRt = up(bR);
    const lerp2 = (a: P, b: P, t: number): P => ({ sx: a.sx + (b.sx - a.sx) * t, sy: a.sy + (b.sy - a.sy) * t });
    const fp = (u: number, v: number): P => lerp2(lerp2(fLt, fRt, u), lerp2(fL, fR, u), v); // ponto na face frontal
    const poly = (pts: P[], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(pts[0].sx, pts[0].sy);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
      ctx.closePath(); ctx.fill();
    };
    if (fade >= 1) this.groundShadow(ctx, sx, fL.sy, (fR.sx - fL.sx) * 0.6, 0.3);

    ctx.save();
    ctx.globalAlpha = fade;
    // topo (mais claro)
    poly([bLt, bRt, fRt, fLt], flash ? "#ffffff" : shade(e.def.color, 1.45));
    // lateral VISÍVEL (a oposta ao ponto de fuga)
    const colSide = flash ? "#dddddd" : shade(e.def.color, 0.6);
    if (sx <= VW / 2) poly([fR, bR, bRt, fRt], colSide); // direita
    else poly([bL, fL, fLt, bLt], colSide);              // esquerda
    // face FRONTAL (gradiente) + contorno
    const g = ctx.createLinearGradient(0, fLt.sy, 0, fL.sy);
    g.addColorStop(0, flash ? "#ffffff" : e.def.color);
    g.addColorStop(1, flash ? "#cccccc" : shade(e.def.color, 0.78));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fL.sx, fL.sy); ctx.lineTo(fR.sx, fR.sy); ctx.lineTo(fRt.sx, fRt.sy); ctx.lineTo(fLt.sx, fLt.sy);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.stroke();
    if (e.dotDps > 0) poly([fL, fR, fRt, fLt], "rgba(124,255,142,0.35)");
    // BAÚ: banda da tampa + fechadura brilhante
    if (e.def.id === "chest" && !e.dead) {
      poly([fp(0, 0.42), fp(1, 0.42), fp(1, 0.66), fp(0, 0.66)], "#5a3d00");
      const lock = fp(0.5, 0.58);
      ctx.fillStyle = "#fff2a8"; ctx.shadowColor = "#ffd65c"; ctx.shadowBlur = 8 + Math.sin(this.time * 6) * 4;
      ctx.beginPath(); ctx.arc(lock.sx, lock.sy, H * 0.08, 0, 6.28); ctx.fill();
      ctx.shadowBlur = 0;
    }
    // HP na face (não em corpo morrendo)
    if (!e.dead) {
      const c = fp(0.5, e.def.id === "chest" ? 0.28 : 0.5);
      ctx.fillStyle = e.def.id === "chest" ? "#3a2800" : "#06080f";
      ctx.font = `bold ${Math.round(H * (e.def.id === "chest" ? 0.3 : 0.46))}px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(Math.max(1, Math.ceil(e.hp))), c.sx, c.sy);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
  }

  private drawBossBar(ctx: CanvasRenderingContext2D, e: Enemy) {
    const w = VW - 200, x = 100, y = VH - 24;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x, y, w, 12);
    ctx.fillStyle = "#ff5470"; ctx.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), 12);
    ctx.strokeStyle = "#ff9aa8"; ctx.strokeRect(x, y, w, 12);
    ctx.fillStyle = "#fff"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
    ctx.fillText(e.def.name, VW / 2, y - 4); ctx.textAlign = "left";
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D) {
    for (const pr of this.projectiles) {
      const p = this.project(pr.x, pr.y);
      const lift = 16 * p.sc, rr = Math.max(2, pr.radius * p.sc);
      this.groundShadow(ctx, p.sx, p.sy, rr, 0.12);
      ctx.save();
      ctx.shadowColor = pr.color; ctx.shadowBlur = 8; ctx.fillStyle = pr.color;
      if (pr.kind === "disc") {
        ctx.translate(p.sx, p.sy - lift); ctx.rotate(this.time * 12);
        ctx.fillRect(-rr, -2, rr * 2, 4); ctx.fillRect(-2, -rr, 4, rr * 2);
      } else {
        ctx.beginPath(); ctx.arc(p.sx, p.sy - lift, rr, 0, 6.28); ctx.fill();
      }
      ctx.restore();
    }
    for (const pr of this.enemyProjectiles) {
      const p = this.project(pr.x, pr.y);
      const rr = Math.max(2, pr.radius * p.sc);
      this.groundShadow(ctx, p.sx, p.sy, rr, 0.12);
      ctx.save(); ctx.shadowColor = pr.color; ctx.shadowBlur = 6; ctx.fillStyle = pr.color;
      ctx.beginPath(); ctx.arc(p.sx, p.sy - 16 * p.sc, rr, 0, 6.28); ctx.fill(); ctx.restore();
    }
  }

  private drawDrones(ctx: CanvasRenderingContext2D) {
    for (const d of this.drones) {
      const p = this.project(d.x, d.y);
      const hover = 26 * p.sc;
      this.groundShadow(ctx, p.sx, p.sy, 6 * p.sc, 0.16);
      ctx.save();
      ctx.translate(p.sx, p.sy - hover);
      ctx.shadowColor = "#ffd65c"; ctx.shadowBlur = 9; ctx.fillStyle = "#ffd65c";
      ctx.beginPath(); ctx.ellipse(0, 0, 7 * p.sc, 5 * p.sc, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = "#fff7d6"; ctx.beginPath(); ctx.arc(0, -1, 2 * p.sc, 0, 6.28); ctx.fill();
      ctx.restore();
    }
  }

  private drawAreas(ctx: CanvasRenderingContext2D) {
    for (const a of this.areas) {
      const p = this.project(a.x, a.y);
      const t = a.life / a.maxLife;
      ctx.save();
      if (a.kind === "tesla" && a.radius === 0) {
        const L = this.project(a.x - 700, a.y), R = this.project(a.x + 700, a.y);
        ctx.globalAlpha = t; ctx.strokeStyle = a.color; ctx.lineWidth = 4; ctx.shadowColor = a.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(L.sx, L.sy); ctx.lineTo(R.sx, R.sy); ctx.stroke();
      } else {
        const rad = a.radius * p.sc;
        ctx.globalAlpha = 0.18 + 0.12 * Math.sin(this.time * 6);
        const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad);
        g.addColorStop(0, a.color); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.sx, p.sy, rad, rad * 0.6, 0, 0, 6.28); ctx.fill();
        if (a.kind === "singularity") { ctx.globalAlpha = 0.9; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(p.sx, p.sy, rad * 0.18, 0, 6.28); ctx.fill(); }
      }
      ctx.restore();
    }
  }

  private drawMines(ctx: CanvasRenderingContext2D) {
    for (const m of this.mines) {
      const p = this.project(m.x, m.y);
      ctx.save(); ctx.translate(p.sx, p.sy);
      const blink = m.arm <= 0 ? (Math.sin(this.time * 20) > 0 ? 1 : 0.4) : 0.7;
      ctx.globalAlpha = blink; ctx.shadowColor = m.color; ctx.shadowBlur = 8; ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(0, -3 * p.sc, 6 * p.sc, 0, 6.28); ctx.fill(); ctx.restore();
    }
  }

  private drawPickups(ctx: CanvasRenderingContext2D) {
    for (const pk of this.pickups) {
      const p = this.project(pk.x, pk.y);
      const oy = (pk.homing ? -9 : -(6 + Math.sin(this.time * 4 + pk.bob) * 2)) * p.sc;
      if (pk.kind === "mech") {
        // item do mech: engrenagem dourada brilhante (recompensa de baú)
        const r = 8 * Math.max(0.7, p.sc);
        ctx.save();
        ctx.translate(p.sx, p.sy + oy - 4 * p.sc);
        ctx.rotate(this.time * 3);
        ctx.shadowColor = "#ffd65c"; ctx.shadowBlur = 14; ctx.fillStyle = "#ffe066";
        for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillRect(-r * 0.18, r * 0.6, r * 0.36, r * 0.5); }
        ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, 6.28); ctx.fill();
        ctx.fillStyle = "#7a5200"; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 6.28); ctx.fill();
        ctx.restore();
        continue;
      }
      const c = pk.kind === "heal" ? "#7CFF8E" : "#5cf2ff";
      const r = (pk.kind === "heal" ? 4 : 3.2) * Math.max(0.6, p.sc);
      if (!pk.homing) this.groundShadow(ctx, p.sx, p.sy, r * 0.9, 0.22);
      ctx.save();
      ctx.shadowColor = c; ctx.shadowBlur = pk.homing ? 11 : 8; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(p.sx, p.sy + oy, r, 0, 6.28); ctx.fill();
      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    const pr = this.project(p.x, p.y);
    const r = p.radius * pr.sc;

    // sombra no chão (pés em pr.sy)
    this.groundShadow(ctx, pr.sx, pr.sy, r, 0.34);

    ctx.save();
    ctx.translate(pr.sx, pr.sy); // origem = pés
    if (p.invuln > 0 && Math.sin(this.time * 40) > 0) ctx.globalAlpha = 0.4;

    // brilho da ult
    if (p.ultActive > 0) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 20; }
    else { ctx.shadowColor = p.char.color; ctx.shadowBlur = 14; }

    // corpo (cápsula vertical, sobe a partir dos pés)
    ctx.fillStyle = p.char.color;
    ctx.beginPath(); ctx.ellipse(0, -r * 1.0, r * 0.72, r * 1.0, 0, 0, 6.28); ctx.fill();
    // cabeça
    ctx.beginPath(); ctx.arc(0, -r * 2.05, r * 0.5, 0, 6.28); ctx.fill();
    // visor escuro
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#06080f";
    ctx.beginPath(); ctx.ellipse(p.facing * r * 0.18, -r * 2.05, r * 0.26, r * 0.3, 0, 0, 6.28); ctx.fill();
    // arma apontando pra frente, na altura do "peito"
    ctx.fillStyle = shade(p.char.color, 1.3);
    ctx.fillRect(p.facing > 0 ? r * 0.3 : -r * 1.2, -r * 1.25, r * 0.9, r * 0.28);

    // escudo
    if (p.shield > 0) {
      ctx.strokeStyle = "rgba(120,200,255,0.55)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -r * 1.1, r * 1.1, r * 1.7, 0, 0, 6.28); ctx.stroke();
    }
    ctx.restore();

    // RECARGA visual acima da cabeça do personagem
    const w0 = p.weapons[0];
    if (w0 && w0.reloadTimer > 0) {
      const rtw = weaponRuntime(WEAPONS[w0.defId], w0.level, p, w0.up);
      const frac = rtw.reload > 0 ? 1 - w0.reloadTimer / rtw.reload : 1;
      const cx = pr.sx, cy = pr.sy - r * 3.2;
      const rad = Math.max(8, r * 0.7);
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.28); ctx.stroke();
      ctx.strokeStyle = "#ffd65c";
      ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + frac * 6.283); ctx.stroke();
      ctx.fillStyle = "#ffe066"; ctx.font = `bold ${Math.round(rad * 0.8)}px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("⟳", cx, cy + 1);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.restore();
    }
  }

  // golpes de martelo (arco fugaz na direção do golpe)
  // varredura de GRADIENTE (sem desenhar o martelo): uma faixa de luz passa
  // pela frente esmaecendo; cada golpe varre no sentido INVERSO (vai e volta).
  private drawSwings(ctx: CanvasRenderingContext2D) {
    for (const s of this.swings) {
      const phase = Math.min(1, 1 - s.life / s.maxLife); // 0→1
      const pr = this.project(s.x, s.y);
      const reach = Math.max(20, s.reach * pr.sc);
      const fwd = Math.cos(s.ang) >= 0 ? 1 : -1; // lado da mira
      const cx = pr.sx, cy = pr.sy - reach * 0.45; // pivô (peito)
      // arco vertical na frente; o sentido alterna por golpe (s.dir)
      const thA = -1.3, thB = 1.3;
      const start = s.dir > 0 ? thA : thB;
      const end = s.dir > 0 ? thB : thA;
      const et = phase * phase; // EASE no início (lento → rápido)
      const fade = 1 - phase * phase; // esmaece ao longo do golpe

      ctx.save();
      ctx.lineCap = "round";
      ctx.shadowColor = "#ffe066"; ctx.shadowBlur = 16;
      // trilha: fatias atrás da frente da varredura, cada vez mais fracas (esmaece)
      const N = 12;
      for (let i = 0; i < N; i++) {
        const tt = et - i * 0.05;
        if (tt < 0) break;
        const th = lerp(start, end, tt);
        const ang = fwd > 0 ? th : Math.PI - th; // espelha pro lado esquerdo
        const a = (1 - i / N) * fade * 0.7;
        ctx.strokeStyle = `rgba(255,236,165,${a})`;
        ctx.lineWidth = reach * 0.62 * (1 - (i / N) * 0.55);
        ctx.beginPath();
        ctx.arc(cx, cy, reach * 1.05, ang - 0.16, ang + 0.16);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // marcador do destino de clique (anel pulsante no chão)
  private drawMoveTarget(ctx: CanvasRenderingContext2D) {
    if (!this.moveTargetActive) return;
    const pr = this.project(this.moveTargetX, this.moveTargetY);
    const r = (10 + Math.sin(this.time * 10) * 3) * pr.sc;
    ctx.save();
    ctx.strokeStyle = "rgba(120,230,255,0.8)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(pr.sx, pr.sy, r, r * 0.45, 0, 0, 6.28); ctx.stroke();
    ctx.fillStyle = "rgba(120,230,255,0.5)";
    ctx.beginPath(); ctx.ellipse(pr.sx, pr.sy, 3 * pr.sc, 1.6 * pr.sc, 0, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  // mira: linha de ricochete (tiro) OU arco de alcance (martelo)
  private drawAim(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    const mainDef = WEAPONS[p.weapons[0].defId];
    if (mainDef.behavior === "melee") {
      // prévia do arco do martelo na direção da mira
      const rt = weaponRuntime(mainDef, p.weapons[0].level, p, p.weapons[0].up);
      const pr = this.project(p.x, p.y);
      const reach = (rt.radius || 60) * pr.sc;
      ctx.save();
      ctx.translate(pr.sx, pr.sy - reach * 0.35);
      ctx.rotate(p.aimAngle);
      ctx.globalAlpha = 0.25; ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, reach, -(rt.arc || 1.4) / 2, (rt.arc || 1.4) / 2); ctx.stroke();
      ctx.restore();
      return;
    }
    const fw = p.weapons.find((w) => WEAPONS[w.defId].behavior === "frontal");
    if (!fw) return; // personagem sem tiro mirado não mostra mira
    let bounces = weaponRuntime(WEAPONS[fw.defId], fw.level, p).bounces;

    let x = p.x, y = p.y; // marcha no MUNDO
    let vx = Math.cos(p.aimAngle), vy = Math.sin(p.aimAngle);
    const pts: { x: number; y: number }[] = [{ x, y }];
    const step = 12;
    let dist = 0;
    while (dist < 1600) {
      x += vx * step; y += vy * step; dist += step;
      if (y < WALL_TOP + 6) {
        if (bounces > 0) { y = WALL_TOP + 6; vy = -vy; bounces--; pts.push({ x, y }); }
        else break;
      } else if (y > WALL_BOT - 6) {
        if (bounces > 0) { y = WALL_BOT - 6; vy = -vy; bounces--; pts.push({ x, y }); }
        else break;
      }
      const pj = this.project(x, y);
      if (pj.sx < -30 || pj.sx > VW + 30) break;
      let hit = false;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (dist2(x, y, e.x, e.y) < (e.radius + 3) ** 2) { hit = true; break; }
      }
      if (hit) break;
    }
    pts.push({ x, y });

    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = "rgba(150,230,255,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const s0 = this.project(pts[0].x, pts[0].y);
    ctx.moveTo(s0.sx, s0.sy);
    for (let i = 1; i < pts.length; i++) { const s = this.project(pts[i].x, pts[i].y); ctx.lineTo(s.sx, s.sy); }
    ctx.stroke();
    ctx.setLineDash([]);
    const end = this.project(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.strokeStyle = "rgba(150,230,255,0.8)";
    ctx.beginPath(); ctx.arc(end.sx, end.sy, 6, 0, 6.28); ctx.stroke();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (const pa of this.particles) {
      const p = this.project(pa.x, pa.y);
      const sz = pa.size * p.sc;
      ctx.globalAlpha = Math.max(0, pa.life / pa.maxLife);
      ctx.fillStyle = pa.color;
      ctx.fillRect(p.sx - sz / 2, p.sy - 14 * p.sc - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of this.texts) {
      const p = this.project(t.x, t.y);
      const a = Math.min(1, t.life / t.maxLife);
      ctx.globalAlpha = a;
      ctx.font = `bold ${Math.round(t.size * (0.7 + 0.5 * p.sc))}px system-ui`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(t.text, p.sx, p.sy + t.oy);
      ctx.fillStyle = t.color; ctx.fillText(t.text, p.sx, p.sy + t.oy);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  // moedas voando até a HUD (coords de tela, sobre tudo)
  private drawCoins(ctx: CanvasRenderingContext2D) {
    for (const c of this.coins) {
      if (c.age < 0) continue;
      ctx.save();
      ctx.shadowColor = "#ffd65c"; ctx.shadowBlur = 8;
      ctx.fillStyle = "#ffe066";
      ctx.beginPath(); ctx.ellipse(c.x, c.y, 5.5, 5.5, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = "#b8860b"; ctx.font = "bold 7px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("❖", c.x, c.y + 0.5);
      ctx.restore();
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
}

// ---------------- runtime de arma (escala por nível + stats) ----------------
interface WeaponRuntime {
  damage: number;
  cooldown: number;
  count: number;
  pierce: number;
  bounces: number;
  radius: number;
  duration: number;
  chainJumps: number;
  mag: number; // tamanho do pente (0 = sem munição)
  reload: number; // tempo de recarga
  arc: number; // ângulo do golpe melee
  range: number; // alcance da bala (0 = longo)
  spread: number; // abertura do leque (rad)
  knockback: number;
  critChance: number;
  projSize: number;
}

const NO_UP = baseUpgradeBonus();

function weaponRuntime(def: WeaponDef, level: number, p: Player, up: UpgradeBonus = NO_UP): WeaponRuntime {
  const s = p.stats;
  const lvlDmg = 1 + 0.18 * (level - 1);
  let dmg = def.damage * lvlDmg * s.damageMul * up.damageMul;
  if (def.behavior === "frontal" || def.behavior === "rail" || def.behavior === "ricochet") dmg *= s.frontalDamageMul;
  if (def.behavior === "nanite" || def.behavior === "area") dmg *= s.dotMul;
  // overdrive (Vega)
  if (p.ultActive > 0 && p.char.ult === "overdrive") dmg *= 1.6;

  let cd = def.cooldown * (1 - 0.04 * (level - 1)) * up.cooldownMul / s.fireRateMul;
  if (p.ultActive > 0 && p.char.ult === "overdrive") cd *= 0.55;

  // contagem de projéteis por tipo
  let count: number;
  if (def.behavior === "frontal") {
    if (def.pellets) count = def.pellets + Math.floor((level - 1) / 2) + s.projectileAdd + up.pelletsAdd; // shotgun
    else if (def.burst) count = def.burst + up.burstAdd; // rajada
    else count = (def.count ?? 1) + s.projectileAdd + (level >= 3 ? 1 : 0) + (level >= 5 ? 1 : 0); // rifle
  } else {
    count = def.count ?? 1;
    if (def.behavior === "nanite") count += Math.floor(level / 2);
    if (def.behavior === "mine") count += Math.floor(level / 3);
  }

  // munição/recarga
  let mag = def.mag ?? 0;
  if (mag > 0) {
    if (def.pellets) mag += level - 1; // shotgun +1/nível
    else if (def.burst) mag += 0; // rajada fixa
    else mag += (level - 1) * 2; // rifle +2/nível
    mag += up.magAdd;
  }
  const reload = Math.max(0.3, (def.reload ?? 0) * (1 - 0.05 * (level - 1)) * up.reloadMul);

  // ricochetes
  let bounces = (def.bounces ?? 0) + s.ricochetBonusBounces + up.bouncesAdd;
  if (def.behavior === "ricochet") bounces += level - 1;
  else if (def.behavior === "frontal") bounces += Math.floor((level - 1) / 2);
  const chainJumps = (def.chainJumps ?? 0) + (level - 1);
  // martelo: alcance e arco crescem com o nível + upgrades
  const radius = ((def.radius ?? 0) + (def.behavior === "melee" ? (level - 1) * 7 + up.reachAdd : 0)) * s.areaMul;
  const arc = (def.arc ?? 0) + (def.behavior === "melee" ? (level - 1) * 0.12 + up.arcAdd : 0);
  const duration = (def.duration ?? 0) * s.durationMul;
  const range = (def.range ?? 0) * up.rangeMul;
  const spread = (def.spread ?? 0.1) * up.spreadMul;
  const knockback = (def.knockback ?? 0) * up.knockbackMul;

  return {
    damage: dmg, cooldown: Math.max(0.08, cd), count, pierce: (def.pierce ?? 0) + up.pierceAdd,
    bounces, radius, duration, chainJumps, mag, reload, arc, range, spread, knockback,
    critChance: Math.min(0.6, up.critChance), projSize: up.projSizeMul,
  };
}

// dano base do disco já considera ricochete multiplicador de stat
function p_stat_ricochet(_p: Player) { return 1; }

// clareia/escurece uma cor #rrggbb por um fator (>1 clareia).
function shade(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r},${g},${b})`;
}
