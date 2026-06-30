// Dimensões lógicas do mundo (escaladas por CSS). Compartilhadas entre
// o motor e a entrada (mira) sem criar dependência circular.
// VH é FIXO (faixa de jogo constante); VW acompanha o aspecto da janela
// (live binding) pra o jogo PREENCHER a tela em qualquer proporção.
export let VW = 960;
export const VH = 540;
// PAREDES = limites da faixa jogável (profundidade). Dinâmicas: a faixa
// encolhe/cresce conforme a quantidade de fileiras de inimigos, sempre
// CENTRADA em VH/2. Default = 6 fileiras (fase 1), célula = diâmetro do
// cubo (38) pra a parede COLAR exatamente nas bordas dos cubos.
export let WALL_TOP = VH / 2 - (6 * 38) / 2;
export let WALL_BOT = VH / 2 + (6 * 38) / 2;

// ajusta a largura lógica ao aspecto atual (chamado no resize). Faixa mais
// ESTREITA (corredor menos largo na horizontal); telas largas ganham borda.
export function setVW(w: number) {
  VW = Math.round(Math.min(880, Math.max(560, w)));
}

// dimensiona a faixa jogável (paredes) à altura dada, centrada em VH/2
export function setBandHeight(h: number) {
  const half = Math.max(60, h) / 2;
  WALL_TOP = VH / 2 - half;
  WALL_BOT = VH / 2 + half;
}
