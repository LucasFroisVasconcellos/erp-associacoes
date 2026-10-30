// Os alertas são sinais para conferência, nunca acusações: a decisão é sempre de uma pessoa.

export interface DadosAnalise {
  hoje: string; inicio: string; saldo: string;
  previstas: { data: string; tipo: 'entrada' | 'saida'; valor: string; categoria: string }[];
  recorrencias: { tipo: 'entrada' | 'saida'; valor: string; dia: number; inicio: string; fim: string | null; descricao: string }[];
  parcelas: { data: string; valor: string; situacao: string; verba: string }[];
  mensalidades: { abertas_futuras: { data: string; valor: string }[]; pagas_12m: number; vencidas_abertas: { dias: number; valor: string }[] };
  realizados: Realizado[];
  captacao: Record<string, { n: number; valor: string }>;
  verbas: { situacao: string; pedido: string; aprovado: string; recebido: string }[];
  atletas_ativos: number;
  treinos: { n: number; presencas: number };
  viagens: { titulo: string; km: number | null; atletas: number; custo: string }[];
  tarefas: { nome: string; abertas: number; atrasadas: number; feitas_no_prazo: number; feitas_atrasadas: number }[] | null;
}
export interface Realizado {
  id: string; data: string; tipo: 'entrada' | 'saida'; valor: string; categoria: string; fonte: string;
  contraparte_id: string | null; descricao: string; comprovante: boolean; atraso_dias: number;
}

