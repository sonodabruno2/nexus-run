// Dimensões lógicas do mundo (escaladas por CSS). Compartilhadas entre
// o motor e a entrada (mira) sem criar dependência circular.
// VH é FIXO (faixa de jogo constante); VW acompanha o aspecto da janela
// (live binding) pra o jogo PREENCHER a tela em qualquer proporção.
export let VW = 960;
export const VH = 540;
export const WALL_TOP = 40;
export const WALL_BOT = VH - 40;

// ajusta a largura lógica ao aspecto atual (chamado no resize)
export function setVW(w: number) {
  VW = Math.round(Math.min(1700, Math.max(820, w)));
}
