import { ErroApp } from '@/lib/erros';
import { hojeSP, somarDias } from '@/lib/datas';
import { somar } from '@/lib/dinheiro';
import type {
  Conta, DadosPrestacao, DetalheProjeto, DocumentoVerba, Lancamento, OrigemVerba, ParcelaVerba, Pendencia, ProjetoPainel,
  ProjetoSimples, Regras, RubricaSimples, TipoVerba, Verba,
} from '@/dados/tipos';

type Args = Record<string, unknown>;
const uuid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const falhar = (erro: string, campo?: string): never => { throw new ErroApp({ erro, campo }); };

const PADRAO: Regras = {
  conta_especifica: false, exige_rubricas: false, exige_transferencia: false, aceita_dinheiro: true, permite_reembolso: true,
  prestacao_parcial: false, prazo_prestacao_dias: 30, guarda_anos: 5, contrapartidas: [], documentos_antes: [], documentos_depois: [],
};
const completas = (r: Partial<Regras> | undefined): Regras => ({ ...PADRAO, ...(r ?? {}) });

interface ProjetoDemo extends Omit<ProjetoPainel, 'gasto' | 'entrou' | 'recebido_verba' | 'orcamento' | 'saldo' | 'pct_tempo' | 'pct_gasto' | 'rubricas' | 'pendencias' | 'contas'> {
  rubricas: { id: string; nome: string; previsto: string; ativa: boolean }[];
}

