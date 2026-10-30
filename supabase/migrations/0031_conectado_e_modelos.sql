-- 0031: uso rápido no celular e modelos de permissão cadastráveis (pedido da diretoria, 28/10/2026).
-- 1) Sessão de até 30 dias: o servidor recusa sessão cuja última autenticação (senha ou código)
--    tem mais de 30 dias — vale mesmo se o aparelho guardar a sessão ("manter conectado").
-- 2) Ações sensíveis não pedem de novo o código do autenticador: o código é pedido no login.
-- 3) Modelos de permissão: o administrador cadastra modelos com nome e pode trocar o modelo
--    padrão de cada cargo (usado no convite e em "Usar modelo do cargo").

create function private.ultima_autenticacao() returns timestamptz
language sql stable set search_path = '' as $$
  select to_timestamp(max((e ->> 'timestamp')::bigint))
  from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
  where (e ->> 'timestamp') ~ '^[0-9]{1,12}$'
$$;

create or replace function private.sessao_erro() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null then 'nao_autenticado'
    when coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then 'precisa_2fa'
    -- sem data de autenticação conferível = vencida (fail closed)
    when coalesce(private.ultima_autenticacao(), '-infinity') < now() - interval '30 days' then 'sessao_expirada'
    when not exists (
      select 1 from public.membros m
      where m.id = auth.uid() and m.ativo
        and (m.acesso_expira_em is null or m.acesso_expira_em > now())
    ) then 'sem_acesso'
    else null
  end
$$;

-- Antes: o código tinha que ter sido digitado nos últimos 10 minutos para mudar acessos,
-- exportar auditoria e publicar a transparência. Decisão da diretoria: o código vale no login.
-- O login continua exigindo a segunda etapa (aal2) em todas as tabelas e funções.
create or replace function private.totp_recente() returns boolean
language sql stable set search_path = '' as $$ select true $$;

create table public.modelos_permissao (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 60)),
  cargo text unique check (cargo is null or cargo = any (private.cargos())), -- preenchido: é o modelo padrão desse cargo
  permissoes jsonb not null check (private.permissoes_validas(permissoes)),
  criado_por uuid not null references public.membros (id),
  atualizado_em timestamptz not null default now()
);
create unique index modelos_permissao_nome_idx on public.modelos_permissao (lower(nome));
create index modelos_permissao_criado_por_idx on public.modelos_permissao (criado_por);
select private.proteger_tabela('public.modelos_permissao');
create policy ler on public.modelos_permissao for select to authenticated using ((select private.is_admin()));
create trigger modelos_permissao_auditar after insert or update or delete on public.modelos_permissao for each row execute function private.trg_auditar();

