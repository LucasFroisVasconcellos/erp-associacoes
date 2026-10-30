import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

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

test('envio de comprovantes: 60 autorizações por hora por pessoa', async () => {
  const contaId = randomUUID(); const cat = randomUUID();
  await db.rpc('salvar_conta', { p: { id: contaId, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, sessao(tes));
  await db.rpc('salvar_categoria', { p: { id: cat, nome: 'Material', tipo: 'saida' } }, sessao(tes));
  const id = randomUUID();
  const hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  await db.rpc('criar_lancamento', { p: { id, tipo: 'saida', situacao: 'realizada', valor: '1.00', data: hoje, descricao: 'Teste', categoria_id: cat, conta_id: contaId } }, sessao(dir));
  const respostas = [];
  for (let i = 0; i < 62; i++) respostas.push(await db.rpc('autorizar_comprovante', { p_lancamento: id }, sessao(dir)));
  expect(respostas.slice(0, 60).every((r) => r.ok)).toBe(true);
  expect(respostas[60].erro).toBe('limite');
  expect(respostas[61].erro).toBe('limite');
  // outra pessoa não é afetada
  expect((await db.rpc('autorizar_comprovante', { p_lancamento: id }, sessao(tes))).ok).toBe(true);
  // excesso registrado uma única vez
  const n = await db.valor<number>(`select count(*)::int from public.auditoria where acao = 'acesso_negado'
    and registro_id = 'autorizar_comprovante' and depois ->> 'motivo' = 'limite' and membro_id = $1`, 'postgres', [dir]);
  expect(n).toBe(1);
});

test('convites: 20 por hora por administrador', async () => {
  // o vice ainda não convidou ninguém nesta hora (o presidente já usou 3 convites no beforeAll)
  const rs = [];
  for (let i = 0; i < 21; i++) {
    rs.push(await db.rpc('registrar_convite', { p_email: `pessoa${i}@exemplo.test`, p_nome: `Pessoa ${i}`, p_cargo: 'diretor', p_permissoes: [] }, sessao(vice)));
  }
  expect(rs.slice(0, 20).every((r) => r.ok)).toBe(true);
  expect(rs[20].erro).toBe('limite');
});

test('tabela de limites não é acessível pelo cliente', async () => {
  expect(await db.falha('select * from private.limites', sessao(pres))).toMatch(/permission denied/);
});
