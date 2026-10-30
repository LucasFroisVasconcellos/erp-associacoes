-- 0030: "Pedir acesso" — formulário público com CAPTCHA, só nome e e-mail. O pedido só fica pendente; quem libera é
-- um administrador (vira convite, com o cargo e as permissões que ELE escolher) ou recusa.
-- Quem grava o pedido é só a Edge Function "pedir-acesso" (service role), depois de validar o
-- Turnstile no servidor. O formulário nunca dispara e-mail (não serve de relé de spam) e a
-- resposta é sempre a mesma (não revela se o e-mail já pediu ou já é membro).

create table public.pedidos_acesso (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (private.texto_ok(nome, 2, 120)),
  email text not null check (email = lower(email) and private.email_valido(email)),
  ip_hash text check (ip_hash ~ '^[0-9a-f]{64}$'), -- HMAC do IP, só para limitar abuso; some na decisão
  situacao text not null default 'pendente' check (situacao in ('pendente', 'aprovado', 'recusado')),
  decidido_por uuid references public.membros (id),
  decidido_em timestamptz,
  motivo text check (private.texto_opcional_ok(motivo, 300)),
  criado_em timestamptz not null default now(),
  check ((situacao = 'pendente') = (decidido_em is null)),
  check (situacao = 'pendente' or ip_hash is null)
);
create unique index pedidos_acesso_um_pendente on public.pedidos_acesso (email) where situacao = 'pendente';
create index pedidos_acesso_ip_idx on public.pedidos_acesso (ip_hash, criado_em) where ip_hash is not null;
create index pedidos_acesso_decidido_por_idx on public.pedidos_acesso (decidido_por) where decidido_por is not null;
select private.proteger_tabela('public.pedidos_acesso');
-- administradores leem, mas nunca o ip_hash
revoke select on public.pedidos_acesso from authenticated;
grant select (id, nome, email, situacao, decidido_por, decidido_em, motivo, criado_em) on public.pedidos_acesso to authenticated;
create policy ler on public.pedidos_acesso for select to authenticated using ((select private.is_admin()));
create trigger pedidos_acesso_auditar after insert or update or delete on public.pedidos_acesso for each row execute function private.trg_auditar_sensivel();

-- Só a service role (Edge Function), depois do CAPTCHA validado no servidor.
create function private.registrar_pedido_acesso(p jsonb, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_nome text;
begin
  if not coalesce(private.so_chaves(p, array['nome','email']), false) then return private.erro('invalido'); end if;
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then return private.erro('invalido', 'ip'); end if;
  v_email := lower(btrim(coalesce(private.j_texto(p -> 'email'), '')));
  v_nome := btrim(coalesce(private.j_texto(p -> 'nome'), ''));
  if not private.email_valido(v_email) then return private.erro('invalido', 'email'); end if;
  if not private.texto_ok(v_nome, 2, 120) then return private.erro('invalido', 'nome'); end if;
  -- uma checagem de limite por vez para o mesmo IP (pedidos simultâneos não furam o limite)
  perform pg_advisory_xact_lock(hashtextextended('pedido_acesso:' || p_ip_hash, 0));
  -- limpeza oportunista (retenção): decididos somem em 90 dias; pendentes esquecidos, em 60
  delete from public.pedidos_acesso where (situacao <> 'pendente' and decidido_em < now() - interval '90 days')
                                        or (situacao = 'pendente' and criado_em < now() - interval '60 days');
  -- limites: 3 por hora por IP; no máximo 50 pendentes no total (a fila não cresce sem fim)
  if (select count(*) from public.pedidos_acesso where ip_hash = p_ip_hash and criado_em > now() - interval '1 hour') >= 3 then return private.erro('limite'); end if;
  if (select count(*) from public.pedidos_acesso where situacao = 'pendente') >= 50 then return private.erro('limite'); end if;
  -- já pediu ou já é membro: mesma resposta, nada novo gravado
  if exists (select 1 from public.pedidos_acesso where email = v_email and situacao = 'pendente')
     or exists (select 1 from public.membros where email = v_email) then
    return jsonb_build_object('ok', true);
  end if;
  insert into public.pedidos_acesso (nome, email, ip_hash)
  values (v_nome, v_email, p_ip_hash)
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- Administrador (com 2FA recente) decide. Aprovar exige que o convite já tenha sido feito para o
-- mesmo e-mail depois do pedido (o convite carrega cargo e permissões escolhidos pelo administrador).
create function private.decidir_pedido_acesso(p_id uuid, p_decisao text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('decidir_pedido_acesso', 'acessos'); x public.pedidos_acesso;
begin
  if v_erro is not null then return v_erro; end if;
  if p_decisao not in ('aprovado', 'recusado') then return private.erro('invalido', 'decisao'); end if;
  if not private.texto_opcional_ok(nullif(btrim(coalesce(p_motivo, '')), ''), 300) then return private.erro('invalido', 'motivo'); end if;
  select * into x from public.pedidos_acesso where id = p_id for update;
  if x.id is null then return private.erro('nao_encontrado'); end if;
  if x.situacao <> 'pendente' then return jsonb_build_object('ok', x.situacao = p_decisao, 'repetido', true, 'erro', case when x.situacao <> p_decisao then 'ja_decidido' end); end if;
  if p_decisao = 'aprovado' and not exists (
       select 1 from public.convites c where c.email = x.email and c.criado_em >= x.criado_em and c.cancelado_em is null) then
    return private.erro('sem_convite');
  end if;
  update public.pedidos_acesso set situacao = p_decisao, decidido_por = auth.uid(), decidido_em = now(),
    motivo = nullif(btrim(coalesce(p_motivo, '')), ''), ip_hash = null where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('decidir_pedido_acesso', 100);

create function public.registrar_pedido_acesso(p jsonb, p_ip_hash text) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_pedido_acesso(p, p_ip_hash) $$;
create function public.decidir_pedido_acesso(p_id uuid, p_decisao text, p_motivo text default null) returns jsonb language sql security invoker set search_path = '' as $$ select private.decidir_pedido_acesso(p_id, p_decisao, p_motivo) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function public.registrar_pedido_acesso(jsonb, text) from authenticated;
revoke all on function private.registrar_pedido_acesso(jsonb, text) from authenticated;
grant execute on function public.registrar_pedido_acesso(jsonb, text) to service_role;
grant execute on function private.registrar_pedido_acesso(jsonb, text) to service_role;
grant execute on function public.decidir_pedido_acesso(uuid, text, text) to authenticated;
grant execute on function private.decidir_pedido_acesso(uuid, text, text) to authenticated;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
