
export type Boleto =
  | { ok: true; tipo: 'bancario' | 'arrecadacao'; codigoBarras: string; valor: string | null; vencimento: string | null }
  | { ok: false; erro: string };

function mod10(s: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    const p = Number(s[i]) * peso;
    soma += Math.floor(p / 10) + (p % 10);
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

function somaMod11(s: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    soma += Number(s[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma % 11;
}

/** DV geral do boleto bancário: 0, 10 ou 11 viram 1. */
function mod11Banco(s: string): number {
  const dv = 11 - somaMod11(s);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** DV de arrecadação (módulo 11): resto 0 ou 1 → 0; resto 10 → 1. */
function mod11Arrecadacao(s: string): number {
  const r = somaMod11(s);
  return r === 0 || r === 1 ? 0 : r === 10 ? 1 : 11 - r;
}

function diasDepois(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Fator de vencimento: escolhe o ciclo (1997 ou o novo de 22/02/2025) mais próximo de hoje. */
function vencimentoPorFator(fator: number, hoje: string): string | null {
  if (fator === 0) return null;
  const novo = diasDepois('2025-02-22', fator - 1000);
  const antigo = diasDepois('1997-10-07', fator);
  const dist = (iso: string) => Math.abs(new Date(`${iso}T12:00:00Z`).getTime() - new Date(`${hoje}T12:00:00Z`).getTime());
  return dist(novo) <= dist(antigo) ? novo : antigo;
}

function valorDe(digitos: string): string | null {
  const centavos = Number(digitos);
  if (!Number.isSafeInteger(centavos) || centavos <= 0) return null;
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

function lerBancario(cb: string, hoje: string): Boleto {
  if (cb[3] !== '9') return { ok: false, erro: 'moeda' };
  if (mod11Banco(cb.slice(0, 4) + cb.slice(5)) !== Number(cb[4])) return { ok: false, erro: 'digito' };
  return { ok: true, tipo: 'bancario', codigoBarras: cb, valor: valorDe(cb.slice(9, 19)),
    vencimento: vencimentoPorFator(Number(cb.slice(5, 9)), hoje) };
}

function dvArrecadacao(cb: string): ((s: string) => number) | null {
  const id = cb[2];
  if (id === '6' || id === '7') return mod10;
  if (id === '8' || id === '9') return mod11Arrecadacao;
  return null;
}

function lerArrecadacao(cb: string): Boleto {
  const dv = dvArrecadacao(cb);
  if (!dv) return { ok: false, erro: 'identificador' };
  if (dv(cb.slice(0, 3) + cb.slice(4)) !== Number(cb[3])) return { ok: false, erro: 'digito' };
  const valorReal = cb[2] === '6' || cb[2] === '8';
  return { ok: true, tipo: 'arrecadacao', codigoBarras: cb, valor: valorReal ? valorDe(cb.slice(4, 15)) : null, vencimento: null };
}

export function lerBoleto(entrada: string, hoje: string): Boleto {
  if (!/^[\d.\s-]+$/.test(entrada)) return { ok: false, erro: 'formato' };
  const d = entrada.replace(/\D/g, '');
  if (d.length === 44) return d[0] === '8' ? lerArrecadacao(d) : lerBancario(d, hoje);
  if (d.length === 47) {
    const c1 = d.slice(0, 10), c2 = d.slice(10, 21), c3 = d.slice(21, 32);
    if (mod10(c1.slice(0, 9)) !== Number(c1[9]) || mod10(c2.slice(0, 10)) !== Number(c2[10])
        || mod10(c3.slice(0, 10)) !== Number(c3[10])) return { ok: false, erro: 'digito' };
    const cb = d.slice(0, 4) + d[32] + d.slice(33, 47) + c1.slice(4, 9) + c2.slice(0, 10) + c3.slice(0, 10);
    return lerBancario(cb, hoje);
  }
  if (d.length === 48 && d[0] === '8') {
    const dv = dvArrecadacao(d);
    if (!dv) return { ok: false, erro: 'identificador' };
    let cb = '';
    for (let i = 0; i < 4; i++) {
      const bloco = d.slice(i * 12, i * 12 + 11);
      if (dv(bloco) !== Number(d[i * 12 + 11])) return { ok: false, erro: 'digito' };
      cb += bloco;
    }
    return lerArrecadacao(cb);
  }
  return { ok: false, erro: 'formato' };
}
