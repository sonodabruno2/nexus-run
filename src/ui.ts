import { World } from "./game";
import { CHARACTERS } from "./content/characters";
import { WEAPONS } from "./content/weapons";
import { PASSIVES } from "./content/passives";
import type { Card } from "./player";
import type { MechUpgradeDef } from "./content/mech";
import {
  META_UPGRADES,
  buyUpgrade,
  upgradeCost,
  upgradeLevel,
} from "./meta";
import { audio } from "./audio";

export type Screen = "none" | "menu" | "shop" | "levelup" | "mechpick" | "end" | "pause";

export class UI {
  overlay: HTMLDivElement;
  world: World;
  selectedChar = CHARACTERS[0].id;
  screen: Screen = "none";

  constructor(parent: HTMLElement, world: World) {
    this.world = world;
    this.overlay = document.createElement("div");
    this.overlay.className = "overlay";
    parent.appendChild(this.overlay);
  }

  hide() {
    this.overlay.classList.add("hidden");
    this.overlay.innerHTML = "";
    this.screen = "none";
  }

  private show() {
    this.overlay.classList.remove("hidden");
  }

  showPause() {
    this.show();
    this.screen = "pause";
    this.overlay.innerHTML = "";
    const resume = el("button", "btn primary", "▶ Continuar") as HTMLButtonElement;
    resume.onclick = () => this.hide();
    const quit = el("button", "btn", "Abandonar (Menu)") as HTMLButtonElement;
    quit.onclick = () => { this.world.status = "gameover"; this.hide(); this.showMenu(); };
    this.overlay.append(
      el("div", "title", "PAUSA"),
      el("div", "subtitle", "Incursão suspensa."),
      row(resume, quit),
    );
  }

  // ----------------------------- menu + loja
  showMenu() {
    this.show();
    this.screen = "menu";
    const m = this.world.meta;
    this.overlay.innerHTML = "";

    const title = el("div", "title", "NEXUS RUN");
    const sub = el("div", "subtitle",
      "Survivor horizontal automático. Avance pelo laboratório NEXUS enquanto a IA tenta empurrar você para a Barreira de Purga. Mire a build, sobreviva, vá mais fundo.");
    const charsWrap = el("div", "chars");
    for (const c of CHARACTERS) {
      const card = el("div", "char" + (c.id === this.selectedChar ? " sel" : ""));
      card.innerHTML = `
        <div class="dot" style="background:${c.color};color:${c.color}"></div>
        <h3>${c.name}</h3>
        <div class="role">${c.title}</div>
        <p><b>Arma:</b> ${WEAPONS[c.startWeapon].name}<br><b>Passiva:</b> ${c.passiveDesc}</p>
        <div class="ult">★ ${c.ultName}: ${c.ultDesc}</div>`;
      card.onclick = () => {
        this.selectedChar = c.id;
        charsWrap.querySelectorAll(".char").forEach((n) => n.classList.remove("sel"));
        card.classList.add("sel");
      };
      charsWrap.appendChild(card);
    }

    const creditsLine = el("div", "credits-line", `❖ ${m.credits} créditos`);
    const best = m.bestTime > 0
      ? el("div", "stat-line", `Melhor tempo: ${fmtTime(m.bestTime)} · Runs: ${m.runs}`)
      : el("div", "stat-line", "Primeira incursão. Boa sorte.");

    const startBtn = el("button", "btn primary", "▶ INICIAR INCURSÃO") as HTMLButtonElement;
    startBtn.onclick = () => this.startRun();
    const shopBtn = el("button", "btn", "⚙ ABRIGO NEXUS (loja)") as HTMLButtonElement;
    shopBtn.onclick = () => this.showShop();

    const hint = el("div", "hint", "Mover: WASD / setas / arraste · Ultimate: Espaço · Pausar: P");

    this.overlay.append(title, sub, creditsLine, best, charsWrap, row(startBtn, shopBtn), hint);
  }

  showShop() {
    this.show();
    this.screen = "shop";
    const m = this.world.meta;
    this.overlay.innerHTML = "";
    const wrap = el("div", "shop");
    wrap.appendChild(el("h2", "", "Abrigo NEXUS"));
    wrap.appendChild(el("div", "credits-line", `❖ ${m.credits} créditos`));
    const grid = el("div", "shop-grid");

    for (const def of META_UPGRADES) {
      const lvl = upgradeLevel(m, def.id);
      const maxed = lvl >= def.max;
      const cost = upgradeCost(def, lvl);
      const item = el("div", "up");
      item.innerHTML = `
        <div class="info">
          <h4>${def.name}</h4>
          <small>${def.desc}</small>
          <div class="lvl">Nível ${lvl}/${def.max}</div>
        </div>`;
      const btn = el("button", "btn", maxed ? "MÁX" : `❖ ${cost}`) as HTMLButtonElement;
      btn.disabled = maxed || m.credits < cost;
      btn.onclick = () => { if (buyUpgrade(m, def)) this.showShop(); };
      item.appendChild(btn);
      grid.appendChild(item);
    }
    wrap.appendChild(grid);
    const back = el("button", "btn primary", "◀ Voltar") as HTMLButtonElement;
    back.onclick = () => this.showMenu();
    this.overlay.append(wrap, back);
  }

