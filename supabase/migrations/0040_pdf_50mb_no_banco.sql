-- 0040: PDF de até 50 MB também no banco. A 0037 subiu o limite dos buckets e a função
-- enviar-arquivo já aceitava 50 MB, mas o registro no banco continuava em 10 MB: o arquivo
-- subia, o banco recusava ("invalido/tamanho") e o arquivo era apagado. Achado em produção
-- ao enviar o estatuto (PDF de 20 MB).
-- Regra única, no servidor: PDF até 50 MB (52428800); foto e demais tipos até 10 MB (10485760).

create function private.tamanho_arquivo_ok(p_mime text, p_tamanho bigint) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_tamanho between 1 and case when p_mime = 'application/pdf' then 52428800 else 10485760 end, false)
$$;

-- restrições das tabelas: mesma regra (a foto 3x4 é só imagem e continua em 10 MB)
alter table public.comprovantes drop constraint comprovantes_tamanho_check,
  add constraint comprovantes_tamanho_check check (private.tamanho_arquivo_ok(mime, tamanho));
alter table public.arquivos_contador drop constraint arquivos_contador_tamanho_check,
  add constraint arquivos_contador_tamanho_check check (private.tamanho_arquivo_ok(mime, tamanho));
alter table public.documentos_pessoa drop constraint documentos_pessoa_arquivo_tamanho_check,
  add constraint documentos_pessoa_arquivo_tamanho_check check (arquivo_tamanho is null or private.tamanho_arquivo_ok(arquivo_mime, arquivo_tamanho));
alter table public.documentos_saude drop constraint documentos_saude_arquivo_tamanho_check,
  add constraint documentos_saude_arquivo_tamanho_check check (arquivo_tamanho is null or private.tamanho_arquivo_ok(arquivo_mime, arquivo_tamanho));
alter table public.documentos_institucionais drop constraint documentos_institucionais_arquivo_tamanho_check,
  add constraint documentos_institucionais_arquivo_tamanho_check check (arquivo_tamanho is null or private.tamanho_arquivo_ok(arquivo_mime, arquivo_tamanho));
alter table public.contrapartidas drop constraint contrapartidas_arquivo_tamanho_check,
  add constraint contrapartidas_arquivo_tamanho_check check (arquivo_tamanho is null or private.tamanho_arquivo_ok(arquivo_mime, arquivo_tamanho));

create or replace function private.registrar_comprovante(p_usuario uuid, p jsonb) returns jsonb
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
  if not private.tamanho_arquivo_ok(v_mime, v_tam) then return private.erro('invalido', 'tamanho'); end if;

  v_dup := exists (select 1 from public.comprovantes c
                   where c.sha256 = v_sha or (v_chave is not null and c.chave_acesso = v_chave)
                      or (v_codigo is not null and c.codigo_barras = v_codigo));
  insert into public.comprovantes (lancamento_id, caminho, mime, tamanho, sha256, origem, chave_acesso, codigo_barras, url_qrcode, enviado_por)
  values (v_lanc, v_caminho, v_mime, v_tam, v_sha, v_origem, v_chave, v_codigo, v_url, p_usuario)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'duplicado', v_dup);
end $$;

