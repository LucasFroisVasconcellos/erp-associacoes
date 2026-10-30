-- 0002 · Membros da diretoria, permissões por módulo/ação, convites e avisos.
-- Invariantes (testadas em tests/db/acessos.test.mjs):
--  * sem 2FA (aal2), inativo ou com acesso vencido => não lê nem grava nada;
--  * ninguém altera o próprio cargo ou as próprias permissões;
--  * sempre restam pelo menos 2 administradores permanentes (ou o número atual, se menor);
--  * mudança de acesso exige 2FA confirmado há no máximo 10 minutos.

create function private.modulos() returns text[] language sql immutable set search_path = '' as $$
  select array['financeiro','contador','relatorios','verbas','projetos','captacao','agenda',
               'tarefas','viagens','pessoas','patrimonio','filiacoes','documentos','avisos','saude']
$$;
create function private.acoes() returns text[] language sql immutable set search_path = '' as $$
  select array['ver','criar','editar','aprovar','exportar','administrar']
$$;
create function private.cargos() returns text[] language sql immutable set search_path = '' as $$
  select array['presidente','vice_presidente','secretario','tesoureiro','diretor']
$$;
create function private.cargos_admin() returns text[] language sql immutable set search_path = '' as $$
  select array['presidente','vice_presidente','secretario']
$$;

create table public.membros (
  id uuid primary key references auth.users (id) on delete restrict,
  nome text not null check (private.texto_ok(nome, 2, 120)),
  email text not null unique check (email = lower(email) and char_length(email) <= 254),
  cargo text not null check (cargo = any (private.cargos())),
  ativo boolean not null default true,
  acesso_expira_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.permissoes (
  membro_id uuid not null references public.membros (id) on delete cascade,
  modulo text not null check (modulo = any (private.modulos())),
  acao text not null check (acao = any (private.acoes())),
  alcance text not null default 'tudo' check (alcance in ('tudo', 'proprios')),
  primary key (membro_id, modulo, acao)
);

create table public.convites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  nome text not null,
  cargo text not null check (cargo = any (private.cargos())),
  permissoes jsonb not null default '[]',
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '7 days',
  usado_em timestamptz,
  usado_por uuid references public.membros (id),
  cancelado_em timestamptz
);
create unique index convites_um_pendente_por_email on public.convites (email)
  where usado_em is null and cancelado_em is null;

create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  membro_id uuid not null references public.membros (id) on delete cascade,
  texto text not null check (char_length(texto) <= 500),
  criada_em timestamptz not null default now(),
  lida_em timestamptz
);
create index notificacoes_membro_idx on public.notificacoes (membro_id, criada_em desc);

create index convites_criado_por_idx on public.convites (criado_por);
create index convites_usado_por_idx on public.convites (usado_por) where usado_por is not null;

select private.proteger_tabela('public.membros');
select private.proteger_tabela('public.permissoes');
select private.proteger_tabela('public.convites');
select private.proteger_tabela('public.notificacoes');

create trigger membros_auditar after insert or update or delete on public.membros
  for each row execute function private.trg_auditar();
create trigger convites_auditar after insert or update or delete on public.convites
  for each row execute function private.trg_auditar();

-- Devolve o motivo de bloqueio da sessão atual, ou null se a sessão é válida.
create function private.sessao_erro() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null then 'nao_autenticado'
    when coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then 'precisa_2fa'
    when not exists (
      select 1 from public.membros m
      where m.id = auth.uid() and m.ativo
        and (m.acesso_expira_em is null or m.acesso_expira_em > now())
    ) then 'sem_acesso'
    else null
  end
$$;

create function private.membro_atual() returns uuid
language sql stable security definer set search_path = '' as $$
  select case when private.sessao_erro() is null then auth.uid() end
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membros m
    where m.id = private.membro_atual() and m.cargo = any (private.cargos_admin())
  )
$$;

create function private.pode(p_modulo text, p_acao text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.permissoes p
    where p.membro_id = private.membro_atual() and p.modulo = p_modulo and p.acao = p_acao
  )
$$;

create function private.alcance(p_modulo text, p_acao text) returns text
language sql stable security definer set search_path = '' as $$
  select p.alcance from public.permissoes p
  where p.membro_id = private.membro_atual() and p.modulo = p_modulo and p.acao = p_acao
$$;

