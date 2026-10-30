-- 0034: sem e-mails de aviso por enquanto (decisão da diretoria, 28/10/2026).
-- A rotina diária continua criando as tarefas recorrentes, mas não monta mais a fila de
-- lembretes e resumo semanal (ninguém a enviaria e ela só cresceria). A Edge Function
-- "enviar-emails" não é publicada. Para religar no futuro: nova migration que volte a chamar
-- private.preparar_emails() aqui (a função e a fila continuam existindo).
-- O convite para criar a senha (Supabase Auth) não é afetado.

create or replace function private.rotina_organizacao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int := private.gerar_ocorrencias(private.hoje() + 35);
begin
  perform private.registrar('rotina_organizacao', null, null, null, jsonb_build_object('tarefas_criadas', v_n));
  return jsonb_build_object('ok', true, 'tarefas_criadas', v_n, 'emails', 'desligados');
end $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
