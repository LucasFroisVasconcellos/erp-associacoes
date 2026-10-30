import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, tes: string, dir: string, hoje: string, segunda: string;

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira Teste', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor Teste', cargo: 'diretor' });
  hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  segunda = await db.valor<string>(`select to_char(private.hoje() - (extract(isodow from private.hoje())::int - 1), 'YYYY-MM-DD')`);
  const em = (dias: number) => db.valor<string>(`select to_char(private.hoje() + ${dias}, 'YYYY-MM-DD')`);
  // tarefa da tesoureira: prazo daqui a 3 dias, lembrete 3 dias antes => lembrete hoje
  await db.rpc('criar_tarefa', { p: { id: randomUUID(), titulo: 'Enviar fechamento ao contador', responsavel: tes, prazo: await em(3), lembrete_dias: 3 } }, sessao(pres));
  // tarefa do diretor vencendo hoje
  await db.rpc('criar_tarefa', { p: { id: randomUUID(), titulo: 'Reservar a quadra', responsavel: dir, prazo: hoje } }, sessao(pres));
  // concluída: não lembra
  const feita = randomUUID();
  await db.rpc('criar_tarefa', { p: { id: feita, titulo: 'Já feita', responsavel: dir, prazo: hoje } }, sessao(pres));
  await db.rpc('mudar_situacao_tarefa', { p_id: feita, p_situacao: 'feito' }, sessao(dir));
});
afterAll(async () => { await db?.destruir(); });

const fila = () => db.linhas('select chave, membro_id, assunto, corpo from private.fila_emails order by chave');

test('lembretes: N dias antes e no dia, só de tarefa aberta; rodar de novo não duplica', async () => {
  const r = await db.valor('select private.preparar_emails()', 'postgres');
  expect(r.lembretes).toBe(2);
  const r2 = await db.valor('select private.preparar_emails()', 'postgres');
  expect(r2.lembretes).toBe(0);
  const linhas = (await fila()).filter((l) => String(l.chave).startsWith('lembrete:'));
  expect(linhas.map((l) => l.membro_id).sort()).toEqual([dir, tes].sort());
  expect(linhas.some((l) => String(l.assunto).startsWith('Tarefa para hoje: Reservar a quadra'))).toBe(true);
});

test('conteúdo mínimo: sem e-mail, sem valores, com o aviso de onde ver os detalhes', async () => {
  for (const l of await fila()) {
    expect(String(l.corpo)).not.toMatch(/@|R\$/);
    expect(String(l.assunto)).not.toMatch(/[\r\n]/);
  }
});

test('resumo semanal só na segunda, uma vez por pessoa, respeitando a preferência', async () => {
  expect((await db.rpc('salvar_preferencias_email', { p: { lembretes: true, resumo_semanal: false } }, sessao(dir))).ok).toBe(true);
  expect((await db.rpc('salvar_preferencias_email', { p: { lembretes: 'sim', resumo_semanal: false } }, sessao(dir))).campo).toBe('lembretes');
  expect((await db.rpc('salvar_preferencias_email', { p: { lembretes: true, resumo_semanal: true, membro_id: tes } }, sessao(dir))).erro).toBe('invalido');
  const terca = await db.valor<string>(`select to_char($1::date + 1, 'YYYY-MM-DD')`, 'postgres', [segunda]);
  expect((await db.valor(`select private.preparar_emails($1::date)`, 'postgres', [terca])).resumos).toBe(0);
  const r = await db.valor(`select private.preparar_emails($1::date)`, 'postgres', [segunda]);
  expect(r.resumos).toBe(3); // presidente, vice e tesoureira (o diretor desligou)
  expect((await db.valor(`select private.preparar_emails($1::date)`, 'postgres', [segunda])).resumos).toBe(0);
  const resumos = (await fila()).filter((l) => String(l.chave).startsWith('resumo:'));
  expect(resumos.some((l) => l.membro_id === dir)).toBe(false);
  const daTes = resumos.find((l) => l.membro_id === tes)!;
  expect(String(daTes.corpo)).toContain('Enviar fechamento ao contador');
  expect(String(daTes.corpo)).toContain('Olá, Tesoureira!');
});

test('desligar lembretes vale para os próximos', async () => {
  await db.rpc('salvar_preferencias_email', { p: { lembretes: false, resumo_semanal: false } }, sessao(tes));
  const amanha = await db.valor<string>(`select to_char(private.hoje() + 1, 'YYYY-MM-DD')`);
  await db.rpc('criar_tarefa', { p: { id: randomUUID(), titulo: 'Outra da tesoureira', responsavel: tes, prazo: amanha, lembrete_dias: 1 } }, sessao(pres));
  await db.linhas(`delete from private.fila_emails`);
  expect((await db.valor('select private.preparar_emails()', 'postgres')).lembretes).toBe(1); // só o do diretor
});

