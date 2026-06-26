import { VW, VH } from "./constants";

// Entrada: teclado (WASD/setas) move; mouse mira. Toque (mobile) move via arraste.
export class Input {
  private keys = new Set<string>();
  private touchActive = false;
  private touchX = 0;
  private touchY = 0;
  private touchBaseX = 0;
  private touchBaseY = 0;
  pausePressed = false;
  ultPressed = false;
  clickPressed = false; // clique esquerdo: definir destino de movimento
  // mira (em coords lógicas do mundo); começa apontando à frente
  pointerX = VW * 0.72;
  pointerY = VH * 0.45;
  hasPointer = false;

  constructor(target: HTMLElement) {
    // mira por mouse → converte coords de tela para coords lógicas
    const setPointer = (clientX: number, clientY: number) => {
      const r = target.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      this.pointerX = ((clientX - r.left) / r.width) * VW;
      this.pointerY = ((clientY - r.top) / r.height) * VH;
      this.hasPointer = true;
    };
    target.addEventListener("mousemove", (e) => setPointer(e.clientX, e.clientY));
    // mouse: ESQUERDO = andar até o clique; DIREITO = ultimate
    target.addEventListener("mousedown", (e) => {
      setPointer(e.clientX, e.clientY);
      if (e.button === 2) { this.ultPressed = true; e.preventDefault(); }
      else if (e.button === 0) { this.clickPressed = true; }
    });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === "p" || k === "escape") this.pausePressed = true;
      if (k === " " || k === "shift") this.ultPressed = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k))
        e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));

    const start = (x: number, y: number) => {
      this.touchActive = true;
      this.touchBaseX = x;
      this.touchBaseY = y;
      this.touchX = x;
      this.touchY = y;
    };
    const move = (x: number, y: number) => {
      this.touchX = x;
      this.touchY = y;
    };
    const end = () => {
      this.touchActive = false;
    };

    target.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      start(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    target.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      move(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    target.addEventListener("touchend", () => end());
  }

  // Direção de movimento desejada, componentes em [-1,1].
  dir(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) x -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) x += 1;
    if (this.keys.has("w") || this.keys.has("arrowup")) y -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) y += 1;

    if (this.touchActive) {
      const dx = this.touchX - this.touchBaseX;
      const dy = this.touchY - this.touchBaseY;
      const dead = 8;
      const max = 60;
      if (Math.abs(dx) > dead) x = clampN(dx / max);
      if (Math.abs(dy) > dead) y = clampN(dy / max);
    }
    // normaliza diagonais
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  // ponto de mira em coords lógicas do mundo
  pointer(): { x: number; y: number } {
    return { x: this.pointerX, y: this.pointerY };
  }

  consumeClick(): boolean {
    const v = this.clickPressed;
    this.clickPressed = false;
    return v;
  }

  consumePause(): boolean {
    const v = this.pausePressed;
    this.pausePressed = false;
    return v;
  }
  consumeUlt(): boolean {
    const v = this.ultPressed;
    this.ultPressed = false;
    return v;
  }
}

const clampN = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
