// Lista fechada de privilégios: qualquer função, tabela ou grant novo que fique alcançável
// pelo cliente sem ter sido decidido aqui quebra este teste (fail closed para mudanças futuras).
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, novoBanco } from './harness';

let db: Banco;
beforeAll(async () => { db = await novoBanco(); });
afterAll(async () => { await db?.destruir(); });

// Implementações das RPCs (chamadas pelos invólucros SECURITY INVOKER de public) e as
// funções usadas nas políticas de RLS. Cada uma valida sessão, 2FA e permissão sozinha.
const PRIVADAS_DO_CLIENTE = [
  'aceitar_convite', 'alcance', 'alterar_membro', 'autorizar_arquivo_contador', 'autorizar_comprovante',
  'cancelar_convite', 'cancelar_lancamento', 'checklist_fechamento', 'criar_lancamento', 'dados_relatorio',
  'decidir_reembolso', 'definir_permissoes', 'editar_lancamento', 'estornar_lancamento', 'exportar_auditoria', 'fechar_mes',
  'gerar_previstos', 'importar_modelos_tipos_gasto', 'is_admin', 'justificar_sem_comprovante',
  'marcar_avisos_lidos', 'membro_atual', 'meu_perfil', 'modelo_permissoes', 'painel_inicial', 'pode',
  'realizar_lancamento', 'registrar_convite', 'salvar_categoria', 'salvar_centro_custo', 'salvar_conta',
  'salvar_contraparte', 'salvar_projeto', 'salvar_recorrencia', 'salvar_tipo_gasto', 'sessao_erro',
  've_registro', 'verificar_duplicidade',
  // 0012: agenda, tarefas e avisos
  'agenda_periodo', 'aplicar_modelo', 'arquivar_aviso', 'cancelar_evento', 'comentar_tarefa', 'criar_tarefa',
  'editar_tarefa', 'gerar_tarefas_recorrentes', 'importar_modelo_viagem', 'importar_tipos_evento', 'marcar_aviso_lido',
  'mudar_situacao_tarefa', 'publicar_aviso', 'resumo_organizacao', 'salvar_evento', 'salvar_item_tarefa',
  'salvar_modelo_tarefas', 'salvar_tarefa_recorrente', 'salvar_tipo_evento', 've_tarefa', 've_tarefa_id',
  // 0013: preferências de e-mail (o envio é só da service role)
  'salvar_preferencias_email',
  // 0014: verbas e projetos
  'classificar_lancamento', 'dados_prestacao', 'desfazer_recebimento', 'editar_projeto', 'formalizar_verba',
  'importar_modelos_verba', 'justificar_regra', 'mudar_situacao_verba', 'painel_projeto', 'painel_projetos',
  'registrar_recebimento', 'salvar_documento_verba', 'salvar_origem_verba', 'salvar_parcelas', 'salvar_rubrica',
  'salvar_tipo_verba', 'salvar_verba', 've_verba', 've_verba_id', 'vincular_conta_projeto',
  // 0015: pessoas, mensalidades e saúde
  'autorizar_documento', 'gerar_mensalidades', 'mudar_mensalidade', 'registrar_consentimento', 'registrar_pagamento_mensalidade',
  'resumo_pessoas', 'revogar_consentimento', 'salvar_categoria_socio', 'salvar_config_pix', 'salvar_documento_pessoa',
  'salvar_documento_saude', 'salvar_pessoa', 'salvar_saude',
  // 0016: patrimônio
  'baixar_bem', 'devolver_bem', 'emprestar_bem', 'registrar_manutencao', 'salvar_bem',
  // 0017: governança
  'painel_governanca', 'salvar_ata', 'salvar_deliberacao', 'salvar_documento_institucional', 'salvar_mandato',
  'salvar_presencas', 'salvar_reuniao',
  // 0018: filiações
  'definir_dependencia_verba', 'gerar_contribuicao', 'importar_tipos_filiacao', 'painel_filiacoes',
  'salvar_documento_filiacao', 'salvar_filiacao', 'salvar_tipo_filiacao',
  // 0019: presença em treinos
  'frequencia_atletas', 'salvar_presenca_evento',
  // 0020–0022: conciliação, captação e viagens
  'conciliar', 'conciliar_automatico', 'desfazer_conciliacao', 'ignorar_linha', 'importar_extrato', 'painel_conciliacao',
  'importar_plano_contas', 'vincular_categoria_conta', 'importar_lancamentos', 'lancar_do_extrato', 'importar_balancete', 'comparar_balancete', 'dados_analise',
  'previa_transparencia', 'publicar_transparencia', 'retirar_transparencia', 'transparencia_publica',
  'salvar_orcamento', 'orcamento_ano', 'receber_mensalidade', 'criar_projeto', 'salvar_ficha_atleta', 'remover_foto_pessoa', 'decidir_pedido_acesso', 'salvar_modelo_permissao', 'apagar_modelo_permissao', 'salvar_salario_minimo', 'receber_parcela_unica', 'apagar_categoria_socio', 'apagar_membro',
  'cancelar_recibo', 'emitir_recibo', 'painel_captacao', 'registrar_interacao', 'salvar_acao_captacao', 'salvar_contrapartida',
  'salvar_oportunidade', 'salvar_vendedor', 'salvar_config_entidade',
  'encerrar_viagem', 'painel_viagens', 'salvar_delegacao', 'salvar_viagem', 'vincular_lancamento_viagem',
];

