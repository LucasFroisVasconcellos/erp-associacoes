-- 0010: exportação da trilha de auditoria (backup mensal e pedidos de titular, LGPD).
-- Só administrador com 2FA recente (módulo "acessos" em private.checar), período de até
-- 1 ano no fuso de São Paulo, filtro opcional por pessoa (o que ela fez e o que fizeram
-- sobre ela), até 20.000 linhas, limite de 10 exportações por hora. A exportação é
-- registrada na própria trilha (só período, pessoa e quantidade — nunca as linhas).

insert into private.limites_operacao (operacao, maximo_por_hora) values ('exportar_auditoria', 10);

create function private.exportar_auditoria(p_inicio date, p_fim date, p_membro uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('exportar_auditoria', 'acessos');
  v_de timestamptz; v_ate timestamptz; v_linhas jsonb; v_n int; v_max constant int := 20000;
begin
  if v_erro is not null then return v_erro; end if;
  if p_inicio is null or p_fim is null or p_inicio > p_fim or p_fim - p_inicio > 366 then
    return private.erro('invalido', 'periodo');
  end if;
  v_de := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  v_ate := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';

  select coalesce(jsonb_agg(x.j order by x.id), '[]'), count(*) into v_linhas, v_n
  from (
    select a.id, jsonb_build_object(
      'id', a.id, 'em', a.em, 'autor', m.nome, 'membro_id', a.membro_id, 'acao', a.acao,
      'tabela', a.tabela, 'registro_id', a.registro_id, 'antes', a.antes, 'depois', a.depois) as j
    from public.auditoria a
    left join public.membros m on m.id = a.membro_id
    where a.em >= v_de and a.em < v_ate
      and (p_membro is null or a.membro_id = p_membro or a.registro_id = p_membro::text)
    order by a.id
    limit v_max + 1
  ) x;

  perform private.registrar('exportar', 'auditoria', null, null, jsonb_build_object(
    'inicio', p_inicio, 'fim', p_fim, 'membro', p_membro, 'linhas', least(v_n, v_max)));

  return jsonb_build_object('ok', true, 'inicio', p_inicio, 'fim', p_fim, 'gerado_em', now(),
    'truncado', v_n > v_max,
    'linhas', case when v_n > v_max then v_linhas - v_max else v_linhas end);
end $$;

create function public.exportar_auditoria(p_inicio date, p_fim date, p_membro uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.exportar_auditoria(p_inicio, p_fim, p_membro)
$$;

revoke all on function private.exportar_auditoria(date, date, uuid) from public, anon;
revoke all on function public.exportar_auditoria(date, date, uuid) from public, anon;
grant execute on function private.exportar_auditoria(date, date, uuid) to authenticated;
grant execute on function public.exportar_auditoria(date, date, uuid) to authenticated;
