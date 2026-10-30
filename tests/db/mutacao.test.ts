// Teste de MUTAÇÃO dos controles de segurança: cada controle é desligado numa cópia do
// banco e o ataque correspondente precisa passar a funcionar. Se um controle pudesse ser
// removido sem nenhum ataque funcionar, o teste não estaria protegendo nada.
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

interface Cenario { db: Banco; pres: string; vice: string; tes: string; dir: string; conta: string; cat: string; lanc: string; reembTes: string; lancFechado: string }

async function cenario(): Promise<Cenario> {
  const db = await novoBanco();
  const pres = await primeiroAdmin(db);
  const vice = await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  const tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  const dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  const conta = randomUUID(); const cat = randomUUID();
  await db.rpc('salvar_categoria', { p: { id: cat, nome: 'Material', tipo: 'saida' } }, sessao(tes));
  await db.rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, sessao(tes));
  const hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  const passado = await db.valor<string>(`select to_char(date_trunc('month', private.hoje()) - interval '1 month', 'YYYY-MM-DD')`);
  const lanc = randomUUID();
  await db.rpc('criar_lancamento', { p: { id: lanc, tipo: 'saida', situacao: 'realizada', valor: '10.00', data: hoje, descricao: 'Lançamento do diretor', categoria_id: cat, conta_id: conta } }, sessao(dir));
  const reembTes = randomUUID();
  await db.rpc('criar_lancamento', { p: { id: reembTes, tipo: 'saida', situacao: 'realizada', valor: '5.00', data: hoje, descricao: 'Reembolso da tesoureira', categoria_id: cat, reembolso: true } }, sessao(tes));
  const lancFechado = randomUUID();
  await db.rpc('criar_lancamento', { p: { id: lancFechado, tipo: 'saida', situacao: 'realizada', valor: '7.00', data: passado, descricao: 'Do mês fechado', categoria_id: cat, conta_id: conta } }, sessao(tes));
  const criados = await db.valor<number>(`select count(*)::int from public.lancamentos where id in ('${lanc}', '${reembTes}', '${lancFechado}')`);
  if (criados !== 3) throw new Error(`cenário incompleto: ${criados} de 3 lançamentos criados`);
  await db.linhas(`insert into public.fechamentos (competencia, fechado_por, confirmacoes, resumo) values ('${passado}', '${tes}', '{}', '{}')`);
  return { db, pres, vice, tes, dir, conta, cat, lanc, reembTes, lancFechado };
}

/** Troca um trecho do corpo de uma função (falha se o trecho não existir: mutação inválida). */
async function mutarFuncao(db: Banco, assinatura: string, de: string, para: string) {
  const def = await db.valor<string>(`select pg_get_functiondef('${assinatura}'::regprocedure)`);
  if (!def.includes(de)) throw new Error(`mutação inválida: "${de}" não está em ${assinatura}`);
  await db.linhas(def.replace(de, para));
}

const ok = (r: { ok?: boolean } | null) => r?.ok === true;
const tenta = async (f: () => Promise<unknown>) => { try { await f(); return true; } catch (e) { if (process.env.ERP_DEBUG) console.log('tentativa bloqueada:', (e as Error).message); return false; } };

