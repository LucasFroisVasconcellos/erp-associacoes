-- 0011: ajustes da exportação da auditoria (achados da revisão independente).
--  - pedido de titular (LGPD): o filtro por pessoa passa a incluir o que fizeram SOBRE ela
--    quando ela aparece numa coluna de pessoa do registro (reembolso, convite, lançamento,
--    comprovante, fechamento) ou pelo e-mail (convites), e não só pelo id do registro;
--  - "até 1 ano" passa a ser de fato no máximo 366 dias contados (diferença de até 365).
-- Mesma assinatura: os grants da 0010 continuam valendo.

create or replace function private.exportar_auditoria(p_inicio date, p_fim date, p_membro uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('exportar_auditoria', 'acessos');
  v_de timestamptz; v_ate timestamptz; v_linhas jsonb; v_n int; v_max constant int := 20000;
  v_id text := p_membro::text;
  v_email text := (select lower(m.email) from public.membros m where m.id = p_membro);
begin
  if v_erro is not null then return v_erro; end if;
  if p_inicio is null or p_fim is null or p_inicio > p_fim or p_fim - p_inicio > 365 then
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
      and (p_membro is null or a.membro_id = p_membro or a.registro_id = v_id
           -- o que fizeram SOBRE a pessoa: ela aparece numa coluna de pessoa do registro
           -- (reembolso que pediu, convite que recebeu, lançamento que criou...) ou pelo e-mail
           or exists (
             select 1 from (values (a.antes), (a.depois)) v(j)
             where j is not null and (
               v_id in (j ->> 'solicitante', j ->> 'usado_por', j ->> 'criado_por', j ->> 'decidido_por', j ->> 'membro',
                        j ->> 'realizado_por', j ->> 'enviado_por', j ->> 'fechado_por', j ->> 'membro_id')
               or (v_email is not null and lower(j ->> 'email') = v_email))))
    order by a.id
    limit v_max + 1
  ) x;

  perform private.registrar('exportar', 'auditoria', null, null, jsonb_build_object(
    'inicio', p_inicio, 'fim', p_fim, 'membro', p_membro, 'linhas', least(v_n, v_max)));

  return jsonb_build_object('ok', true, 'inicio', p_inicio, 'fim', p_fim, 'gerado_em', now(),
    'truncado', v_n > v_max,
    'linhas', case when v_n > v_max then v_linhas - v_max else v_linhas end);
end $$;
