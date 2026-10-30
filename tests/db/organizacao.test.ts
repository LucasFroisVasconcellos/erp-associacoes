import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, tes: string, dir: string, dirProprios: string, semAgenda: string;
let tipoTreino: string, tipoViagem: string, hoje: string;

const rpc = (nome: string, args: Record<string, unknown>, quem: string, opc?: Parameters<typeof sessao>[1]) =>
  db.rpc(nome, args, sessao(quem, opc));
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);
const conta = (sql: string, params?: unknown[]) => db.valor<number>(`select count(*)::int from (${sql}) t`, 'postgres', params);
const zerarLimites = () => db.linhas('delete from private.limites');

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  dirProprios = await convidarMembro(db, pres, { email: 'proprios@exemplo.test', nome: 'Diretora Própria', cargo: 'diretor', permissoes: [
    { modulo: 'tarefas', acao: 'ver', alcance: 'proprios' }, { modulo: 'tarefas', acao: 'criar', alcance: 'tudo' },
    { modulo: 'agenda', acao: 'ver', alcance: 'tudo' }, { modulo: 'avisos', acao: 'ver', alcance: 'tudo' }] });
  semAgenda = await convidarMembro(db, pres, { email: 'sem@exemplo.test', nome: 'Sem Agenda', cargo: 'diretor', permissoes: [
    { modulo: 'financeiro', acao: 'ver', alcance: 'tudo' }] });
  hoje = await data('private.hoje()');
});
afterAll(async () => { await db?.destruir(); });

describe('tipos de evento', () => {
  test('nada vem pronto; a lista do Dossiê só entra quando a diretoria pede, e não duplica', async () => {
    expect(await conta('select * from public.tipos_evento')).toBe(0);
    expect((await rpc('importar_tipos_evento', {}, semAgenda)).erro).toBe('sem_permissao');
    expect((await rpc('importar_tipos_evento', {}, dir)).criados).toBe(9);
    expect((await rpc('importar_tipos_evento', {}, dir)).criados).toBe(0);
    tipoTreino = await db.valor(`select id from public.tipos_evento where nome = 'Treino'`);
    tipoViagem = await db.valor(`select id from public.tipos_evento where nome = 'Viagem'`);
  });

  test('tipo novo: cor e ícone só da lista fechada; nome único sem diferenciar maiúsculas', async () => {
    const p = { id: randomUUID(), nome: 'Fisioterapia coletiva', cor: 'verde', icone: 'outro' };
    expect((await rpc('salvar_tipo_evento', { p: { ...p, cor: 'javascript:alert(1)' } }, dir)).campo).toBe('cor');
    expect((await rpc('salvar_tipo_evento', { p: { ...p, icone: '<svg>' } }, dir)).campo).toBe('icone');
    expect((await rpc('salvar_tipo_evento', { p: { ...p, criado_por: pres } }, dir)).erro).toBe('invalido');
    expect((await rpc('salvar_tipo_evento', { p }, dir)).ok).toBe(true);
    expect((await rpc('salvar_tipo_evento', { p: { ...p, id: randomUUID(), nome: 'FISIOTERAPIA COLETIVA' } }, dir)).erro).toBe('duplicado');
  });
});