export function criarVerbasDemo(eu: string, outros: string[], ctx: {
  lancamentos: Lancamento[]; contas: Conta[]; novo: (p: Partial<Lancamento> & Pick<Lancamento, 'tipo' | 'valor' | 'data' | 'descricao'>) => Lancamento;
  catSaida: (nome: string) => string; catEntrada: (nome: string) => string;
}) {
  const hoje = hojeSP();
  const d = (n: number) => somarDias(hoje, n);
  const tipos: TipoVerba[] = [
    { id: uuid(), nome: 'Emenda parlamentar (termo de fomento)', ativo: true, regras: { conta_especifica: true, exige_rubricas: true, exige_transferencia: true, aceita_dinheiro: false, permite_reembolso: false, prestacao_parcial: true, prazo_prestacao_dias: 90, guarda_anos: 10,
      documentos_antes: ['Plano de trabalho', 'Certidões negativas'], documentos_depois: ['Relatório de execução do objeto', 'Relatório de execução financeira', 'Extratos da conta específica'] } },
    { id: uuid(), nome: 'Patrocínio privado', ativo: true, regras: { contrapartidas: ['Marca no uniforme', 'Publicações nas redes sociais'] } },
    { id: uuid(), nome: 'Edital de entidade', ativo: true, regras: { documentos_depois: ['Relatório da atividade'] } },
  ];
  const origens: OrigemVerba[] = [
    { id: uuid(), nome: 'Deputado Estadual Exemplo', categoria: 'parlamentar', contato: 'Gabinete, (16) 0000-0000', ativa: true },
    { id: uuid(), nome: 'Empresa Exemplo Ltda.', categoria: 'empresa', contato: null, ativa: true },
    { id: uuid(), nome: 'Confederação Exemplo', categoria: 'entidade', contato: null, ativa: true },
  ];
  const verbas: Verba[] = [];
  const parcelas: ParcelaVerba[] = [];
  const documentos: DocumentoVerba[] = [];
  const verba = (titulo: string, tipo: number, origem: number, extra: Partial<Verba>): Verba => {
    const v: Verba = { id: uuid(), titulo, tipo_id: tipos[tipo]!.id, origem_id: origens[origem]!.id, descricao: null, forma_recebimento: 'caixa_livre',
      valor_pedido: null, valor_aprovado: null, situacao: 'ideia', regras: tipos[tipo]!.regras, prazo_pedido: null, responsavel: eu, criado_por: eu, criado_em: agora(), ...extra };
    verbas.push(v);
    const r = completas(v.regras);
    for (const [momento, lista] of [['antes', r.documentos_antes], ['depois', r.documentos_depois]] as const) {
      lista.forEach((nome, i) => documentos.push({ id: uuid(), verba_id: v.id, momento, nome, entregue_em: momento === 'antes' && i === 0 ? agora() : null, entregue_por: null }));
    }
    return v;
  };
  const emenda = verba('Emenda para cadeiras de jogo e viagens', 0, 0, { forma_recebimento: 'conta_especifica', valor_pedido: '80000.00', valor_aprovado: '60000.00', situacao: 'em_execucao', responsavel: outros[1] ?? eu });
  verba('Patrocínio 2027 — renovação', 1, 1, { valor_pedido: '9000.00', situacao: 'pedido_enviado', prazo_pedido: d(12) });
  verba('Passagens para o Brasileiro', 2, 2, { forma_recebimento: 'pago_pela_origem', valor_aprovado: '4200.00', situacao: 'aprovado' });
  verba('Rifa de fim de ano', 1, 1, { situacao: 'ideia' });
  verba('Edital de fomento ao esporte', 2, 2, { valor_pedido: '15000.00', situacao: 'negado' });

  const contaProj = ctx.contas.find((c) => c.tipo === 'projeto')!;
  const projetos: ProjetoDemo[] = [{
    id: uuid(), nome: 'Cadeiras de jogo e viagens 2026', ativo: true, verba_id: emenda.id, fonte: 'Emenda parlamentar (termo de fomento)',
    descricao: 'Compra de cadeiras de jogo e viagens para competições oficiais.', vigencia_inicio: d(-120), vigencia_fim: d(120),
    valor_aprovado: '60000.00', valor_contrapartida: '0.00', regras: completas(emenda.regras), responsavel: outros[1] ?? eu,
    prazo_prestacao: d(210), prazo_prestacao_parcial: d(30), situacao: 'em_execucao',
    rubricas: [
      { id: uuid(), nome: 'Transporte', previsto: '20000.00', ativa: true },
      { id: uuid(), nome: 'Cadeiras de jogo', previsto: '30000.00', ativa: true },
      { id: uuid(), nome: 'Uniformes', previsto: '6000.00', ativa: true },
      { id: uuid(), nome: 'Arbitragem', previsto: '4000.00', ativa: true },
    ],
  }];
  const projA = projetos[0]!;
  contaProj.projeto_id = projA.id;
  [['30000.00', -110, -112], ['30000.00', 15, null]].forEach(([valor, prev, rec], i) => {
    parcelas.push({ id: uuid(), verba_id: emenda.id, numero: i + 1, valor: String(valor), data_prevista: d(Number(prev)),
      recebido_em: rec === null ? null : d(Number(rec)), valor_recebido: rec === null ? null : String(valor), lancamento_id: null });
  });
  const classif = new Map<string, string>();
  const justif = new Map<string, string>();
  const gasto = (valor: string, dias: number, descricao: string, rub: number | null, extra: Partial<Lancamento> = {}) => {
    const l = ctx.novo({ tipo: 'saida', valor, data: d(-dias), descricao, conta_id: contaProj.id, categoria_id: ctx.catSaida('Material esportivo'), forma_pagamento: 'transferencia', ...extra });
    if (rub !== null) classif.set(l.id, projA.rubricas[rub]!.id);
    return l;
  };
  ctx.novo({ tipo: 'entrada', valor: '30000.00', data: d(-112), descricao: 'Repasse da emenda — 1ª parcela', conta_id: contaProj.id, categoria_id: ctx.catEntrada('Repasse de projeto'), forma_pagamento: 'transferencia' });
  gasto('8400.00', 90, 'Ônibus adaptado — etapa de Ribeirão Preto', 0);
  gasto('7900.00', 40, 'Ônibus adaptado — etapa de Campinas', 0);
  gasto('15600.00', 60, 'Duas cadeiras de jogo', 1);
  gasto('5850.00', 20, 'Uniformes de jogo', 2);
  gasto('380.00', 8, 'Lanche da delegação', null, { forma_pagamento: 'dinheiro', categoria_id: ctx.catSaida('Alimentação') });

  const efetivos = (p: ProjetoDemo) => ctx.lancamentos.filter((l) => l.situacao === 'realizada' && !l.estorno_de
    && !ctx.lancamentos.some((e) => e.estorno_de === l.id)
    && (l.projeto_id === p.id || (!l.projeto_id && ctx.contas.some((c) => c.id === l.conta_id && c.projeto_id === p.id))));
  const pendencias = (p: ProjetoDemo): Pendencia[] => {
    const r = p.regras; const out: Pendencia[] = [];
    for (const l of efetivos(p).filter((x) => x.tipo === 'saida')) {
      const regras: Pendencia['regra'][] = [];
      if (r.exige_rubricas && !classif.has(l.id)) regras.push('sem_rubrica');
      if (!r.aceita_dinheiro && l.forma_pagamento === 'dinheiro') regras.push('forma_dinheiro');
      if (r.exige_transferencia && !['transferencia', 'pix', 'boleto'].includes(l.forma_pagamento ?? '')) regras.push('sem_transferencia');
      for (const regra of regras) out.push({ lancamento_id: l.id, regra, justificada: justif.has(`${l.id}:${regra}`), motivo: justif.get(`${l.id}:${regra}`) ?? null,
        descricao: l.descricao, data: l.data, valor: l.valor, forma_pagamento: l.forma_pagamento });
    }
    return out;
  };
  const painel = (p: ProjetoDemo): ProjetoPainel => {
    const ls = efetivos(p);
    const g = somar(ls.filter((l) => l.tipo === 'saida').map((l) => l.valor));
    const e = somar(ls.filter((l) => l.tipo === 'entrada').map((l) => l.valor));
    const orc = somar([p.valor_aprovado ?? '0', p.valor_contrapartida]);
    const ini = p.vigencia_inicio, fim = p.vigencia_fim;
    const dias = (a: string, b: string) => (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000;
    const pctTempo = ini && fim ? Math.round(1000 * Math.max(0, dias(ini, hoje < fim ? hoje : fim)) / Math.max(1, dias(ini, fim))) / 10 : null;
    const pend = pendencias(p);
    return {
      ...p, contas: ctx.contas.filter((c) => c.projeto_id === p.id).map((c) => ({ id: c.id, nome: c.nome })),
      gasto: g, entrou: e, recebido_verba: somar(parcelas.filter((x) => x.verba_id === p.verba_id && x.valor_recebido).map((x) => x.valor_recebido!)),
      orcamento: Number(orc) ? orc : null, saldo: somar([e, '-' + g]), pct_tempo: pctTempo, pct_gasto: Number(orc) ? Math.round(1000 * Number(g) / Number(orc)) / 10 : null,
      rubricas: p.rubricas.map((r) => {
        const real = somar(ls.filter((l) => classif.get(l.id) === r.id).map((l) => l.valor));
        const pct = Number(r.previsto) ? Math.round(1000 * Number(real) / Number(r.previsto)) / 10 : null;
        const alerta = pct === null ? null : pct > 100 ? 'estourada' : pct >= 90 ? 'perto_do_limite'
          : pctTempo !== null && pct > pctTempo + 25 ? 'adiantada' : pctTempo !== null && pctTempo >= 50 && pct < pctTempo - 35 ? 'atrasada' : null;
        return { id: r.id, nome: r.nome, previsto: r.previsto, realizado: real, pct, ativa: r.ativa, alerta };
      }),
      pendencias: { abertas: pend.filter((x) => !x.justificada).length, justificadas: pend.filter((x) => x.justificada).length, itens: pend },
    };
  };
  const achar = (id: unknown) => projetos.find((p) => p.id === id) ?? falhar('nao_encontrado');
  const achaVerba = (id: unknown) => verbas.find((v) => v.id === id) ?? falhar('nao_encontrado');
  const texto = (v: unknown, min: number, max: number, campo: string) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length < min || s.length > max) falhar('invalido', campo);
    return s;
  };

  const rpc: Record<string, (a: Args) => unknown> = {
    salvar_tipo_verba: ({ p }) => { const x = p as TipoVerba; texto(x.nome, 2, 80, 'nome'); const i = tipos.findIndex((t) => t.id === x.id);
      const t = { ...x, regras: x.regras ?? {}, ativo: x.ativo ?? true }; if (i >= 0) tipos[i] = t; else tipos.push(t); return { ok: true, id: x.id }; },
    importar_modelos_verba: () => ({ ok: true, criados: 0 }),
    salvar_origem_verba: ({ p }) => { const x = p as OrigemVerba; texto(x.nome, 2, 120, 'nome'); const i = origens.findIndex((o) => o.id === x.id);
      const o = { ...x, contato: x.contato ?? null, ativa: x.ativa ?? true }; if (i >= 0) origens[i] = o; else origens.push(o); return { ok: true, id: x.id }; },
    salvar_verba: ({ p }) => {
      const x = p as Verba;
      texto(x.titulo, 2, 160, 'titulo');
      const atual = verbas.find((v) => v.id === x.id);
      if (atual) { Object.assign(atual, x); return { ok: true, id: x.id, repetido: true }; }
      const t = tipos.find((y) => y.id === x.tipo_id) ?? falhar('invalido', 'tipo_id');
      const v = verba(x.titulo, tipos.indexOf(t), Math.max(0, origens.findIndex((o) => o.id === x.origem_id)), { ...x, regras: x.regras ?? t.regras, situacao: 'ideia', criado_por: eu });
      return { ok: true, id: v.id, repetido: false };
    },
    mudar_situacao_verba: ({ p_id, p_situacao }) => { achaVerba(p_id).situacao = p_situacao as Verba['situacao']; return { ok: true }; },
    salvar_parcelas: ({ p_verba, p }) => {
      const lista = p as { id: string; valor: string; data_prevista: string }[];
      for (let i = parcelas.length - 1; i >= 0; i--) if (parcelas[i]!.verba_id === p_verba && !parcelas[i]!.recebido_em) parcelas.splice(i, 1);
      const base = parcelas.filter((x) => x.verba_id === p_verba).length;
      [...lista].sort((a, b) => a.data_prevista.localeCompare(b.data_prevista)).forEach((x, i) => parcelas.push({ id: x.id, verba_id: String(p_verba), numero: base + i + 1,
        valor: x.valor, data_prevista: x.data_prevista, recebido_em: null, valor_recebido: null, lancamento_id: null }));
      return { ok: true, parcelas: lista.length };
    },
    registrar_recebimento: ({ p_parcela, p }) => {
      const x = parcelas.find((y) => y.id === p_parcela) ?? falhar('nao_encontrado');
      const q = p as { lancamento_id?: string; data?: string; valor?: string };
      const l = q.lancamento_id ? ctx.lancamentos.find((y) => y.id === q.lancamento_id) : undefined;
      Object.assign(x, { recebido_em: l?.data ?? q.data ?? hoje, valor_recebido: l?.valor ?? q.valor ?? x.valor, lancamento_id: l?.id ?? null });
      return { ok: true };
    },
    desfazer_recebimento: ({ p_parcela }) => { const x = parcelas.find((y) => y.id === p_parcela) ?? falhar('nao_encontrado'); Object.assign(x, { recebido_em: null, valor_recebido: null, lancamento_id: null }); return { ok: true }; },
    salvar_documento_verba: ({ p_verba, p }) => {
      const x = p as { id: string; momento?: 'antes' | 'depois'; nome?: string; entregue?: boolean };
      let doc = documentos.find((y) => y.id === x.id);
      if (!doc) { doc = { id: x.id, verba_id: String(p_verba), momento: x.momento ?? 'antes', nome: texto(x.nome, 2, 200, 'nome'), entregue_em: null, entregue_por: null }; documentos.push(doc); }
      if (x.entregue !== undefined) { doc.entregue_em = x.entregue ? agora() : null; doc.entregue_por = x.entregue ? eu : null; }
      return { ok: true, id: x.id };
    },
    formalizar_verba: ({ p_verba, p }) => {
      const v = achaVerba(p_verba);
      const ja = projetos.find((x) => x.verba_id === v.id);
      if (ja) return { ok: true, id: ja.id, repetido: true };
      const q = p as { projeto_id: string; nome?: string; vigencia_inicio: string; vigencia_fim: string };
      const r = completas(v.regras);
      projetos.push({ id: q.projeto_id, nome: q.nome || v.titulo, ativo: true, verba_id: v.id, fonte: tipos.find((t) => t.id === v.tipo_id)?.nome ?? null,
        descricao: v.descricao, vigencia_inicio: q.vigencia_inicio, vigencia_fim: q.vigencia_fim, valor_aprovado: v.valor_aprovado ?? v.valor_pedido,
        valor_contrapartida: '0.00', regras: r, responsavel: v.responsavel, prazo_prestacao: somarDias(q.vigencia_fim, r.prazo_prestacao_dias),
        prazo_prestacao_parcial: null, situacao: 'em_execucao', rubricas: [] });
      if (['ideia', 'pedido_enviado', 'em_analise', 'aprovado'].includes(v.situacao)) v.situacao = 'formalizado';
      return { ok: true, id: q.projeto_id, repetido: false };
    },
    criar_projeto: ({ p }) => {
      const q = p as { projeto_id: string; nome: string; fonte?: string; vigencia_inicio: string; vigencia_fim: string; valor_aprovado?: string; valor_contrapartida?: string };
      if (projetos.some((x) => x.id === q.projeto_id)) return { ok: true, id: q.projeto_id, repetido: true };
      texto(q.nome, 2, 120, 'nome');
      if (!q.vigencia_fim || q.vigencia_fim < q.vigencia_inicio) falhar('invalido', 'vigencia_fim');
      const r = completas({});
      projetos.push({ id: q.projeto_id, nome: q.nome, ativo: true, verba_id: null, fonte: q.fonte || null, descricao: null, vigencia_inicio: q.vigencia_inicio,
        vigencia_fim: q.vigencia_fim, valor_aprovado: q.valor_aprovado ?? null, valor_contrapartida: q.valor_contrapartida ?? '0.00', regras: r, responsavel: eu,
        prazo_prestacao: somarDias(q.vigencia_fim, r.prazo_prestacao_dias), prazo_prestacao_parcial: null, situacao: 'em_execucao', rubricas: [] });
      return { ok: true, id: q.projeto_id, repetido: false };
    },
    editar_projeto: ({ p_id, p }) => { const x = achar(p_id); Object.assign(x, p); if ((p as { regras?: Partial<Regras> }).regras) x.regras = completas((p as { regras: Partial<Regras> }).regras); return { ok: true }; },
    vincular_conta_projeto: ({ p_projeto, p_conta, p_vincular }) => {
      const c = ctx.contas.find((x) => x.id === p_conta) ?? falhar('invalido', 'conta_id');
      c.projeto_id = p_vincular ? String(p_projeto) : null; if (p_vincular) c.tipo = 'projeto'; return { ok: true };
    },
    salvar_rubrica: ({ p_projeto, p }) => {
      const x = achar(p_projeto); const q = p as { id: string; nome: string; valor_previsto: string; ativa?: boolean };
      texto(q.nome, 2, 80, 'nome');
      const r = x.rubricas.find((y) => y.id === q.id);
      if (r) Object.assign(r, { nome: q.nome, previsto: q.valor_previsto, ativa: q.ativa ?? r.ativa });
      else x.rubricas.push({ id: q.id, nome: q.nome, previsto: q.valor_previsto, ativa: q.ativa ?? true });
      return { ok: true, id: q.id };
    },
    classificar_lancamento: ({ p_lancamento, p_rubrica }) => { if (p_rubrica) classif.set(String(p_lancamento), String(p_rubrica)); else classif.delete(String(p_lancamento)); return { ok: true }; },
    justificar_regra: ({ p_lancamento, p_regra, p_motivo }) => { texto(p_motivo, 3, 300, 'motivo'); justif.set(`${p_lancamento}:${p_regra}`, String(p_motivo)); return { ok: true }; },
    painel_projetos: () => ({ ok: true, projetos: projetos.map((p) => ({ ...painel(p), pendencias: { ...painel(p).pendencias, itens: null } })) }),
    painel_projeto: ({ p_id }): DetalheProjeto & { ok: true } => {
      const p = achar(p_id);
      return { ok: true, projeto: painel(p),
        lancamentos: efetivos(p).sort((a, b) => b.data.localeCompare(a.data)).map((l) => ({ id: l.id, tipo: l.tipo, data: l.data, valor: l.valor, descricao: l.descricao,
          forma_pagamento: l.forma_pagamento, rubrica_id: classif.get(l.id) ?? null, tem_comprovante: true })),
        parcelas: parcelas.filter((x) => x.verba_id === p.verba_id).map((x) => ({ numero: x.numero, valor: x.valor, data_prevista: x.data_prevista, recebido_em: x.recebido_em, valor_recebido: x.valor_recebido })) };
    },
    dados_prestacao: ({ p_id }): DadosPrestacao & { ok: true } => {
      const p = achar(p_id); const v = verbas.find((x) => x.id === p.verba_id);
      return { ok: true, gerado_em: agora(), projeto: painel(p),
        verba: v ? { titulo: v.titulo, origem: origens.find((o) => o.id === v.origem_id)?.nome ?? '', tipo: tipos.find((t) => t.id === v.tipo_id)?.nome ?? '',
          documentos: documentos.filter((x) => x.verba_id === v.id).map((x) => ({ momento: x.momento, nome: x.nome, entregue: !!x.entregue_em })) } : null,
        pagamentos: efetivos(p).sort((a, b) => a.data.localeCompare(b.data)).map((l) => ({ data: l.data, tipo: l.tipo, valor: l.valor, descricao: l.descricao,
          favorecido: l.tipo === 'saida' ? 'Fornecedor Exemplo' : 'Deputado Estadual Exemplo', documento: null, forma_pagamento: l.forma_pagamento,
          conta: ctx.contas.find((c) => c.id === l.conta_id)?.nome ?? null, rubrica: p.rubricas.find((r) => r.id === classif.get(l.id))?.nome ?? null,
          comprovante: true, sem_comprovante_motivo: null })),
        atividades: [{ titulo: 'Campeonato Paulista — etapa Campinas', inicio: d(-40), fim: d(-38), dia_inteiro: true, local: 'Campinas (SP)', tipo: 'Campeonato' }] };
    },
  };

  return {
    rpc,
    leituras: {
      tiposVerba: async () => [...tipos],
      origensVerba: async () => [...origens],
      verbas: async () => [...verbas],
      parcelasVerba: async (id: string) => parcelas.filter((x) => x.verba_id === id).sort((a, b) => a.numero - b.numero),
      documentosVerba: async (id: string) => documentos.filter((x) => x.verba_id === id),
      projetos: async (): Promise<ProjetoSimples[]> => projetos.map((p) => ({ id: p.id, nome: p.nome, ativo: p.ativo, verba_id: p.verba_id })),
      rubricas: async (): Promise<RubricaSimples[]> => projetos.flatMap((p) => p.rubricas.map((r) => ({ id: r.id, projeto_id: p.id, nome: r.nome, ativa: r.ativa }))),
    },
  };
}
