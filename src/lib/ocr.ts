// OCR com Tesseract.js no aparelho; os arquivos vêm do próprio site (/ocr), sem CDN.

export type DadosLidos = { valor?: string; data?: string; emitente?: string };

const DINHEIRO = /(\d{1,3}(?:\.\d{3})+|\d{1,7}),(\d{2})(?!\d)/g;
const PALAVRAS_TOTAL = /(VALOR\s*(A\s*PAGAR|TOTAL|PAGO|COBRADO)|TOTAL\s*(A\s*PAGAR|R\$|GERAL)?|\bPAGO\b)/i;
const NAO_EMITENTE = /(CNPJ|CPF|CUPOM|NOTA|FISCAL|DOCUMENTO|DANFE|EXTRATO|COMPROVANTE|RUA|AV\.|AVENIDA|CEP|TEL|IE\b|IM\b|\d{4,})/i;

function valoresDaLinha(l: string): bigint[] {
  return [...l.matchAll(DINHEIRO)].map((m) => BigInt((m[1] ?? '0').replace(/\./g, '')) * 100n + BigInt(m[2] ?? '0'));
}

const emTexto = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;

export function extrairDados(texto: string, hoje: string): DadosLidos {
  const linhas = texto.slice(0, 20_000).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const r: DadosLidos = {};

  // valor: o da linha de "TOTAL"/"VALOR A PAGAR" (a última que tiver número); senão, o maior do texto
  const comTotal = linhas.filter((l) => PALAVRAS_TOTAL.test(l) && valoresDaLinha(l).length);
  const candidatos = comTotal.length ? valoresDaLinha(comTotal.at(-1)!) : linhas.flatMap(valoresDaLinha);
  const valor = candidatos.length ? (comTotal.length ? candidatos.at(-1)! : candidatos.reduce((a, b) => (b > a ? b : a))) : 0n;
  if (valor > 0n && valor <= 999_999_999n) r.valor = emTexto(valor);

  // data: a primeira dd/mm/aaaa válida que não esteja no futuro
  for (const m of texto.matchAll(/\b(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/g)) {
    const [d, mes, a] = [Number(m[1]), Number(m[2]), m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])];
    const iso = `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(`${iso}T12:00:00Z`);
    if (a >= 2000 && !Number.isNaN(dt.getTime()) && dt.getUTCDate() === d && iso <= hoje) { r.data = iso; break; }
  }

  // estabelecimento: a primeira linha "de nome" do topo do cupom
  const nome = linhas.slice(0, 6).find((l) => (l.match(/[A-Za-zÀ-ú]/g)?.length ?? 0) >= 4 && !NAO_EMITENTE.test(l));
  if (nome) r.emitente = nome.slice(0, 80);
  return r;
}

export async function lerTextoDaFoto(foto: Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const base = new URL('ocr/', document.baseURI).href;
  const worker = await createWorker('por', 1, {
    workerPath: base + 'worker.min.js', corePath: base, langPath: base, workerBlobURL: false,
  });
  try {
    const { data } = await worker.recognize(foto);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}
