-- 0028: criar projeto sem verba (projeto próprio da Associação Exemplo, ex.: escolinha, evento anual).
-- Mesmas validações do editar_projeto; regras padrão (podem ser ajustadas depois no projeto).

create function private.criar_projeto(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('criar_projeto', 'projetos', 'criar');
  v_id uuid; v_ini date; v_fim date; v_nome text; v_inserido uuid; v_regras jsonb := private.regras_completas('{}');
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['projeto_id','nome','fonte','descricao','vigencia_inicio','vigencia_fim','valor_aprovado','valor_contrapartida','responsavel']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'projeto_id'); if v_id is null then return private.erro('invalido', 'projeto_id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 120) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'fonte') and (jsonb_typeof(p -> 'fonte') <> 'string' or not private.texto_opcional_ok(private.j_texto(p -> 'fonte'), 120)) then return private.erro('invalido', 'fonte'); end if;
  if not private.vazio(p -> 'descricao') and (jsonb_typeof(p -> 'descricao') <> 'string' or not private.texto_longo_ok(p ->> 'descricao', 2000)) then return private.erro('invalido', 'descricao'); end if;
  v_ini := private.j_data(p -> 'vigencia_inicio'); v_fim := private.j_data(p -> 'vigencia_fim');
  if v_ini is null or v_ini not between private.hoje() - 1830 and private.hoje() + 1100 then return private.erro('invalido', 'vigencia_inicio'); end if;
  if v_fim is null or v_fim < v_ini or v_fim > v_ini + 1830 then return private.erro('invalido', 'vigencia_fim'); end if;
  if not private.vazio(p -> 'valor_aprovado') and private.j_valor(p -> 'valor_aprovado') is null then return private.erro('invalido', 'valor_aprovado'); end if;
  if not private.vazio(p -> 'valor_contrapartida') and private.j_valor(p -> 'valor_contrapartida') is null then return private.erro('invalido', 'valor_contrapartida'); end if;
  if not private.vazio(p -> 'responsavel') and not private.membro_ativo(private.j_uuid(p -> 'responsavel')) then return private.erro('invalido', 'responsavel'); end if;
  insert into public.projetos (id, nome, ativo, criado_por, fonte, descricao, vigencia_inicio, vigencia_fim, valor_aprovado, valor_contrapartida,
                               regras, responsavel, prazo_prestacao, situacao)
  values (v_id, v_nome, true, auth.uid(), nullif(private.j_texto(p -> 'fonte'), ''), nullif(btrim(coalesce(p ->> 'descricao', '')), ''), v_ini, v_fim,
          private.j_valor(p -> 'valor_aprovado'), coalesce(private.j_valor(p -> 'valor_contrapartida'), 0), '{}',
          coalesce(private.j_uuid(p -> 'responsavel'), auth.uid()), v_fim + (v_regras ->> 'prazo_prestacao_dias')::int, 'em_execucao')
  on conflict (id) do nothing returning id into v_inserido;
  if v_inserido is null then
    -- mesmo id de novo (toque duplo): devolve o que já existe, se for do mesmo autor
    if exists (select 1 from public.projetos where id = v_id and criado_por = auth.uid() and verba_id is null) then
      return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true);
    end if;
    return private.erro('conflito', 'projeto_id');
  end if;
  perform private.tarefa_prestacao(v_id, 'final');
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('criar_projeto', 30);

create function public.criar_projeto(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.criar_projeto(p) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
grant execute on function public.criar_projeto(jsonb) to authenticated;
grant execute on function private.criar_projeto(jsonb) to authenticated;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
