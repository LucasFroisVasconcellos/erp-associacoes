-- 0009: retenção de dados pessoais (LGPD, arts. 15 e 16).
-- Remove o que já cumpriu a finalidade e não tem guarda obrigatória:
--   - convites nunca aceitos: 90 dias depois de expirar ou de ser cancelado;
--   - notificações já lidas: 180 dias depois da leitura;
--   - contadores de limite de uso: 1 dia depois da janela.
-- NÃO toca em lançamentos, comprovantes, cadastros, fechamentos nem na auditoria:
-- são registros contábeis com guarda legal (ver docs/lgpd.md).
-- Agendada no Supabase com pg_cron (docs/deploy.md); só o postgres executa.

create function private.aplicar_retencao(p_agora timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_convites int; v_notificacoes int; v_limites int;
begin
  delete from public.convites
   where usado_em is null
     and coalesce(cancelado_em, expira_em) < p_agora - interval '90 days';
  get diagnostics v_convites = row_count;

  delete from public.notificacoes
   where lida_em is not null and lida_em < p_agora - interval '180 days';
  get diagnostics v_notificacoes = row_count;

  delete from private.limites where janela < p_agora - interval '1 day';
  get diagnostics v_limites = row_count;

  -- registra só QUANTOS registros foram tratados, nunca o conteúdo
  perform private.registrar('retencao', null, null, null,
    jsonb_build_object('convites', v_convites, 'notificacoes', v_notificacoes, 'limites', v_limites));

  return jsonb_build_object('ok', true, 'convites', v_convites, 'notificacoes', v_notificacoes, 'limites', v_limites);
end $$;

revoke all on function private.aplicar_retencao(timestamptz) from public, anon, authenticated, service_role;
