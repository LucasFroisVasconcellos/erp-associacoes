import type { Categoria, Conta, Lancamento, LinhaExtrato } from '@/dados/tipos';
import { ErroApp } from '@/lib/erros';
import { hojeSP } from '@/lib/datas';

type Args = Record<string, unknown>;
type Linha = Record<string, unknown>;
const falhar = (erro: string, campo?: string): never => { throw new ErroApp({ erro, campo }); };
const centavos = (v: string) => Math.round(Number(v) * 100);
const reais = (c: number) => (c / 100).toFixed(2);

export function criarImportarDemo(eu: string, ctx: {
  categorias: Categoria[]; contas: Conta[]; lancamentos: Lancamento[]; plano: Linha[];
  extrato: (LinhaExtrato & { conta_id: string })[]; novo: (p: Partial<Lancamento> & Pick<Lancamento, 'tipo' | 'valor' | 'data' | 'descricao'>) => Lancamento;
}) {
  const hoje = hojeSP();
  const lotes = new Set<string>();
  const balancetes: { lote: string; competencia: string; arquivo: string; em: string; linhas: { codigo: string; debito: string; credito: string }[] }[] = [];
  const conta = (codigo: string, nome: string, natureza: string) => { const c = { id: crypto.randomUUID(), codigo, nome, natureza, ativa: true }; ctx.plano.push(c); return c; };
  conta('1.1.01', 'Caixa e bancos', 'ativo'); conta('2.1.01', 'Fornecedores a pagar', 'passivo'); conta('2.4.01', 'Patrimônio social', 'patrimonio');
  const ligacoes: [string, string, string][] = [
    ['3.1.01', 'Doações recebidas', 'Doações'], ['3.1.02', 'Patrocínios', 'Patrocínio'], ['3.1.03', 'Receitas de eventos e rifas', 'Rifas e eventos'],
    ['3.1.04', 'Recursos de projetos', 'Repasse de projeto'], ['4.1.01', 'Transporte e viagens', 'Transporte'], ['4.1.02', 'Alimentação', 'Alimentação'],
    ['4.1.03', 'Material esportivo', 'Material esportivo'], ['4.1.04', 'Arbitragem e taxas', 'Arbitragem'], ['4.1.05', 'Despesas bancárias', 'Tarifas bancárias'],
  ];
  for (const [cod, nome, cat] of ligacoes) {
    const c = conta(cod, nome, cod.startsWith('3') ? 'receita' : 'despesa');
    const categoria = ctx.categorias.find((x) => x.nome === cat);
    if (categoria) categoria.conta_contabil_id = c.id; // "Aluguel e infraestrutura" fica sem conta, de propósito
  }
  const mesPassado = (() => { const [a, m] = hoje.split('-').map(Number) as [number, number]; return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`; })();
  const fimMes = (c: string) => { const [a, m] = c.split('-').map(Number) as [number, number]; return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
  const doSistema = (contaId: string, comp: string) => ctx.lancamentos.filter((l) => l.situacao === 'realizada' && l.data >= comp && l.data <= fimMes(comp)
    && ctx.categorias.find((c) => c.id === l.categoria_id)?.conta_contabil_id === contaId).reduce((s, l) => s + centavos(l.valor), 0);
  balancetes.push({ lote: 'demo', competencia: mesPassado, arquivo: 'balancete-contador.xlsx', em: new Date().toISOString(),
    linhas: ctx.plano.filter((p) => ['receita', 'despesa'].includes(String(p.natureza))).map((p) => {
      let c = doSistema(String(p.id), mesPassado);
      if (p.codigo === '4.1.05') c += 1290;
      return p.natureza === 'receita' ? { codigo: String(p.codigo), debito: '0.00', credito: reais(c) } : { codigo: String(p.codigo), debito: reais(c), credito: '0.00' };
    }) });

  const novoLote = (id: unknown) => { if (lotes.has(String(id))) return false; lotes.add(String(id)); return true; };
  const orcamentos = new Map<string, string>();
  const anoAtual = hoje.slice(0, 4);
  for (const [nome, v] of [['Transporte', '4000.00'], ['Alimentação', '3000.00'], ['Material esportivo', '40000.00'], ['Arbitragem', '2500.00'],
    ['Tarifas bancárias', '400.00'], ['Aluguel e infraestrutura', '7800.00'], ['Patrocínio', '18000.00'], ['Doações', '6000.00'], ['Repasse de projeto', '36000.00']] as const) {
    const c = ctx.categorias.find((x) => x.nome === nome); if (c) orcamentos.set(`${anoAtual}|${c.id}`, v);
  }
  const rpc: Record<string, (a: Args) => unknown> = {
    salvar_orcamento: ({ p_ano, p }) => {
      for (const x of p as { categoria_id: string; valor: string }[]) orcamentos.set(`${p_ano}|${x.categoria_id}`, x.valor);
      return { ok: true };
    },
    orcamento_ano: ({ p_ano }) => {
      const ano = String(p_ano);
      return { ok: true, ano: Number(ano), hoje, categorias: ctx.categorias.filter((c) => c.ativa).map((c) => {
        const doAno = ctx.lancamentos.filter((l) => l.categoria_id === c.id && l.data.startsWith(ano) && !l.estorno_de);
        const real = doAno.filter((l) => l.situacao === 'realizada');
        const meses = [...new Set(real.map((l) => Number(l.data.slice(5, 7))))].sort((x, y) => x - y)
          .map((m) => ({ mes: m, valor: reais(real.filter((l) => Number(l.data.slice(5, 7)) === m).reduce((t, l) => t + centavos(l.valor), 0)) }));
        return { id: c.id, nome: c.nome, tipo: c.tipo, previsto: orcamentos.get(`${ano}|${c.id}`) ?? '0.00',
          realizado: reais(real.reduce((t, l) => t + centavos(l.valor), 0)), por_mes: meses,
          a_realizar: reais(doAno.filter((l) => l.situacao === 'prevista').reduce((t, l) => t + centavos(l.valor), 0)) };
      }) };
    },

    importar_plano_contas: ({ p_lote, p }) => {
      if (!novoLote(p_lote)) return { ok: true, repetido: true };
      let novas = 0;
      for (const x of p as { codigo: string; nome: string; natureza: string }[]) {
        const atual = ctx.plano.find((c) => c.codigo === x.codigo);
        if (atual) Object.assign(atual, { nome: x.nome, natureza: x.natureza, ativa: true }); else { conta(x.codigo, x.nome, x.natureza); novas++; }
      }
      return { ok: true, novas, total: (p as unknown[]).length };
    },
    vincular_categoria_conta: ({ p_categoria, p_conta }) => {
      const c = ctx.categorias.find((x) => x.id === p_categoria) ?? falhar('nao_encontrado');
      const pc = p_conta ? ctx.plano.find((x) => x.id === p_conta) ?? falhar('invalido', 'conta_contabil_id') : null;
      if (pc && ![c.tipo === 'entrada' ? 'receita' : 'despesa', 'outra'].includes(String(pc.natureza))) falhar('invalido', 'conta_contabil_id');
      c.conta_contabil_id = pc ? String(pc.id) : null;
      return { ok: true };
    },
    importar_lancamentos: ({ p_lote, p }) => {
      const linhas = p as (Partial<Lancamento> & { id: string })[];
      const problemas = linhas.flatMap((x, i) => {
        const cat = ctx.categorias.find((c) => c.id === x.categoria_id);
        const campo = !cat || cat.tipo !== x.tipo ? 'categoria_id' : !x.data || x.data > hoje ? 'data' : !ctx.contas.some((c) => c.id === x.conta_id) ? 'conta_id' : null;
        return campo ? [{ linha: i + 1, erro: 'invalido', campo }] : [];
      });
      if (problemas.length) return { ok: false, erro: 'linhas_invalidas', problemas };
      if (!novoLote(p_lote)) return { ok: true, repetido: true };
      let novas = 0;
      for (const x of linhas) {
        if (ctx.lancamentos.some((l) => l.id === x.id)) continue;
        ctx.novo({ id: x.id, tipo: x.tipo!, valor: x.valor!, data: x.data!, descricao: x.descricao!, categoria_id: x.categoria_id!, conta_id: x.conta_id!,
          forma_pagamento: x.forma_pagamento ?? null, criado_por: eu, sem_comprovante_motivo: 'Importado da planilha antiga' });
        novas++;
      }
      return { ok: true, novas, repetidas: linhas.length - novas };
    },
    lancar_do_extrato: ({ p }) => {
      const itens = p as { linha: string; id: string; categoria_id: string; descricao?: string }[];
      for (const x of itens) {
        const e = ctx.extrato.find((l) => l.id === x.linha) ?? falhar('nao_encontrado');
        if (e.lancamento_id || e.ignorada_motivo) falhar('ja_conciliada');
        const cat = ctx.categorias.find((c) => c.id === x.categoria_id);
        if (!cat || cat.tipo !== (e.valor.startsWith('-') ? 'saida' : 'entrada')) falhar('invalido', 'categoria_id');
      }
      for (const x of itens) {
        const e = ctx.extrato.find((l) => l.id === x.linha)!;
        const l = ctx.novo({ id: x.id, tipo: e.valor.startsWith('-') ? 'saida' : 'entrada', valor: e.valor.replace('-', ''), data: e.data,
          descricao: x.descricao?.trim() || e.descricao, categoria_id: x.categoria_id, conta_id: e.conta_id, criado_por: eu, sem_comprovante_motivo: 'Lançado do extrato' });
        e.lancamento_id = l.id;
      }
      return { ok: true, criados: itens.length };
    },
    importar_balancete: ({ p_lote, p_arquivo, p_competencia, p }) => {
      if (!novoLote(p_lote)) return { ok: true, repetido: true };
      balancetes.push({ lote: String(p_lote), competencia: String(p_competencia), arquivo: String(p_arquivo), em: new Date().toISOString(),
        linhas: (p as { codigo: string; debito?: string; credito?: string }[]).map((x) => ({ codigo: x.codigo, debito: x.debito ?? '0.00', credito: x.credito ?? '0.00' })) });
      return { ok: true, linhas: (p as unknown[]).length };
    },
    comparar_balancete: ({ p_competencia }) => {
      const comp = String(p_competencia);
      const b = balancetes.filter((x) => x.competencia === comp).at(-1);
      const contas = ctx.plano.filter((pc) => ['receita', 'despesa'].includes(String(pc.natureza))).sort((a, c) => String(a.codigo).localeCompare(String(c.codigo))).flatMap((pc) => {
        const s = doSistema(String(pc.id), comp);
        const linha = b?.linhas.find((l) => l.codigo === pc.codigo);
        const mov = linha ? (pc.natureza === 'receita' ? centavos(linha.credito) - centavos(linha.debito) : centavos(linha.debito) - centavos(linha.credito)) : null;
        if (!s && mov === null) return [];
        return [{ codigo: pc.codigo, nome: pc.nome, natureza: pc.natureza, sistema: s ? reais(s) : null, contador: mov === null ? null : reais(mov), diferenca: reais(s - (mov ?? 0)) }];
      });
      return { ok: true, competencia: comp, balancete: b ? { arquivo: b.arquivo, importado_em: b.em } : null, contas,
        categorias_sem_conta: ctx.categorias.filter((c) => c.ativa && !c.conta_contabil_id).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo })) };
    },
  };
  return { rpc };
}
