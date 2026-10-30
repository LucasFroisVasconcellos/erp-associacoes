-- 0036: salário mínimo atualizado sozinho, pela série oficial do Banco Central (SGS 1619,
-- "Salário mínimo", mensal, em R$): https://api.bcb.gov.br/dados/serie/bcdata.sgs.1619/dados/ultimos/13?formato=json
-- Desenho (fail closed — na dúvida, não grava e registra na auditoria):
--  * o endereço é fixo no servidor (sem SSRF); a chamada HTTP é do pg_net, agendada pelo pg_cron
--    (docs/deploy.md, 7p). O banco de testes não tem pg_net: as chamadas a "net" ficam em SQL dinâmico;
--  * private.importar_salario_minimo(json) confere tudo: formato, datas, valor entre R$ 100 e R$ 100 mil,
--    nunca menor que o anterior (o mínimo não diminui) e aumento de no máximo 25% de uma vez;
--  * só cria vigência nova: o que já está cadastrado (inclusive à mão) nunca é sobrescrito;
--    se o Banco Central disser outro valor para uma data já cadastrada, registra o conflito e não mexe;
--  * o cadastro manual em Pessoas › Cadastros continua funcionando (reserva se a fonte falhar).

create function private.importar_salario_minimo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb; v_mes date; v_valor numeric; v_atual numeric;
  v_serie jsonb := '[]'; v_criadas int := 0; v_conflitos int := 0; v_recusadas int := 0;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 or jsonb_array_length(p) > 60 then
    perform private.registrar('salario_minimo_automatico', 'salarios_minimos', null, null, jsonb_build_object('erro', 'formato'));
    return jsonb_build_object('ok', false, 'erro', 'formato');
  end if;
  -- 1) valida cada mês (DD/MM/AAAA e "1621.00"); um item ruim invalida a resposta inteira
  for e in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e ->> 'data', '') !~ '^01/[01][0-9]/20[0-9]{2}$'
       or coalesce(e ->> 'valor', '') !~ '^[0-9]{3,6}(\.[0-9]{1,2})?$' then
      perform private.registrar('salario_minimo_automatico', 'salarios_minimos', null, null, jsonb_build_object('erro', 'formato'));
      return jsonb_build_object('ok', false, 'erro', 'formato');
    end if;
    v_mes := to_date(e ->> 'data', 'DD/MM/YYYY');
    v_valor := (e ->> 'valor')::numeric(14, 2);
    if v_valor not between 100 and 100000 or v_mes < date '2000-01-01' or v_mes > private.hoje() + 400 then
      perform private.registrar('salario_minimo_automatico', 'salarios_minimos', null, null, jsonb_build_object('erro', 'fora_da_faixa'));
      return jsonb_build_object('ok', false, 'erro', 'fora_da_faixa');
    end if;
    v_serie := v_serie || jsonb_build_object('mes', v_mes, 'valor', v_valor);
  end loop;
  -- 2) cada mês em que o valor muda vira uma vigência candidata
  for e in select x from jsonb_array_elements(v_serie) x order by (x ->> 'mes')::date loop
    v_mes := (e ->> 'mes')::date; v_valor := (e ->> 'valor')::numeric;
    v_atual := (select s.valor from public.salarios_minimos s where s.vigente_desde <= v_mes order by s.vigente_desde desc limit 1);
    if v_atual is distinct from v_valor then
      if exists (select 1 from public.salarios_minimos where vigente_desde = v_mes) then
        v_conflitos := v_conflitos + 1;  -- já cadastrado com outro valor: não mexe
      elsif v_atual is not null and (v_valor < v_atual or v_valor > v_atual * 1.25) then
        v_recusadas := v_recusadas + 1;  -- diminuiu ou subiu demais: suspeito, não grava
      else
        insert into public.salarios_minimos (vigente_desde, valor) values (v_mes, v_valor);
        v_criadas := v_criadas + 1;
      end if;
    end if;
  end loop;
  perform private.registrar('salario_minimo_automatico', 'salarios_minimos', null, null,
    jsonb_build_object('criadas', v_criadas, 'conflitos', v_conflitos, 'recusadas', v_recusadas));
  return jsonb_build_object('ok', true, 'criadas', v_criadas, 'conflitos', v_conflitos, 'recusadas', v_recusadas);
end $$;

create table private.salario_minimo_pedidos (
  id bigint primary key,           -- id do pedido no pg_net
  pedido_em timestamptz not null default now()
);
revoke all on private.salario_minimo_pedidos from public, anon, authenticated, service_role;

create function private.pedir_salario_minimo() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  -- endereço fixo; só GET; tempo limite curto
  execute $q$select net.http_get(url := 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1619/dados/ultimos/13?formato=json', timeout_milliseconds := 10000)$q$ into v_id;
  insert into private.salario_minimo_pedidos (id) values (v_id) on conflict do nothing;
  delete from private.salario_minimo_pedidos where pedido_em < now() - interval '2 days';
  return jsonb_build_object('ok', true, 'pedido', v_id);
end $$;

create function private.processar_salario_minimo() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_status int; v_corpo text; v_res jsonb := '[]';
begin
  for r in select id from private.salario_minimo_pedidos order by id loop
    execute 'select status_code, content from net._http_response where id = $1' into v_status, v_corpo using r.id;
    continue when v_status is null;   -- ainda não respondeu
    delete from private.salario_minimo_pedidos where id = r.id;
    if v_status <> 200 or v_corpo is null or length(v_corpo) > 20000 then
      perform private.registrar('salario_minimo_automatico', 'salarios_minimos', null, null, jsonb_build_object('erro', 'resposta', 'status', v_status));
      continue;
    end if;
    begin
      v_res := v_res || private.importar_salario_minimo(v_corpo::jsonb);
    exception when others then   -- JSON inválido: não grava nada
      perform private.registrar('salario_minimo_automatico', 'salarios_minimos', null, null, jsonb_build_object('erro', 'json'));
    end;
  end loop;
  return jsonb_build_object('ok', true, 'resultados', v_res);
end $$;

-- só o agendador (postgres) chama; nenhum papel da API
revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function private.importar_salario_minimo(jsonb), private.pedir_salario_minimo(), private.processar_salario_minimo()
  from authenticated, service_role, anon;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
