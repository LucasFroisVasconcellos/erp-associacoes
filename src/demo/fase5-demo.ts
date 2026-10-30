import type { OpcoesLista, TabelaLeitura } from '@/dados/fonte';
import type { Lancamento, LinhaExtrato, PrazoAgenda, Verba } from '@/dados/tipos';
import { ErroApp } from '@/lib/erros';
import { hojeSP, somarDias } from '@/lib/datas';

type Args = Record<string, unknown>;
type Linha = Record<string, unknown> & { id?: string };
const uuid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const falhar = (erro: string, campo?: string): never => { throw new ErroApp({ erro, campo }); };

export function criarFase5Demo(eu: string, ctx: { lancamentos: Lancamento[]; contaMovimento: string; verbas: () => Promise<Verba[]>; atletas: () => Promise<{ id: string; nome: string }[]> }) {
  const hoje = hojeSP(); const d = (n: number) => somarDias(hoje, n);
  const t: Record<TabelaLeitura, Linha[]> = {
    oportunidades: [], oportunidade_interacoes: [], contrapartidas: [], acoes_captacao: [], acao_vendedores: [], recibos: [],
    viagens: [], viagem_delegacao: [], viagem_lancamentos: [], plano_contas: [], transparencia_publicacoes: [],
    configuracoes: [{ chave: 'entidade', valor: { nome: 'Associação Exemplo', cnpj: '11222333000181', endereco: 'Rua Exemplo, 100 — Cidade Exemplo' } }],
  };
  const op = (nome: string, tipo: string, etapa: string, valor: string | null, passo: string | null, quando: number | null) => {
    const o = { id: uuid(), tipo, nome, contato: null, etapa, valor_estimado: valor, proximo_passo: passo, proximo_passo_em: quando === null ? null : d(quando),
      verba_id: null, responsavel: eu, criado_por: eu, atualizado_em: agora() };
    t.oportunidades.push(o); return o;
  };
  const o1 = op('Empresa Exemplo Ltda.', 'patrocinio', 'proposta', '12000.00', 'Ligar para saber da proposta', 2);
  op('Mercado Fictício', 'patrocinio', 'contato', '3000.00', 'Enviar apresentação', -1);
  op('Clínica Demonstração', 'patrocinio', 'prospeccao', null, null, null);
  op('Apoiadores da campanha IR 2027', 'incentivo_ir', 'contato', '8000.00', 'Mandar lembrete aos apoiadores', 40);
  op('Doador Exemplo', 'doacao', 'fechado', '500.00', null, null);
  t.oportunidade_interacoes.push({ id: uuid(), oportunidade_id: o1.id, data: d(-6), texto: 'Reunião com o setor de marketing; pediram proposta com contrapartidas.', autor: eu, criado_em: agora() });
  void ctx.verbas().then((vs) => {
    const v = vs.find((x) => x.titulo.startsWith('Patrocínio')) ?? vs[0];
    if (!v) return;
    t.contrapartidas.push({ id: uuid(), verba_id: v.id, descricao: 'Marca no uniforme de jogo', prazo: d(10), entregue_em: null, observacao: null, arquivo_caminho: null, arquivo_mime: null, criado_por: eu },
      { id: uuid(), verba_id: v.id, descricao: 'Três publicações nas redes sociais', prazo: d(-3), entregue_em: null, observacao: null, arquivo_caminho: null, arquivo_mime: null, criado_por: eu });
  });
  const rifa = { id: uuid(), tipo: 'rifa', nome: 'Rifa para o Brasileiro', data: d(20), preco_unitario: '10.00', quantidade: 500, custo: '400.00', situacao: 'em_andamento',
    autorizacao: 'Conferido com o contador (exemplo)', evento_id: null, criado_por: eu };
  t.acoes_captacao.push(rifa, { id: uuid(), tipo: 'evento', nome: 'Jantar beneficente', data: d(45), preco_unitario: '60.00', quantidade: 120, custo: '2500.00', situacao: 'planejada', autorizacao: null, evento_id: null, criado_por: eu });
  t.acao_vendedores.push({ id: uuid(), acao_id: rifa.id, nome: 'Ana Exemplo', membro_id: null, bilhetes: 100, vendidos: 82, valor_prestado: '820.00', lancamento_id: null },
    { id: uuid(), acao_id: rifa.id, nome: 'Bruno Fictício', membro_id: null, bilhetes: 100, vendidos: 40, valor_prestado: '300.00', lancamento_id: null });
  let ultimoRecibo = 0;
  const recibo = (doador: string, doc: string | null, valor: string, forma: string, desc: string | null) => {
    ultimoRecibo++;
    t.recibos.push({ id: uuid(), ano: Number(hoje.slice(0, 4)), numero: ultimoRecibo, doador_nome: doador, doador_documento: doc, valor, data: d(-10 * ultimoRecibo), forma, descricao: desc,
      lancamento_id: null, oportunidade_id: null, emitido_por: eu, emitido_em: agora(), cancelado_em: null, motivo_cancelamento: null });
  };
  recibo('Doador Exemplo', '52998224725', '500.00', 'bens', 'Duas cadeiras de treino usadas');
  recibo('Empresa Exemplo Ltda.', '11222333000181', '1500.00', 'servicos', 'Transporte para o Paulista');

  const viagem = { id: uuid(), titulo: 'Campeonato Brasileiro', destino: 'Brasília (DF)', saida: d(-20), retorno: d(-15), distancia_km: 1800, orcamento: '15000.00', situacao: 'em_andamento',
    quartos_adaptados: 6, transporte_acessivel: true, observacoes: 'Ônibus com elevador; hotel com 6 quartos adaptados confirmados.', evento_id: null, verba_id: null, projeto_id: null, responsavel: eu, criado_por: eu };
  t.viagens.push(viagem, { id: uuid(), titulo: 'Etapa do Paulista', destino: 'Santos (SP)', saida: d(12), retorno: d(13), distancia_km: 520, orcamento: '4000.00', situacao: 'planejada',
    quartos_adaptados: 3, transporte_acessivel: true, observacoes: null, evento_id: null, verba_id: null, projeto_id: null, responsavel: eu, criado_por: eu });
  void ctx.atletas().then((as) => {
    for (const [i, a] of as.slice(0, 4).entries()) t.viagem_delegacao.push({ id: uuid(), viagem_id: viagem.id, pessoa_id: a.id, membro_id: null, nome: a.nome, funcao: 'atleta', quarto: String(101 + Math.floor(i / 2)) });
    t.viagem_delegacao.push({ id: uuid(), viagem_id: viagem.id, pessoa_id: null, membro_id: null, nome: 'Técnico Exemplo', funcao: 'tecnico', quarto: '103' });
  });
  const saidas = ctx.lancamentos.filter((l) => l.tipo === 'saida' && l.situacao === 'realizada').slice(0, 3);
  saidas.forEach((l, i) => t.viagem_lancamentos.push({ lancamento_id: l.id, viagem_id: viagem.id, papel: i === 0 ? 'adiantamento' : 'despesa' }));

  const extrato: (LinhaExtrato & { conta_id: string })[] = ctx.lancamentos
    .filter((l) => l.conta_id === ctx.contaMovimento && l.situacao === 'realizada').slice(0, 6)
    .map((l) => ({ id: uuid(), conta_id: ctx.contaMovimento, data: l.data, valor: `${l.tipo === 'saida' ? '-' : ''}${l.valor}`, descricao: l.descricao.toUpperCase(), lancamento_id: null, ignorada_motivo: null, sugestoes: null }));
  extrato.push({ id: uuid(), conta_id: ctx.contaMovimento, data: d(-3), valor: '-12.90', descricao: 'TARIFA PACOTE DE SERVICOS', lancamento_id: null, ignorada_motivo: null, sugestoes: null });

  const achar = (tab: TabelaLeitura, id: unknown) => t[tab].find((x) => x.id === id) ?? falhar('nao_encontrado');
  const upsert = (tab: TabelaLeitura, p: Linha, padrao: Linha = {}) => {
    const i = t[tab].findIndex((x) => x.id === p.id);
    if (i >= 0) t[tab][i] = { ...t[tab][i], ...p }; else t[tab].push({ ...padrao, ...p });
    return { ok: true, id: p.id };
  };
  const candidatos = (x: LinhaExtrato & { conta_id: string }) => ctx.lancamentos.filter((l) => l.conta_id === x.conta_id && l.situacao === 'realizada'
    && l.tipo === (Number(x.valor) > 0 ? 'entrada' : 'saida') && l.valor === x.valor.replace('-', '') && Math.abs(Date.parse(l.data) - Date.parse(x.data)) <= 5 * 86_400_000
    && !extrato.some((e) => e.lancamento_id === l.id));
  const numeros = (id: string) => {
    const ls = t.viagem_lancamentos.filter((x) => x.viagem_id === id).map((x) => ({ papel: String(x.papel), l: ctx.lancamentos.find((l) => l.id === x.lancamento_id) }));
    const soma = (papel: string) => ls.filter((x) => x.papel === papel).reduce((s, x) => s + Number(x.l?.valor ?? 0), 0);
    const v = achar('viagens', id); const atletas = t.viagem_delegacao.filter((x) => x.viagem_id === id && x.funcao === 'atleta').length;
    const gasto = soma('despesa'), adiant = soma('adiantamento'), devol = soma('devolucao');
    return { id, gasto: gasto.toFixed(2), adiantado: adiant.toFixed(2), devolvido: devol.toFixed(2), saldo_acerto: (adiant - gasto - devol).toFixed(2), atletas,
      delegacao: t.viagem_delegacao.filter((x) => x.viagem_id === id).length, custo_por_atleta: atletas ? (gasto / atletas).toFixed(2) : null,
      custo_por_km: Number(v.distancia_km) > 0 ? (gasto / Number(v.distancia_km)).toFixed(2) : null };
  };

  const rpc: Record<string, (a: Args) => unknown> = {
    salvar_oportunidade: ({ p }) => upsert('oportunidades', { ...(p as Linha), atualizado_em: agora() }, { criado_por: eu, etapa: 'prospeccao' }),
    registrar_interacao: ({ p_oportunidade, p }) => upsert('oportunidade_interacoes', { ...(p as Linha), oportunidade_id: p_oportunidade, autor: eu, criado_em: agora() }),
    salvar_contrapartida: ({ p }) => upsert('contrapartidas', p as Linha, { criado_por: eu, arquivo_caminho: null }),
    salvar_acao_captacao: ({ p }) => upsert('acoes_captacao', p as Linha, { criado_por: eu, situacao: 'planejada', custo: '0.00' }),
    salvar_vendedor: ({ p_acao, p }) => upsert('acao_vendedores', { ...(p as Linha), acao_id: p_acao }, { bilhetes: 0, vendidos: 0, valor_prestado: '0.00' }),
    emitir_recibo: ({ p }) => {
      const q = p as Linha; const ja = t.recibos.find((r) => r.id === q.id);
      if (ja) return { ok: true, id: ja.id, numero: ja.numero, repetido: true };
      ultimoRecibo++;
      t.recibos.push({ ...q, ano: Number(String(q.data).slice(0, 4)), numero: ultimoRecibo, emitido_por: eu, emitido_em: agora(), cancelado_em: null, motivo_cancelamento: null,
        doador_documento: q.doador_documento ? String(q.doador_documento).replace(/\D/g, '') : null });
      return { ok: true, id: q.id, numero: ultimoRecibo };
    },
    cancelar_recibo: ({ p_id, p_motivo }) => { Object.assign(achar('recibos', p_id), { cancelado_em: agora(), motivo_cancelamento: p_motivo }); return { ok: true }; },
    salvar_config_entidade: ({ p }) => { t.configuracoes = t.configuracoes.filter((x) => x.chave !== 'entidade').concat({ chave: 'entidade', valor: p }); return { ok: true }; },
    painel_captacao: () => {
      const etapas: Record<string, { n: number; valor: string }> = {};
      for (const o of t.oportunidades) { const e = (etapas[String(o.etapa)] ??= { n: 0, valor: '0.00' }); e.n++; e.valor = (Number(e.valor) + Number(o.valor_estimado ?? 0)).toFixed(2); }
      return { ok: true, etapas,
        passos_atrasados: t.oportunidades.filter((o) => o.proximo_passo_em && String(o.proximo_passo_em) < hoje && !['fechado', 'perdido'].includes(String(o.etapa))).length,
        contrapartidas_atrasadas: t.contrapartidas.filter((c) => !c.entregue_em && c.prazo && String(c.prazo) < hoje).length,
        acoes: t.acoes_captacao.map((a) => { const vs = t.acao_vendedores.filter((v) => v.acao_id === a.id); const arr = vs.reduce((s, v) => s + Number(v.valor_prestado), 0);
          return { id: a.id, arrecadado: arr.toFixed(2), vendidos: vs.reduce((s, v) => s + Number(v.vendidos), 0), resultado: (arr - Number(a.custo)).toFixed(2) }; }) };
    },
    salvar_viagem: ({ p }) => upsert('viagens', p as Linha, { criado_por: eu, situacao: 'planejada', transporte_acessivel: false }),
    salvar_delegacao: ({ p_viagem, p }) => {
      t.viagem_delegacao = t.viagem_delegacao.filter((x) => x.viagem_id !== p_viagem).concat((p as Linha[]).map((x) => ({ pessoa_id: null, membro_id: null, quarto: null, ...x, viagem_id: p_viagem })));
      return { ok: true, pessoas: (p as Linha[]).length };
    },
    vincular_lancamento_viagem: ({ p_viagem, p_lancamento, p_papel }) => {
      t.viagem_lancamentos = t.viagem_lancamentos.filter((x) => x.lancamento_id !== p_lancamento);
      if (p_papel) t.viagem_lancamentos.push({ lancamento_id: p_lancamento, viagem_id: p_viagem, papel: p_papel });
      return { ok: true };
    },
    painel_viagens: () => ({ ok: true, viagens: t.viagens.map((v) => numeros(String(v.id))) }),
    encerrar_viagem: ({ p_id }) => {
      if (Number(numeros(String(p_id)).saldo_acerto) > 0) falhar('acerto_pendente');
      Object.assign(achar('viagens', p_id), { situacao: 'encerrada' }); return { ok: true };
    },
    importar_extrato: ({ p_conta, p }) => {
      let novas = 0;
      for (const x of p as { data: string; valor: string; descricao: string; id?: string }[]) {
        if (x.id && extrato.some((e) => e.id === `fit:${x.id}`)) continue;
        extrato.push({ id: x.id ? `fit:${x.id}` : uuid(), conta_id: String(p_conta), data: x.data, valor: x.valor, descricao: x.descricao, lancamento_id: null, ignorada_motivo: null, sugestoes: null });
        novas++;
      }
      return { ok: true, novas, repetidas: (p as unknown[]).length - novas };
    },
    painel_conciliacao: ({ p_conta, p_inicio, p_fim }) => ({ ok: true,
      linhas: extrato.filter((x) => x.conta_id === p_conta && x.data >= String(p_inicio) && x.data <= String(p_fim)).sort((a, b) => b.data.localeCompare(a.data))
        .map((x) => ({ ...x, sugestoes: x.lancamento_id || x.ignorada_motivo ? null : candidatos(x).map((l) => ({ id: l.id, data: l.data, descricao: l.descricao })) })),
      sem_extrato: ctx.lancamentos.filter((l) => l.conta_id === p_conta && l.situacao === 'realizada' && l.data >= String(p_inicio) && l.data <= String(p_fim)
        && !extrato.some((e) => e.lancamento_id === l.id)).map((l) => ({ id: l.id, data: l.data, tipo: l.tipo, valor: l.valor, descricao: l.descricao })) }),
    conciliar: ({ p_linha, p_lancamento }) => {
      const x = extrato.find((e) => e.id === p_linha) ?? falhar('nao_encontrado');
      if (!candidatos(x).some((l) => l.id === p_lancamento) && !ctx.lancamentos.some((l) => l.id === p_lancamento && l.valor === x.valor.replace('-', ''))) falhar('invalido', 'lancamento_id');
      x.lancamento_id = String(p_lancamento); return { ok: true };
    },
    conciliar_automatico: ({ p_conta }) => {
      let n = 0;
      for (const x of extrato.filter((e) => e.conta_id === p_conta && !e.lancamento_id && !e.ignorada_motivo)) {
        const c = candidatos(x); if (c.length === 1) { x.lancamento_id = c[0]!.id; n++; }
      }
      return { ok: true, conciliadas: n };
    },
    ignorar_linha: ({ p_linha, p_motivo }) => { Object.assign(extrato.find((e) => e.id === p_linha) ?? falhar('nao_encontrado'), { ignorada_motivo: p_motivo }); return { ok: true }; },
    desfazer_conciliacao: ({ p_linha }) => { Object.assign(extrato.find((e) => e.id === p_linha) ?? falhar('nao_encontrado'), { lancamento_id: null, ignorada_motivo: null }); return { ok: true }; },
  };

  function prazos(ini: string, fim: string): PrazoAgenda[] {
    const no = (x: unknown) => typeof x === 'string' && x >= ini && x <= fim;
    return [
      ...t.oportunidades.filter((o) => no(o.proximo_passo_em) && !['fechado', 'perdido'].includes(String(o.etapa)))
        .map((o) => ({ tipo: 'captacao' as const, titulo: `${o.proximo_passo ?? 'Próximo passo'}: ${o.nome}`, data: String(o.proximo_passo_em), ref: String(o.id) })),
      ...t.contrapartidas.filter((c) => !c.entregue_em && no(c.prazo)).map((c) => ({ tipo: 'contrapartida' as const, titulo: `Contrapartida: ${c.descricao}`, data: String(c.prazo), ref: String(c.verba_id) })),
      ...t.viagens.filter((v) => ['planejada', 'em_andamento'].includes(String(v.situacao)) && no(v.saida)).map((v) => ({ tipo: 'viagem' as const, titulo: `Viagem: ${v.titulo}`, data: String(v.saida), ref: String(v.id) })),
    ];
  }

  return {
    rpc, prazos, tabelas: t, extrato,
    anexar: (id: string, mime: string) => { Object.assign(achar('contrapartidas', id), { arquivo_caminho: `${id}/${uuid()}`, arquivo_mime: mime, entregue_em: hoje }); return { id }; },
    lista: async <T,>(tabela: TabelaLeitura, o: OpcoesLista = {}): Promise<T[]> => {
      let r = t[tabela].filter((x) => Object.entries(o.onde ?? {}).every(([k, v]) => String(x[k]) === v));
      if (o.ordem) r = [...r].sort((a, b) => String(a[o.ordem!] ?? '').localeCompare(String(b[o.ordem!] ?? '')) * (o.desc ? -1 : 1));
      return r.slice(0, o.limite ?? 1000) as T[];
    },
  };
}
