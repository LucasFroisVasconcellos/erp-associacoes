import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string;

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  const convite = (email: string, expira: string, extra = '') => db.linhas(
    `insert into public.convites (email, nome, cargo, criado_por, expira_em${extra ? ', ' + extra.split('=')[0] : ''})
     values ($1, 'Pessoa Fictícia', 'diretor', $2, now() - $3::interval${extra ? ', ' + extra.split('=')[1] : ''})`,
    'postgres', [email, pres, expira]);
  await convite('vencido@exemplo.test', '100 days');
  await convite('no-prazo@exemplo.test', '10 days');
  await convite('cancelado@exemplo.test', '1 day', 'cancelado_em=now() - interval \'95 days\'');
  await convite('aceito@exemplo.test', '400 days', `usado_em=now() - interval '400 days'`);
  await db.linhas(
    `insert into public.notificacoes (membro_id, texto, lida_em) values
       ($1, 'lida há muito tempo', now() - interval '200 days'),
       ($1, 'lida há pouco', now() - interval '10 days'),
       ($1, 'nunca lida', null)`, 'postgres', [pres]);
  await db.linhas(`insert into private.limites (chave, janela, contagem) values
    ('x:antigo', now() - interval '3 days', 1), ('x:atual', date_trunc('hour', now()), 1)`, 'postgres');
});
afterAll(async () => { await db?.destruir(); });

test('apaga o que venceu e mantém o que está no prazo', async () => {
  const auditoriaAntes = await db.valor<number>('select count(*)::int from public.auditoria', 'postgres');
  const r = await db.valor('select private.aplicar_retencao()', 'postgres');
  expect(r).toMatchObject({ ok: true, convites: 2, notificacoes: 1, limites: 1 });

  const emails = (await db.linhas('select email from public.convites order by email', 'postgres')).map((x) => x.email);
  expect(emails).toEqual(['aceito@exemplo.test', 'no-prazo@exemplo.test']);
  const textos = (await db.linhas('select texto from public.notificacoes order by texto', 'postgres')).map((x) => x.texto);
  expect(textos).toEqual(['lida há pouco', 'nunca lida']);
  expect(await db.valor<number>(`select count(*)::int from private.limites where chave = 'x:atual'`, 'postgres')).toBe(1);

  // auditoria nunca é apagada (só cresce)
  expect(await db.valor<number>('select count(*)::int from public.auditoria', 'postgres')).toBeGreaterThan(auditoriaAntes);
});

test('o registro da rotina guarda só contagens, sem e-mail nem nome', async () => {
  const linha = await db.valor(`select depois from public.auditoria where acao = 'retencao' order by id desc limit 1`, 'postgres');
  expect(Object.keys(linha).sort()).toEqual(['avisos', 'contatos', 'convites', 'limites', 'notificacoes', 'saude', 'tarefas']);
  expect(JSON.stringify(linha)).not.toMatch(/@|Fictícia/);
});

test('rodar de novo não apaga mais nada (idempotente)', async () => {
  expect(await db.valor('select private.aplicar_retencao()', 'postgres')).toMatchObject({ convites: 0, notificacoes: 0, limites: 0 });
});

test('cliente não consegue chamar a rotina', async () => {
  expect(await db.falha('select private.aplicar_retencao()', sessao(pres))).toMatch(/permission denied/);
  expect(await db.falha('select private.aplicar_retencao()', 'anon')).toMatch(/permission denied/);
  expect(await db.falha('select private.aplicar_retencao()', 'service')).toMatch(/permission denied/);
});