create or replace function private.registrar_documento(p_usuario uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_area text; v_doc uuid; v_caminho text; v_sha text; v_bucket text; o storage.objects; v_antigo text; v_mime text; v_tam int;
begin
  if not exists (select 1 from public.membros where id = p_usuario and ativo) then return private.erro('invalido', 'usuario'); end if;
  perform set_config('app.ator', p_usuario::text, true);
  if not coalesce(private.so_chaves(p, array['area','documento_id','caminho','sha256']), false) then return private.erro('invalido'); end if;
  v_area := private.j_texto(p -> 'area');
  v_bucket := case v_area when 'pessoa' then 'pessoas' when 'saude' then 'saude' when 'institucional' then 'institucional' when 'contrapartida' then 'captacao' when 'foto_pessoa' then 'pessoas' end;
  if v_bucket is null then return private.erro('invalido', 'area'); end if;
  v_doc := private.j_uuid(p -> 'documento_id'); if v_doc is null then return private.erro('invalido', 'documento_id'); end if;
  v_caminho := private.j_texto(p -> 'caminho');
  if coalesce(v_caminho, '') !~ ('^' || v_doc::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$') then
    return private.erro('invalido', 'caminho');
  end if;
  v_sha := private.j_texto(p -> 'sha256'); if coalesce(v_sha, '') !~ '^[0-9a-f]{64}$' then return private.erro('invalido', 'sha256'); end if;
  o := private.objeto_storage(v_bucket, v_caminho);
  if o.id is null then return private.erro('arquivo_inexistente'); end if;
  v_mime := coalesce(o.metadata ->> 'mimetype', '');
  v_tam := coalesce((o.metadata ->> 'size')::int, 0);
  if not (v_mime = any (array['image/jpeg','image/png','image/webp','application/pdf'])) then return private.erro('invalido', 'mime'); end if;
  if not private.tamanho_arquivo_ok(v_mime, v_tam) then return private.erro('invalido', 'tamanho'); end if;
  if v_area = 'foto_pessoa' then
    if v_mime = 'application/pdf' then return private.erro('invalido', 'mime'); end if;
    select foto_caminho into v_antigo from public.pessoas where id = v_doc and situacao <> 'desligado' for update;
    if not found then return private.erro('nao_encontrado'); end if;
    if not private.consentimento_ativo(v_doc, 'imagem') then return private.erro('sem_consentimento'); end if;
    update public.pessoas set foto_caminho = v_caminho, foto_mime = v_mime, foto_tamanho = v_tam, foto_sha256 = v_sha, atualizado_em = now() where id = v_doc;
  elsif v_area = 'pessoa' then
    select arquivo_caminho into v_antigo from public.documentos_pessoa where id = v_doc for update;
    if not found then return private.erro('nao_encontrado'); end if;
    update public.documentos_pessoa set arquivo_caminho = v_caminho, arquivo_mime = v_mime, arquivo_tamanho = v_tam, arquivo_sha256 = v_sha,
      entregue_em = coalesce(entregue_em, private.hoje()) where id = v_doc;
  elsif v_area = 'saude' then
    select arquivo_caminho into v_antigo from public.documentos_saude where id = v_doc for update;
    if not found then return private.erro('nao_encontrado'); end if;
    if not private.consentimento_ativo((select pessoa_id from public.documentos_saude where id = v_doc), 'saude') then return private.erro('sem_consentimento'); end if;
    update public.documentos_saude set arquivo_caminho = v_caminho, arquivo_mime = v_mime, arquivo_tamanho = v_tam, arquivo_sha256 = v_sha where id = v_doc;
  elsif v_area = 'institucional' then
    select arquivo_caminho into v_antigo from public.documentos_institucionais where id = v_doc for update;
    if not found then return private.erro('nao_encontrado'); end if;
    update public.documentos_institucionais set arquivo_caminho = v_caminho, arquivo_mime = v_mime, arquivo_tamanho = v_tam, arquivo_sha256 = v_sha where id = v_doc;
  else
    select arquivo_caminho into v_antigo from public.contrapartidas where id = v_doc for update;
    if not found then return private.erro('nao_encontrado'); end if;
    -- a foto é a prova da entrega
    update public.contrapartidas set arquivo_caminho = v_caminho, arquivo_mime = v_mime, arquivo_tamanho = v_tam, arquivo_sha256 = v_sha,
      entregue_em = coalesce(entregue_em, private.hoje()) where id = v_doc;
  end if;
  if v_antigo is not null and v_antigo <> v_caminho then
    insert into private.arquivos_remover (bucket, caminho, motivo) values (v_bucket, v_antigo, 'substituido') on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_doc);
end $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function private.tamanho_arquivo_ok(text, bigint) from authenticated, service_role, anon;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
