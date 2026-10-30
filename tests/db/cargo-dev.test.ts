import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, dev: string, dir: string;
const totalPermissoes = () => db.valor<number>('select cardinality(private.modulos()) * cardinality(private.acoes())');
const doMembro = (id: string) => db.valor<number>('select count(*)::int from public.permissoes where membro_id = $1', 'postgres', [id]);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  dev = await convidarMembro(db, pres, { email: 'dev@exemplo.test', nome: 'Dev', cargo: 'dev' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
});
afterAll(async () => { await db?.destruir(); });

describe('cargo dev', () => {
  test('modelo do dev tem tudo, inclusive saúde; o do presidente continua sem saúde', async () => {
    const m = (await db.rpc('modelo_permissoes', { p_cargo: 'dev' }, sessao(pres))).permissoes as { modulo: string }[];
    expect(m.length).toBe(await totalPermissoes());
    expect(m.some((p) => p.modulo === 'saude')).toBe(true);
    const p = (await db.rpc('modelo_permissoes', { p_cargo: 'presidente' }, sessao(pres))).permissoes as { modulo: string }[];
    expect(p.some((x) => x.modulo === 'saude')).toBe(false);
  });

  test('dev convidado é administrador e recebe todas as permissões', async () => {
    expect(await doMembro(dev)).toBe(await totalPermissoes());
    const perfil = await db.rpc('meu_perfil', {}, sessao(dev));
    expect(perfil.membro.admin).toBe(true);
    expect(perfil.membro.cargo).toBe('dev');
  });

  test('dev administra acessos; diretor continua sem poder', async () => {
    expect((await db.rpc('modelo_permissoes', { p_cargo: 'dev' }, sessao(dev))).ok).toBe(true);
    expect((await db.rpc('modelo_permissoes', { p_cargo: 'dev' }, sessao(dir))).erro).toBe('sem_permissao');
  });

  test('dev sem a segunda etapa do login (aal1) não entra (2FA continua obrigatório)', async () => {
    expect((await db.rpc('meu_perfil', {}, sessao(dev, { aal: 'aal1' }))).erro).toBe('precisa_2fa');
  });

  test('a troca de cargo colada no SQL Editor deixa o presidente como dev, com tudo', async () => {
    // exatamente o que o desenvolvedor cola (docs/deploy.md, 7m)
    await db.linhas(`update public.membros set cargo = 'dev' where email = 'presidente@exemplo.test'`, 'postgres');
    await db.linhas(`select private.gravar_permissoes(id, private.permissoes_modelo('dev')) from public.membros where email = 'presidente@exemplo.test'`, 'postgres');
    expect(await doMembro(pres)).toBe(await totalPermissoes());
    expect((await db.rpc('meu_perfil', {}, sessao(pres))).membro.admin).toBe(true);
    expect((await db.rpc('modelo_permissoes', { p_cargo: 'superadmin' }, sessao(pres))).campo).toBe('cargo');
  });

  test('modelo cadastrado em Acessos para o dev vale no lugar do padrão', async () => {
    const r = await db.rpc('salvar_modelo_permissao', { p: { id: crypto.randomUUID(), nome: 'Dev enxuto', cargo: 'dev',
      permissoes: [{ modulo: 'agenda', acao: 'ver', alcance: 'tudo' }] } }, sessao(pres));
    expect(r.ok).toBe(true);
    expect((await db.rpc('modelo_permissoes', { p_cargo: 'dev' }, sessao(pres))).permissoes).toHaveLength(1);
  });
});
