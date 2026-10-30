-- 0041: apagar um acesso (membro) que nunca registrou nada (pedido da diretoria, 28/10/2026).
-- Para quem já tem histórico (lançou, aprovou, criou evento, convidou…) continua valendo só
-- DESLIGAR o acesso: a auditoria e os registros dependem da pessoa. Quem decide é o banco:
--  * só administrador (módulo acessos); ninguém apaga o próprio acesso;
--  * mantém o mínimo de administradores (mesma regra de alterar_membro);
--  * apaga só o que é da própria pessoa e não é histórico: permissões, notificações, fila de
--    e-mail, preferências, leituras de avisos, presença em eventos e o convite que ela usou;
--  * qualquer outra referência (chave estrangeira) desfaz tudo e responde "tem_historico";
--  * apaga também o login (auth.users), na MESMA transação: sessões, 2FA e identidades do
--    Supabase Auth saem em cascata, e a pessoa é desconectada na hora. Ou sai tudo, ou nada.
-- A remoção fica na auditoria (gatilho de membros: ação "remover").

create function private.apagar_membro(p_membro uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('apagar_membro', 'acessos'); m public.membros;
begin
  if v_erro is not null then return v_erro; end if;
  if p_membro is null then return private.erro('invalido', 'id'); end if;
  if p_membro = auth.uid() then return private.negar('apagar_membro', 'proprio_acesso'); end if;

  -- trava as linhas para que duas mudanças simultâneas não furem o mínimo de admins
  perform 1 from public.membros order by id for update;
  select * into m from public.membros where id = p_membro;
  if m.id is null then return private.erro('nao_encontrado'); end if;
  if private.admins_permanentes(p_membro) < least(2, private.admins_permanentes()) then return private.erro('minimo_admins'); end if;

  begin
    delete from public.preferencias_email where membro_id = p_membro;
    delete from public.aviso_leituras where membro_id = p_membro;
    delete from public.evento_participantes where membro_id = p_membro;
    delete from public.convites where usado_por = p_membro or (email = m.email and usado_em is null);
    delete from public.membros where id = p_membro;      -- permissões, notificações e fila saem em cascata
    delete from auth.users where id = p_membro;          -- login, sessões e 2FA
  exception when foreign_key_violation then
    return private.erro('tem_historico');
  end;
  return jsonb_build_object('ok', true);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('apagar_membro', 10);

create function public.apagar_membro(p_membro uuid) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.apagar_membro(p_membro) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
grant execute on function public.apagar_membro(uuid) to authenticated;
grant execute on function private.apagar_membro(uuid) to authenticated;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
