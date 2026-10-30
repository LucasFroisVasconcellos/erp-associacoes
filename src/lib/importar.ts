import { decodificar, lerData, lerValor } from './extrato';

export type Tabela = string[][];
export const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const limpar = (t: string, max = 200) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function celula(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return v === null || v === undefined ? '' : String(v);
}

/** Lê o arquivo como tabela de textos. Limite de 5 MB e 5.000 linhas. */
export async function lerTabela(nome: string, bytes: ArrayBuffer): Promise<Tabela> {
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('grande_demais');
  if (/\.xlsx$/i.test(nome)) {
    const { readSheet } = await import('read-excel-file/browser');
    const linhas = (await readSheet(new Blob([bytes]))) as unknown[][];
    return linhas.slice(0, 5001).map((l) => l.map(celula));
  }
  const Papa = (await import('papaparse')).default;
  return Papa.parse<string[]>(decodificar(bytes).slice(0, 5_000_000), { skipEmptyLines: true }).data.slice(0, 5001);
}

export function acharColunas<K extends string>(t: Tabela, nomes: Record<K, string[]>, obrigatorias: NoInfer<K>[]): { linha: number; ix: Record<K, number> } | null {
  for (let i = 0; i < Math.min(t.length, 30); i++) {
    const cab = (t[i] ?? []).map(normal);
    const ix = Object.fromEntries(Object.entries(nomes).map(([k, v]) => [k, cab.findIndex((c) => (v as string[]).includes(c))])) as Record<K, number>;
    if (obrigatorias.every((k) => ix[k] >= 0)) return { linha: i, ix };
  }
  return null;
}

export interface Cadastro { id: string; nome: string; tipo?: 'entrada' | 'saida'; ativa?: boolean }
export interface ItemLancamento {
  linha: number; data: string | null; valor: string | null; tipo: 'entrada' | 'saida'; descricao: string;
  categoriaNome: string; categoria_id: string | null; conta_id: string | null; forma_pagamento: string | null; problemas: string[];
}

const COL_LANC = {
  data: ['data', 'date', 'dt', 'data do lancamento', 'data lancamento', 'data pagamento', 'data de pagamento', 'vencimento'],
  valor: ['valor', 'valor (r$)', 'valor r$', 'quantia', 'total'],
  entrada: ['entrada', 'entradas', 'credito', 'receita', 'recebido'],
  saida: ['saida', 'saidas', 'debito', 'despesa', 'pago'],
  descricao: ['descricao', 'historico', 'o que', 'detalhes', 'lancamento', 'observacao', 'item'],
  categoria: ['categoria', 'classificacao', 'tipo de gasto', 'grupo', 'rubrica'],
  conta: ['conta', 'banco', 'conta bancaria', 'caixa'],
  tipo: ['tipo', 'e/s', 'entrada/saida', 'natureza', 'movimento'],
  forma: ['forma', 'forma de pagamento', 'pagamento', 'meio'],
};
const FORMAS: Record<string, string> = { pix: 'pix', dinheiro: 'dinheiro', especie: 'dinheiro', boleto: 'boleto', transferencia: 'transferencia', ted: 'transferencia',
  doc: 'transferencia', debito: 'cartao_debito', 'cartao de debito': 'cartao_debito', credito: 'cartao_credito', 'cartao de credito': 'cartao_credito', cartao: 'cartao_credito' };

function tipoDoTexto(t: string): 'entrada' | 'saida' | null {
  const s = normal(t);
  if (/^(e|c|entrada|entradas|receita|credito|recebimento|recebido)$/.test(s)) return 'entrada';
  if (/^(s|d|saida|saidas|despesa|debito|pagamento|pago)$/.test(s)) return 'saida';
  return null;
}

