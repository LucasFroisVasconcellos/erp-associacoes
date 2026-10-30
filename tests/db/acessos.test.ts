import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, criarUsuario, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, vice: string, tes: string, dir: string;

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  vice = await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
});
afterAll(async () => { await db?.destruir(); });

const conta = (sql: string, ctx?: Parameters<Banco['valor']>[1], params?: unknown[]) =>
  db.valor<number>(`select count(*)::int from (${sql}) t`, ctx, params);

describe('sessão', () => {
  test('sem sessão (anon) não lê membros nem chama RPCs', async () => {
    expect(await db.falha('select count(*) from public.membros', 'anon')).toMatch(/permission denied/);
    expect(await db.falha('select public.meu_perfil()', 'anon')).toMatch(/permission denied/);
  });

  test('sessão sem 2FA (aal1) não enxerga nada e recebe precisa_2fa', async () => {
    expect(await conta('select * from public.membros', sessao(pres, { aal: 'aal1' }))).toBe(0);
    expect((await db.rpc('meu_perfil', {}, sessao(pres, { aal: 'aal1' }))).erro).toBe('precisa_2fa');
  });

  test('usuário do Auth sem convite não é membro e não vê nada', async () => {
    const intruso = await criarUsuario(db, 'intruso@exemplo.test');
    expect(await conta('select * from public.membros', sessao(intruso))).toBe(0);
    expect((await db.rpc('meu_perfil', {}, sessao(intruso))).erro).toBe('sem_acesso');
  });

  test('meu_perfil devolve cargo, admin e permissões do modelo', async () => {
    const r = await db.rpc('meu_perfil', {}, sessao(tes));
    expect(r.ok).toBe(true);
    expect(r.membro.cargo).toBe('tesoureiro');
    expect(r.membro.admin).toBe(false);
    const fin = r.permissoes.filter((p: any) => p.modulo === 'financeiro').map((p: any) => p.acao).sort();
    expect(fin).toEqual(['administrar', 'aprovar', 'criar', 'editar', 'exportar', 'ver']);
    expect((await db.rpc('meu_perfil', {}, sessao(pres))).membro.admin).toBe(true);
  });

  test('nenhum modelo concede dados de saúde', async () => {
    for (const c of ['presidente', 'vice_presidente', 'secretario', 'tesoureiro', 'diretor']) {
      const m = await db.rpc('modelo_permissoes', { p_cargo: c }, sessao(pres));
      expect(m.permissoes.some((p: any) => p.modulo === 'saude'), c).toBe(false);
    }
  });
});

