// PKCE; sessão em sessionStorage, ou até 30 dias com "manter conectado" (o banco recusa sessão mais velha).
// Nada de token na URL: links do e-mail viram sessão e são apagados do endereço.
import { normalizarDecimais } from './normalizar';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { interpretar, type Config } from '@/lib/config';
import { ErroApp, erroDeAuth, erroVisivelNaRecuperacao } from '@/lib/erros';
import { geracao } from '@/lib/geracao';
import { definirLembrar, lembrado } from '@/lib/manter-conectado';
import { TABELAS_LEITURA, type EventoSessao, type Fonte } from './fonte';
import type { Aviso, ConfigPix, ItemAuditoria, Lancamento, Permissao, PreferenciasEmail, Reembolso, Tarefa } from './tipos';

const TEMPO_LIMITE = 20_000;

const local = () => (lembrado() ? localStorage : sessionStorage);
const armazenamentoDaSessao = {
  getItem: (k: string) => { try { return local().getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { local().setItem(k, v); } catch { /* sem storage: sessão só em memória */ } },
  removeItem: (k: string) => { for (const s of [() => sessionStorage, () => localStorage]) { try { s().removeItem(k); } catch { /* idem */ } } },
};

const sinal = (ms = TEMPO_LIMITE) => AbortSignal.timeout(Math.min(Math.max(ms, 1_000), 120_000));

export function criarFonteSupabase(cfg: Config): Fonte {
  const sb: SupabaseClient = createClient(cfg.url, cfg.chave, {
    auth: {
      flowType: 'pkce',
      storage: armazenamentoDaSessao,
      storageKey: 'erp.sessao',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  async function ler<T>(consulta: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
    const { data, error } = await geracao.proteger(Promise.resolve(consulta));
    return interpretar<T>(normalizarDecimais(data), error as never);
  }

  async function authOk(p: Promise<{ error: { message?: string; status?: number; code?: string } | null }>) {
    const { error } = await geracao.proteger(p);
    if (!error) return;
    throw erroDeAuth(error);
  }

  async function chamarFuncao<T>(nome: string, corpo: BodyInit, json: boolean, publica = false): Promise<T> {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token && !publica) throw new ErroApp({ erro: 'nao_autenticado' });
    let r: Response;
    try {
      r = await geracao.proteger(fetch(`${cfg.url}/functions/v1/${nome}`, {
        method: 'POST', body: corpo, signal: AbortSignal.timeout(60_000),
        headers: { ...(token && !publica ? { authorization: `Bearer ${token}` } : {}), apikey: cfg.chave, ...(json ? { 'content-type': 'application/json' } : {}) },
      }));
    } catch (e) {
      if ((e as Error).name === 'RespostaObsoleta') throw e;
      throw new ErroApp({ erro: (e as Error).name === 'TimeoutError' ? 'tempo_esgotado' : 'rede' });
    }
    const corpoResp = await r.json().catch(() => ({ erro: 'falha_interna' }));
    if (!r.ok || corpoResp.erro) throw new ErroApp({ erro: corpoResp.erro ?? 'falha_interna', campo: corpoResp.campo, requestId: corpoResp.requestId });
    return corpoResp as T;
  }

  const mapaLanc = (l: Record<string, unknown>): Lancamento => ({
    ...(l as unknown as Lancamento),
    valor: String(l.valor),
    categoria: (l.categorias as { nome?: string } | null)?.nome ?? null,
    conta: (l.contas_bancarias as { nome?: string } | null)?.nome ?? null,
    autor: (l.membros as { nome?: string } | null)?.nome ?? null,
    comprovantes: (l.comprovantes as { count: number }[] | undefined)?.[0]?.count ?? 0,
  });
  const mapaTarefa = (t: Record<string, unknown>): Tarefa => {
    const itens = (t.tarefa_itens as { feito: boolean }[] | undefined) ?? [];
    const { tarefa_itens: _i, ...resto } = t;
    void _i;
    return { ...(resto as unknown as Tarefa), itens_total: itens.length, itens_feitos: itens.filter((i) => i.feito).length };
  };
  const SELECT_LANC = '*, categorias(nome), contas_bancarias(nome), membros!lancamentos_criado_por_fkey(nome), comprovantes(count)';

  async function marcarEstornados(lista: Lancamento[]): Promise<Lancamento[]> {
    if (lista.length === 0) return lista;
    const ids = lista.map((l) => l.id);
    const est = await ler<{ estorno_de: string }[]>(sb.from('lancamentos').select('estorno_de').in('estorno_de', ids).abortSignal(sinal()));
    const com = new Set(est.map((e) => e.estorno_de));
    return lista.map((l) => ({ ...l, estornado: com.has(l.id) }));
  }

  return {
    demo: false,
    captcha: cfg.captcha,

    async sessao() {
      const { data } = await sb.auth.getSession();
      const s = data.session;
      if (!s) return null;
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      return { usuarioId: s.user.id, email: s.user.email ?? '', aal: (aal?.currentLevel ?? 'aal1') as 'aal1' | 'aal2', proximoAal: (aal?.nextLevel ?? 'aal1') as 'aal1' | 'aal2' };
    },
    aoMudarSessao(cb) {
      const { data } = sb.auth.onAuthStateChange((evento) => {
        const mapa: Record<string, EventoSessao> = { SIGNED_IN: 'entrou', SIGNED_OUT: 'saiu', MFA_CHALLENGE_VERIFIED: 'atualizou', TOKEN_REFRESHED: 'atualizou', USER_UPDATED: 'atualizou' };
        const e = mapa[evento];
        if (e) cb(e);
      });
      return () => data.subscription.unsubscribe();
    },
    lembrado,
    entrar: (email, senha, captcha, manter) => { definirLembrar(Boolean(manter)); return authOk(sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password: senha, options: captcha ? { captchaToken: captcha } : undefined,
    })); },
    async sair(todos) {
      geracao.avancar();
      definirLembrar(false);
      const { error } = await sb.auth.signOut({ scope: todos ? 'global' : 'local' });
      if (error && todos) { await sb.auth.signOut({ scope: 'local' }); throw new ErroApp({ erro: 'rede' }); }
    },
    pedirRecuperacao: (email, redirectTo, captcha) => authOk(sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo, captchaToken: captcha })).catch((e) => {
      // Mesmo resultado para e-mail existente ou não (erroVisivelNaRecuperacao, em lib/erros).
      if (erroVisivelNaRecuperacao(e)) throw e;
    }),
    confirmarLink: (tokenHash, tipo) => authOk(sb.auth.verifyOtp({ token_hash: tokenHash, type: tipo })),
    sessaoDoLink: (acesso, renovacao) => authOk(sb.auth.setSession({ access_token: acesso, refresh_token: renovacao })),
    async definirSenha(senha) {
      await authOk(sb.auth.updateUser({ password: senha }));
      await sb.auth.signOut({ scope: 'others' }); // troca de senha encerra as outras sessões
    },

    async fatores() {
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) throw new ErroApp({ erro: 'falha_interna' });
      return (data?.totp ?? []).map((f) => ({ id: f.id, status: f.status as 'verified' | 'unverified' }));
    },
    async cadastrarFator() {
      const { data: lista } = await sb.auth.mfa.listFactors();
      for (const f of lista?.all ?? []) if (f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Associação Exemplo' });
      if (error || !data) throw new ErroApp({ erro: 'falha_interna' });
      const qr = data.totp.qr_code;
      if (!qr.startsWith('data:image/svg+xml')) throw new ErroApp({ erro: 'falha_interna' });
      return { id: data.id, qr, segredo: data.totp.secret };
    },
    async confirmarCodigo(fatorId, codigo) {
      if (!/^\d{6}$/.test(codigo)) throw new ErroApp({ erro: 'codigo' });
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo });
      if (error) throw new ErroApp({ erro: error.status === 429 ? 'limite' : 'codigo' });
    },

    rpc: (nome, args, opcoes) => ler(sb.rpc(nome, args ?? {}).abortSignal(sinal(opcoes?.tempoLimiteMs))),
    convidar: (dados) => chamarFuncao('convidar', JSON.stringify(dados), true),
    pedirAcesso: async (dados) => { await chamarFuncao('pedir-acesso', JSON.stringify(dados), true, true); },
    enviarArquivo: (form) => chamarFuncao('enviar-arquivo', form, false),
    async urlArquivo(bucket, caminho) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(caminho, 60);
      if (error || !data) throw new ErroApp({ erro: 'sem_permissao' });
      return data.signedUrl;
    },

    contas: () => ler(sb.from('contas_bancarias').select('*').order('nome').abortSignal(sinal())),
    categorias: () => ler(sb.from('categorias').select('*').order('nome').abortSignal(sinal())),
    tiposGasto: () => ler(sb.from('tipos_gasto').select('*').order('nome').abortSignal(sinal())),
    contrapartes: () => ler(sb.from('contrapartes').select('*').order('nome').abortSignal(sinal())),
    recorrencias: () => ler(sb.from('recorrencias').select('*').order('descricao').abortSignal(sinal())),
    async lancamentos(f) {
      let c = sb.from('lancamentos').select(SELECT_LANC);
      if (f.situacao && f.situacao !== 'todas') c = c.eq('situacao', f.situacao);
      if (f.tipo) c = c.eq('tipo', f.tipo);
      if (f.inicio) c = c.gte('data', f.inicio);
      if (f.fim) c = c.lte('data', f.fim);
      if (f.busca) c = c.ilike('descricao', `%${f.busca.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
      // paginação por cursor (data, criado_em), nunca OFFSET
      if (f.antesDe) c = c.or(`data.lt."${f.antesDe.data}",and(data.eq."${f.antesDe.data}",criado_em.lt."${f.antesDe.criado_em}")`);
      const linhas = await ler<Record<string, unknown>[]>(c.order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(f.limite ?? 50).abortSignal(sinal()));
      return marcarEstornados(linhas.map(mapaLanc));
    },
    async lancamento(id) {
      const l = await ler<Record<string, unknown> | null>(sb.from('lancamentos').select(SELECT_LANC).eq("id", id).abortSignal(sinal()).maybeSingle());
      return l ? (await marcarEstornados([mapaLanc(l)]))[0]! : null;
    },
    comprovantes: (id) => ler(sb.from('comprovantes').select('*').eq('lancamento_id', id).order('enviado_em').abortSignal(sinal())),
    async reembolsos() {
      const linhas = await ler<Record<string, unknown>[]>(sb.from('reembolsos')
        .select('*, lancamento:lancamentos(*), membro:membros!reembolsos_solicitante_fkey(nome)').order('criado_em', { ascending: false }).abortSignal(sinal()));
      return linhas.map((r) => ({ ...(r as unknown as Reembolso), nome_solicitante: (r.membro as { nome?: string } | null)?.nome ?? undefined }));
    },
    membros: () => ler(sb.from('membros').select('*').order('nome').abortSignal(sinal())),
    permissoesDe: (id) => ler<Permissao[]>(sb.from('permissoes').select('modulo, acao, alcance').eq('membro_id', id).abortSignal(sinal())),
    modelosPermissao: () => ler(sb.from('modelos_permissao').select('id, nome, cargo, permissoes, atualizado_em').order('nome').limit(100).abortSignal(sinal())),
    pedidosAcesso: () => ler(sb.from('pedidos_acesso').select('id, nome, email, criado_em').eq('situacao', 'pendente').order('criado_em').limit(50).abortSignal(sinal())),
    convites: () => ler(sb.from('convites').select('id, email, nome, cargo, criado_em, expira_em, usado_em, cancelado_em').order('criado_em', { ascending: false }).limit(50).abortSignal(sinal())),
    async auditoria(antesDe) {
      // a trilha não tem chave estrangeira (é independente de propósito): o nome vem à parte
      let c = sb.from('auditoria').select('*').order('id', { ascending: false }).limit(50);
      if (antesDe) c = c.lt('id', antesDe);
      const [linhas, pessoas] = await Promise.all([
        ler<Record<string, unknown>[]>(c.abortSignal(sinal())),
        ler<{ id: string; nome: string }[]>(sb.from('membros').select('id, nome').abortSignal(sinal())),
      ]);
      const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
      return linhas.map((a) => ({ ...(a as unknown as ItemAuditoria), autor: nomes.get(a.membro_id as string) ?? null }));
    },
    arquivosContador: () => ler(sb.from('arquivos_contador').select('*').order('competencia', { ascending: false }).order('enviado_em', { ascending: false }).abortSignal(sinal())),
    notificacoes: () => ler(sb.from('notificacoes').select('*').order('criada_em', { ascending: false }).limit(30).abortSignal(sinal())),
    fechamentos: () => ler(sb.from('fechamentos').select('competencia, fechado_em').order('competencia', { ascending: false }).abortSignal(sinal())),

    tiposEvento: () => ler(sb.from('tipos_evento').select('id, nome, cor, icone, ativo').order('nome').abortSignal(sinal())),
    async tarefas() {
      const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const linhas = await ler<Record<string, unknown>[]>(sb.from('tarefas').select('*, tarefa_itens(feito)')
        .or(`situacao.in.(a_fazer,fazendo),atualizado_em.gte."${desde}"`)
        .order('prazo', { ascending: true, nullsFirst: false }).order('criado_em').limit(500).abortSignal(sinal()));
      return linhas.map(mapaTarefa);
    },
    async tarefa(id) {
      const t = await ler<Record<string, unknown> | null>(sb.from('tarefas').select('*, tarefa_itens(feito)').eq('id', id).abortSignal(sinal()).maybeSingle());
      return t ? mapaTarefa(t) : null;
    },
    itensTarefa: (id) => ler(sb.from('tarefa_itens').select('*').eq('tarefa_id', id).order('ordem').abortSignal(sinal())),
    comentariosTarefa: (id) => ler(sb.from('tarefa_comentarios').select('*').eq('tarefa_id', id).order('criado_em').limit(200).abortSignal(sinal())),
    tarefasRecorrentes: () => ler(sb.from('tarefas_recorrentes').select('*').order('titulo').abortSignal(sinal())),
    modelosTarefas: () => ler(sb.from('modelos_tarefas').select('id, nome, tipo_evento_id, itens, ativo').order('nome').abortSignal(sinal())),
    async avisos() {
      const { data: s } = await sb.auth.getSession();
      const eu = s.session?.user.id;
      const [lista, minhas] = await Promise.all([
        ler<Aviso[]>(sb.from('avisos').select('id, titulo, texto, autor, publicado_em, expira_em, arquivado_em')
          .order('publicado_em', { ascending: false }).limit(100).abortSignal(sinal())),
        ler<{ aviso_id: string }[]>(sb.from('aviso_leituras').select('aviso_id').eq('membro_id', eu ?? '').abortSignal(sinal())),
      ]);
      const lidos = new Set(minhas.map((l) => l.aviso_id));
      return lista.map((a) => ({ ...a, lido: lidos.has(a.id) }));
    },
    leiturasAviso: (id) => ler(sb.from('aviso_leituras').select('aviso_id, membro_id, lido_em').eq('aviso_id', id).order('lido_em').abortSignal(sinal())),
    async preferenciasEmail() {
      const p = await ler<PreferenciasEmail | null>(sb.from('preferencias_email').select('lembretes, resumo_semanal').abortSignal(sinal()).maybeSingle());
      return p ?? { lembretes: true, resumo_semanal: true };
    },

    tiposVerba: () => ler(sb.from('tipos_verba').select('id, nome, regras, ativo').order('nome').abortSignal(sinal())),
    origensVerba: () => ler(sb.from('origens_verba').select('id, nome, categoria, contato, ativa').order('nome').abortSignal(sinal())),
    verbas: () => ler(sb.from('verbas').select('*').order('atualizado_em', { ascending: false }).limit(300).abortSignal(sinal())),
    parcelasVerba: (id) => ler(sb.from('verba_parcelas').select('id, verba_id, numero, valor, data_prevista, recebido_em, valor_recebido, lancamento_id').eq('verba_id', id).order('numero').abortSignal(sinal())),
    documentosVerba: (id) => ler(sb.from('verba_documentos').select('id, verba_id, momento, nome, entregue_em, entregue_por').eq('verba_id', id).order('momento').order('nome').abortSignal(sinal())),
    projetos: () => ler(sb.from('projetos').select('id, nome, ativo, verba_id').order('nome').abortSignal(sinal())),
    rubricas: () => ler(sb.from('projeto_rubricas').select('id, projeto_id, nome, ativa').order('ordem').abortSignal(sinal())),

    async configPix() {
      const c = await ler<{ valor: ConfigPix } | null>(sb.from('configuracoes').select('valor').eq('chave', 'pix').abortSignal(sinal()).maybeSingle());
      return c?.valor ?? null;
    },
    categoriasSocio: () => ler(sb.from('categorias_socio').select('id, nome, valor_mensalidade, percentual_salario_minimo, percentual_parcela_unica, dia_vencimento, ativa').order('nome').abortSignal(sinal())),
    parcelasUnicas: (id) => ler(sb.from('parcelas_unicas').select('id, pessoa_id, ano, valor, pago_em, lancamento_id').eq('pessoa_id', id).order('ano', { ascending: false }).abortSignal(sinal())),
    salariosMinimos: () => ler(sb.from('salarios_minimos').select('vigente_desde, valor').order('vigente_desde', { ascending: false }).abortSignal(sinal())),
    pessoas: () => ler(sb.from('pessoas').select('id, nome, atleta, associado, categoria_id, situacao, data_nascimento, email, telefone, responsavel_nome, responsavel_contato, responsavel_parentesco, observacao, desligado_em, criado_em, foto_caminho, apelido, numero_camisa, posicao, tamanho_uniforme, registro_federacao, na_associacao_desde, emergencia_nome, emergencia_telefone')
      .order('nome').limit(2000).abortSignal(sinal())),
    mensalidades(pessoaId) {
      const desde = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
      let c = sb.from('mensalidades').select('id, pessoa_id, competencia, valor, vencimento, situacao, txid, lancamento_id, pago_em, motivo').gte('competencia', desde);
      if (pessoaId) c = c.eq('pessoa_id', pessoaId);
      return ler(c.order('competencia', { ascending: false }).limit(3000).abortSignal(sinal()));
    },
    documentosPessoa: (id) => ler(sb.from('documentos_pessoa').select('id, pessoa_id, tipo, descricao, validade, entregue_em, arquivo_caminho, arquivo_mime, arquivado_em').eq('pessoa_id', id).order('criado_em').abortSignal(sinal())),
    consentimentos: (id) => ler(sb.from('consentimentos').select('id, pessoa_id, finalidade, base_legal, concedido_por, nome_concedente, concedido_em, revogado_em').eq('pessoa_id', id).order('registrado_em', { ascending: false }).abortSignal(sinal())),
    saude: (id) => ler(sb.from('pessoa_saude').select('pessoa_id, deficiencia, classe_funcional, observacoes, atualizado_em').eq('pessoa_id', id).abortSignal(sinal()).maybeSingle()),
    documentosSaude: (id) => ler(sb.from('documentos_saude').select('id, pessoa_id, tipo, emitido_em, validade, arquivo_caminho, arquivo_mime').eq('pessoa_id', id).order('criado_em').abortSignal(sinal())),
    bens: () => ler(sb.from('bens').select('id, numero, nome, categoria, origem, projeto_id, lancamento_id, valor, data_aquisicao, situacao, baixa_motivo, observacao, criado_em').order('numero').limit(2000).abortSignal(sinal())),
    emprestimos: () => ler(sb.from('emprestimos').select('id, bem_id, pessoa_id, inicio, previsao_devolucao, devolvido_em, termo_versao, termo_aceito_por, termo_aceito_em, observacao').order('inicio', { ascending: false }).limit(1000).abortSignal(sinal())),
    manutencoes: (id) => ler(sb.from('manutencoes').select('id, bem_id, data, descricao, custo, proxima_em').eq('bem_id', id).order('data', { ascending: false }).abortSignal(sinal())),
    documentosInstitucionais: () => ler(sb.from('documentos_institucionais').select('id, tipo, titulo, emitido_em, validade, observacao, arquivo_caminho, arquivo_mime, arquivado_em').order('titulo').abortSignal(sinal())),
    mandatos: () => ler(sb.from('mandatos').select('id, nome, membro_id, cargo, orgao, inicio, fim').order('fim', { ascending: false }).abortSignal(sinal())),
    reunioes: () => ler(sb.from('reunioes').select('id, tipo, titulo, data, local, pauta, quorum_minimo, situacao, ata, ata_aprovada_em').order('data', { ascending: false }).limit(300).abortSignal(sinal())),
    presencas: (id) => ler(sb.from('reuniao_presencas').select('reuniao_id, nome, membro_id').eq('reuniao_id', id).order('nome').abortSignal(sinal())),
    deliberacoes: (id) => ler(sb.from('deliberacoes').select('id, reuniao_id, ordem, texto, votos_favor, votos_contra, abstencoes, resultado').eq('reuniao_id', id).order('ordem').abortSignal(sinal())),
    tiposFiliacao: () => ler(sb.from('tipos_filiacao').select('id, nome, ativo').order('nome').abortSignal(sinal())),
    filiacoes: () => ler(sb.from('filiacoes').select('id, entidade, tipo_id, categoria, situacao, inicio, validade, renovacao, contribuicao_valor, contribuicao_periodicidade, recorrencia_id, beneficios, obrigacoes, responsavel, criado_por').order('entidade').abortSignal(sinal())),
    async lista(tabela, o = {}) {
      if (!TABELAS_LEITURA.includes(tabela)) throw new ErroApp({ erro: 'invalido' });
      let c = sb.from(tabela).select('*');
      for (const [k, v] of Object.entries(o.onde ?? {})) {
        if (!/^[a-z_]{1,40}$/.test(k)) throw new ErroApp({ erro: 'invalido' });
        c = c.eq(k, v);
      }
      if (o.ordem && /^[a-z_]{1,40}$/.test(o.ordem)) c = c.order(o.ordem, { ascending: !o.desc });
      return ler(c.limit(Math.min(o.limite ?? 1000, 2000)).abortSignal(sinal()));
    },
    presencasEvento: (id) => ler(sb.from('evento_presencas').select('evento_id, pessoa_id, presente, justificativa').eq('evento_id', id).abortSignal(sinal())),
    documentosFiliacao: (id) => ler(sb.from('filiacao_documentos').select('id, filiacao_id, nome, documento_institucional_id, entregue_em').eq('filiacao_id', id).order('nome').abortSignal(sinal())),
  };
}