export function montarLancamentos(t: Tabela, cad: { categorias: Cadastro[]; contas: Cadastro[]; contaPadrao: string | null; hoje: string }):
  { itens: ItemLancamento[]; ignoradas: number } | null {
  const achado = acharColunas(t, COL_LANC, ['data', 'descricao']);
  if (!achado || (achado.ix.valor < 0 && achado.ix.entrada < 0 && achado.ix.saida < 0)) return null;
  const { linha: cab, ix } = achado;
  const pegar = (l: string[], k: keyof typeof COL_LANC) => (ix[k] >= 0 ? (l[ix[k]] ?? '').trim() : '');
  const cats = new Map(cad.categorias.filter((c) => c.ativa !== false).map((c) => [`${c.tipo}|${normal(c.nome)}`, c.id]));
  const contas = new Map(cad.contas.filter((c) => c.ativa !== false).map((c) => [normal(c.nome), c.id]));
  const itens: ItemLancamento[] = [];
  let ignoradas = 0;
  t.slice(cab + 1).forEach((l, i) => {
    const descricao = limpar(pegar(l, 'descricao'));
    let v = pegar(l, 'valor') ? lerValor(pegar(l, 'valor')) : null;
    if (!v && pegar(l, 'entrada')) v = lerValor(pegar(l, 'entrada'));
    if (!v && pegar(l, 'saida')) { const s = lerValor(pegar(l, 'saida')); v = s && (s.startsWith('-') ? s : `-${s}`); }
    if (!descricao && !v) return;
    if (/^saldo/.test(normal(descricao))) { ignoradas++; return; }
    const tipo = tipoDoTexto(pegar(l, 'tipo')) ?? (v?.startsWith('-') ? 'saida' : pegar(l, 'saida') && !pegar(l, 'entrada') ? 'saida' : 'entrada');
    const data = lerData(pegar(l, 'data'));
    const categoriaNome = limpar(pegar(l, 'categoria'), 60);
    const contaNome = pegar(l, 'conta');
    const conta_id = contaNome ? contas.get(normal(contaNome)) ?? null : cad.contaPadrao;
    const problemas: string[] = [];
    if (!data) problemas.push('data');
    else if (data > cad.hoje) problemas.push('data no futuro');
    if (!v) problemas.push('valor');
    if (descricao.length < 2) problemas.push('descrição');
    if (!conta_id) problemas.push(contaNome ? `conta "${limpar(contaNome, 40)}" não cadastrada` : 'conta');
    const forma = FORMAS[normal(pegar(l, 'forma'))] ?? null;
    itens.push({ linha: cab + 2 + i, data, valor: v ? v.replace('-', '') : null, tipo, descricao, categoriaNome,
      categoria_id: categoriaNome ? cats.get(`${tipo}|${normal(categoriaNome)}`) ?? null : null, conta_id, forma_pagamento: forma, problemas });
  });
  return { itens, ignoradas };
}

/** Id fixo calculado do conteúdo da linha (SHA-256): importar o mesmo arquivo de novo não duplica. */
export async function idDoConteudo(...partes: string[]): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(partes.join('\u001f'))));
  h[6] = (h[6]! & 0x0f) | 0x80; h[8] = (h[8]! & 0x3f) | 0x80; // UUID versão 8 (personalizado), variante RFC
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export async function payloadLancamentos(itens: ItemLancamento[]): Promise<Record<string, unknown>[]> {
  const vistos = new Map<string, number>();
  const out: Record<string, unknown>[] = [];
  for (const it of itens) {
    if (it.problemas.length || !it.categoria_id || !it.data || !it.valor || !it.conta_id) continue;
    const chave = [it.data, it.tipo, it.valor, normal(it.descricao), it.conta_id].join('|');
    const n = (vistos.get(chave) ?? 0) + 1; vistos.set(chave, n);
    out.push({ id: await idDoConteudo('lancamento', chave, String(n)), tipo: it.tipo, valor: it.valor, data: it.data, descricao: it.descricao,
      categoria_id: it.categoria_id, conta_id: it.conta_id, ...(it.forma_pagamento ? { forma_pagamento: it.forma_pagamento } : {}) });
  }
  return out;
}

