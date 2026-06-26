// Áudio sintetizado (WebAudio, sem assets). Criado no 1º gesto do usuário.
class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private last: Record<string, number> = {};
  enabled = true;

  resume() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private gate(name: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < minGap) return false;
    this.last[name] = now;
    return true;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, when = 0) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, when = 0) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + when;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = filterFreq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }

  shoot() { if (!this.gate("shoot", 0.05)) return; this.tone(440, 0.06, "square", 0.035, 300); }
  shotgun() { if (!this.gate("shotgun", 0.06)) return; this.tone(220, 0.12, "square", 0.07, 110); this.noise(0.09, 0.05, 900); }
  melee() { if (!this.gate("melee", 0.05)) return; this.tone(150, 0.14, "triangle", 0.1, 70); this.noise(0.07, 0.06, 600); }
  reload() { if (!this.gate("reload", 0.1)) return; this.tone(300, 0.05, "square", 0.04, 200); }
  reloadDone() { this.tone(520, 0.05, "square", 0.05); this.tone(700, 0.06, "square", 0.05, undefined, 0.05); }
  hit() { if (!this.gate("hit", 0.02)) return; this.tone(820, 0.05, "square", 0.05, 560); }
  breakCube() {
    if (!this.gate("break", 0.03)) return;
    this.tone(200, 0.13, "triangle", 0.11, 90);
    this.noise(0.08, 0.05, 1300);
  }
  coin() {
    if (!this.gate("coin", 0.025)) return;
    this.tone(988, 0.07, "square", 0.06);
    this.tone(1319, 0.10, "square", 0.06, undefined, 0.06);
  }
  xp() { if (!this.gate("xp", 0.02)) return; this.tone(660, 0.05, "sine", 0.04, 880); }
  level() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, "triangle", 0.09, undefined, i * 0.07));
  }
  hurt() { if (!this.gate("hurt", 0.1)) return; this.tone(220, 0.18, "sawtooth", 0.12, 90); this.noise(0.12, 0.05, 500); }
  ultReady() { [784, 1047, 1319].forEach((f, i) => this.tone(f, 0.14, "sine", 0.07, undefined, i * 0.05)); }
  ult() { this.tone(160, 0.4, "sawtooth", 0.14, 600); this.noise(0.3, 0.08, 800); }
}

export const audio = new GameAudio();