test('preferências: cada um lê só as suas', async () => {
  expect(await db.valor<number>('select count(*)::int from public.preferencias_email', sessao(dir))).toBe(1);
  expect(await db.valor<number>('select count(*)::int from public.preferencias_email', sessao(pres))).toBe(0);
});

test('envio: só a service role pega e marca; o navegador não', async () => {
  expect(await db.falha('select public.pegar_emails(10)', sessao(pres))).toMatch(/permission denied/);
  expect(await db.falha(`select public.marcar_email(gen_random_uuid(), true, null)`, sessao(pres))).toMatch(/permission denied/);
  expect(await db.falha('select public.pegar_emails(10)', 'anon')).toMatch(/permission denied/);
  expect(await db.falha('select count(*) from private.fila_emails', 'service')).toMatch(/permission denied/);
  expect((await db.valor('select public.pegar_emails(0)', 'service')).campo).toBe('lote');
});

test('duas execuções simultâneas nunca pegam o mesmo e-mail; marcar enviado é definitivo', async () => {
  await db.linhas(`delete from private.fila_emails`);
  for (let i = 0; i < 6; i++) {
    await db.linhas(`insert into private.fila_emails (chave, membro_id, assunto, corpo) values ($1, $2, 'Assunto', 'Corpo')`, 'postgres', [`teste:${i}`, dir]);
  }
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => db.valor('select public.pegar_emails(3)', 'service')));
  const ids = [...a.emails, ...b.emails, ...c.emails].map((e: { id: string }) => e.id);
  expect(ids.length).toBe(6);
  expect(new Set(ids).size).toBe(6);
  expect(a.emails[0]?.para ?? b.emails[0]?.para).toBe('dir@exemplo.test');
  // reservado: ninguém pega de novo antes de 10 minutos
  expect((await db.valor('select public.pegar_emails(50)', 'service')).emails).toEqual([]);
  expect((await db.valor('select public.marcar_email($1, true, null)', 'service', [ids[0]])).ok).toBe(true);
  expect((await db.valor('select public.marcar_email($1, true, null)', 'service', [ids[0]])).erro).toBe('nao_encontrado');
  // falha: a mensagem gravada é curta e limpa
  expect((await db.valor(`select public.marcar_email($1, false, $2)`, 'service', [ids[1], 'EAUTH <senha=xyz>\nlinha'])).ok).toBe(true);
  expect(await db.valor(`select erro from private.fila_emails where id = $1`, 'postgres', [ids[1]])).toBe('EAUTH senhaxyzlinha');
  // depois de 10 minutos volta para a fila; depois de 5 tentativas, desiste
  await db.linhas(`update private.fila_emails set pego_em = now() - interval '11 minutes' where id = $1`, 'postgres', [ids[1]]);
  expect((await db.valor('select public.pegar_emails(50)', 'service')).emails.map((e: { id: string }) => e.id)).toEqual([ids[1]]);
  await db.linhas(`update private.fila_emails set pego_em = now() - interval '11 minutes', tentativas = 5 where id = $1`, 'postgres', [ids[1]]);
  expect((await db.valor('select public.pegar_emails(50)', 'service')).emails).toEqual([]);
});

test('membro desativado não recebe', async () => {
  await db.linhas(`delete from private.fila_emails`);
  await db.linhas(`insert into private.fila_emails (chave, membro_id, assunto, corpo) values ('x:1', $1, 'A', 'B')`, 'postgres', [dir]);
  await db.linhas(`update public.membros set ativo = false where id = $1`, 'postgres', [dir]);
  expect((await db.valor('select public.pegar_emails(10)', 'service')).emails).toEqual([]);
  await db.linhas(`update public.membros set ativo = true where id = $1`, 'postgres', [dir]);
});

test('limpeza: enviados há mais de 30 dias saem', async () => {
  await db.linhas(`delete from private.fila_emails`);
  await db.linhas(`insert into private.fila_emails (chave, membro_id, assunto, corpo, enviado_em) values ('velho', $1, 'A', 'B', now() - interval '31 days')`, 'postgres', [dir]);
  await db.valor('select private.preparar_emails()', 'postgres');
  expect(await db.valor<number>(`select count(*)::int from private.fila_emails where chave = 'velho'`)).toBe(0);
});

// 0034: e-mails de aviso desligados: a rotina diária não monta mais a fila.
test('rotina diária não coloca e-mails na fila (desligados em 0034)', async () => {
  const antes = await db.valor<number>('select count(*)::int from private.fila_emails', 'postgres');
  const r = await db.valor<{ emails: string }>('select private.rotina_organizacao()', 'postgres');
  expect(r.emails).toBe('desligados');
  expect(await db.valor<number>('select count(*)::int from private.fila_emails', 'postgres')).toBe(antes);
});
