
export interface LinhaLida { data: string; valor: string; descricao: string; id?: string }
export interface Leitura { linhas: LinhaLida[]; ignoradas: number }

const limparTexto = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const limparId = (t: string | undefined) => (t && /^[A-Za-z0-9._:/-]{1,100}$/.test(t.trim()) ? t.trim() : undefined);

/** "20261005120000[-3:BRT]" → "2026-10-05"; "05/10/2026" → "2026-10-05"; "2026-10-05" fica. */
export function lerData(t: string): string | null {
  const s = t.trim();
  let m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (!m) m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  let a: number, mes: number, d: number;
  if (m) [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    const b = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
    if (!b) return null;
    [d, mes, a] = [Number(b[1]), Number(b[2]), Number(b[3]!.length === 2 ? `20${b[3]}` : b[3])];
  }
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) return null;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "1.234,56", "-1234.56", "1234,56 D", "(12,00)", "R$ 10,00" → "1234.56" com sinal; null se não for valor. */
export function lerValor(t: string): string | null {
  let s = t.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (/[Dd]$/.test(s)) { negativo = true; s = s.slice(0, -1); } else if (/[Cc]$/.test(s)) s = s.slice(0, -1);
  if (s.startsWith('-')) { negativo = !negativo; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (n === 0) return null;
  return `${negativo ? '-' : ''}${n.toFixed(2)}`;
}

/** Decodifica o arquivo: OFX de banco brasileiro costuma vir em Windows-1252. */
export function decodificar(bytes: ArrayBuffer): string {
  const inicio = new TextDecoder('latin1').decode(bytes.slice(0, 600));
  const cp1252 = /CHARSET:\s*1252|ENCODING:\s*USASCII|encoding="(windows-1252|iso-8859-1)"/i.test(inicio);
  return new TextDecoder(cp1252 ? 'windows-1252' : 'utf-8').decode(bytes);
}

export function lerOfx(texto: string): Leitura {
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, nome: string) => new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(b)?.[1]?.trim();
  let ignoradas = 0;
  const linhas: LinhaLida[] = [];
  for (const bloco of blocos) {
    const b = bloco.split(/<\/STMTTRN>/i)[0] ?? '';
    const data = lerData(tag(b, 'DTPOSTED') ?? '');
    const valor = lerValor((tag(b, 'TRNAMT') ?? '').replace(',', '.'));
    const descricao = limparTexto([tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' — '));
    if (!data || !valor || !descricao) { ignoradas++; continue; }
    linhas.push({ data, valor, descricao, id: limparId(tag(b, 'FITID')) });
  }
  return { linhas, ignoradas };
}

const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const COLUNAS = {
  data: ['data', 'date', 'data lancamento', 'data do lancamento', 'dt', 'data movimento'],
  descricao: ['descricao', 'historico', 'lancamento', 'memo', 'description', 'detalhes', 'historico do lancamento'],
  valor: ['valor', 'value', 'amount', 'valor (r$)', 'valor r$'],
  credito: ['credito', 'entrada', 'credit'],
  debito: ['debito', 'saida', 'debit'],
  id: ['id', 'identificador', 'documento', 'fitid', 'numero do documento'],
};
const achar = (cab: string[], nomes: string[]) => cab.findIndex((c) => nomes.includes(normal(c)));

export async function lerCsv(texto: string): Promise<Leitura> {
  const Papa = (await import('papaparse')).default;
  const linhasBrutas = Papa.parse<string[]>(texto.slice(0, 5_000_000), { skipEmptyLines: true }).data;
  const iCab = linhasBrutas.findIndex((l) => achar(l, COLUNAS.data) >= 0 && achar(l, COLUNAS.descricao) >= 0);
  if (iCab < 0) return { linhas: [], ignoradas: linhasBrutas.length };
  const cab = linhasBrutas[iCab]!;
  const ix = { data: achar(cab, COLUNAS.data), descricao: achar(cab, COLUNAS.descricao), valor: achar(cab, COLUNAS.valor),
    credito: achar(cab, COLUNAS.credito), debito: achar(cab, COLUNAS.debito), id: achar(cab, COLUNAS.id) };
  let ignoradas = 0;
  const linhas: LinhaLida[] = [];
  for (const l of linhasBrutas.slice(iCab + 1)) {
    const data = lerData(l[ix.data] ?? '');
    let valor = ix.valor >= 0 ? lerValor(l[ix.valor] ?? '') : null;
    if (!valor && ix.credito >= 0 && (l[ix.credito] ?? '').trim()) valor = lerValor(l[ix.credito]!);
    if (!valor && ix.debito >= 0 && (l[ix.debito] ?? '').trim()) { const v = lerValor(l[ix.debito]!); valor = v && (v.startsWith('-') ? v : `-${v}`); }
    const descricao = limparTexto(l[ix.descricao] ?? '');
    if (!data || !valor || !descricao || /^saldo/i.test(normal(descricao))) { ignoradas++; continue; }
    linhas.push({ data, valor, descricao, id: ix.id >= 0 ? limparId(l[ix.id]) : undefined });
  }
  return { linhas, ignoradas };
}

export async function lerExtrato(nome: string, bytes: ArrayBuffer): Promise<Leitura> {
  if (/\.pdf$/i.test(nome)) return (await import('./extrato-pdf')).lerExtratoPdf(bytes, new Date().getFullYear());
  const texto = decodificar(bytes);
  return /\.ofx$|\.qfx$/i.test(nome) || /<OFX>/i.test(texto.slice(0, 2000)) ? lerOfx(texto) : lerCsv(texto);
}
