import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, sec: string, dir: string, semPessoas: string;
let hoje: string, tipo: string, treino: string, futuro: string, ana: string, bia: string, socio: string, projeto: string;
const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  semPessoas = await convidarMembro(db, pres, { email: 'sp@exemplo.test', nome: 'Sem Pessoas', cargo: 'diretor' });
  await db.linhas(`delete from public.permissoes where membro_id = $1 and modulo = 'pessoas'`, 'postgres', [semPessoas]);
  hoje = await db.valor(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  await rpc('importar_tipos_evento', {}, sec);
  tipo = await db.valor(`select id from public.tipos_evento limit 1`);
  treino = randomUUID(); futuro = randomUUID(); ana = randomUUID(); bia = randomUUID(); socio = randomUUID(); projeto = randomUUID();
  await rpc('salvar_projeto', { p: { id: projeto, nome: 'Projeto de treinos' } }, pres);
  await rpc('salvar_evento', { p: { id: treino, tipo_id: tipo, titulo: 'Treino', inicio: `${hoje}T00:01:00-03:00`, fim: `${hoje}T00:02:00-03:00`, projeto_id: projeto } }, sec);
  const depois = await db.valor<string>(`select to_char(private.hoje() + 10, 'YYYY-MM-DD')`);
  await rpc('salvar_evento', { p: { id: futuro, tipo_id: tipo, titulo: 'Treino futuro', inicio: `${depois}T19:00:00-03:00`, fim: `${depois}T21:00:00-03:00` } }, sec);
  await rpc('salvar_pessoa', { p: { id: ana, nome: 'Ana Fictícia', atleta: true, associado: false } }, sec);
  await rpc('salvar_pessoa', { p: { id: bia, nome: 'Bia Fictícia', atleta: true, associado: false } }, sec);
  await rpc('salvar_pessoa', { p: { id: socio, nome: 'Sócio Fictício', atleta: false, associado: true } }, sec);
});
afterAll(async () => { await db?.destruir(); });

test('marca presença; só atletas ativos; sem duplicar; refazer substitui', async () => {
  const lista = [{ pessoa_id: ana, presente: true }, { pessoa_id: bia, presente: false, justificativa: 'Atestado' }];
  expect((await rpc('salvar_presenca_evento', { p_evento: treino, p: [{ pessoa_id: socio, presente: true }] }, sec)).campo).toBe('presencas');
  expect((await rpc('salvar_presenca_evento', { p_evento: treino, p: [{ pessoa_id: ana, presente: true }, { pessoa_id: ana, presente: false }] }, sec)).campo).toBe('presencas');
  expect((await rpc('salvar_presenca_evento', { p_evento: treino, p: [{ pessoa_id: ana, presente: 'sim' }] }, sec)).campo).toBe('presencas');
  expect((await rpc('salvar_presenca_evento', { p_evento: treino, p: [{ pessoa_id: ana, presente: true, saude: 'x' }] }, sec)).campo).toBe('presencas');
  const r = await rpc('salvar_presenca_evento', { p_evento: treino, p: lista }, sec);
  expect(r).toMatchObject({ ok: true, marcados: 2, presentes: 1 });
  expect((await rpc('salvar_presenca_evento', { p_evento: treino, p: [{ pessoa_id: ana, presente: true }] }, sec)).marcados).toBe(1);
  expect(await db.valor<number>(`select count(*)::int from public.evento_presencas where evento_id = $1`, 'postgres', [treino])).toBe(1);
});

test('quem não vê pessoas não marca nem lê; evento futuro recusado', async () => {
  expect((await rpc('salvar_presenca_evento', { p_evento: treino, p: [] }, semPessoas)).erro).toBe('sem_permissao');
  expect(await db.valor<number>(`select count(*)::int from public.evento_presencas`, sessao(semPessoas))).toBe(0);
  expect(await db.valor<number>(`select count(*)::int from public.evento_presencas`, sessao(dir))).toBe(1);
  expect((await rpc('salvar_presenca_evento', { p_evento: futuro, p: [{ pessoa_id: ana, presente: true }] }, sec)).erro).toBe('evento_futuro');
});

test('frequência e prestação de contas contam os presentes', async () => {
  const f = await rpc('frequencia_atletas', { p_inicio: hoje, p_fim: hoje }, dir);
  expect(f.atletas).toEqual([{ pessoa_id: ana, presentes: 1, marcados: 1 }]);
  expect((await rpc('frequencia_atletas', { p_inicio: hoje, p_fim: hoje }, semPessoas)).erro).toBe('sem_permissao');
  const p = await rpc('dados_prestacao', { p_id: projeto }, pres);
  expect(p.atividades[0].presentes).toBe(1);
});

test('evento cancelado não recebe presença', async () => {
  await rpc('cancelar_evento', { p_id: treino, p_motivo: 'Chuva forte' }, sec);
  expect((await rpc('salvar_presenca_evento', { p_evento: treino, p: [] }, sec)).campo).toBe('evento');
});
