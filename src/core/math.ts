export interface Vec {
  x: number;
  y: number;
}

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.sqrt(dist2(ax, ay, bx, by));

export const angleTo = (ax: number, ay: number, bx: number, by: number) =>
  Math.atan2(by - ay, bx - ax);

// Aproxima `a` de `b` no máximo `maxStep`.
export const approach = (a: number, b: number, maxStep: number) => {
  const d = b - a;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
};
