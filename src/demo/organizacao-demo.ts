import { ErroApp } from '@/lib/erros';
import { diaDaSemana, instanteSP } from '@/lib/agenda';
import { hojeSP, somarDias } from '@/lib/datas';
import type {
  AgendaPeriodo, Aviso, ComentarioTarefa, Evento, ItemTarefa, LeituraAviso, ModeloTarefas, PreferenciasEmail,
  PrazoAgenda, ResumoOrganizacao, Tarefa, TarefaRecorrente, TipoEvento,
} from '@/dados/tipos';

type Args = Record<string, unknown>;
const uuid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const falhar = (erro: string, campo?: string): never => { throw new ErroApp({ erro, campo }); };

export function criarOrganizacaoDemo(eu: string, outros: string[]) {
  const hoje = hojeSP();
  const d = (n: number) => somarDias(hoje, n);
  const tipos: TipoEvento[] = [
    { id: uuid(), nome: 'Treino', cor: 'azul', icone: 'treino', ativo: true },
    { id: uuid(), nome: 'Jogo', cor: 'verde', icone: 'jogo', ativo: true },
    { id: uuid(), nome: 'Campeonato', cor: 'laranja', icone: 'trofeu', ativo: true },
    { id: uuid(), nome: 'Viagem', cor: 'teal', icone: 'viagem', ativo: true },
    { id: uuid(), nome: 'Reunião de diretoria', cor: 'indigo', icone: 'reuniao', ativo: true },
    { id: uuid(), nome: 'Prazo fiscal', cor: 'cinza', icone: 'prazo', ativo: true },
  ];
  const tipo = (nome: string) => tipos.find((t) => t.nome === nome)!.id;
  const eventos: Evento[] = [];
  const ev = (titulo: string, t: string, dia: string, hi: string | null, hf: string | null, extra: Partial<Evento> = {}): Evento => {
    const e: Evento = {
      id: uuid(), tipo_id: tipo(t), titulo, dia_inteiro: !hi,
      inicio: instanteSP(dia, hi ?? '00:00'), fim: instanteSP(extra.fim ?? dia, hf ?? '00:00'),
      local: null, descricao: null, projeto_id: null, criado_por: eu, cancelado_em: null, motivo_cancelamento: null, participantes: [], ...extra,
    };
    if (extra.fim) e.fim = instanteSP(extra.fim, hf ?? '00:00');
    eventos.push(e);
    return e;
  };
  const quinta = (4 - diaDaSemana(hoje) + 7) % 7;
  for (const k of [-2, -1, 0, 1, 2, 3]) ev('Treino da equipe', 'Treino', d(quinta + k * 7), '19:30', '21:30', { local: 'Ginásio de esportes' });
  ev('Reunião de diretoria', 'Reunião de diretoria', d(4), '20:00', '21:30', { local: 'Sede da Associação Exemplo', participantes: [eu, ...outros.slice(0, 3)] });
  ev('Amistoso contra equipe convidada', 'Jogo', d(11), '10:00', '12:00', { local: 'Ginásio de esportes' });
  const camp = ev('Campeonato Paulista — etapa Campinas', 'Campeonato', d(32), null, null, { fim: d(34), local: 'Campinas (SP)' });
  ev('Prazo: certidão municipal', 'Prazo fiscal', d(18), null, null);

  const tarefas: Tarefa[] = [];
  const itens: ItemTarefa[] = [];
  const comentarios: ComentarioTarefa[] = [];
  const tarefa = (titulo: string, resp: string, prazo: string | null, extra: Partial<Tarefa> = {}, lista: string[] = []) => {
    const t: Tarefa = {
      id: uuid(), titulo, descricao: null, responsavel: resp, prazo, prioridade: 'normal', situacao: 'a_fazer', evento_id: null,
      recorrencia_id: null, modelo_id: null, lembrete_dias: 1, criado_por: eu, criado_em: agora(), concluida_em: null, ...extra,
    };
    tarefas.push(t);
    lista.forEach((texto, i) => itens.push({ id: uuid(), tarefa_id: t.id, ordem: i, texto, feito: i === 0 && lista.length > 1, feito_por: null, feito_em: null }));
    return t;
  };
  tarefa('Conferir extrato de outubro', outros[1] ?? eu, d(1), { prioridade: 'alta' }, ['Baixar o extrato', 'Conferir com os lançamentos', 'Anotar diferenças']);
  tarefa('Enviar fechamento ao contador', outros[1] ?? eu, d(5));
  tarefa('Montar a pauta da reunião', eu, d(3), { situacao: 'fazendo' }, ['Pendências do mês', 'Campeonato Paulista', 'Patrocínio']);
  tarefa('Confirmar atletas para o Paulista', eu, d(-1), { evento_id: camp.id, prioridade: 'alta' });
  tarefa('Reservar ônibus adaptado', outros[0] ?? eu, d(12), { evento_id: camp.id });
  tarefa('Checar pneus das cadeiras de jogo', outros[3] ?? eu, d(25), { evento_id: camp.id });
  tarefa('Publicar fotos do amistoso', outros[2] ?? eu, null, { prioridade: 'baixa' });
  tarefa('Renovar a inscrição na federação', eu, d(-8), { situacao: 'feito', concluida_em: agora() });
  comentarios.push({ id: uuid(), tarefa_id: tarefas[2]!.id, autor: outros[0] ?? eu, texto: 'Incluir o orçamento do ônibus na pauta.', criado_em: agora() });

  const recorrentes: TarefaRecorrente[] = [
    { id: uuid(), titulo: 'Conferir o extrato do mês', descricao: null, responsavel: outros[1] ?? eu, frequencia: 'mensal', dia: 5, inicio: d(-60), fim: null, lembrete_dias: 2, ativa: true },
  ];
  const modelos: ModeloTarefas[] = [];
  const avisos: Aviso[] = [
    { id: uuid(), titulo: 'Reunião extraordinária no sábado', texto: 'Sábado, às 10h, na sede.\nPauta: Campeonato Paulista e patrocínio.', autor: outros[0] ?? eu, publicado_em: agora(), expira_em: d(10), arquivado_em: null },
    { id: uuid(), titulo: 'Novo horário de treino', texto: 'A partir do mês que vem, os treinos de quinta começam às 19h30.', autor: eu, publicado_em: new Date(Date.now() - 6 * 86_400_000).toISOString(), expira_em: null, arquivado_em: null },
  ];
  const leituras: LeituraAviso[] = [
    { aviso_id: avisos[1]!.id, membro_id: eu, lido_em: agora() },
    ...outros.slice(0, 2).map((m) => ({ aviso_id: avisos[1]!.id, membro_id: m, lido_em: agora() })),
  ];
  let prefs: PreferenciasEmail = { lembretes: true, resumo_semanal: true };

  const comItens = (t: Tarefa): Tarefa => {
    const its = itens.filter((i) => i.tarefa_id === t.id);
    return { ...t, itens_total: its.length, itens_feitos: its.filter((i) => i.feito).length };
  };
  const achar = (id: unknown) => tarefas.find((t) => t.id === id) ?? falhar('nao_encontrado');
  const texto = (v: unknown, min: number, max: number, campo: string) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length < min || s.length > max) falhar('invalido', campo);
    return s;
  };

  const rpc: Record<string, (a: Args) => unknown> = {
    agenda_periodo: ({ p_inicio, p_fim }): AgendaPeriodo & { ok: true } => {
      const ini = String(p_inicio), fim = String(p_fim);
      const lista = eventos.filter((e) => hojeSP(new Date(e.inicio)) <= fim && hojeSP(new Date(e.fim)) >= ini).sort((a, b) => a.inicio.localeCompare(b.inicio));
      const prazos: PrazoAgenda[] = tarefas.filter((t) => t.prazo && t.prazo >= ini && t.prazo <= fim && ['a_fazer', 'fazendo'].includes(t.situacao))
        .map((t) => ({ tipo: 'tarefa', titulo: t.titulo, data: t.prazo!, ref: t.id, responsavel: t.responsavel }));
      const dia10 = `${hoje.slice(0, 8)}10`;
      if (dia10 >= ini && dia10 <= fim) prazos.push({ tipo: 'fechamento', titulo: 'Fechar o mês anterior e enviar ao contador', data: dia10, ref: '' });
      if (d(4) >= ini && d(4) <= fim) prazos.push({ tipo: 'a_pagar', titulo: 'Aluguel da quadra', data: d(4), ref: '' });
      return { ok: true, eventos: lista, prazos };
    },
    salvar_evento: ({ p }) => {
      const x = p as Partial<Evento> & { inicio: string; fim?: string; participantes?: string[] };
      const titulo = texto(x.titulo, 2, 120, 'titulo');
      if (!tipos.some((t) => t.id === x.tipo_id)) falhar('invalido', 'tipo_id');
      const inicio = x.dia_inteiro ? instanteSP(x.inicio, '00:00') : x.inicio;
      const fim = x.dia_inteiro ? instanteSP(x.fim ?? x.inicio, '00:00') : x.fim ?? x.inicio;
      if (fim < inicio) falhar('invalido', 'fim');
      const atual = eventos.find((e) => e.id === x.id);
      if (atual?.cancelado_em) falhar('cancelado');
      const novo: Evento = { ...(atual ?? { criado_por: eu, cancelado_em: null, motivo_cancelamento: null, projeto_id: null }),
        id: x.id!, tipo_id: x.tipo_id!, titulo, inicio, fim, dia_inteiro: !!x.dia_inteiro, local: (x.local ?? '').trim() || null,
        descricao: (x.descricao ?? '').trim() || null, participantes: x.participantes ?? atual?.participantes ?? [] } as Evento;
      if (atual) Object.assign(atual, novo); else eventos.push(novo);
      return { ok: true, id: x.id };
    },
    cancelar_evento: ({ p_id, p_motivo }) => {
      const e = eventos.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
      texto(p_motivo, 3, 300, 'motivo');
      e.cancelado_em = agora(); e.motivo_cancelamento = String(p_motivo);
      return { ok: true };
    },
    salvar_tipo_evento: ({ p }) => {
      const x = p as TipoEvento;
      const nome = texto(x.nome, 2, 60, 'nome');
      if (tipos.some((t) => t.nome.toLowerCase() === nome.toLowerCase() && t.id !== x.id)) falhar('duplicado', 'nome');
      const i = tipos.findIndex((t) => t.id === x.id);
      const t = { ...x, nome, ativo: x.ativo ?? true };
      if (i >= 0) tipos[i] = t; else tipos.push(t);
      return { ok: true, id: x.id };
    },
    importar_tipos_evento: () => ({ ok: true, criados: 0 }),
    criar_tarefa: ({ p }) => {
      const x = p as Partial<Tarefa> & { itens?: string[] };
      if (tarefas.some((t) => t.id === x.id)) return { ok: true, id: x.id, repetido: true };
      const t = tarefa(texto(x.titulo, 2, 160, 'titulo'), x.responsavel ?? eu, x.prazo ?? null,
        { id: x.id!, descricao: x.descricao ?? null, prioridade: x.prioridade ?? 'normal', evento_id: x.evento_id ?? null, lembrete_dias: x.lembrete_dias ?? 1 }, x.itens ?? []);
      return { ok: true, id: t.id };
    },
    editar_tarefa: ({ p_id, p }) => { const t = achar(p_id); if (t.situacao === 'cancelada') falhar('cancelada'); Object.assign(t, p); return { ok: true }; },
    mudar_situacao_tarefa: ({ p_id, p_situacao }) => {
      const t = achar(p_id);
      if (!['a_fazer', 'fazendo', 'feito', 'cancelada'].includes(String(p_situacao))) falhar('invalido', 'situacao');
      t.situacao = p_situacao as Tarefa['situacao']; t.concluida_em = p_situacao === 'feito' ? agora() : null;
      return { ok: true };
    },
    salvar_item_tarefa: ({ p_tarefa, p }) => {
      const t = achar(p_tarefa);
      const x = p as { id: string; texto?: string; feito?: boolean; remover?: boolean };
      const i = itens.findIndex((it) => it.id === x.id);
      if (x.remover) { if (i >= 0) itens.splice(i, 1); return { ok: true }; }
      if (i >= 0) Object.assign(itens[i]!, { ...(x.texto ? { texto: x.texto } : {}), ...(x.feito !== undefined ? { feito: x.feito, feito_por: x.feito ? eu : null } : {}) });
      else itens.push({ id: x.id, tarefa_id: t.id, ordem: itens.filter((it) => it.tarefa_id === t.id).length, texto: texto(x.texto, 1, 200, 'texto'), feito: !!x.feito, feito_por: null, feito_em: null });
      return { ok: true, id: x.id };
    },
    comentar_tarefa: ({ p_tarefa, p_id, p_texto }) => {
      achar(p_tarefa);
      if (!comentarios.some((c) => c.id === p_id)) comentarios.push({ id: String(p_id), tarefa_id: String(p_tarefa), autor: eu, texto: texto(p_texto, 1, 2000, 'texto'), criado_em: agora() });
      return { ok: true };
    },
    salvar_tarefa_recorrente: ({ p }) => {
      const x = p as TarefaRecorrente;
      texto(x.titulo, 2, 160, 'titulo');
      const i = recorrentes.findIndex((r) => r.id === x.id);
      const r: TarefaRecorrente = { ...x, descricao: x.descricao ?? null, fim: x.fim ?? null, lembrete_dias: x.lembrete_dias ?? 1, ativa: x.ativa ?? true };
      if (i >= 0) recorrentes[i] = r; else recorrentes.push(r);
      return { ok: true, id: x.id };
    },
    gerar_tarefas_recorrentes: () => ({ ok: true, criadas: 0 }),
    salvar_modelo_tarefas: ({ p }) => {
      const x = p as ModeloTarefas;
      texto(x.nome, 2, 80, 'nome');
      if (!x.itens?.length) falhar('invalido', 'itens');
      const i = modelos.findIndex((m) => m.id === x.id);
      if (i >= 0) modelos[i] = { ...x, ativo: x.ativo ?? true }; else modelos.push({ ...x, tipo_evento_id: x.tipo_evento_id ?? null, ativo: true });
      return { ok: true, id: x.id };
    },
    importar_modelo_viagem: () => {
      if (modelos.some((m) => m.nome === 'Viagem para competição')) return { ok: true, criados: 0 };
      modelos.push({ id: uuid(), nome: 'Viagem para competição', tipo_evento_id: tipo('Viagem'), ativo: true, itens: [
        ['Inscrição na competição', 45], ['Confirmação dos atletas', 30], ['Transporte acessível', 30], ['Hospedagem acessível', 30],
        ['Alimentação', 15], ['Adiantamento de despesas', 10], ['Autorizações de menores', 10], ['Checagem das cadeiras de jogo', 7],
        ['Acerto de contas da viagem', 0], ['Relatório com fotos', 0]].map(([titulo, dias_antes]) => ({ titulo: String(titulo), dias_antes: Number(dias_antes) })) });
      return { ok: true, criados: 1 };
    },
    aplicar_modelo: ({ p_modelo, p_evento, p_responsaveis }) => {
      const m = modelos.find((x) => x.id === p_modelo) ?? falhar('invalido', 'modelo');
      const e = eventos.find((x) => x.id === p_evento && !x.cancelado_em) ?? falhar('invalido', 'evento');
      const resp = (p_responsaveis ?? {}) as Record<string, string>;
      let criadas = 0;
      m.itens.forEach((it, i) => {
        if (tarefas.some((t) => t.evento_id === e.id && t.modelo_id === m.id && t.titulo === it.titulo)) return;
        const prazo = somarDias(hojeSP(new Date(e.inicio)), -it.dias_antes);
        tarefa(it.titulo, resp[String(i)] ?? eu, prazo < hoje ? hoje : prazo, { evento_id: e.id, modelo_id: m.id });
        criadas++;
      });
      return { ok: true, criadas };
    },
    publicar_aviso: ({ p }) => {
      const x = p as Aviso;
      if (avisos.some((a) => a.id === x.id)) return { ok: true, id: x.id, repetido: true };
      avisos.unshift({ id: x.id, titulo: texto(x.titulo, 2, 120, 'titulo'), texto: texto(x.texto, 1, 4000, 'texto'), autor: eu, publicado_em: agora(), expira_em: x.expira_em ?? null, arquivado_em: null });
      leituras.push({ aviso_id: x.id, membro_id: eu, lido_em: agora() });
      return { ok: true, id: x.id };
    },
    arquivar_aviso: ({ p_id }) => { const a = avisos.find((x) => x.id === p_id) ?? falhar('nao_encontrado'); a.arquivado_em ??= agora(); return { ok: true }; },
    marcar_aviso_lido: ({ p_id }) => {
      if (!leituras.some((l) => l.aviso_id === p_id && l.membro_id === eu)) leituras.push({ aviso_id: String(p_id), membro_id: eu, lido_em: agora() });
      return { ok: true };
    },
    resumo_organizacao: (): ResumoOrganizacao & { ok: true } => ({
      ok: true,
      minhas_tarefas: tarefas.filter((t) => t.responsavel === eu && ['a_fazer', 'fazendo'].includes(t.situacao))
        .sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999')).slice(0, 8)
        .map((t) => ({ id: t.id, titulo: t.titulo, prazo: t.prazo, situacao: t.situacao, prioridade: t.prioridade, atrasada: t.prazo ? t.prazo < hoje : null })),
      tarefas_atrasadas: tarefas.filter((t) => t.responsavel === eu && ['a_fazer', 'fazendo'].includes(t.situacao) && t.prazo && t.prazo < hoje).length,
      proximos_eventos: eventos.filter((e) => !e.cancelado_em && e.fim >= agora() && hojeSP(new Date(e.inicio)) < d(15))
        .sort((a, b) => a.inicio.localeCompare(b.inicio)).slice(0, 5)
        .map((e) => ({ id: e.id, titulo: e.titulo, inicio: e.inicio, dia_inteiro: e.dia_inteiro, tipo_id: e.tipo_id, local: e.local })),
      avisos_nao_lidos: avisos.filter((a) => !a.arquivado_em && !leituras.some((l) => l.aviso_id === a.id && l.membro_id === eu)).length,
    }),
    salvar_preferencias_email: ({ p }) => { prefs = { ...(p as PreferenciasEmail) }; return { ok: true }; },
  };

  return {
    rpc,
    leituras: {
      tiposEvento: async () => [...tipos],
      tarefas: async () => tarefas.map(comItens),
      tarefa: async (id: string) => { const t = tarefas.find((x) => x.id === id); return t ? comItens(t) : null; },
      itensTarefa: async (id: string) => itens.filter((i) => i.tarefa_id === id).sort((a, b) => a.ordem - b.ordem),
      comentariosTarefa: async (id: string) => comentarios.filter((c) => c.tarefa_id === id),
      tarefasRecorrentes: async () => [...recorrentes],
      modelosTarefas: async () => [...modelos],
      avisos: async () => avisos.map((a) => ({ ...a, lido: leituras.some((l) => l.aviso_id === a.id && l.membro_id === eu) })),
      leiturasAviso: async (id: string) => leituras.filter((l) => l.aviso_id === id),
      preferenciasEmail: async () => ({ ...prefs }),
    },
  };
}
