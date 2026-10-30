-- 0039: apagar categoria de mensalidade que NUNCA foi usada (pedido da diretoria, 28/10/2026).
-- Categoria usada por alguém (mesmo desligado) não se apaga: o histórico depende dela — continua
-- sendo só "desativar". Quem confere é o banco: a chave estrangeira de pessoas.categoria_id
-- impede apagar uma categoria em uso, e a função responde "em_uso" antes disso.
-- Ninguém apaga direto pela API (a tabela não tem permissão de DELETE); só por esta função.

drop trigger if exists categorias_socio_sem_apagar on public.categorias_socio;

create function private.apagar_categoria_socio(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('apagar_categoria_socio', 'pessoas', 'editar');
begin
  if v_erro is not null then return v_erro; end if;
  if p_id is null then return private.erro('invalido', 'id'); end if;
  perform 1 from public.categorias_socio where id = p_id for update;
  if not found then return private.erro('nao_encontrado'); end if;
  if exists (select 1 from public.pessoas where categoria_id = p_id) then return private.erro('em_uso'); end if;
  delete from public.categorias_socio where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('apagar_categoria_socio', 30);

create function public.apagar_categoria_socio(p_id uuid) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.apagar_categoria_socio(p_id) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
grant execute on function public.apagar_categoria_socio(uuid) to authenticated;
grant execute on function private.apagar_categoria_socio(uuid) to authenticated;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