export type Natureza = 'ativo' | 'passivo' | 'patrimonio' | 'receita' | 'despesa' | 'outra';
export interface ContaPlano { codigo: string; nome: string; natureza: Natureza }
const COL_PLANO = { codigo: ['codigo', 'cod', 'classificacao', 'conta', 'codigo da conta', 'reduzido'], nome: ['nome', 'descricao', 'titulo', 'nome da conta', 'denominacao'], natureza: ['natureza', 'tipo', 'grupo'] };
const NATUREZAS: Natureza[] = ['ativo', 'passivo', 'patrimonio', 'receita', 'despesa', 'outra'];
/** Padrão mais comum nos planos de entidades sem fins lucrativos; a pessoa confere e muda na prévia. */
export const NATUREZA_PADRAO: Record<string, Natureza> = { '1': 'ativo', '2': 'passivo', '3': 'receita', '4': 'despesa' };

export const codigoValido = (c: string) => /^[0-9]{1,4}(\.[0-9]{1,6}){0,6}$/.test(c);
const limparCodigo = (c: string) => c.trim().replace(/[\s-]+/g, '.').replace(/\.+$/, '');

function naturezaDoNome(nome: string): Natureza | null {
  const s = normal(nome);
  if (/receita|doac|contribuic|subvenc/.test(s)) return 'receita';
  if (/despesa|custo/.test(s)) return 'despesa';
  if (/patrimonio liquido|patrimonio social|superavit|deficit/.test(s)) return 'patrimonio';
  return null;
}

export function lerPlanoContas(t: Tabela, porDigito: Record<string, Natureza> = NATUREZA_PADRAO): { contas: ContaPlano[]; ignoradas: number } | null {
  const a = acharColunas(t, COL_PLANO, ['codigo', 'nome']);
  if (!a) return null;
  const vistos = new Set<string>(); const contas: ContaPlano[] = []; let ignoradas = 0;
  for (const l of t.slice(a.linha + 1)) {
    const codigo = limparCodigo(l[a.ix.codigo] ?? ''); const nome = limpar(l[a.ix.nome] ?? '', 120);
    if (!codigoValido(codigo) || nome.length < 2 || vistos.has(codigo)) { ignoradas++; continue; }
    vistos.add(codigo);
    const dada = a.ix.natureza >= 0 ? normal(l[a.ix.natureza] ?? '') as Natureza : null;
    const natureza = (dada && NATUREZAS.includes(dada) ? dada : null) ?? naturezaDoNome(nome) ?? porDigito[codigo[0]!] ?? 'outra';
    contas.push({ codigo, nome, natureza });
  }
  return { contas, ignoradas };
}

export interface LinhaBalancete { codigo: string; nome: string; saldo_anterior?: string; debito: string; credito: string; saldo_atual?: string }
const COL_BAL = {
  codigo: COL_PLANO.codigo, nome: COL_PLANO.nome,
  saldo_anterior: ['saldo anterior', 'saldo inicial', 'anterior'], debito: ['debito', 'debitos'], credito: ['credito', 'creditos'],
  saldo_atual: ['saldo atual', 'saldo final', 'saldo'],
};
const semSinal = (v: string | null) => (v ? v.replace('-', '') : '0.00');

export function lerBalancete(t: Tabela): { linhas: LinhaBalancete[]; ignoradas: number } | null {
  const a = acharColunas(t, COL_BAL, ['codigo', 'nome', 'debito', 'credito']);
  if (!a) return null;
  const vistos = new Set<string>(); const linhas: LinhaBalancete[] = []; let ignoradas = 0;
  for (const l of t.slice(a.linha + 1)) {
    const codigo = limparCodigo(l[a.ix.codigo] ?? ''); const nome = limpar(l[a.ix.nome] ?? '', 160);
    if (!codigoValido(codigo) || !nome || vistos.has(codigo)) { ignoradas++; continue; }
    vistos.add(codigo);
    const val = (k: keyof typeof COL_BAL) => (a.ix[k] >= 0 && (l[a.ix[k]] ?? '').trim() ? lerValor(l[a.ix[k]]!) : null);
    const ant = val('saldo_anterior'), atual = val('saldo_atual');
    linhas.push({ codigo, nome, debito: semSinal(val('debito')), credito: semSinal(val('credito')),
      ...(ant ? { saldo_anterior: ant } : {}), ...(atual ? { saldo_atual: atual } : {}) });
  }
  return { linhas, ignoradas };
}