const MUTANTES: { controle: string; desligar: (c: Cenario) => Promise<void>; ataque: (c: Cenario) => Promise<boolean> }[] = [
  {
    controle: 'sessão sem 2FA, inativa ou vencida não passa nas RPCs',
    desligar: async ({ db }) => mutarFuncao(db, 'private.sessao_erro()', "when coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then 'precisa_2fa'", "when false then 'precisa_2fa'"),
    ataque: async ({ db, tes }) => ok(await db.rpc('meu_perfil', {}, sessao(tes, { aal: 'aal1' }))),
  },
  {
    controle: 'cliente não grava direto na tabela de lançamentos',
    desligar: async ({ db }) => {
      await db.linhas('grant insert on public.lancamentos to authenticated');
      await db.linhas('create policy inserir_livre on public.lancamentos for insert to authenticated with check (true)');
      // isola o controle da TABELA: as restrições CHECK usam funções privadas de validação,
      // que o cliente também não executa (uma camada a mais, que aqui é aberta de propósito)
      await db.linhas('grant execute on all functions in schema private to authenticated');
    },
    ataque: async ({ db, dir, conta, cat }) => tenta(() => db.linhas(`insert into public.lancamentos (id, tipo, situacao, valor, data, descricao, categoria_id, conta_id, criado_por)
      values (gen_random_uuid(), 'saida', 'realizada', 999999, current_date, 'Dinheiro do nada', '${cat}', '${conta}', '${dir}')`, sessao(dir))),
  },
  {
    controle: 'ninguém altera as próprias permissões',
    desligar: async ({ db }) => mutarFuncao(db, 'private.definir_permissoes(uuid,jsonb)', "if p_membro = auth.uid() then return private.negar('definir_permissoes', 'proprio_acesso'); end if;", ''),
    ataque: async ({ db, pres }) => ok(await db.rpc('definir_permissoes', { p_membro: pres, p_permissoes: [{ modulo: 'saude', acao: 'ver' }] }, sessao(pres))),
  },
  {
    controle: 'foto 3x4 só com autorização de imagem (0029)',
    desligar: async ({ db }) => mutarFuncao(db, 'private.autorizar_documento(text,uuid)', "if not private.consentimento_ativo(p_documento, 'imagem') then return private.erro('sem_consentimento'); end if;", ''),
    ataque: async ({ db, pres }) => {
      const id = randomUUID();
      if (!ok(await db.rpc('salvar_pessoa', { p: { id, nome: 'Atleta Mutação', atleta: true, associado: false } }, sessao(pres)))) throw new Error('cenário: pessoa');
      return ok(await db.rpc('autorizar_documento', { p_area: 'foto_pessoa', p_documento: id }, sessao(pres)));
    },
  },
  {
    controle: 'mínimo de dois administradores',
    desligar: async ({ db }) => mutarFuncao(db, 'private.alterar_membro(uuid,text,boolean,timestamp with time zone)', 'v_depois < least(2, v_antes)', 'false'),
    ataque: async ({ db, pres, vice }) => ok(await db.rpc('alterar_membro', { p_membro: vice, p_cargo: 'diretor', p_ativo: true, p_acesso_expira_em: null }, sessao(pres))),
  },
  {
    controle: 'sessão autenticada há mais de 30 dias não entra (0031)',
    desligar: async ({ db }) => mutarFuncao(db, 'private.sessao_erro()', "when coalesce(private.ultima_autenticacao(), '-infinity') < now() - interval '30 days' then 'sessao_expirada'", "when false then 'sessao_expirada'"),
    ataque: async ({ db, tes }) => ok(await db.rpc('meu_perfil', {}, sessao(tes, { totpHaSegundos: 31 * 86400, loginHaSegundos: 31 * 86400 }))),
  },
  {
    controle: 'ninguém decide o próprio reembolso',
    desligar: async ({ db }) => mutarFuncao(db, 'private.decidir_reembolso(uuid,boolean,uuid,text)', "if r.solicitante = auth.uid() then return private.negar('decidir_reembolso', 'proprio_reembolso'); end if;", ''),
    ataque: async ({ db, tes, reembTes, conta }) => ok(await db.rpc('decidir_reembolso', { p_id: reembTes, p_aprovar: true, p_conta_id: conta, p_motivo: null }, sessao(tes))),
  },
  {
    controle: 'permissão por módulo e ação (diretor não estorna)',
    desligar: async ({ db }) => { await db.linhas(`create or replace function private.pode(p_modulo text, p_acao text) returns boolean language sql stable security definer set search_path = '' as $$ select true $$`); },
    ataque: async ({ db, dir, lanc }) => ok(await db.rpc('estornar_lancamento', { p_id: lanc, p_motivo: 'Ataque de diretor' }, sessao(dir))),
  },
  {
    controle: 'mês fechado travado no banco (gatilho)',
    desligar: async ({ db }) => { await db.linhas('drop trigger lancamentos_trava on public.lancamentos'); },
    ataque: async ({ db, lancFechado }) => tenta(async () => {
      await db.linhas(`update public.lancamentos set valor = 1 where id = '${lancFechado}'`);
      if ((await db.valor<string>(`select valor::text from public.lancamentos where id = '${lancFechado}'`)) !== '1.00') throw new Error('não alterou');
    }),
  },
  {
    controle: 'trilha de auditoria imutável',
    desligar: async ({ db }) => { await db.linhas('drop trigger auditoria_sem_alterar on public.auditoria'); },
    ataque: async ({ db }) => tenta(async () => {
      await db.linhas(`update public.auditoria set acao = 'apagado' where id = (select min(id) from public.auditoria)`);
      if ((await db.valor<number>(`select count(*)::int from public.auditoria where acao = 'apagado'`)) !== 1) throw new Error('não alterou');
    }),
  },
  {
    controle: 'limite de uso por pessoa',
    desligar: async ({ db }) => { await db.linhas(`create or replace function private.consumir_limite(p_operacao text) returns int language sql security definer set search_path = '' as $$ select null::int $$`); },
    ataque: async ({ db, dir, lanc }) => {
      let r;
      for (let i = 0; i < 61; i++) r = await db.rpc('autorizar_comprovante', { p_lancamento: lanc }, sessao(dir));
      return ok(r);
    },
  },
];

