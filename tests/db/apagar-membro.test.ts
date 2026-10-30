import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, criarUsuario, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, sec: string, dir: string;
const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const conta = (sql: string, id: string) => db.valor<number>(sql, 'postgres', [id]);
const membro = (id: string) => conta('select count(*)::int from public.membros where id = $1', id);
const login = (id: string) => conta('select count(*)::int from auth.users where id = $1', id);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Sec', cargo: 'secretario' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Dir', cargo: 'diretor' });
});
afterAll(async () => { await db?.destruir(); });

test('acesso sem histórico: some o membro, as permissões, o convite usado e o login; fica na auditoria', async () => {
  const t = await convidarMembro(db, pres, { email: 'teste@exemplo.test', nome: 'Teste', cargo: 'conselho_fiscal' });
  await db.linhas(`insert into public.notificacoes (membro_id, texto) values ($1, 'oi')`, 'postgres', [t]);
  expect((await rpc('apagar_membro', { p_membro: t }, pres)).ok).toBe(true);
  expect(await membro(t)).toBe(0);
  expect(await login(t)).toBe(0);
  expect(await conta('select count(*)::int from public.permissoes where membro_id = $1', t)).toBe(0);
  expect(await db.valor<number>(`select count(*)::int from public.convites where email = 'teste@exemplo.test'`, 'postgres')).toBe(0);
  expect(await db.valor<number>(`select count(*)::int from public.auditoria where tabela = 'membros' and acao = 'remover' and registro_id = $1`, 'postgres', [t])).toBe(1);
  // dá para convidar o mesmo e-mail de novo
  const perms = (await rpc('modelo_permissoes', { p_cargo: 'diretor' }, pres)).permissoes;
  expect((await rpc('registrar_convite', { p_email: 'teste@exemplo.test', p_nome: 'Teste', p_cargo: 'diretor', p_permissoes: perms }, pres)).ok).toBe(true);
});

test('com histórico: nada é apagado (nem o login) e a resposta orienta a desligar', async () => {
  const h = await convidarMembro(db, pres, { email: 'hist@exemplo.test', nome: 'Hist', cargo: 'secretario' });
  expect((await rpc('salvar_pessoa', { p: { id: randomUUID(), nome: 'Pessoa Fictícia', atleta: false, associado: true } }, h)).ok).toBe(true);
  const permsAntes = await conta('select count(*)::int from public.permissoes where membro_id = $1', h);
  expect((await rpc('apagar_membro', { p_membro: h }, pres)).erro).toBe('tem_historico');
  expect(await membro(h)).toBe(1);
  expect(await login(h)).toBe(1);
  expect(await conta('select count(*)::int from public.permissoes where membro_id = $1', h)).toBe(permsAntes);
  expect(await conta(`select count(*)::int from public.convites where usado_por = $1`, h)).toBe(1);
});

test('negado: o próprio acesso, quem não é administrador, inexistente, sem login e direto na tabela', async () => {
  expect((await rpc('apagar_membro', { p_membro: pres }, pres)).erro).toBe('proprio_acesso');
  expect((await rpc('apagar_membro', { p_membro: sec }, dir)).erro).toBe('sem_permissao');
  expect((await rpc('apagar_membro', { p_membro: randomUUID() }, pres)).erro).toBe('nao_encontrado');
  expect((await rpc('apagar_membro', { p_membro: null }, pres)).erro).toBe('invalido');
  expect(await db.falha('select public.apagar_membro($1)', 'anon', [dir])).toMatch(/permission denied/);
  expect(await db.falha('delete from public.membros where id = $1', sessao(pres), [dir])).toMatch(/permission denied|row-level/);
  expect(await db.falha('delete from auth.users where id = $1', sessao(pres), [dir])).toMatch(/permission denied/);
  expect(await membro(dir)).toBe(1);
});

test('sem 2FA (aal1) não apaga', async () => {
  expect((await db.rpc('apagar_membro', { p_membro: dir }, sessao(pres, { aal: 'aal1' }))).ok).not.toBe(true);
  expect(await membro(dir)).toBe(1);
});

test('mantém o mínimo de dois administradores', async () => {
  const b = await novoBanco();
  try {
    const p = await primeiroAdmin(b);
    const v = await convidarMembro(b, p, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
    expect((await b.rpc('apagar_membro', { p_membro: v }, sessao(p))).erro).toBe('minimo_admins');
    expect(await b.valor<number>('select count(*)::int from public.membros where id = $1', 'postgres', [v])).toBe(1);
    // com um terceiro administrador, apagar o vice (sem histórico) passa
    await convidarMembro(b, p, { email: 'sec2@exemplo.test', nome: 'Sec Dois', cargo: 'secretario' });
    expect((await b.rpc('apagar_membro', { p_membro: v }, sessao(p))).ok).toBe(true);
  } finally { await b.destruir(); }
});

test('login sem cadastro de membro não chega a apagar ninguém', async () => {
  const solto = await criarUsuario(db, 'solto@exemplo.test');
  expect((await rpc('apagar_membro', { p_membro: solto }, pres)).erro).toBe('nao_encontrado');
  expect(await login(solto)).toBe(1);
});