describe('convites', () => {
  test('não-admin não convida e a tentativa fica na auditoria', async () => {
    const r = await db.rpc('registrar_convite', { p_email: 'x@exemplo.test', p_nome: 'Fulano', p_cargo: 'diretor', p_permissoes: [] }, sessao(tes));
    expect(r.erro).toBe('sem_permissao');
    expect(await conta(`select * from public.auditoria where acao = 'acesso_negado' and membro_id = $1`, 'postgres', [tes])).toBeGreaterThanOrEqual(1);
  });

  test('convite com campos inválidos ou extras é rejeitado', async () => {
    const base = { p_email: 'novo@exemplo.test', p_nome: 'Fulano', p_cargo: 'diretor', p_permissoes: [] as unknown };
    const campo = async (over: Record<string, unknown>) => {
      const r = await db.rpc('registrar_convite', { ...base, ...over }, sessao(pres));
      expect(r.erro).toBe('invalido');
      return r.campo;
    };
    expect(await campo({ p_email: 'sem-arroba' })).toBe('email');
    expect(await campo({ p_nome: 'X' })).toBe('nome');
    expect(await campo({ p_nome: 'Nome\u0007' })).toBe('nome');
    expect(await campo({ p_cargo: 'rei' })).toBe('cargo');
    expect(await campo({ p_permissoes: [{ modulo: 'financeiro', acao: 'ver', alcance: 'tudo', extra: 1 }] })).toBe('permissoes');
    expect(await campo({ p_permissoes: [{ modulo: 'acessos', acao: 'administrar' }] })).toBe('permissoes');
    expect(await campo({ p_permissoes: { modulo: 'financeiro' } })).toBe('permissoes');
    expect(await campo({ p_permissoes: [{ modulo: 'financeiro', acao: 'ver', alcance: 'todos' }] })).toBe('permissoes');
  });

  test('convite para quem já é membro é recusado', async () => {
    const r = await db.rpc('registrar_convite', { p_email: 'TES@exemplo.test', p_nome: 'Tesoureira', p_cargo: 'diretor', p_permissoes: [] }, sessao(pres));
    expect(r.erro).toBe('ja_e_membro');
  });

  test('convite vencido não vira membro no primeiro login', async () => {
    expect((await db.rpc('registrar_convite', { p_email: 'atrasado@exemplo.test', p_nome: 'Atrasado', p_cargo: 'diretor', p_permissoes: [] }, sessao(pres))).ok).toBe(true);
    await db.linhas(`update public.convites set expira_em = now() - interval '1 minute' where email = 'atrasado@exemplo.test'`);
    const id = await criarUsuario(db, 'atrasado@exemplo.test');
    expect((await db.rpc('aceitar_convite', {}, sessao(id, { aal: 'aal1' }))).erro).toBe('convite_invalido');
    expect(await conta('select * from public.membros where id = $1', 'postgres', [id])).toBe(0);
  });

  test('convite só é aceito pela pessoa do e-mail convidado', async () => {
    expect((await db.rpc('registrar_convite', { p_email: 'certo@exemplo.test', p_nome: 'Certo', p_cargo: 'diretor', p_permissoes: [] }, sessao(pres))).ok).toBe(true);
    const outro = await criarUsuario(db, 'errado@exemplo.test');
    expect((await db.rpc('aceitar_convite', {}, sessao(outro, { aal: 'aal1' }))).erro).toBe('convite_invalido');
  });

  test('convite cancelado não pode ser aceito', async () => {
    const c = await db.rpc('registrar_convite', { p_email: 'cancelado@exemplo.test', p_nome: 'Cancelado', p_cargo: 'diretor', p_permissoes: [] }, sessao(pres));
    expect((await db.rpc('cancelar_convite', { p_convite: c.convite_id }, sessao(pres))).ok).toBe(true);
    const id = await criarUsuario(db, 'cancelado@exemplo.test');
    expect((await db.rpc('aceitar_convite', {}, sessao(id, { aal: 'aal1' }))).erro).toBe('convite_invalido');
  });

  test('dois aceites simultâneos do mesmo convite criam um único membro', async () => {
    expect((await db.rpc('registrar_convite', { p_email: 'duplo@exemplo.test', p_nome: 'Duplo', p_cargo: 'diretor', p_permissoes: [] }, sessao(pres))).ok).toBe(true);
    const id = await criarUsuario(db, 'duplo@exemplo.test');
    const rs = await Promise.all([1, 2, 3].map(() => db.rpc('aceitar_convite', {}, sessao(id, { aal: 'aal1' })).catch((e: Error) => ({ excecao: e.message }))));
    expect(rs.filter((r: any) => r.ok).length).toBeGreaterThanOrEqual(1);
    expect(await conta('select * from public.membros where id = $1', 'postgres', [id])).toBe(1);
  });
});