-- o modelo que vinha da 0002 continua como padrão de fábrica
create function private.permissoes_modelo_padrao(p_cargo text) returns jsonb
language sql immutable set search_path = '' as $$
  with regras(cargo, modulo, acoes) as (values
    ('presidente','financeiro','{ver,criar,editar,aprovar,exportar,administrar}'),
    ('presidente','contador','{ver,criar,editar,exportar,administrar}'),
    ('presidente','relatorios','{ver,exportar}'),
    ('presidente','verbas','{ver,criar,editar,aprovar,exportar,administrar}'),
    ('presidente','projetos','{ver,criar,editar,aprovar,exportar,administrar}'),
    ('presidente','captacao','{ver,criar,editar,aprovar,exportar}'),
    ('presidente','agenda','{ver,criar,editar}'),
    ('presidente','tarefas','{ver,criar,editar}'),
    ('presidente','viagens','{ver,criar,editar,aprovar}'),
    ('presidente','pessoas','{ver,criar,editar}'),
    ('presidente','patrimonio','{ver,criar,editar}'),
    ('presidente','filiacoes','{ver,criar,editar,aprovar}'),
    ('presidente','documentos','{ver,criar,editar}'),
    ('presidente','avisos','{ver,criar,editar}'),
    ('secretario','financeiro','{ver,criar}'),
    ('secretario','contador','{ver,criar}'),
    ('secretario','relatorios','{ver,exportar}'),
    ('secretario','verbas','{ver,criar,editar}'),
    ('secretario','projetos','{ver,criar,editar}'),
    ('secretario','captacao','{ver,criar,editar}'),
    ('secretario','agenda','{ver,criar,editar}'),
    ('secretario','tarefas','{ver,criar,editar}'),
    ('secretario','viagens','{ver,criar,editar}'),
    ('secretario','pessoas','{ver,criar,editar}'),
    ('secretario','patrimonio','{ver,criar,editar}'),
    ('secretario','filiacoes','{ver,criar,editar}'),
    ('secretario','documentos','{ver,criar,editar}'),
    ('secretario','avisos','{ver,criar,editar}'),
    ('tesoureiro','financeiro','{ver,criar,editar,aprovar,exportar,administrar}'),
    ('tesoureiro','contador','{ver,criar,editar,exportar}'),
    ('tesoureiro','relatorios','{ver,exportar}'),
    ('tesoureiro','verbas','{ver,criar,editar}'),
    ('tesoureiro','projetos','{ver,criar}'),
    ('tesoureiro','captacao','{ver}'),
    ('tesoureiro','agenda','{ver,criar,editar}'),
    ('tesoureiro','tarefas','{ver,criar,editar}'),
    ('tesoureiro','viagens','{ver,criar}'),
    ('tesoureiro','pessoas','{ver,editar}'),
    ('tesoureiro','patrimonio','{ver}'),
    ('tesoureiro','filiacoes','{ver}'),
    ('tesoureiro','documentos','{ver,criar}'),
    ('tesoureiro','avisos','{ver,criar}'),
    ('diretor','financeiro','{ver,criar}'),
    ('diretor','contador','{ver}'),
    ('diretor','relatorios','{ver}'),
    ('diretor','verbas','{ver}'),
    ('diretor','projetos','{ver}'),
    ('diretor','captacao','{ver}'),
    ('diretor','agenda','{ver,criar,editar}'),
    ('diretor','tarefas','{ver,criar,editar}'),
    ('diretor','viagens','{ver,criar}'),
    ('diretor','pessoas','{ver}'),
    ('diretor','patrimonio','{ver}'),
    ('diretor','filiacoes','{ver}'),
    ('diretor','documentos','{ver}'),
    ('diretor','avisos','{ver,criar}')
  )
  select coalesce(jsonb_agg(jsonb_build_object('modulo', r.modulo, 'acao', a, 'alcance', 'tudo')
                            order by r.modulo, a), '[]'::jsonb)
  from regras r, unnest(r.acoes::text[]) a
  -- vice-presidente segue o modelo do presidente
  where r.cargo = case when p_cargo = 'vice_presidente' then 'presidente' else p_cargo end
$$;

create or replace function private.permissoes_modelo(p_cargo text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.permissoes from public.modelos_permissao m where m.cargo = p_cargo),
    (select m.permissoes from public.modelos_permissao m where p_cargo = 'vice_presidente' and m.cargo = 'presidente'),
    private.permissoes_modelo_padrao(p_cargo))
$$;

create function private.salvar_modelo_permissao(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_modelo_permissao', 'acessos'); v_id uuid; v_nome text; v_cargo text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','cargo','permissoes']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := btrim(coalesce(private.j_texto(p -> 'nome'), ''));
  if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'cargo') then
    v_cargo := private.j_texto(p -> 'cargo');
    if not (coalesce(v_cargo, '') = any (private.cargos())) then return private.erro('invalido', 'cargo'); end if;
  end if;
  if not coalesce(private.permissoes_validas(p -> 'permissoes'), false) then return private.erro('invalido', 'permissoes'); end if;
  if exists (select 1 from public.modelos_permissao where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('conflito', 'nome'); end if;
  if v_cargo is not null and exists (select 1 from public.modelos_permissao where cargo = v_cargo and id <> v_id) then return private.erro('conflito', 'cargo'); end if;
  insert into public.modelos_permissao (id, nome, cargo, permissoes, criado_por)
  values (v_id, v_nome, v_cargo, p -> 'permissoes', auth.uid())
  on conflict (id) do update set nome = excluded.nome, cargo = excluded.cargo, permissoes = excluded.permissoes, atualizado_em = now();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.apagar_modelo_permissao(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('apagar_modelo_permissao', 'acessos');
begin
  if v_erro is not null then return v_erro; end if;
  delete from public.modelos_permissao where id = p_id;
  if not found then return jsonb_build_object('ok', true, 'repetido', true); end if;
  return jsonb_build_object('ok', true);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('salvar_modelo_permissao', 60), ('apagar_modelo_permissao', 60);

create function public.salvar_modelo_permissao(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_modelo_permissao(p) $$;
create function public.apagar_modelo_permissao(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.apagar_modelo_permissao(p_id) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function private.ultima_autenticacao() from authenticated, service_role, anon;
revoke all on function private.permissoes_modelo_padrao(text) from authenticated, service_role, anon;
do $$
declare f text;
begin
  foreach f in array array['salvar_modelo_permissao(jsonb)','apagar_modelo_permissao(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
