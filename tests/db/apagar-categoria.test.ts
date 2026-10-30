import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, sec: string, dir: string;
const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const existe = (id: string) => db.valor<number>('select count(*)::int from public.categorias_socio where id = $1', 'postgres', [id]);
const cat = async () => { const id = randomUUID(); await rpc('salvar_categoria_socio', { p: { id, nome: 'Cat ' + id.slice(0, 6), valor_mensalidade: '10.00', dia_vencimento: 10 } }, sec); return id; };

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Sec', cargo: 'secretario' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Dir', cargo: 'diretor' });
});
afterAll(async () => { await db?.destruir(); });

test('categoria sem uso é apagada; a ação fica na auditoria', async () => {
  const id = await cat();
  expect((await rpc('apagar_categoria_socio', { p_id: id }, sec)).ok).toBe(true);
  expect(await existe(id)).toBe(0);
  expect(await db.valor<number>(`select count(*)::int from public.auditoria where tabela = 'categorias_socio' and acao = 'remover'`, 'postgres')).toBeGreaterThan(0);
});

test('categoria usada por alguém (mesmo desligado) não é apagada', async () => {
  const id = await cat();
  const p = randomUUID();
  await rpc('salvar_pessoa', { p: { id: p, nome: 'Pessoa Fictícia', atleta: false, associado: true, categoria_id: id } }, sec);
  expect((await rpc('apagar_categoria_socio', { p_id: id }, sec)).erro).toBe('em_uso');
  await rpc('salvar_pessoa', { p: { id: p, nome: 'Pessoa Fictícia', atleta: false, associado: true, categoria_id: id, situacao: 'desligado' } }, sec);
  expect((await rpc('apagar_categoria_socio', { p_id: id }, sec)).erro).toBe('em_uso');
  expect(await existe(id)).toBe(1);
});

test('sem permissão, inexistente e direto na tabela: negado', async () => {
  const id = await cat();
  expect((await rpc('apagar_categoria_socio', { p_id: id }, dir)).erro).toBe('sem_permissao');
  expect((await rpc('apagar_categoria_socio', { p_id: randomUUID() }, sec)).erro).toBe('nao_encontrado');
  expect(await db.falha('delete from public.categorias_socio where id = $1', sessao(pres), [id])).toMatch(/permission denied|row-level/);
  expect(await existe(id)).toBe(1);
});