const executaveis = (papel: string, schema: string) => db.linhas(
  `select p.proname as nome from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = $2 and has_function_privilege($1, p.oid, 'execute') order by 1`, 'postgres', [papel, schema],
).then((r) => r.map((x) => x.nome as string));

test('anon só executa a função pública da transparência (Fase 7), nada mais', async () => {
  expect(await executaveis('anon', 'public')).toEqual(['transparencia_publica']);
  expect(await executaveis('anon', 'private')).toEqual(['transparencia_publica']);
});

test('authenticated executa só a lista aprovada de funções privadas', async () => {
  expect(await executaveis('authenticated', 'private')).toEqual([...PRIVADAS_DO_CLIENTE].sort());
});

test('funções sensíveis ficam fora do alcance de qualquer cliente, inclusive service_role', async () => {
  for (const f of ['aplicar_retencao', 'bootstrap_admin', 'registrar', 'trg_auditar', 'consumir_limite', 'gravar_permissoes',
    'gerar_ocorrencias', 'rotina_organizacao', 'trg_sem_apagar', 'gravar_participantes', 'preparar_emails',
    'tarefa_prestacao', 'lancamentos_projeto', 'pendencias_projeto', 'execucao_projeto', 'projeto_json',
    'trg_auditar_sensivel', 'apagar_saude', 'consentimento_ativo', 'menor_de_idade', 'trg_ata_congelada',
    'candidatos_extrato', 'extrato_pendente', 'pode_mexer_viagem', 'numeros_viagem', 'abrir_lote', 'lancamento_do_extrato', 'montar_transparencia', 'trg_pessoa_desligada', 'trg_imagem_revogada', 'ultima_autenticacao', 'permissoes_modelo_padrao']) {
    for (const papel of ['anon', 'authenticated', 'service_role']) {
      const pode = await db.valor<boolean>(
        `select bool_or(has_function_privilege($1, p.oid, 'execute')) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = $2`, 'postgres', [papel, f]);
      expect(pode, `${papel} executa private.${f}`).toBe(false);
    }
  }
});

test('nenhuma tabela de public aceita escrita direta do cliente', async () => {
  const r = await db.linhas(
    `select c.relname, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p(priv)
      where n.nspname = 'public' and c.relkind = 'r'
        and (has_table_privilege('authenticated', c.oid, p.priv) or has_table_privilege('anon', c.oid, p.priv))`, 'postgres');
  expect(r).toEqual([]);
});

test('fila de e-mails: só a service role pega e marca; ninguém lê a tabela', async () => {
  for (const f of ['pegar_emails', 'marcar_email']) {
    for (const papel of ['anon', 'authenticated']) {
      expect(await db.valor<boolean>(`select bool_or(has_function_privilege($1, p.oid, 'execute')) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.proname = $2`, 'postgres', [papel, f]),
        `${papel} executa ${f}`).toBe(false);
    }
  }
  for (const papel of ['anon', 'authenticated', 'service_role']) {
    expect(await db.valor<boolean>(`select has_table_privilege($1, 'private.fila_emails', 'select')`, 'postgres', [papel])).toBe(false);
  }
});

test('saúde: tabelas só para quem tem o módulo "saude"; fila de remoção e registro de arquivos só da service role', async () => {
  for (const f of ['registrar_documento', 'pegar_arquivos_remover', 'confirmar_remocao']) {
    expect(await db.valor<boolean>(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.proname = $1`, 'postgres', [f]), f).toBe(false);
  }
  for (const papel of ['anon', 'authenticated', 'service_role']) {
    expect(await db.valor<boolean>(`select has_table_privilege($1, 'private.arquivos_remover', 'select')`, 'postgres', [papel])).toBe(false);
  }
  // nenhum perfil-modelo de cargo traz o módulo de saúde
  for (const cargo of ['presidente', 'vice_presidente', 'secretario', 'tesoureiro', 'diretor']) {
    expect(await db.valor<boolean>(`select exists (select 1 from jsonb_array_elements(private.permissoes_modelo($1)) e where e ->> 'modulo' = 'saude')`, 'postgres', [cargo]), cargo).toBe(false);
  }
});
