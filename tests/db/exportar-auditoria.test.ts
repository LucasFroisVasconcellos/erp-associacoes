import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, vice: string, tes: string;

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  vice = await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  // linhas fixas em datas conhecidas (a trilha é imutável, mas o postgres pode inserir)
  await db.linhas(`insert into public.auditoria (em, membro_id, acao, tabela, registro_id, depois) values
    ('2026-09-01 02:00:00+00', $1, 'inserir', 'lancamentos', 'L-AGO', '{}'),      -- 31/08 23:00 em São Paulo
    ('2026-09-15 12:00:00+00', $1, 'inserir', 'lancamentos', 'L-SET', '{"valor":"10.00"}'),
    ('2026-10-01 02:30:00+00', $1, 'inserir', 'lancamentos', 'L-VIRADA', '{}'),   -- 30/09 23:30 em São Paulo
    ('2026-10-01 03:30:00+00', $2, 'alterar', 'membros', $1, '{}'),               -- 01/10 00:30 em São Paulo; sobre a tesoureira
    ('2026-10-10 15:00:00+00', $3, 'alterar', 'permissoes', $2, '{}'),
    ('2026-10-05 15:00:00+00', $3, 'inserir', 'convites', 'CONVITE-1', '{"email":"TES@exemplo.test","nome":"Tesoureira"}'),
    ('2026-10-06 15:00:00+00', $2, 'alterar', 'reembolsos', null, jsonb_build_object('solicitante', $1::text, 'situacao', 'pago'))`, 'postgres', [tes, vice, pres]);
});
afterAll(async () => { await db?.destruir(); });

const exportar = (quem: string, args: Record<string, unknown>, opc?: Parameters<typeof sessao>[1]) =>
  db.rpc('exportar_auditoria', { p_inicio: null, p_fim: null, p_membro: null, ...args }, sessao(quem, opc));

test('administrador exporta o período, no fuso de São Paulo, com o nome de quem fez', async () => {
  const r = await exportar(pres, { p_inicio: '2026-09-01', p_fim: '2026-09-30' });
  expect(r.ok).toBe(true);
  const ids = r.linhas.map((l: { registro_id: string }) => l.registro_id);
  expect(ids).toContain('L-SET');
  expect(ids).toContain('L-VIRADA'); // 02:30 UTC de 01/10 ainda é setembro em São Paulo
  expect(ids).not.toContain('L-AGO'); // 02:00 UTC de 01/09 ainda é agosto em São Paulo
  expect(ids).not.toContain(tes);    // 03:30 UTC de 01/10 já é outubro
  const set = r.linhas.find((l: { registro_id: string }) => l.registro_id === 'L-SET');
  expect(set).toMatchObject({ autor: 'Tesoureira', acao: 'inserir', tabela: 'lancamentos', depois: { valor: '10.00' } });
  expect(r.truncado).toBe(false);
});

test('filtro por pessoa traz o que ela fez e o que fizeram sobre ela', async () => {
  // até 15/10: fora as linhas reais do convite e do aceite, criadas agora pelo próprio teste
  const r = await exportar(pres, { p_inicio: '2026-09-01', p_fim: '2026-10-15', p_membro: tes });
  const ids = r.linhas.map((l: { registro_id: string }) => l.registro_id).sort();
  expect(ids.filter(Boolean)).toEqual(['CONVITE-1', 'L-SET', 'L-VIRADA', tes].sort()); // L-AGO (31/08 em São Paulo) fica fora
  // e o que fizeram sobre ela sem usar o id dela como registro: convite (pelo e-mail) e reembolso (solicitante)
  const tabelas = r.linhas.map((l: { tabela: string }) => l.tabela);
  expect(tabelas).toContain('convites');
  expect(tabelas).toContain('reembolsos');
  expect(r.linhas.filter((l: { tabela: string }) => l.tabela === 'convites')).toHaveLength(1); // ação do vice sobre a tesoureira entra; a do presidente sobre o vice não
});

test('a exportação fica registrada na trilha, sem copiar as linhas exportadas', async () => {
  await exportar(vice, { p_inicio: '2026-10-01', p_fim: '2026-10-31' });
  const linha = await db.valor(`select jsonb_build_object('tabela', tabela, 'membro', membro_id, 'depois', depois)
    from public.auditoria where acao = 'exportar' and tabela = 'auditoria' order by id desc limit 1`, 'postgres');
  expect(linha.tabela).toBe('auditoria');
  expect(linha.membro).toBe(vice);
  expect(Object.keys(linha.depois).sort()).toEqual(['fim', 'inicio', 'linhas', 'membro']);
});

test('quem não é administrador não exporta', async () => {
  expect((await exportar(tes, { p_inicio: '2026-09-01', p_fim: '2026-09-30' })).erro).toBe('sem_permissao');
});

test('sessão vencida (30 dias) não exporta; sem 2FA nada sai; sem login a função nem é alcançável', async () => {
  expect((await exportar(pres, { p_inicio: '2026-09-01', p_fim: '2026-09-30' }, { totpHaSegundos: 31 * 86400, loginHaSegundos: 31 * 86400 })).erro).toBe('sessao_expirada');
  expect((await exportar(pres, { p_inicio: '2026-09-01', p_fim: '2026-09-30' }, { aal: 'aal1' })).erro).toBe('precisa_2fa');
  expect(await db.falha(`select public.exportar_auditoria('2026-09-01', '2026-09-30', null)`, 'anon')).toMatch(/permission denied/);
});

test('período inválido é recusado', async () => {
  expect((await exportar(pres, { p_inicio: '2025-01-01', p_fim: '2026-01-01' })).ok).toBe(true); // 366 dias contados
  for (const [ini, fim] of [[null, '2026-09-30'], ['2026-09-30', '2026-09-01'], ['2025-01-01', '2026-01-02'], ['2025-01-01', '2026-03-01']]) {
    const r = await exportar(pres, { p_inicio: ini, p_fim: fim });
    expect(r, `${ini} a ${fim}`).toMatchObject({ erro: 'invalido', campo: 'periodo' });
  }
});

test('limite de 10 exportações por hora por pessoa', async () => {
  const novo = await novoBanco();
  try {
    const a = await primeiroAdmin(novo);
    const rs = [];
    for (let i = 0; i < 11; i++) rs.push(await novo.rpc('exportar_auditoria', { p_inicio: '2026-09-01', p_fim: '2026-09-30', p_membro: null }, sessao(a)));
    expect(rs.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(rs[10].erro).toBe('limite');
  } finally { await novo.destruir(); }
});

test('acima de 20 mil registros: entrega 20 mil e avisa que cortou', async () => {
  const novo = await novoBanco();
  try {
    const a = await primeiroAdmin(novo);
    await novo.linhas(`insert into public.auditoria (em, membro_id, acao, tabela, registro_id)
      select timestamptz '2026-08-10 15:00:00+00', $1, 'inserir', 'lancamentos', 'L' || g from generate_series(1, 20001) g`, 'postgres', [a]);
    const r = await novo.rpc('exportar_auditoria', { p_inicio: '2026-08-01', p_fim: '2026-08-31', p_membro: null }, sessao(a));
    expect(r.truncado).toBe(true);
    expect(r.linhas).toHaveLength(20000);
    const registro = await novo.valor(`select depois from public.auditoria where acao = 'exportar' order by id desc limit 1`, 'postgres');
    expect(registro.linhas).toBe(20000);
  } finally { await novo.destruir(); }
}, 60_000);
