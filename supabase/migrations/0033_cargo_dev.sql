-- 0033: cargo "dev" (pedido da diretoria, 28/10/2026): quem mantém o sistema.
-- É administrador (cuida de Acessos) e o modelo padrão dá TODAS as ações em TODOS os módulos,
-- inclusive Saúde — decisão consciente da diretoria (ver ADR 0019). Como qualquer cargo,
-- continua exigindo login com 2FA (aal2) e a sessão de no máximo 30 dias.
-- Só estrutura: a troca de cargo de alguém é feita à parte (dado, não estrutura).

create or replace function private.cargos() returns text[] language sql immutable set search_path = '' as $$
  select array['presidente','vice_presidente','secretario','tesoureiro','diretor','dev']
$$;
create or replace function private.cargos_admin() returns text[] language sql immutable set search_path = '' as $$
  select array['presidente','vice_presidente','secretario','dev']
$$;

-- todas as ações de todos os módulos, alcance "tudo"
create function private.permissoes_todas() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_agg(jsonb_build_object('modulo', m, 'acao', a, 'alcance', 'tudo') order by m, a)
  from unnest(private.modulos()) m, unnest(private.acoes()) a
$$;

-- um modelo cadastrado em Acessos para o cargo continua valendo primeiro
create or replace function private.permissoes_modelo(p_cargo text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.permissoes from public.modelos_permissao m where m.cargo = p_cargo),
    (select m.permissoes from public.modelos_permissao m where p_cargo = 'vice_presidente' and m.cargo = 'presidente'),
    case when p_cargo = 'dev' then private.permissoes_todas() else private.permissoes_modelo_padrao(p_cargo) end)
$$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function private.permissoes_todas() from authenticated, service_role, anon;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