export const cent = (v: string | null | undefined) => (v ? Math.round(Number(v) * 100) : 0);
export const reais = (c: number) => (c / 100).toFixed(2);
const mesDe = (d: string) => d.slice(0, 7);
function somarMeses(mes: string, n: number) {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export const PESO_VERBA: Record<string, number> = {
  ideia: 0, pedido_enviado: 0.2, em_analise: 0.4, aprovado: 0.8, formalizado: 0.95,
  recebido_parcial: 1, recebido: 1, em_execucao: 1, prestacao_contas: 1,
};

export interface Cenario {
  id: string; tipo: 'atrasar_verba' | 'gasto_extra' | 'receita_extra' | 'cortar_recorrente';
  rotulo: string; mes: string; meses?: number; valor?: string; verba?: string; descricao?: string;
}
export interface MesPrevisao { mes: string; entradasCertas: number; entradasProvaveis: number; saidas: number; saldo: number }
export interface Previsao { meses: MesPrevisao[]; menorSaldo: number; mesMenor: string; folego: number | null; atrasadasReceber: number; atrasadasPagar: number }

/** Saldo mês a mês. Vencidas entram no mês atual. "Prováveis" = verbas pesadas + mensalidades × taxa de pagamento. */
export function prever(d: DadosAnalise, n = 12, cenarios: Cenario[] = []): Previsao {
  const atual = mesDe(d.hoje);
  const meses = Array.from({ length: n }, (_, i) => somarMeses(atual, i));
  const linha = new Map(meses.map((m) => [m, { mes: m, entradasCertas: 0, entradasProvaveis: 0, saidas: 0, saldo: 0 }]));
  const noMes = (data: string) => (data < d.hoje ? atual : mesDe(data));
  let atrasadasReceber = 0, atrasadasPagar = 0;
  for (const p of d.previstas) {
    const l = linha.get(noMes(p.data)); if (!l) continue;
    if (p.data < d.hoje) { if (p.tipo === 'entrada') atrasadasReceber += cent(p.valor); else atrasadasPagar += cent(p.valor); }
    if (p.tipo === 'entrada') l.entradasCertas += cent(p.valor); else l.saidas += cent(p.valor);
  }
  for (const r of d.recorrencias) {
    for (const m of meses) {
      const dia = `${m}-${String(r.dia).padStart(2, '0')}`;
      if (dia < d.hoje || dia < r.inicio || (r.fim && dia > r.fim)) continue;
      const corte = cenarios.find((c) => c.tipo === 'cortar_recorrente' && c.descricao === r.descricao);
      if (corte && m >= corte.mes) continue;
      const l = linha.get(m)!;
      if (r.tipo === 'entrada') l.entradasCertas += cent(r.valor); else l.saidas += cent(r.valor);
    }
  }
  for (const p of d.parcelas) {
    const atraso = cenarios.find((c) => c.tipo === 'atrasar_verba' && c.verba === p.verba);
    const data = atraso ? `${somarMeses(mesDe(p.data < d.hoje ? d.hoje : p.data), atraso.meses ?? 3)}-01` : p.data;
    const l = linha.get(noMes(data)); if (!l) continue;
    l.entradasProvaveis += Math.round(cent(p.valor) * (PESO_VERBA[p.situacao] ?? 0));
  }
  const vencidas = d.mensalidades.vencidas_abertas.length;
  const taxa = d.mensalidades.pagas_12m + vencidas ? d.mensalidades.pagas_12m / (d.mensalidades.pagas_12m + vencidas) : 0.8;
  for (const m of d.mensalidades.abertas_futuras) { const l = linha.get(noMes(m.data)); if (l) l.entradasProvaveis += Math.round(cent(m.valor) * taxa); }
  for (const c of cenarios) {
    const l = linha.get(c.mes); if (!l || !c.valor) continue;
    if (c.tipo === 'gasto_extra') l.saidas += cent(c.valor);
    if (c.tipo === 'receita_extra') l.entradasCertas += cent(c.valor);
  }
  let saldo = cent(d.saldo); let menorSaldo = Number.POSITIVE_INFINITY; let mesMenor = atual; let folego: number | null = null;
  meses.forEach((m, i) => {
    const l = linha.get(m)!;
    saldo += l.entradasCertas + l.entradasProvaveis - l.saidas; l.saldo = saldo;
    if (saldo < menorSaldo) { menorSaldo = saldo; mesMenor = m; }
    if (saldo < 0 && folego === null) folego = i;
  });
  return { meses: meses.map((m) => linha.get(m)!), menorSaldo, mesMenor, folego, atrasadasReceber, atrasadasPagar };
}

export function concentracao(realizados: Realizado[]) {
  const porFonte = new Map<string, number>();
  for (const r of realizados) if (r.tipo === 'entrada') porFonte.set(r.fonte, (porFonte.get(r.fonte) ?? 0) + cent(r.valor));
  const total = [...porFonte.values()].reduce((a, b) => a + b, 0);
  const fontes = [...porFonte.entries()].map(([fonte, c]) => ({ fonte, total: c, parte: total ? c / total : 0 })).sort((a, b) => b.total - a.total);
  const hhi = fontes.reduce((s, f) => s + f.parte ** 2, 0);
  return { hhi, nivel: (hhi >= 0.25 ? 'alto' : hhi >= 0.15 ? 'moderado' : 'baixo') as 'alto' | 'moderado' | 'baixo', fontes, total };
}

export function porMes(realizados: Realizado[], inicio: string, hoje: string) {
  const meses: string[] = []; for (let m = mesDe(inicio); m <= mesDe(hoje); m = somarMeses(m, 1)) meses.push(m);
  return meses.map((mes) => {
    const doMes = realizados.filter((r) => mesDe(r.data) === mes);
    return { mes, entradas: doMes.filter((r) => r.tipo === 'entrada').reduce((s, r) => s + cent(r.valor), 0),
      saidas: doMes.filter((r) => r.tipo === 'saida').reduce((s, r) => s + cent(r.valor), 0) };
  });
}

const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2; };

/** Gastos fora do padrão da própria categoria: z robusto (mediana e desvio absoluto) acima de 3,5; precisa de 6+ gastos na categoria. */
export function foraDoPadrao(realizados: Realizado[]) {
  const porCat = new Map<string, Realizado[]>();
  for (const r of realizados) if (r.tipo === 'saida') porCat.set(r.categoria, [...(porCat.get(r.categoria) ?? []), r]);
  const out: (Realizado & { tipico: number; z: number })[] = [];
  for (const [, lista] of porCat) {
    if (lista.length < 6) continue;
    const vs = lista.map((r) => cent(r.valor)); const med = mediana(vs); const mad = mediana(vs.map((v) => Math.abs(v - med)));
    if (mad === 0) continue;
    for (const r of lista) { const z = (0.6745 * (cent(r.valor) - med)) / mad; if (z > 3.5) out.push({ ...r, tipico: med, z }); }
  }
  return out.sort((a, b) => b.z - a.z);
}

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Possíveis duplicidades: mesmo valor e sentido, mesma contraparte (ou mesma descrição) e até 3 dias de diferença. */
export function duplicidades(realizados: Realizado[]) {
  const grupos = new Map<string, Realizado[]>();
  for (const r of realizados) { const k = `${r.tipo}|${r.valor}`; grupos.set(k, [...(grupos.get(k) ?? []), r]); }
  const pares: [Realizado, Realizado][] = [];
  for (const [, g] of grupos) {
    const s = [...g].sort((a, b) => a.data.localeCompare(b.data));
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      const a = s[i]!, b = s[j]!;
      if ((Date.parse(b.data) - Date.parse(a.data)) / 86_400_000 > 3) break;
      const mesmo = (a.contraparte_id && a.contraparte_id === b.contraparte_id) || normalizar(a.descricao) === normalizar(b.descricao);
      if (mesmo) pares.push([a, b]);
    }
  }
  return pares;
}

