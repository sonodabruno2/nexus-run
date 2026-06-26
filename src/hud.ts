import type { World } from "./game";
import { VW, VH } from "./core/constants";
import { WEAPONS } from "./content/weapons";
import { PASSIVES } from "./content/passives";

// HUD em pílulas brancas flutuantes + campo de tiros embaixo (estilo shooter).
export class HUD {
  root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private loadoutSig = "";

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud hidden";
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-side hud-left">
          <div class="pill hp"><div class="fill"></div><div class="fill shield"></div><span class="txt"></span></div>
          <div class="pill mech"><div class="fill mfill"></div><span class="txt mtxt">⚙ —</span></div>
          <div class="pill xp"><div class="fill"></div><span class="txt">Nv 1</span></div>
          <div class="pill ammo"><div class="fill afill"></div><span class="txt atxt">—</span></div>
          <div class="upgrades"></div>
        </div>
        <div class="hud-center">
          <div class="pill progress"><div class="fill prog"></div><span class="txt ptxt">SETOR 0%</span></div>
        </div>
        <div class="hud-side hud-right">
          <div class="pill stat time">0:00</div>
          <div class="pill stat cred">❖ 0</div>
          <div class="pill stat kill">☠ 0</div>
          <div class="pill stat reroll hidden">⟳ 0</div>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="weapons"></div>
        <div class="ultgauge" title="Especial — botão direito do mouse">
          <div class="ring"><div class="inner"><span class="unum">0</span></div></div>
          <div class="ulabel">ESPECIAL</div>
        </div>
      </div>`;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    for (const k of [
      ".pill.hp .fill:not(.shield)|hpFill", ".pill.hp .fill.shield|hpShield", ".pill.hp .txt|hpTxt",
      ".pill.mech|mechPill", ".pill.mech .mfill|mechFill", ".pill.mech .mtxt|mechTxt",
      ".pill.xp .fill|xpFill", ".pill.xp .txt|xpTxt",
      ".pill.ammo|ammoPill", ".pill.ammo .afill|ammoFill", ".pill.ammo .atxt|ammoTxt",
      ".upgrades|upgrades",
      ".pill.progress|progPill", ".pill.progress .prog|progFill", ".pill.progress .ptxt|progTxt",
      ".pill.time|time", ".pill.cred|cred", ".pill.kill|kill", ".pill.reroll|reroll",
      ".weapons|weapons", ".ultgauge|ult", ".ultgauge .ring|ultRing", ".ultgauge .unum|ultNum", ".ultgauge .ulabel|ultLabel",
    ]) {
      const [sel, name] = k.split("|");
      this.el[name] = q(sel);
    }
  }

  setVisible(v: boolean) {
    this.root.classList.toggle("hidden", !v);
  }

  creditAnchor(canvas: HTMLCanvasElement): { x: number; y: number } {
    const pr = this.el.cred.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    if (cr.width <= 0 || cr.height <= 0) return { x: VW - 80, y: 22 };
    return {
      x: ((pr.left + pr.width / 2) - cr.left) / cr.width * VW,
      y: ((pr.top + pr.height / 2) - cr.top) / cr.height * VH,
    };
  }

  update(world: World) {
    const p = world.player;
    if (!p) return;
    const e = this.el;

    e.hpFill.style.width = Math.max(0, Math.min(1, p.hp / p.maxHp)) * 100 + "%";
    e.hpShield.style.width = Math.min(1, p.shield / p.maxHp) * 100 + "%";
    e.hpTxt.textContent = `${Math.ceil(Math.max(0, p.hp))}/${p.maxHp}`;
    // vida do MECH (game over se zerar)
    const m = world.mech;
    const mFrac = Math.max(0, Math.min(1, m.hp / m.maxHp));
    e.mechFill.style.width = mFrac * 100 + "%";
    e.mechPill.classList.toggle("low", mFrac < 0.3);
    e.mechTxt.textContent = `⚙ ${Math.ceil(Math.max(0, m.hp))}/${m.maxHp}`;
    e.xpFill.style.width = Math.min(1, p.xp / p.xpToNext) * 100 + "%";
    e.xpTxt.textContent = `Nv ${p.level}`;

    // munição / recarga / martelo
    const wi = world.mainWeaponInfo();
    e.ammoPill.classList.toggle("melee", wi.melee);
    e.ammoPill.classList.toggle("reloading", wi.reloading);
    if (wi.melee) { e.ammoFill.style.width = "100%"; e.ammoTxt.textContent = "🔨 ∞"; }
    else if (wi.reloading) { e.ammoFill.style.width = wi.reloadFrac * 100 + "%"; e.ammoTxt.textContent = "RECARREGANDO…"; }
    else { e.ammoFill.style.width = (wi.ammo / wi.mag) * 100 + "%"; e.ammoTxt.textContent = `${wi.ammo} / ${wi.mag}`; }

    // progresso da fase / chefe
    const prog = world.runProgress();
    const boss = world.bossActive();
    e.progFill.style.width = prog * 100 + "%";
    e.progPill.classList.toggle("boss", boss);
    e.progTxt.textContent = boss ? "⚠ CHEFE" : `SETOR ${Math.round(prog * 100)}%`;

    e.time.textContent = (() => { const m = Math.floor(world.time / 60), s = Math.floor(world.time % 60); return `${m}:${s.toString().padStart(2, "0")}`; })();
    e.cred.textContent = `❖ ${p.credits}`;
    e.kill.textContent = `☠ ${world.kills}`;
    e.reroll.classList.toggle("hidden", p.rerolls <= 0);
    e.reroll.textContent = `⟳ ${p.rerolls}`;

    // ESPECIAL: medidor circular 0–100 (carrega matando)
    const pct = Math.round(Math.min(1, p.ultCharge) * 100);
    const ready = p.ultCharge >= 1 && p.ultActive <= 0;
    (e.ultRing as HTMLElement).style.background =
      `conic-gradient(${ready ? "#ffe066" : "#9a7bff"} ${pct}%, rgba(255,255,255,0.14) ${pct}% 100%)`;
    e.ultNum.textContent = p.ultActive > 0 ? "ON" : String(pct);
    e.ult.classList.toggle("ready", ready);
    e.ult.classList.toggle("active", p.ultActive > 0);
    e.ultLabel.textContent = ready ? "ATIVAR ▸ (dir.)" : p.char.ultName;

    // melhorias (passivas) perto da vida + campo de armas embaixo
    this.syncLoadout(world);
  }

  private syncLoadout(world: World) {
    const p = world.player;
    const sig = p.weapons.map((w) => `${w.defId}:${w.level}:${Object.values(w.taken).reduce((a, b) => a + b, 0)}`).join(",")
      + "|" + Object.entries(p.passives).map(([k, v]) => `${k}${v}`).join(",");
    if (sig === this.loadoutSig) return;
    this.loadoutSig = sig;

    // passivas (melhorias) perto da vida
    this.el.upgrades.innerHTML = p.passives && Object.keys(p.passives).length
      ? Object.entries(p.passives).map(([id, lvl]) => {
        const d = PASSIVES[id];
        return `<span class="uchip" title="${d ? d.desc : ""}">${d ? short(d.name) : id}<i>${lvl}</i></span>`;
      }).join("")
      : "";

    // armas (campo de tiros) embaixo
    this.el.weapons.innerHTML = p.weapons.map((w, i) => {
      const d = WEAPONS[w.defId];
      const mods = Object.values(w.taken).reduce((a, b) => a + b, 0);
      const dots = "●".repeat(Math.min(6, mods));
      return `<div class="wchip${i === 0 ? " main" : ""}" style="--c:${d.color}" title="${d.name} — ${d.desc}">
        <span class="wname">${short(d.name)}</span><span class="wlv">Lv${w.level}</span>
        <span class="wmods">${dots}</span></div>`;
    }).join("");
  }
}

// abrevia um nome longo pra caber no chip
function short(name: string): string {
  return name.length > 12 ? name.slice(0, 11) + "…" : name;
}