describe('gestão de acessos', () => {
  test('escrita direta nas tabelas é negada para usuários logados', async () => {
    expect(await db.falha(`update public.membros set cargo = 'presidente' where id = $1`, sessao(dir), [dir])).toMatch(/permission denied/);
    expect(await db.falha(`insert into public.permissoes (membro_id, modulo, acao) values ($1, 'financeiro', 'aprovar')`, sessao(dir), [dir])).toMatch(/permission denied/);
    expect(await db.falha('delete from public.auditoria', sessao(pres))).toMatch(/permission denied/);
  });

  test('ninguém altera as próprias permissões nem o próprio cargo', async () => {
    expect((await db.rpc('definir_permissoes', { p_membro: pres, p_permissoes: [{ modulo: 'saude', acao: 'ver' }] }, sessao(pres))).erro).toBe('proprio_acesso');
    expect((await db.rpc('alterar_membro', { p_membro: vice, p_cargo: 'presidente', p_ativo: true, p_acesso_expira_em: null }, sessao(vice))).erro).toBe('proprio_acesso');
  });

  test('o código vale no login (0031): sem reconfirmar; sessão autenticada há mais de 30 dias é recusada', async () => {
    const atuais = await db.valor<unknown[]>(`select coalesce(jsonb_agg(jsonb_build_object('modulo', modulo, 'acao', acao, 'alcance', alcance)), '[]') from public.permissoes where membro_id = $1`, 'postgres', [dir]);
    expect((await db.rpc('definir_permissoes', { p_membro: dir, p_permissoes: atuais }, sessao(pres, { totpHaSegundos: 3 * 86400, loginHaSegundos: 3 * 86400 }))).ok).toBe(true);
    expect((await db.rpc('meu_perfil', {}, sessao(pres, { totpHaSegundos: 29 * 86400, loginHaSegundos: 29 * 86400 }))).ok).toBe(true);
    expect((await db.rpc('meu_perfil', {}, sessao(pres, { totpHaSegundos: 31 * 86400, loginHaSegundos: 31 * 86400 }))).erro).toBe('sessao_expirada');
    expect(await db.valor<number>('select count(*)::int from public.lancamentos', sessao(pres, { totpHaSegundos: 31 * 86400, loginHaSegundos: 31 * 86400 }))).toBe(0); // RLS também fecha
  });

  test('admin define permissões de outro, com auditoria e aviso à pessoa', async () => {
    const r = await db.rpc('definir_permissoes', { p_membro: dir, p_permissoes: [
      { modulo: 'financeiro', acao: 'ver', alcance: 'proprios' },
      { modulo: 'financeiro', acao: 'criar', alcance: 'tudo' },
    ] }, sessao(vice));
    expect(r.ok).toBe(true);
    const perfil = await db.rpc('meu_perfil', {}, sessao(dir));
    expect(perfil.permissoes.filter((p: any) => p.modulo === 'financeiro').map((p: any) => `${p.acao}:${p.alcance}`).sort()).toEqual(['criar:tudo', 'ver:proprios']);
    expect(await conta('select * from public.notificacoes where membro_id = $1', sessao(dir), [dir])).toBeGreaterThanOrEqual(1);
    expect(await conta(`select * from public.auditoria where tabela = 'permissoes'`)).toBeGreaterThanOrEqual(1);
  });

  test('mínimo de 2 administradores ativos é mantido', async () => {
    expect((await db.rpc('alterar_membro', { p_membro: vice, p_cargo: 'diretor', p_ativo: true, p_acesso_expira_em: null }, sessao(pres))).erro).toBe('minimo_admins');
    expect((await db.rpc('alterar_membro', { p_membro: pres, p_cargo: 'presidente', p_ativo: false, p_acesso_expira_em: null }, sessao(vice))).erro).toBe('minimo_admins');
  });

  test('membro desativado ou com acesso vencido perde tudo', async () => {
    const temp = await convidarMembro(db, pres, { email: 'temp@exemplo.test', nome: 'Temp', cargo: 'diretor' });
    expect((await db.rpc('meu_perfil', {}, sessao(temp))).ok).toBe(true);
    const r = await db.rpc('alterar_membro', { p_membro: temp, p_cargo: 'diretor', p_ativo: true, p_acesso_expira_em: '2000-01-01T00:00:00Z' }, sessao(pres));
    expect(r.erro).toBe('invalido');
    await db.linhas(`update public.membros set acesso_expira_em = now() - interval '1 second' where id = $1`, 'postgres', [temp]);
    expect((await db.rpc('meu_perfil', {}, sessao(temp))).erro).toBe('sem_acesso');
    expect(await conta('select * from public.membros', sessao(temp))).toBe(0);
  });
});

describe('auditoria e funções privadas', () => {
  test('auditoria é imutável até para o dono do banco', async () => {
    expect(await db.falha(`update public.auditoria set acao = 'x'`)).toMatch(/imutável/);
    expect(await db.falha('delete from public.auditoria')).toMatch(/imutável/);
    expect(await db.falha('truncate public.auditoria')).toMatch(/imutável/);
  });

  test('só administradores leem a auditoria e os convites', async () => {
    expect(await conta('select * from public.auditoria', sessao(tes))).toBe(0);
    expect(await conta('select * from public.auditoria', sessao(pres))).toBeGreaterThan(0);
    expect(await conta('select * from public.convites', sessao(tes))).toBe(0);
  });

  test('funções privadas sensíveis não são chamáveis pelo cliente', async () => {
    expect(await db.falha(`select private.bootstrap_admin('a@b.test','A','presidente')`, sessao(pres))).toMatch(/permission denied/);
    expect(await db.falha(`select private.registrar('x', null, null, null, null)`, sessao(pres))).toMatch(/permission denied/);
    expect(await db.falha(`select private.gravar_permissoes($1, '[]')`, sessao(pres), [pres])).toMatch(/permission denied/);
  });

  test('bootstrap só funciona com o sistema vazio', async () => {
    await criarUsuario(db, 'outro@exemplo.test');
    expect(await db.falha(`select private.bootstrap_admin('outro@exemplo.test','Outro','presidente')`)).toMatch(/[Jj]á existem membros/);
  });
});

// Por último: depois deste teste não se sabe qual admin foi rebaixado.
describe('concorrência', () => {
  test('rebaixamentos simultâneos não furam o mínimo de administradores', async () => {
    const sec = await convidarMembro(db, pres, { email: 'sec2@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
    // 3 admins: pres, vice, sec. Cada um tenta rebaixar outro ao mesmo tempo.
    const tentar = (quem: string, alvo: string) =>
      db.rpc('alterar_membro', { p_membro: alvo, p_cargo: 'diretor', p_ativo: true, p_acesso_expira_em: null }, sessao(quem)).catch((e: Error) => ({ excecao: e.message }));
    await Promise.all([tentar(pres, vice), tentar(vice, sec), tentar(sec, pres)]);
    const admins = await conta(`select * from public.membros where ativo and cargo in ('presidente','vice_presidente','secretario')`);
    expect(admins).toBeGreaterThanOrEqual(2);
  });
});
