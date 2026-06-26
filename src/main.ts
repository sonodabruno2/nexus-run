import "./style.css";
import { World, VW, VH } from "./game";
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

// ----- escala responsiva -----
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const margin = 0;
  const scale = Math.min(
    (window.innerWidth - margin) / VW,
    (window.innerHeight - margin) / VH,
  );
  const cssW = Math.floor(VW * scale);
  const cssH = Math.floor(VH * scale);
  canvas.width = Math.floor(VW * dpr);
  canvas.height = Math.floor(VH * dpr);
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  stage.style.width = cssW + "px";
  stage.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
