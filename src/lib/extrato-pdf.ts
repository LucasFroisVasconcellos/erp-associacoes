import { lerData, lerValor, type Leitura, type LinhaLida } from './extrato';

export function lerLinhasExtrato(linhas: string[], anoPadrao: number): Leitura {
  const out: LinhaLida[] = [];
  let ignoradas = 0;
  const ano = linhas.join(' ').match(/\b(20\d{2})\b/)?.[1] ?? String(anoPadrao);
  for (const bruta of linhas) {
    const l = bruta.replace(/\s+/g, ' ').trim();
    const m = /^(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.+)$/.exec(l);
    if (!m) continue;
    // valor do movimento = o primeiro valor da linha; o que vier depois costuma ser o saldo do dia
    const valores = [...m[2]!.matchAll(/-?\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?(?:\s?[CD](?=\s|$))?/g)];
    const primeiro = valores[0];
    if (!primeiro) { ignoradas++; continue; }
    const v = primeiro[0];
    const resto = m[2]!.slice(0, primeiro.index).replace(/R\$\s*$/, '').trim();
    const data = lerData(m[1]!.length === 5 ? `${m[1]}/${ano}` : m[1]!);
    const valor = lerValor(v.replace(/\s/g, ''));
    const descricao = resto.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200).trim();
    if (!data || !valor || descricao.length < 2 || /^saldo/i.test(descricao)) { ignoradas++; continue; }
    out.push({ data, valor, descricao });
  }
  return { linhas: out, ignoradas };
}

/** Lê o PDF no aparelho (sem enviar a ninguém). Usa o pdf.js sem worker separado (CSP e Trusted Types). */
export async function lerExtratoPdf(bytes: ArrayBuffer, anoPadrao: number): Promise<Leitura> {
  const pdfjs = await import('pdfjs-dist');
  // @ts-expect-error módulo sem tipos: registra o "worker" no próprio contexto (sem new Worker, que a CSP/Trusted Types barraria)
  await import('pdfjs-dist/build/pdf.worker.min.mjs');
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false });
  const doc = await tarefa.promise;
  const linhas: string[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
      const pagina = await doc.getPage(p);
      const { items } = await pagina.getTextContent();
      const porY = new Map<number, { x: number; t: string }[]>();
      for (const it of items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] as number); const x = it.transform[4] as number;
        const chave = [...porY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
        porY.set(chave, [...(porY.get(chave) ?? []), { x, t: it.str }]);
      }
      for (const [, partes] of [...porY.entries()].sort((a, b) => b[0] - a[0])) linhas.push(partes.sort((a, b) => a.x - b.x).map((p) => p.t).join(' '));
    }
  } finally { await tarefa.destroy(); }
  return lerLinhasExtrato(linhas, anoPadrao);
}
