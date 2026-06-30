import "./style.css";
import { World, VH } from "./game";
import { setVW } from "./core/constants";
import { UI } from "./ui";
import { HUD } from "./hud";
import { showGate } from "./gate";

const app = document.getElementById("app")!;

// palco (canvas + overlay)
const stage = document.createElement("div");
stage.id = "stage";
const canvas = document.createElement("canvas");
stage.appendChild(canvas);
app.appendChild(stage);

const ctx = canvas.getContext("2d", { alpha: false })!;
const world = new World(ctx);
// overlay de UI cobre a JANELA inteira (não só o retângulo do canvas),
// senão menus altos estouram a área 16:9 e o botão de play some.
const ui = new UI(app, world);
const hud = new HUD(app);

// ----- botão de TELA CHEIA (aparece nas telas de menu/loja/fim/pausa) -----
const fsBtn = document.createElement("button");
fsBtn.className = "fsbtn";
fsBtn.title = "Tela cheia";
fsBtn.textContent = "⛶";
fsBtn.onclick = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
};
app.appendChild(fsBtn);

// ----- escala responsiva: PREENCHE a tela (largura lógica = aspecto da janela) -----
function resize() {
  const winW = window.innerWidth, winH = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // VH fixo; largura lógica acompanha o aspecto (clampada) → canvas com o mesmo
  // aspecto da janela = preenche a tela sem barras (só em aspectos extremos sobra borda).
  const lw = Math.round(Math.min(880, Math.max(560, VH * (winW / winH))));
  setVW(lw);
  const scale = Math.min(winW / lw, winH / VH);
  const cssW = Math.round(lw * scale);
  const cssH = Math.round(VH * scale);
  // backing store em resolução de tela cheia (nítido), desenhando no espaço lógico lw×VH
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  stage.style.width = cssW + "px";
  stage.style.height = cssH + "px";
  ctx.setTransform((cssW * dpr) / lw, 0, 0, (cssH * dpr) / VH, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ----- estado de pausa (separado do status do mundo) -----
let paused = false;

// ----- loop principal -----
let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;

  const canRun = world.player && world.status === "playing" && ui.screen === "none" && !paused;
  if (canRun) {
    world.update(dt);
    // pausa por tecla
    if (world.input.consumePause()) {
      paused = true;
      ui.showPause();
    }
  }

  if (world.player) world.render();

  // botão de tela cheia só nas telas "de menu" (fora do jogo e das escolhas)
  const menuish = ui.screen === "menu" || ui.screen === "shop" || ui.screen === "end" || ui.screen === "pause";
  fsBtn.style.display = menuish ? "grid" : "none";

  // HUD em pílulas: visível só jogando
  const hudVisible = !!world.player && ui.screen === "none";
  hud.setVisible(hudVisible);
  if (hudVisible) {
    hud.update(world);
    // alvo das moedas = pílula ❖ da HUD (em coords lógicas do canvas)
    const a = hud.creditAnchor(canvas);
    world.creditTargetX = a.x;
    world.creditTargetY = a.y;
  }

  // reações de UI ao status do mundo
  if (ui.screen === "none" && !paused) {
    if (world.status === "levelup" && world.pendingCards) {
      ui.showLevelUp(world.pendingCards);
    } else if (world.status === "mechpick" && world.pendingMechCards) {
      ui.showMechPick(world.pendingMechCards);
    } else if (world.status === "gameover") {
      ui.showEnd(false);
    } else if (world.status === "win") {
      ui.showEnd(true);
    }
  }
  // retomar da pausa quando o overlay fechar
  if (paused && ui.screen === "none") paused = false;

  requestAnimationFrame(frame);
}

// portão de senha antes do jogo (só abre com 615700)
showGate(() => ui.showMenu());
requestAnimationFrame(frame);