describe('eventos', () => {
  let ev: string;
  const evento = (extra: Record<string, unknown> = {}) => ({
    id: randomUUID(), tipo_id: tipoTreino, titulo: 'Treino de quinta', inicio: `${hoje}T19:30:00-03:00`, fim: `${hoje}T21:30:00-03:00`, ...extra,
  });

  test('cria com participantes; repetir o mesmo id edita, sem duplicar', async () => {
    const p = evento({ participantes: [dir, tes] });
    ev = p.id;
    expect((await rpc('salvar_evento', { p }, dir)).ok).toBe(true);
    expect((await rpc('salvar_evento', { p: { ...p, titulo: 'Treino de quinta (quadra 2)' } }, dir)).ok).toBe(true);
    expect(await conta('select * from public.eventos where id = $1', [ev])).toBe(1);
    expect(await conta('select * from public.evento_participantes where evento_id = $1', [ev])).toBe(2);
  });

  test('sem agenda/criar não cria; sem agenda/ver não lê nada', async () => {
    expect((await rpc('salvar_evento', { p: evento() }, semAgenda)).erro).toBe('sem_permissao');
    expect(await db.valor<number>('select count(*)::int from public.eventos', sessao(semAgenda))).toBe(0);
    expect((await rpc('agenda_periodo', { p_inicio: hoje, p_fim: hoje }, semAgenda)).erro).toBe('sem_permissao');
  });

  test('sem 2FA: nem lê, nem grava', async () => {
    expect(await db.valor<number>('select count(*)::int from public.eventos', sessao(dir, { aal: 'aal1' }))).toBe(0);
    expect((await rpc('salvar_evento', { p: evento() }, dir, { aal: 'aal1' })).erro).toBe('precisa_2fa');
  });

  test('quem só cria não edita evento de outra pessoa', async () => {
    const p = evento();
    expect((await rpc('salvar_evento', { p }, pres)).ok).toBe(true);
    expect((await rpc('salvar_evento', { p: { ...p, titulo: 'Tomado' } }, dirProprios)).erro).toBe('sem_permissao');
  });

  test('datas: fuso obrigatório, fim depois do início, dia inteiro guardado como meia-noite local', async () => {
    expect((await rpc('salvar_evento', { p: evento({ inicio: `${hoje}T19:30:00` }) }, dir)).campo).toBe('inicio'); // sem fuso
    expect((await rpc('salvar_evento', { p: evento({ fim: `${hoje}T10:00:00-03:00` }) }, dir)).campo).toBe('fim');
    expect((await rpc('salvar_evento', { p: evento({ inicio: '2019-01-01T10:00:00Z', fim: '2019-01-01T11:00:00Z' }) }, dir)).campo).toBe('inicio');
    const dia = evento({ dia_inteiro: true, inicio: hoje, fim: hoje });
    expect((await rpc('salvar_evento', { p: dia }, dir)).ok).toBe(true);
    expect(await db.valor<string>(`select to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') from public.eventos where id = $1`, 'postgres', [dia.id])).toBe('00:00');
  });

  test('participante precisa ser membro ativo', async () => {
    expect((await rpc('salvar_evento', { p: evento({ participantes: [randomUUID()] }) }, dir)).campo).toBe('participantes');
    expect((await rpc('salvar_evento', { p: evento({ participantes: ['x'] }) }, dir)).campo).toBe('participantes');
  });

  test('evento não se apaga: é cancelado com motivo; cancelado não é editado', async () => {
    expect((await rpc('cancelar_evento', { p_id: ev, p_motivo: '' }, dir)).campo).toBe('motivo');
    expect((await rpc('cancelar_evento', { p_id: ev, p_motivo: 'Quadra interditada' }, dir)).ok).toBe(true);
    expect((await rpc('cancelar_evento', { p_id: ev, p_motivo: 'De novo' }, dir)).repetido).toBe(true);
    expect((await rpc('salvar_evento', { p: evento({ id: ev }) }, dir)).erro).toBe('cancelado');
    expect(await db.falha('delete from public.eventos where id = $1', 'postgres', [ev])).toMatch(/não se apaga/);
  });

  test('agenda do período: eventos + prazos; o financeiro só aparece para quem vê o financeiro', async () => {
    const cat = randomUUID(), conta = randomUUID();
    await rpc('salvar_categoria', { p: { id: cat, nome: 'Aluguel', tipo: 'saida' } }, tes);
    await rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, tes);
    const amanha = await data('private.hoje() + 1');
    expect((await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'saida', situacao: 'prevista', valor: '300.00', data: amanha,
      descricao: 'Aluguel da quadra', categoria_id: cat } }, tes)).ok).toBe(true);
    const a = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: amanha }, tes);
    expect(a.ok).toBe(true);
    expect(a.eventos.length).toBeGreaterThan(0);
    expect(a.prazos.some((x: { tipo: string }) => x.tipo === 'a_pagar')).toBe(true);
    // diretora sem financeiro: vê a agenda, mas nenhum prazo de dinheiro
    const b = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: amanha }, dirProprios);
    expect(b.prazos.some((x: { tipo: string }) => ['a_pagar', 'a_receber', 'fechamento'].includes(x.tipo))).toBe(false);
    expect((await rpc('agenda_periodo', { p_inicio: hoje, p_fim: await data('private.hoje() + 200') }, tes)).campo).toBe('periodo');
  });
});

