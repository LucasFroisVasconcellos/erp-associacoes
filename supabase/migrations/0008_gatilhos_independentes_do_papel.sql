-- 0008 · Gatilhos de proteção funcionam igual para qualquer papel.
-- Achado do teste de mutação: o gatilho que trava o mês fechado chamava private.mes_fechado()
-- com os privilégios de quem gravava; para quem não tem EXECUTE, a gravação falhava com
-- "permission denied" em vez da regra certa. Bloqueava por acidente, não por desenho.
-- Com SECURITY DEFINER (e search_path vazio) a regra vale sempre e com a mensagem certa.
alter function private.trg_trava_lancamento() security definer;
alter function private.bloquear_auditoria() security definer;
revoke all on function private.trg_trava_lancamento() from public;
revoke all on function private.bloquear_auditoria() from public;