export function qualidade(realizados: Realizado[]) {
  const saidas = realizados.filter((r) => r.tipo === 'saida');
  const atrasos = realizados.map((r) => r.atraso_dias);
  return {
    comComprovante: saidas.length ? saidas.filter((r) => r.comprovante).length / saidas.length : 1,
    semComprovante: saidas.filter((r) => !r.comprovante).length,
    atrasoMediano: atrasos.length ? mediana(atrasos) : 0,
  };
}

/** Lei de Benford nos primeiros dígitos: só com 300+ valores. Devolve o desvio médio absoluto (MAD de Nigrini). */
export function benford(realizados: Realizado[]) {
  const digitos = realizados.map((r) => r.valor.replace('.', '').replace(/^[0-]+/, '')[0]).filter((x): x is string => !!x).map(Number);
  if (digitos.length < 300) return null;
  const obs = Array.from({ length: 9 }, (_, i) => digitos.filter((x) => x === i + 1).length / digitos.length);
  const esp = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));
  const mad = obs.reduce((s, o, i) => s + Math.abs(o - esp[i]!), 0) / 9;
  return { n: digitos.length, mad, conforme: mad <= 0.015, obs, esp };
}

export function custos(d: DadosAnalise) {
  const saidas = d.realizados.filter((r) => r.tipo === 'saida').reduce((s, r) => s + cent(r.valor), 0);
  const meses = Math.max(1, porMes(d.realizados, d.inicio, d.hoje).length);
  const km = d.viagens.reduce((s, v) => s + (v.km ?? 0), 0); const custoViagens = d.viagens.reduce((s, v) => s + cent(v.custo), 0);
  const atletasViagens = d.viagens.reduce((s, v) => s + v.atletas, 0);
  return {
    saidas, porAtletaMes: d.atletas_ativos ? Math.round(saidas / meses / d.atletas_ativos) : null,
    porTreino: d.treinos.n ? Math.round(saidas / d.treinos.n) : null,
    presencaMedia: d.treinos.n ? d.treinos.presencas / d.treinos.n : null,
    porKm: km ? Math.round(custoViagens / km) : null, porAtletaViagem: atletasViagens ? Math.round(custoViagens / atletasViagens) : null,
  };
}

export function inadimplencia(d: DadosAnalise) {
  const v = d.mensalidades.vencidas_abertas;
  const faixa = (min: number, max: number) => v.filter((x) => x.dias >= min && x.dias <= max).reduce((s, x) => s + cent(x.valor), 0);
  const base = d.mensalidades.pagas_12m + v.length;
  return { taxa: base ? v.length / base : 0, quantidade: v.length, total: v.reduce((s, x) => s + cent(x.valor), 0),
    faixas: [{ rotulo: 'até 30 dias', valor: faixa(0, 30) }, { rotulo: '31 a 60', valor: faixa(31, 60) }, { rotulo: '61 a 90', valor: faixa(61, 90) }, { rotulo: 'mais de 90', valor: faixa(91, 1e9) }] };
}

export function funis(d: DadosAnalise) {
  const etapas = ['prospeccao', 'contato', 'proposta', 'fechado'] as const;
  const captacao = etapas.map((e) => ({ etapa: e, n: d.captacao[e]?.n ?? 0, valor: cent(d.captacao[e]?.valor) }));
  const vs = d.verbas.filter((v) => !['ideia', 'cancelado'].includes(v.situacao));
  const pedido = vs.reduce((s, v) => s + cent(v.pedido), 0), aprovado = vs.reduce((s, v) => s + cent(v.aprovado), 0), recebido = vs.reduce((s, v) => s + cent(v.recebido), 0);
  const decididas = vs.filter((v) => v.situacao === 'negado' || cent(v.aprovado) > 0);
  return { captacao, verbas: { pedido, aprovado, recebido, taxaAprovacao: decididas.length ? decididas.filter((v) => v.situacao !== 'negado').length / decididas.length : null } };
}