  private startRun() {
    audio.resume(); // destrava o áudio dentro do gesto do clique
    const char = CHARACTERS.find((c) => c.id === this.selectedChar)!;
    this.world.start(char);
    this.hide();
  }

  // ----------------------------- level up
  showLevelUp(cards: Card[]) {
    this.show();
    this.screen = "levelup";
    this.overlay.innerHTML = "";
    this.overlay.append(
      el("div", "title", "NÍVEL " + this.world.player.level),
      el("div", "subtitle", "Escolha uma melhoria para a sua build."),
    );
    const cardsWrap = el("div", "cards");
    for (const c of cards) {
      const node = el("div", "card" + (c.kind === "fusion" ? " fusion" : ""));
      node.innerHTML = `
        <div class="bar" style="background:${c.color}"></div>
        <div class="tag">${tagFor(c)}</div>
        <h3>${c.name}</h3>
        <p>${c.desc}</p>`;
      node.onclick = () => {
        this.world.chooseCard(c);
        this.hide();
      };
      cardsWrap.appendChild(node);
    }
    this.overlay.appendChild(cardsWrap);
    if (this.world.player.rerolls > 0) {
      const rb = el("button", "btn", `⟳ Reroll (${this.world.player.rerolls})`) as HTMLButtonElement;
      rb.onclick = () => {
        if (this.world.rerollCards() && this.world.pendingCards) {
          this.showLevelUp(this.world.pendingCards);
        }
      };
      this.overlay.appendChild(rb);
    }
  }

  // ----------------------------- escolha de upgrade do MECH (baú raro)
  showMechPick(cards: MechUpgradeDef[]) {
    this.show();
    this.screen = "mechpick";
    this.overlay.innerHTML = "";
    const title = el("div", "title mech", "⚙ NÚCLEO DO MECH");
    this.overlay.append(
      title,
      el("div", "subtitle", "Baú raro recuperado. Escolha um aprimoramento para o seu mech."),
    );
    const cardsWrap = el("div", "cards");
    for (const u of cards) {
      const node = el("div", "card mech");
      node.innerHTML = `
        <div class="bar" style="background:#5cf2ff"></div>
        <div class="tag">⚙ Mech</div>
        <h3>${u.name}</h3>
        <p>${u.desc}</p>`;
      node.onclick = () => {
        this.world.chooseMechUpgrade(u);
        this.hide();
      };
      cardsWrap.appendChild(node);
    }
    this.overlay.appendChild(cardsWrap);
  }

  // ----------------------------- fim de run
  showEnd(won: boolean) {
    this.show();
    this.screen = "end";
    const w = this.world;
    this.overlay.innerHTML = "";
    const title = el("div", "title", won ? "SETOR LIMPO" : "ELIMINADO");
    title.style.background = won
      ? "linear-gradient(90deg,#7CFF8E,#5cf2ff)"
      : "linear-gradient(90deg,#ff5470,#b98cff)";
    (title.style as CSSStyleDeclaration).webkitBackgroundClip = "text";
    title.style.backgroundClip = "text";
    title.style.color = "transparent";

    const stats = el("div", "subtitle",
      `Tempo: ${fmtTime(w.time)} · Abates: ${w.kills} · Nível: ${w.player.level}`);
    const earned = el("div", "credits-line", `+ ❖ ${w.player.credits} créditos coletados`);

    const buildLine = el("div", "stat-line", "Build: " +
      w.player.weapons.map((x) => WEAPONS[x.defId].name).join(" · "));
    const passLine = el("div", "stat-line",
      Object.keys(w.player.passives).length
        ? "Passivas: " + Object.entries(w.player.passives).map(([id, l]) => `${PASSIVES[id].name} ${l}`).join(" · ")
        : "");

    const again = el("button", "btn primary", "↻ Nova incursão") as HTMLButtonElement;
    again.onclick = () => this.startRun();
    const menu = el("button", "btn", "Menu / Loja") as HTMLButtonElement;
    menu.onclick = () => this.showMenu();

    this.overlay.append(title, stats, earned, buildLine, passLine, row(again, menu));
  }
}

// ----------------------------- helpers DOM
function el(tag: string, cls = "", text = ""): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}
function row(...kids: HTMLElement[]): HTMLElement {
  const r = el("div", "row");
  r.append(...kids);
  return r;
}
function tagFor(c: Card): string {
  switch (c.kind) {
    case "weapon-new": return "Nova arma";
    case "weapon-up": return "Upgrade de arma";
    case "weapon-mod": return "★ Mod de arma";
    case "passive-new": return "Nova passiva";
    case "passive-up": return "Upgrade de passiva";
    case "fusion": return "★ Fusão";
    case "heal": return "Reparo";
  }
}
function fmtTime(t: number): string {
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