// Leitura com 2FA tem DUAS camadas independentes: a política RESTRICTIVE (aal2) e a checagem
// de sessão dentro de private.pode(). Cada uma sozinha precisa segurar o ataque.
const semPolitica = (db: Banco) => db.linhas('drop policy exige_2fa on public.lancamentos');
const semChecagemSessao = (db: Banco) => mutarFuncao(db, 'private.sessao_erro()', "when coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then 'precisa_2fa'", "when false then 'precisa_2fa'");
const lerSem2fa = async ({ db, tes }: Cenario) => (await db.valor<number>('select count(*)::int from public.lancamentos', sessao(tes, { aal: 'aal1' }))) > 0;

describe('2FA na leitura: duas camadas independentes', () => {
  test('cada camada sozinha segura; sem as duas o ataque passa', async () => {
    const cs = await Promise.all([cenario(), cenario(), cenario(), cenario()]);
    try {
      expect(await lerSem2fa(cs[0]!)).toBe(false);
      await semPolitica(cs[1]!.db);
      expect(await lerSem2fa(cs[1]!), 'só a checagem de sessão deveria segurar').toBe(false);
      await semChecagemSessao(cs[2]!.db);
      expect(await lerSem2fa(cs[2]!), 'só a política RESTRICTIVE deveria segurar').toBe(false);
      await semPolitica(cs[3]!.db); await semChecagemSessao(cs[3]!.db);
      expect(await lerSem2fa(cs[3]!), 'sem as duas camadas a sonda precisa detectar').toBe(true);
    } finally { await Promise.all(cs.map((c) => c.db.destruir())); }
  });
});

describe('mutação dos controles de segurança', () => {
  for (const m of MUTANTES) {
    test(m.controle, async () => {
      const original = await cenario();
      const mutante = await cenario();
      try {
        expect(await m.ataque(original), 'o ataque NÃO pode funcionar com o controle ligado').toBe(false);
        await m.desligar(mutante);
        expect(await m.ataque(mutante), 'com o controle desligado o ataque deveria funcionar (senão a sonda não mede nada)').toBe(true);
      } finally {
        await original.db.destruir();
        await mutante.db.destruir();
      }
    });
  }
});