-- Pode ver um registro do módulo? Considera o alcance "só os próprios".
create function private.ve_registro(p_modulo text, p_criado_por uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pode(p_modulo, 'ver')
     and (private.alcance(p_modulo, 'ver') = 'tudo' or p_criado_por = auth.uid())
$$;

-- 2FA confirmado há no máximo 10 minutos (claim "amr" do JWT do Supabase).
create function private.totp_recente() returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
    where e ->> 'method' = 'totp'
      and (e ->> 'timestamp') ~ '^[0-9]{1,12}$'
      and (e ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 600
  )
$$;

-- Registra a tentativa negada e devolve o erro (sem exceção, para o registro persistir).
create function private.negar(p_operacao text, p_codigo text default 'sem_permissao') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.registrar('acesso_negado', null, p_operacao, null, jsonb_build_object('motivo', p_codigo));
  return private.erro(p_codigo);
end $$;

-- Verificação padrão no início de cada RPC. Devolve jsonb de erro, ou null se pode seguir.
create function private.checar(p_operacao text, p_modulo text default null, p_acao text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := private.sessao_erro();
begin
  if v = 'sem_acesso' then return private.negar(p_operacao, v); end if;
  if v is not null then return private.erro(v); end if;
  if p_modulo = 'acessos' then
    if not private.is_admin() then return private.negar(p_operacao); end if;
    if not private.totp_recente() then return private.erro('confirme_2fa'); end if;
  elsif p_modulo is not null and not private.pode(p_modulo, p_acao) then
    return private.negar(p_operacao);
  end if;
  return null;
end $$;

create policy membros_ler on public.membros for select to authenticated
  using ((select private.membro_atual()) is not null);
create policy permissoes_ler on public.permissoes for select to authenticated
  using (membro_id = (select private.membro_atual()) or (select private.is_admin()));
create policy convites_ler on public.convites for select to authenticated
  using ((select private.is_admin()));
create policy notificacoes_ler on public.notificacoes for select to authenticated
  using (membro_id = (select private.membro_atual()));
create policy auditoria_ler on public.auditoria for select to authenticated
  using ((select private.is_admin()));

create function private.permissoes_modelo(p_cargo text) returns jsonb
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

create function private.permissoes_validas(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 200
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where not private.so_chaves(e, array['modulo','acao','alcance'])
          or jsonb_typeof(e -> 'modulo') is distinct from 'string'
          or jsonb_typeof(e -> 'acao') is distinct from 'string'
          or (e ? 'alcance' and jsonb_typeof(e -> 'alcance') is distinct from 'string')
          or not ((e ->> 'modulo') = any (private.modulos()))
          or not ((e ->> 'acao') = any (private.acoes()))
          or coalesce(e ->> 'alcance', 'tudo') not in ('tudo', 'proprios')
     )
$$;

create function private.gravar_permissoes(p_membro uuid, p jsonb) returns void
language sql security definer set search_path = '' as $$
  delete from public.permissoes where membro_id = p_membro;
  insert into public.permissoes (membro_id, modulo, acao, alcance)
  select distinct on (e ->> 'modulo', e ->> 'acao') p_membro, e ->> 'modulo', e ->> 'acao', coalesce(e ->> 'alcance', 'tudo')
  from jsonb_array_elements(p) e
  order by e ->> 'modulo', e ->> 'acao', coalesce(e ->> 'alcance', 'tudo') = 'proprios' desc;
$$;

create function private.lista_permissoes(p_membro uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('modulo', modulo, 'acao', acao, 'alcance', alcance)
                            order by modulo, acao), '[]'::jsonb)
  from public.permissoes where membro_id = p_membro
$$;

create function private.notificar(p_membro uuid, p_texto text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notificacoes (membro_id, texto) values (p_membro, left(p_texto, 500));
$$;

create function private.email_valido(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and char_length(p) between 6 and 254
     and p ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$'
$$;

-- Executado UMA vez pelo dono do projeto no SQL Editor do Supabase (não exposto à API).
create function private.bootstrap_admin(p_email text, p_nome text, p_cargo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(btrim(p_email));
begin
  if exists (select 1 from public.membros) then
    raise exception 'Já existem membros: use o convite pelo sistema';
  end if;
  if not (p_cargo = any (private.cargos_admin())) then
    raise exception 'O primeiro membro precisa ser presidente, vice-presidente ou secretário';
  end if;
  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is null then raise exception 'Crie antes o usuário % no Authentication do Supabase', v_email; end if;
  insert into public.membros (id, nome, email, cargo) values (v_id, btrim(p_nome), v_email, p_cargo);
  perform private.gravar_permissoes(v_id, private.permissoes_modelo(p_cargo));
  return v_id;
end $$;

create function private.meu_perfil() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('meu_perfil'); m public.membros;
begin
  if v_erro is not null then return v_erro; end if;
  select * into m from public.membros where id = auth.uid();
  return jsonb_build_object('ok', true,
    'membro', jsonb_build_object('id', m.id, 'nome', m.nome, 'email', m.email, 'cargo', m.cargo,
                                 'admin', m.cargo = any (private.cargos_admin()),
                                 'acesso_expira_em', m.acesso_expira_em),
    'permissoes', private.lista_permissoes(m.id),
    'avisos_nao_lidos', (select count(*) from public.notificacoes n where n.membro_id = m.id and n.lida_em is null));
end $$;

create function private.modelo_permissoes(p_cargo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('modelo_permissoes');
begin
  if v_erro is not null then return v_erro; end if;
  if not private.is_admin() then return private.negar('modelo_permissoes'); end if;
  if not (p_cargo = any (private.cargos())) then return private.erro('invalido', 'cargo'); end if;
  return jsonb_build_object('ok', true, 'permissoes', private.permissoes_modelo(p_cargo));
end $$;

create function private.registrar_convite(p_email text, p_nome text, p_cargo text, p_permissoes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('registrar_convite', 'acessos');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.email_valido(v_email) then return private.erro('invalido', 'email'); end if;
  if not private.texto_ok(p_nome, 2, 120) then return private.erro('invalido', 'nome'); end if;
  if not (coalesce(p_cargo, '') = any (private.cargos())) then return private.erro('invalido', 'cargo'); end if;
  if not coalesce(private.permissoes_validas(p_permissoes), false) then return private.erro('invalido', 'permissoes'); end if;
  if exists (select 1 from public.membros where email = v_email) then return private.erro('ja_e_membro'); end if;

  update public.convites set cancelado_em = now()
   where email = v_email and usado_em is null and cancelado_em is null;
  insert into public.convites (email, nome, cargo, permissoes, criado_por)
  values (v_email, btrim(p_nome), p_cargo, p_permissoes, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'convite_id', v_id, 'email', v_email);
end $$;

create function private.cancelar_convite(p_convite uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('cancelar_convite', 'acessos');
begin
  if v_erro is not null then return v_erro; end if;
  update public.convites set cancelado_em = now()
   where id = p_convite and usado_em is null and cancelado_em is null;
  if not found then return private.erro('nao_encontrado'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Chamado pelo próprio convidado no primeiro login (ainda sem 2FA).
-- O e-mail vem do Auth, nunca do cliente.
create function private.aceitar_convite() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text; c public.convites;
begin
  if auth.uid() is null then return private.erro('nao_autenticado'); end if;
  if exists (select 1 from public.membros where id = auth.uid()) then
    return jsonb_build_object('ok', true, 'ja_membro', true);
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into c from public.convites
   where email = v_email and usado_em is null and cancelado_em is null and expira_em > now()
   for update;
  if c.id is null then return private.negar('aceitar_convite', 'convite_invalido'); end if;
  insert into public.membros (id, nome, email, cargo) values (auth.uid(), c.nome, v_email, c.cargo);
  perform private.gravar_permissoes(auth.uid(), c.permissoes);
  update public.convites set usado_em = now(), usado_por = auth.uid() where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

-- Administradores permanentes (sem prazo de acesso) que contam para o mínimo de 2.
create function private.admins_permanentes(p_excluir uuid default null) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.membros
  where ativo and acesso_expira_em is null and cargo = any (private.cargos_admin())
    and (p_excluir is null or id <> p_excluir)
$$;

create function private.alterar_membro(p_membro uuid, p_cargo text, p_ativo boolean, p_acesso_expira_em timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('alterar_membro', 'acessos');
  m public.membros;
  v_antes int; v_depois int;
begin
  if v_erro is not null then return v_erro; end if;
  if p_membro = auth.uid() then return private.negar('alterar_membro', 'proprio_acesso'); end if;
  if not (coalesce(p_cargo, '') = any (private.cargos())) then return private.erro('invalido', 'cargo'); end if;
  if p_ativo is null then return private.erro('invalido', 'ativo'); end if;
  if p_acesso_expira_em is not null and p_acesso_expira_em <= now() then
    return private.erro('invalido', 'acesso_expira_em');
  end if;

  -- trava as linhas para que duas mudanças simultâneas não furem o mínimo de admins
  perform 1 from public.membros order by id for update;
  select * into m from public.membros where id = p_membro;
  if m.id is null then return private.erro('nao_encontrado'); end if;

  v_antes := private.admins_permanentes();
  v_depois := private.admins_permanentes(p_membro)
            + case when p_ativo and p_acesso_expira_em is null and p_cargo = any (private.cargos_admin()) then 1 else 0 end;
  if v_depois < least(2, v_antes) then return private.erro('minimo_admins'); end if;

  update public.membros
     set cargo = p_cargo, ativo = p_ativo, acesso_expira_em = p_acesso_expira_em, atualizado_em = now()
   where id = p_membro;
  perform private.notificar(p_membro, 'Seu acesso ao sistema foi alterado por um administrador.');
  return jsonb_build_object('ok', true);
end $$;

create function private.definir_permissoes(p_membro uuid, p_permissoes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('definir_permissoes', 'acessos'); v_antes jsonb;
begin
  if v_erro is not null then return v_erro; end if;
  if p_membro = auth.uid() then return private.negar('definir_permissoes', 'proprio_acesso'); end if;
  if not coalesce(private.permissoes_validas(p_permissoes), false) then return private.erro('invalido', 'permissoes'); end if;
  if not exists (select 1 from public.membros where id = p_membro) then return private.erro('nao_encontrado'); end if;
  v_antes := private.lista_permissoes(p_membro);
  perform private.gravar_permissoes(p_membro, p_permissoes);
  perform private.registrar('alterar', 'permissoes', p_membro::text, v_antes, private.lista_permissoes(p_membro));
  perform private.notificar(p_membro, 'Suas permissões no sistema foram alteradas por um administrador.');
  return jsonb_build_object('ok', true);
end $$;

create function private.marcar_avisos_lidos() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('marcar_avisos_lidos');
begin
  if v_erro is not null then return v_erro; end if;
  update public.notificacoes set lida_em = now() where membro_id = auth.uid() and lida_em is null;
  return jsonb_build_object('ok', true);
end $$;

-- Invólucros SECURITY INVOKER: o schema exposto não tem nenhuma função SECURITY DEFINER
-- (recomendação dos advisors do Supabase). Quem decide é a implementação em private.
create function public.meu_perfil() returns jsonb
  language sql security invoker set search_path = '' as $$ select private.meu_perfil() $$;
create function public.modelo_permissoes(p_cargo text) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.modelo_permissoes(p_cargo) $$;
create function public.registrar_convite(p_email text, p_nome text, p_cargo text, p_permissoes jsonb) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.registrar_convite(p_email, p_nome, p_cargo, p_permissoes) $$;
create function public.cancelar_convite(p_convite uuid) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.cancelar_convite(p_convite) $$;
create function public.aceitar_convite() returns jsonb
  language sql security invoker set search_path = '' as $$ select private.aceitar_convite() $$;
create function public.alterar_membro(p_membro uuid, p_cargo text, p_ativo boolean, p_acesso_expira_em timestamptz) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.alterar_membro(p_membro, p_cargo, p_ativo, p_acesso_expira_em) $$;
create function public.definir_permissoes(p_membro uuid, p_permissoes jsonb) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.definir_permissoes(p_membro, p_permissoes) $$;
create function public.marcar_avisos_lidos() returns jsonb
  language sql security invoker set search_path = '' as $$ select private.marcar_avisos_lidos() $$;

-- Regra: nada para PUBLIC/anon. authenticated executa os invólucros públicos, as
-- implementações das RPCs e os auxiliares usados nas políticas de RLS.
revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
grant execute on function
  public.meu_perfil(), public.modelo_permissoes(text), public.registrar_convite(text, text, text, jsonb),
  public.cancelar_convite(uuid), public.aceitar_convite(), public.alterar_membro(uuid, text, boolean, timestamptz),
  public.definir_permissoes(uuid, jsonb), public.marcar_avisos_lidos()
  to authenticated;
grant execute on function
  private.meu_perfil(), private.modelo_permissoes(text), private.registrar_convite(text, text, text, jsonb),
  private.cancelar_convite(uuid), private.aceitar_convite(), private.alterar_membro(uuid, text, boolean, timestamptz),
  private.definir_permissoes(uuid, jsonb), private.marcar_avisos_lidos(),
  private.membro_atual(), private.is_admin(), private.pode(text, text), private.alcance(text, text),
  private.ve_registro(text, uuid), private.sessao_erro()
  to authenticated;
