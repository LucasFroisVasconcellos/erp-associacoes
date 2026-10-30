-- 0005 · Comprovantes e arquivos do contador.
-- Fluxo: o navegador envia o arquivo para a Edge Function "enviar-arquivo"; ela confere
-- a sessão (autorizar_*), o tamanho e o tipo REAL pelos bytes iniciais, grava com nome
-- aleatório em bucket privado usando a service role e chama registrar_* (só service_role).
-- O cliente nunca grava no storage diretamente; lê por URL assinada, conforme a RLS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('comprovantes', 'comprovantes', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml', 'text/xml']),
  ('contador', 'contador', false, 10485760,
   array['application/pdf', 'text/csv', 'text/plain', 'application/xml', 'text/xml',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/x-ofx'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function private.origens_comprovante() returns text[] language sql immutable set search_path = '' as $$
  select array['camera','galeria','pdf','scanner','colado','arrastado','qrcode','codigo_barras','xml','outro']
$$;

create table public.comprovantes (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references public.lancamentos (id),
  caminho text not null unique,
  mime text not null,
  tamanho int not null check (tamanho between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  origem text not null check (origem = any (private.origens_comprovante())),
  chave_acesso text check (chave_acesso ~ '^[0-9]{44}$'),
  codigo_barras text check (codigo_barras ~ '^[0-9]{44,48}$'),
  url_qrcode text check (char_length(url_qrcode) <= 600 and url_qrcode ~ '^https://'),
  enviado_por uuid not null references public.membros (id),
  enviado_em timestamptz not null default now()
);
create index comprovantes_lancamento_idx on public.comprovantes (lancamento_id);
create index comprovantes_enviado_por_idx on public.comprovantes (enviado_por);
create index comprovantes_sha_idx on public.comprovantes (sha256);
create index comprovantes_chave_idx on public.comprovantes (chave_acesso) where chave_acesso is not null;
create index comprovantes_codigo_idx on public.comprovantes (codigo_barras) where codigo_barras is not null;

create table public.arquivos_contador (
  id uuid primary key default gen_random_uuid(),
  competencia date not null check (extract(day from competencia) = 1),
  tipo text not null check (tipo in ('balancete','demonstracao','relatorio','obrigacoes','folha','outro')),
  descricao text check (private.texto_opcional_ok(descricao, 200)),
  nome_original text not null check (char_length(nome_original) between 1 and 150),
  caminho text not null unique,
  mime text not null,
  tamanho int not null check (tamanho between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  enviado_por uuid not null references public.membros (id),
  enviado_em timestamptz not null default now()
);
create index arquivos_contador_competencia_idx on public.arquivos_contador (competencia desc);
create index arquivos_contador_enviado_por_idx on public.arquivos_contador (enviado_por);

select private.proteger_tabela('public.comprovantes');
select private.proteger_tabela('public.arquivos_contador');
create trigger comprovantes_auditar after insert or update or delete on public.comprovantes
  for each row execute function private.trg_auditar();
create trigger arquivos_contador_auditar after insert or update or delete on public.arquivos_contador
  for each row execute function private.trg_auditar();
create trigger comprovantes_sem_apagar before update or delete on public.comprovantes
  for each row execute function private.bloquear_auditoria();
create trigger arquivos_contador_sem_apagar before update or delete on public.arquivos_contador
  for each row execute function private.bloquear_auditoria();

create policy ler on public.comprovantes for select to authenticated
  using (exists (select 1 from public.lancamentos l where l.id = lancamento_id));  -- herda a RLS de lancamentos
create policy ler on public.arquivos_contador for select to authenticated
  using ((select private.pode('contador', 'ver')));

-- Storage: leitura só do que a pessoa pode ver; nenhuma escrita pelo cliente.
create policy erp_exige_2fa on storage.objects as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy erp_comprovantes_ler on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes'
         and exists (select 1 from public.comprovantes c where c.caminho = storage.objects.name));
create policy erp_contador_ler on storage.objects for select to authenticated
  using (bucket_id = 'contador' and (select private.pode('contador', 'ver'))
         and exists (select 1 from public.arquivos_contador a where a.caminho = storage.objects.name));

create function private.autorizar_comprovante(p_lancamento uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('autorizar_comprovante', 'financeiro', 'ver'); l public.lancamentos;
begin
  if v_erro is not null then return v_erro; end if;
  select * into l from public.lancamentos where id = p_lancamento;
  if l.id is null then return private.erro('nao_encontrado'); end if;
  if not (private.pode('financeiro', 'editar') or (l.criado_por = auth.uid() and private.pode('financeiro', 'criar'))) then
    return private.negar('autorizar_comprovante');
  end if;
  return jsonb_build_object('ok', true, 'membro_id', auth.uid(), 'lancamento_id', l.id);
end $$;

create function private.autorizar_arquivo_contador() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('autorizar_arquivo_contador', 'contador', 'criar');
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true, 'membro_id', auth.uid());
end $$;

create function private.objeto_storage(p_bucket text, p_nome text) returns storage.objects
language sql stable security definer set search_path = '' as $$
  select * from storage.objects o where o.bucket_id = p_bucket and o.name = p_nome
$$;

create function private.registrar_comprovante(p_usuario uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lanc uuid; v_caminho text; v_sha text; v_origem text; v_chave text; v_codigo text; v_url text;
  o storage.objects; v_mime text; v_tam int; v_dup boolean; v_id uuid;
begin
  if not exists (select 1 from public.membros where id = p_usuario and ativo) then return private.erro('invalido', 'usuario'); end if;
  perform set_config('app.ator', p_usuario::text, true);
  if not coalesce(private.so_chaves(p, array['lancamento_id','caminho','sha256','origem','chave_acesso','codigo_barras','url_qrcode']), false) then
    return private.erro('invalido');
  end if;
  v_lanc := private.j_uuid(p -> 'lancamento_id');
  if v_lanc is null or not exists (select 1 from public.lancamentos where id = v_lanc) then return private.erro('invalido', 'lancamento_id'); end if;
  v_caminho := private.j_texto(p -> 'caminho');
  if coalesce(v_caminho, '') !~ ('^' || v_lanc::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf|xml)$') then
    return private.erro('invalido', 'caminho');
  end if;
  v_sha := private.j_texto(p -> 'sha256');
  if coalesce(v_sha, '') !~ '^[0-9a-f]{64}$' then return private.erro('invalido', 'sha256'); end if;
  v_origem := private.j_texto(p -> 'origem');
  if not (coalesce(v_origem, '') = any (private.origens_comprovante())) then return private.erro('invalido', 'origem'); end if;
  if not private.vazio(p -> 'chave_acesso') then
    v_chave := private.j_texto(p -> 'chave_acesso');
    if coalesce(v_chave, '') !~ '^[0-9]{44}$' then return private.erro('invalido', 'chave_acesso'); end if;
  end if;
  if not private.vazio(p -> 'codigo_barras') then
    v_codigo := private.j_texto(p -> 'codigo_barras');
    if coalesce(v_codigo, '') !~ '^[0-9]{44,48}$' then return private.erro('invalido', 'codigo_barras'); end if;
  end if;
  if not private.vazio(p -> 'url_qrcode') then
    v_url := private.j_texto(p -> 'url_qrcode');
    if coalesce(v_url, '') !~ '^https://[^\s]{1,590}$' then return private.erro('invalido', 'url_qrcode'); end if;
  end if;

  o := private.objeto_storage('comprovantes', v_caminho);
  if o.id is null then return private.erro('arquivo_inexistente'); end if;
  if exists (select 1 from public.comprovantes where caminho = v_caminho) then return private.erro('ja_registrado'); end if;
  v_mime := coalesce(o.metadata ->> 'mimetype', '');
  v_tam := coalesce((o.metadata ->> 'size')::int, 0);
  if not (v_mime = any (array['image/jpeg','image/png','image/webp','application/pdf','application/xml','text/xml'])) then
    return private.erro('invalido', 'mime');
  end if;
  if v_tam not between 1 and 10485760 then return private.erro('invalido', 'tamanho'); end if;

  v_dup := exists (select 1 from public.comprovantes c
                   where c.sha256 = v_sha or (v_chave is not null and c.chave_acesso = v_chave)
                      or (v_codigo is not null and c.codigo_barras = v_codigo));
  insert into public.comprovantes (lancamento_id, caminho, mime, tamanho, sha256, origem, chave_acesso, codigo_barras, url_qrcode, enviado_por)
  values (v_lanc, v_caminho, v_mime, v_tam, v_sha, v_origem, v_chave, v_codigo, v_url, p_usuario)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'duplicado', v_dup);
end $$;

create function private.registrar_arquivo_contador(p_usuario uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_comp date; v_tipo text; v_nome text; v_caminho text; v_sha text; o storage.objects; v_id uuid;
begin
  if not exists (select 1 from public.membros where id = p_usuario and ativo) then return private.erro('invalido', 'usuario'); end if;
  perform set_config('app.ator', p_usuario::text, true);
  if not coalesce(private.so_chaves(p, array['competencia','tipo','descricao','nome_original','caminho','sha256']), false) then
    return private.erro('invalido');
  end if;
  v_comp := private.j_data(p -> 'competencia');
  if v_comp is null or extract(day from v_comp) <> 1 or v_comp > private.hoje() then return private.erro('invalido', 'competencia'); end if;
  v_tipo := private.j_texto(p -> 'tipo');
  if coalesce(v_tipo, '') not in ('balancete','demonstracao','relatorio','obrigacoes','folha','outro') then return private.erro('invalido', 'tipo'); end if;
  if not private.vazio(p -> 'descricao') and not private.texto_ok(private.j_texto(p -> 'descricao'), 2, 200) then return private.erro('invalido', 'descricao'); end if;
  v_nome := private.j_texto(p -> 'nome_original');
  if not private.texto_ok(v_nome, 1, 150) or v_nome ~ '[<>:"/\\|?*]' then return private.erro('invalido', 'nome_original'); end if;
  v_caminho := private.j_texto(p -> 'caminho');
  if coalesce(v_caminho, '') !~ ('^' || to_char(v_comp, 'YYYY-MM') || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|csv|txt|xml|xlsx|xls|docx|ofx)$') then
    return private.erro('invalido', 'caminho');
  end if;
  v_sha := private.j_texto(p -> 'sha256');
  if coalesce(v_sha, '') !~ '^[0-9a-f]{64}$' then return private.erro('invalido', 'sha256'); end if;
  o := private.objeto_storage('contador', v_caminho);
  if o.id is null then return private.erro('arquivo_inexistente'); end if;
  if exists (select 1 from public.arquivos_contador where caminho = v_caminho) then return private.erro('ja_registrado'); end if;
  insert into public.arquivos_contador (competencia, tipo, descricao, nome_original, caminho, mime, tamanho, sha256, enviado_por)
  values (v_comp, v_tipo, private.j_texto(p -> 'descricao'), v_nome, v_caminho, coalesce(o.metadata ->> 'mimetype', 'application/octet-stream'),
          coalesce((o.metadata ->> 'size')::int, 0), v_sha, p_usuario)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.verificar_duplicidade(p_sha256 text, p_chave text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('verificar_duplicidade', 'financeiro', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  if p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$' then return private.erro('invalido', 'sha256'); end if;
  if p_chave is not null and p_chave !~ '^[0-9]{44}$' then return private.erro('invalido', 'chave'); end if;
  if p_codigo is not null and p_codigo !~ '^[0-9]{44,48}$' then return private.erro('invalido', 'codigo'); end if;
  return jsonb_build_object('ok', true, 'lancamentos', coalesce((
    select jsonb_agg(distinct c.lancamento_id) from public.comprovantes c
    join public.lancamentos l on l.id = c.lancamento_id
    where (c.sha256 = p_sha256 or c.chave_acesso = p_chave or c.codigo_barras = p_codigo)
      and private.ve_registro('financeiro', l.criado_por)), '[]'::jsonb));
end $$;
