// Portão de acesso "soft" — barreira simples pra manter o jogo SEM TEXTOS
// durante os testes. Só a senha de 6 dígitos abre. Sem texto na tela, sem
// indicar a quantidade de caracteres.
//
// PARA REMOVER A SENHA depois: troque ACCESS_OPEN para `true` (ou apague a
// chamada showGate() em main.ts). O site/repo é público, então isto é apenas
// uma pequena barreira, não segurança real.

const ACCESS_OPEN = false;
const ACCESS_HASH = "8dc32c96aa1700abc885cb31fa544c186ae132023739d3aa0cdae116448ed6cf"; // sha256 da senha
const ACCESS_KEY = "nexus_access";

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function showGate(onUnlock: () => void): void {
  if (ACCESS_OPEN || localStorage.getItem(ACCESS_KEY) === "1") {
    onUnlock();
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "gate";
  const input = document.createElement("input");
  input.type = "password";
  input.className = "gate-input";
  input.setAttribute("inputmode", "numeric");
  input.autocomplete = "off";
  input.spellcheck = false;
  overlay.appendChild(input);
  document.body.appendChild(overlay);
  setTimeout(() => input.focus(), 40);

  let busy = false;
  const check = async () => {
    if (busy) return;
    const v = input.value;
    if (v.length === 0) return;
    busy = true;
    const ok = (await sha256(v)) === ACCESS_HASH;
    busy = false;
    if (ok) {
      try { localStorage.setItem(ACCESS_KEY, "1"); } catch { /* ignora */ }
      overlay.remove();
      onUnlock();
    } else if (v.length >= 8) {
      // errou: limpa em silêncio (sem texto) + tremidinha
      input.value = "";
      input.classList.remove("shake");
      void input.offsetWidth; // reinicia a animação
      input.classList.add("shake");
    }
  };
  input.addEventListener("input", () => void check());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") void check(); });
  // mantém o foco no campo
  overlay.addEventListener("mousedown", (e) => {
    if (e.target !== input) { e.preventDefault(); input.focus(); }
  });
}