describe('tarefas', () => {
  let t: string;
  const tarefa = (extra: Record<string, unknown> = {}) => ({ id: randomUUID(), titulo: 'Conferir extrato', prazo: hoje, ...extra });

  test('cria com checklist; sem responsável fica com quem criou; repetir o id não duplica', async () => {
    const p = tarefa({ itens: ['Baixar OFX', 'Conferir saldo'] });
    t = p.id;
    expect((await rpc('criar_tarefa', { p }, dir)).ok).toBe(true);
    expect((await rpc('criar_tarefa', { p }, dir)).repetido).toBe(true);
    expect((await rpc('criar_tarefa', { p }, tes)).erro).toBe('conflito');
    expect(await db.valor('select responsavel from public.tarefas where id = $1', 'postgres', [t])).toBe(dir);
    expect(await conta('select * from public.tarefa_itens where tarefa_id = $1', [t])).toBe(2);
  });

  test('passar para outra pessoa avisa a pessoa (notificação)', async () => {
    const p = tarefa({ responsavel: tes, titulo: 'Enviar fechamento ao contador' });
    expect((await rpc('criar_tarefa', { p }, dir)).ok).toBe(true);
    expect(await conta(`select * from public.notificacoes where membro_id = $1 and texto like 'Nova tarefa%'`, [tes])).toBeGreaterThan(0);
  });

  test('todos veem todas (decisão 2); alcance "próprios" vê só as suas', async () => {
    expect(await db.valor<number>('select count(*)::int from public.tarefas where id = $1', sessao(tes), [t])).toBe(1);
    expect(await db.valor<number>('select count(*)::int from public.tarefas where id = $1', sessao(dirProprios), [t])).toBe(0);
    // IDOR: nem pela RPC, nem pelos itens e comentários
    expect((await rpc('mudar_situacao_tarefa', { p_id: t, p_situacao: 'feito' }, dirProprios)).erro).toBe('nao_encontrado');
    expect((await rpc('comentar_tarefa', { p_tarefa: t, p_id: randomUUID(), p_texto: 'oi' }, dirProprios)).erro).toBe('nao_encontrado');
    expect(await db.valor<number>('select count(*)::int from public.tarefa_itens where tarefa_id = $1', sessao(dirProprios), [t])).toBe(0);
  });

  test('responsável anda a tarefa; quem não é responsável nem editor não anda', async () => {
    const p = tarefa({ responsavel: dirProprios, titulo: 'Tarefa dela' });
    expect((await rpc('criar_tarefa', { p }, pres)).ok).toBe(true);
    expect((await rpc('mudar_situacao_tarefa', { p_id: p.id, p_situacao: 'fazendo' }, dirProprios)).ok).toBe(true);
    // responsável sem tarefas/editar não muda título nem cancela
    expect((await rpc('editar_tarefa', { p_id: p.id, p: { titulo: 'Outro' } }, dirProprios)).erro).toBe('sem_permissao');
    expect((await rpc('mudar_situacao_tarefa', { p_id: p.id, p_situacao: 'cancelada' }, dirProprios)).erro).toBe('sem_permissao');
    // ninguém sem tarefas/ver
    expect((await rpc('mudar_situacao_tarefa', { p_id: p.id, p_situacao: 'feito' }, semAgenda)).erro).toBe('sem_permissao');
  });

  test('situação: só valores válidos; "feito" marca a data; reabrir limpa a data', async () => {
    expect((await rpc('mudar_situacao_tarefa', { p_id: t, p_situacao: 'concluida' }, dir)).campo).toBe('situacao');
    expect((await rpc('mudar_situacao_tarefa', { p_id: t, p_situacao: 'feito' }, dir)).ok).toBe(true);
    expect(await db.valor('select concluida_em is not null from public.tarefas where id = $1', 'postgres', [t])).toBe(true);
    expect((await rpc('mudar_situacao_tarefa', { p_id: t, p_situacao: 'feito' }, dir)).repetido).toBe(true);
    expect((await rpc('mudar_situacao_tarefa', { p_id: t, p_situacao: 'a_fazer' }, dir)).ok).toBe(true);
    expect(await db.valor('select concluida_em is null from public.tarefas where id = $1', 'postgres', [t])).toBe(true);
  });

  test('editar: campos extras recusados; responsável precisa ser membro ativo', async () => {
    expect((await rpc('editar_tarefa', { p_id: t, p: { criado_por: tes } }, dir)).erro).toBe('invalido');
    expect((await rpc('editar_tarefa', { p_id: t, p: { responsavel: randomUUID() } }, dir)).campo).toBe('responsavel');
    expect((await rpc('editar_tarefa', { p_id: t, p: { prioridade: 'urgente' } }, dir)).campo).toBe('prioridade');
    expect((await rpc('editar_tarefa', { p_id: t, p: { prioridade: 'alta', lembrete_dias: 3 } }, dir)).ok).toBe(true);
  });

  test('checklist: marcar, incluir, remover; item de outra tarefa não é mexido por aqui', async () => {
    const item = await db.valor<string>('select id from public.tarefa_itens where tarefa_id = $1 order by ordem limit 1', 'postgres', [t]);
    expect((await rpc('salvar_item_tarefa', { p_tarefa: t, p: { id: item, feito: true } }, dir)).ok).toBe(true);
    expect(await db.valor('select feito_por from public.tarefa_itens where id = $1', 'postgres', [item])).toBe(dir);
    const novo = randomUUID();
    expect((await rpc('salvar_item_tarefa', { p_tarefa: t, p: { id: novo, texto: 'Arquivar extrato' } }, dir)).ok).toBe(true);
    expect((await rpc('salvar_item_tarefa', { p_tarefa: t, p: { id: novo, remover: true } }, dir)).ok).toBe(true);
    const outra = tarefa({ itens: ['Item da outra'] });
    await rpc('criar_tarefa', { p: outra }, dir);
    const itemOutra = await db.valor<string>('select id from public.tarefa_itens where tarefa_id = $1', 'postgres', [outra.id]);
    expect((await rpc('salvar_item_tarefa', { p_tarefa: t, p: { id: itemOutra, remover: true } }, dir)).erro).toBe('conflito');
  });

  test('comentário: texto puro, idempotente, não se edita nem se apaga', async () => {
    const id = randomUUID();
    expect((await rpc('comentar_tarefa', { p_tarefa: t, p_id: id, p_texto: 'Feito o download\nfalta conferir' }, tes)).ok).toBe(true);
    expect((await rpc('comentar_tarefa', { p_tarefa: t, p_id: id, p_texto: 'Feito o download' }, tes)).repetido).toBe(true);
    expect((await rpc('comentar_tarefa', { p_tarefa: t, p_id: randomUUID(), p_texto: 'a\u0007b' }, tes)).campo).toBe('texto');
    expect((await rpc('comentar_tarefa', { p_tarefa: t, p_id: randomUUID(), p_texto: 'x'.repeat(2001) }, tes)).campo).toBe('texto');
    expect(await db.falha(`update public.tarefa_comentarios set texto = 'mudado' where id = $1`, 'postgres', [id])).toMatch(/não se apaga/);
    expect(await db.falha('delete from public.tarefa_comentarios where id = $1', 'postgres', [id])).toMatch(/não se apaga/);
  });

  test('cliente não grava direto em nenhuma tabela nova', async () => {
    expect(await db.falha(`insert into public.tarefas (id, titulo, responsavel, criado_por) values (gen_random_uuid(), 'x', '${dir}', '${dir}')`, sessao(dir))).toMatch(/permission denied/);
    expect(await db.falha(`update public.tarefas set situacao = 'feito'`, sessao(dir))).toMatch(/permission denied/);
    expect(await db.falha(`insert into public.aviso_leituras (aviso_id, membro_id) values (gen_random_uuid(), '${dir}')`, sessao(dir))).toMatch(/permission denied/);
  });
});

describe('recorrentes e modelos', () => {
  test('recorrente mensal: gera as próximas e rodar de novo não duplica (inclusive em paralelo)', async () => {
    const p = { id: randomUUID(), titulo: 'Conferir extrato do mês', responsavel: tes, frequencia: 'mensal', dia: 5, inicio: hoje };
    expect((await rpc('salvar_tarefa_recorrente', { p: { ...p, dia: 31 } }, pres)).campo).toBe('dia');
    expect((await rpc('salvar_tarefa_recorrente', { p: { ...p, frequencia: 'diaria' } }, pres)).campo).toBe('frequencia');
    expect((await rpc('salvar_tarefa_recorrente', { p }, dirProprios)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_tarefa_recorrente', { p }, pres)).ok).toBe(true);
    const r = await Promise.all([1, 2, 3, 4].map(() => rpc('gerar_tarefas_recorrentes', {}, tes)));
    const total = r.reduce((s, x) => s + x.criadas, 0);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(await conta('select * from public.tarefas where recorrencia_id = $1', [p.id])).toBe(total);
    expect((await rpc('gerar_tarefas_recorrentes', {}, tes)).criadas).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from public.tarefas where recorrencia_id = $1 and extract(day from prazo) <> 5`, 'postgres', [p.id])).toBe(0);
  });

  test('recorrente semanal cai no dia da semana certo', async () => {
    const p = { id: randomUUID(), titulo: 'Conferir caixinha', responsavel: tes, frequencia: 'semanal', dia: 1, inicio: hoje };
    expect((await rpc('salvar_tarefa_recorrente', { p }, pres)).ok).toBe(true);
    await rpc('gerar_tarefas_recorrentes', {}, tes);
    expect(await db.valor<number>(`select count(*)::int from public.tarefas where recorrencia_id = $1 and extract(dow from prazo) <> 1`, 'postgres', [p.id])).toBe(0);
    expect(await conta('select * from public.tarefas where recorrencia_id = $1', [p.id])).toBeGreaterThanOrEqual(4);
  });

  test('a rotina diária só roda pelo dono do banco', async () => {
    expect(await db.falha('select private.rotina_organizacao()', sessao(pres))).toMatch(/permission denied/);
    expect(await db.valor('select private.rotina_organizacao()', 'postgres')).toMatchObject({ ok: true });
  });

  test('modelo "Viagem para competição": aplicar cria as tarefas uma vez só', async () => {
    expect((await rpc('importar_modelo_viagem', {}, pres)).criados).toBe(1);
    expect((await rpc('importar_modelo_viagem', {}, pres)).criados).toBe(0);
    const modelo = await db.valor<string>(`select id from public.modelos_tarefas where nome = 'Viagem para competição'`);
    const ev = { id: randomUUID(), tipo_id: tipoViagem, titulo: 'Campeonato Paulista em Campinas', dia_inteiro: true,
      inicio: await data('private.hoje() + 60'), fim: await data('private.hoje() + 62') };
    expect((await rpc('salvar_evento', { p: ev }, pres)).ok).toBe(true);
    expect((await rpc('aplicar_modelo', { p_modelo: modelo, p_evento: ev.id, p_responsaveis: { '0': dir, '99': dir } }, pres)).campo).toBe('responsaveis');
    expect((await rpc('aplicar_modelo', { p_modelo: modelo, p_evento: ev.id, p_responsaveis: { '0': randomUUID() } }, pres)).campo).toBe('responsaveis');
    const [a, b] = await Promise.all([
      rpc('aplicar_modelo', { p_modelo: modelo, p_evento: ev.id, p_responsaveis: { '0': dir } }, pres),
      rpc('aplicar_modelo', { p_modelo: modelo, p_evento: ev.id, p_responsaveis: { '0': dir } }, pres),
    ]);
    expect(a.criadas + b.criadas).toBe(10);
    expect(await conta('select * from public.tarefas where evento_id = $1', [ev.id])).toBe(10);
    expect(await db.valor('select responsavel from public.tarefas where evento_id = $1 and modelo_ordem = 0', 'postgres', [ev.id])).toBe(dir);
    // prazo = início − dias_antes (inscrição: 45 dias antes)
    expect(await db.valor<string>(`select to_char(prazo, 'YYYY-MM-DD') from public.tarefas where evento_id = $1 and modelo_ordem = 0`, 'postgres', [ev.id]))
      .toBe(await data('private.hoje() + 15'));
  });

  test('itens de modelo validados (sem campos extras, dias entre 0 e 365)', async () => {
    const p = { id: randomUUID(), nome: 'Reunião mensal', itens: [{ titulo: 'Pauta', dias_antes: 3 }] };
    expect((await rpc('salvar_modelo_tarefas', { p: { ...p, itens: [{ titulo: 'Pauta', dias_antes: -1 }] } }, pres)).campo).toBe('itens');
    expect((await rpc('salvar_modelo_tarefas', { p: { ...p, itens: [{ titulo: 'Pauta', dias_antes: 1, responsavel: dir }] } }, pres)).campo).toBe('itens');
    expect((await rpc('salvar_modelo_tarefas', { p: { ...p, itens: [] } }, pres)).campo).toBe('itens');
    expect((await rpc('salvar_modelo_tarefas', { p }, pres)).ok).toBe(true);
  });
});

describe('avisos', () => {
  let aviso: string;
  test('publicar exige avisos/criar; texto puro e validade razoável', async () => {
    const p = { id: randomUUID(), titulo: 'Reunião extraordinária', texto: 'Sábado, 10h, na sede.\nPauta: Paulista.' };
    aviso = p.id;
    expect((await rpc('publicar_aviso', { p }, semAgenda)).erro).toBe('sem_permissao');
    expect((await rpc('publicar_aviso', { p: { ...p, autor: pres } }, dir)).erro).toBe('invalido');
    expect((await rpc('publicar_aviso', { p: { ...p, expira_em: '2020-01-01' } }, dir)).campo).toBe('expira_em');
    expect((await rpc('publicar_aviso', { p }, dir)).ok).toBe(true);
    expect((await rpc('publicar_aviso', { p }, dir)).repetido).toBe(true);
  });

  test('confirmação de leitura: cada um vê a sua; o autor e os administradores veem todas', async () => {
    expect((await rpc('marcar_aviso_lido', { p_id: aviso }, tes)).ok).toBe(true);
    expect((await rpc('marcar_aviso_lido', { p_id: aviso }, tes)).ok).toBe(true); // idempotente
    expect((await rpc('marcar_aviso_lido', { p_id: aviso }, dirProprios)).ok).toBe(true);
    const leituras = (quem: string) => db.valor<number>('select count(*)::int from public.aviso_leituras where aviso_id = $1', sessao(quem), [aviso]);
    expect(await leituras(dirProprios)).toBe(1);   // só a própria
    expect(await leituras(dir)).toBe(3);           // autor: todas (ele mesmo + 2)
    expect(await leituras(pres)).toBe(3);          // administrador
    expect((await rpc('resumo_organizacao', {}, pres)).avisos_nao_lidos).toBe(1);
  });

  test('arquivar: autor ou administrador; ninguém apaga', async () => {
    expect((await rpc('arquivar_aviso', { p_id: aviso }, tes)).erro).toBe('sem_permissao');
    expect((await rpc('arquivar_aviso', { p_id: aviso }, dir)).ok).toBe(true);
    expect(await db.falha('delete from public.avisos where id = $1', 'postgres', [aviso])).toMatch(/não se apaga/);
  });
});

describe('Início e retenção', () => {
  test('resumo: minhas tarefas abertas e próximos eventos, sem dados de outros módulos', async () => {
    const r = await rpc('resumo_organizacao', {}, tes);
    expect(r.ok).toBe(true);
    expect(r.minhas_tarefas.length).toBeGreaterThan(0);
    expect(Array.isArray(r.proximos_eventos)).toBe(true);
    const s = await rpc('resumo_organizacao', {}, semAgenda);
    expect(s.minhas_tarefas).toEqual([]);
    expect(s.proximos_eventos).toEqual([]);
  });

  test('retenção: aviso arquivado há 2+ anos e tarefa concluída há 5+ anos saem; o resto fica', async () => {
    await zerarLimites();
    const antigo = randomUUID(), tarefaVelha = randomUUID(), tarefaAberta = randomUUID();
    await rpc('publicar_aviso', { p: { id: antigo, titulo: 'Aviso antigo', texto: 'texto' } }, dir);
    await rpc('marcar_aviso_lido', { p_id: antigo }, tes);
    await rpc('arquivar_aviso', { p_id: antigo }, dir);
    await rpc('criar_tarefa', { p: { id: tarefaVelha, titulo: 'Tarefa velha', itens: ['a'] } }, dir);
    await rpc('comentar_tarefa', { p_tarefa: tarefaVelha, p_id: randomUUID(), p_texto: 'comentário' }, dir);
    await rpc('mudar_situacao_tarefa', { p_id: tarefaVelha, p_situacao: 'feito' }, dir);
    await rpc('criar_tarefa', { p: { id: tarefaAberta, titulo: 'Tarefa aberta antiga' } }, dir);
    await db.linhas(`update public.avisos set arquivado_em = now() - interval '3 years' where id = $1`, 'postgres', [antigo]);
    await db.linhas(`update public.tarefas set atualizado_em = now() - interval '6 years' where id = any($1)`, 'postgres', [[tarefaVelha, tarefaAberta]]);
    const r = await db.valor('select private.aplicar_retencao()', 'postgres');
    expect(r).toMatchObject({ ok: true });
    expect(await conta('select * from public.avisos where id = $1', [antigo])).toBe(0);
    expect(await conta('select * from public.tarefas where id = $1', [tarefaVelha])).toBe(0);
    expect(await conta('select * from public.tarefas where id = $1', [tarefaAberta])).toBe(1);   // aberta não sai
    expect(await conta('select * from public.avisos where id <> $1', [antigo])).toBeGreaterThan(0);
    // fora da rotina, apagar continua proibido
    expect(await db.falha('delete from public.tarefas where id = $1', 'postgres', [tarefaAberta])).toMatch(/não se apaga/);
  });
});
