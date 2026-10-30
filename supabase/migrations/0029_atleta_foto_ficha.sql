-- 0029: foto 3x4 (opcional) e ficha esportiva do atleta.
-- Foto: só com autorização de imagem ativa; sai sozinha ao revogar a autorização ou ao desligar a pessoa.
-- Ficha: lista fixa de campos, nenhum dado de saúde (classe funcional e deficiência continuam na área de saúde).

alter table public.pessoas
  add column foto_caminho text,
  add column foto_mime text check (foto_mime in ('image/jpeg', 'image/png', 'image/webp')),
  add column foto_tamanho int check (foto_tamanho between 1 and 10485760),
  add column foto_sha256 text check (foto_sha256 ~ '^[0-9a-f]{64}$'),
  add column apelido text check (private.texto_opcional_ok(apelido, 40)),
  add column numero_camisa smallint check (numero_camisa between 0 and 99),
  add column posicao text check (private.texto_opcional_ok(posicao, 40)),
  add column tamanho_uniforme text check (tamanho_uniforme in ('PP', 'P', 'M', 'G', 'GG', 'XGG')),
  add column registro_federacao text check (private.texto_opcional_ok(registro_federacao, 40)),
  add column na_associacao_desde date check (na_associacao_desde >= date '1950-01-01'),
  add column emergencia_nome text check (private.texto_opcional_ok(emergencia_nome, 120)),
  add column emergencia_telefone text check (emergencia_telefone ~ '^\+?[0-9]{10,13}$'),
  add constraint pessoas_foto_completa check ((foto_caminho is null) = (foto_mime is null) and (foto_caminho is null) = (foto_sha256 is null));
create unique index pessoas_foto_caminho_idx on public.pessoas (foto_caminho) where foto_caminho is not null;

-- quem vê pessoas vê a foto (link assinado de 60 s), e só a foto que está no cadastro agora
create policy erp_fotos_ler on storage.objects for select to authenticated
  using (bucket_id = 'pessoas' and (select private.pode('pessoas', 'ver'))
         and exists (select 1 from public.pessoas p where p.foto_caminho = storage.objects.name));

create or replace function private.autorizar_documento(p_area text, p_documento uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb; v_pessoa uuid;
begin
  if p_area = 'pessoa' then
    v_erro := private.checar('autorizar_documento', 'pessoas', 'editar');
    if v_erro is not null then return v_erro; end if;
    if not exists (select 1 from public.documentos_pessoa where id = p_documento and arquivado_em is null) then return private.erro('nao_encontrado'); end if;
  elsif p_area = 'saude' then
    v_erro := private.checar('autorizar_documento', 'saude', 'editar');
    if v_erro is not null then return v_erro; end if;
    select pessoa_id into v_pessoa from public.documentos_saude where id = p_documento;
    if v_pessoa is null then return private.erro('nao_encontrado'); end if;
    if not private.consentimento_ativo(v_pessoa, 'saude') then return private.erro('sem_consentimento'); end if;
  elsif p_area = 'institucional' then
    v_erro := private.checar('autorizar_documento', 'documentos', 'criar');
    if v_erro is not null then return v_erro; end if;
    if not exists (select 1 from public.documentos_institucionais where id = p_documento and arquivado_em is null) then return private.erro('nao_encontrado'); end if;
  elsif p_area = 'contrapartida' then
    v_erro := private.checar('autorizar_documento', 'captacao', 'criar');
    if v_erro is not null then return v_erro; end if;
    if not exists (select 1 from public.contrapartidas where id = p_documento) then return private.erro('nao_encontrado'); end if;
  elsif p_area = 'foto_pessoa' then
    -- foto 3x4: "documento" é a própria pessoa; só com autorização de imagem ativa (fail closed)
    v_erro := private.checar('autorizar_documento', 'pessoas', 'editar');
    if v_erro is not null then return v_erro; end if;
    if not exists (select 1 from public.pessoas where id = p_documento and situacao <> 'desligado') then return private.erro('nao_encontrado'); end if;
    if not private.consentimento_ativo(p_documento, 'imagem') then return private.erro('sem_consentimento'); end if;
  else
    return private.erro('invalido', 'area');
  end if;
  return jsonb_build_object('ok', true, 'membro_id', auth.uid(), 'documento_id', p_documento);
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
  if v_tam not between 1 and 10485760 then return private.erro('invalido', 'tamanho'); end if;
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

create function private.salvar_ficha_atleta(p_pessoa uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_ficha_atleta', 'pessoas', 'editar'); x public.pessoas; m jsonb; k text; v_num int; v_desde date;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['apelido','numero_camisa','posicao','tamanho_uniforme','registro_federacao','na_associacao_desde',
       'emergencia_nome','emergencia_telefone']), false) then return private.erro('invalido'); end if;
  select * into x from public.pessoas where id = p_pessoa for update;
  if x.id is null then return private.erro('nao_encontrado'); end if;
  if x.situacao = 'desligado' then return private.erro('pessoa_desligada'); end if;
  m := jsonb_build_object('apelido', x.apelido, 'numero_camisa', x.numero_camisa, 'posicao', x.posicao, 'tamanho_uniforme', x.tamanho_uniforme,
         'registro_federacao', x.registro_federacao, 'na_associacao_desde', to_char(x.na_associacao_desde, 'YYYY-MM-DD'),
         'emergencia_nome', x.emergencia_nome, 'emergencia_telefone', x.emergencia_telefone) || p;
  foreach k in array array['apelido', 'posicao', 'registro_federacao', 'emergencia_nome'] loop
    if not private.vazio(m -> k) and (jsonb_typeof(m -> k) <> 'string'
        or not private.texto_opcional_ok(m ->> k, case when k = 'emergencia_nome' then 120 else 40 end)) then
      return private.erro('invalido', k);
    end if;
  end loop;
  if not private.vazio(m -> 'numero_camisa') then
    if jsonb_typeof(m -> 'numero_camisa') <> 'number' or (m ->> 'numero_camisa') !~ '^[0-9]{1,2}$' then return private.erro('invalido', 'numero_camisa'); end if;
    v_num := (m ->> 'numero_camisa')::int;
  end if;
  if not private.vazio(m -> 'tamanho_uniforme') and coalesce(m ->> 'tamanho_uniforme', '') not in ('PP', 'P', 'M', 'G', 'GG', 'XGG') then return private.erro('invalido', 'tamanho_uniforme'); end if;
  if not private.vazio(m -> 'na_associacao_desde') then
    v_desde := private.j_data(m -> 'na_associacao_desde');
    if v_desde is null or v_desde not between date '1950-01-01' and private.hoje() then return private.erro('invalido', 'na_associacao_desde'); end if;
  end if;
  if not private.vazio(m -> 'emergencia_telefone') and (jsonb_typeof(m -> 'emergencia_telefone') <> 'string' or (m ->> 'emergencia_telefone') !~ '^\+?[0-9]{10,13}$') then
    return private.erro('invalido', 'emergencia_telefone');
  end if;
  update public.pessoas set apelido = nullif(btrim(coalesce(m ->> 'apelido', '')), ''), numero_camisa = v_num, posicao = nullif(btrim(coalesce(m ->> 'posicao', '')), ''),
    tamanho_uniforme = nullif(m ->> 'tamanho_uniforme', ''), registro_federacao = nullif(btrim(coalesce(m ->> 'registro_federacao', '')), ''), na_associacao_desde = v_desde,
    emergencia_nome = nullif(btrim(coalesce(m ->> 'emergencia_nome', '')), ''), emergencia_telefone = nullif(m ->> 'emergencia_telefone', ''), atualizado_em = now()
  where id = p_pessoa;
  return jsonb_build_object('ok', true);
end $$;

-- tirar a foto (a pessoa pediu, ou a diretoria trocou de ideia)
create function private.remover_foto_pessoa(p_pessoa uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('remover_foto_pessoa', 'pessoas', 'editar'); v_antigo text;
begin
  if v_erro is not null then return v_erro; end if;
  select foto_caminho into v_antigo from public.pessoas where id = p_pessoa for update;
  if not found then return private.erro('nao_encontrado'); end if;
  if v_antigo is null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.pessoas set foto_caminho = null, foto_mime = null, foto_tamanho = null, foto_sha256 = null, atualizado_em = now() where id = p_pessoa;
  insert into private.arquivos_remover (bucket, caminho, motivo) values ('pessoas', v_antigo, 'foto_removida') on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- desligou: foto e contato de emergência saem na hora (não servem mais à finalidade)
create function private.trg_pessoa_desligada() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.situacao = 'desligado' and old.situacao <> 'desligado' then
    if old.foto_caminho is not null then
      insert into private.arquivos_remover (bucket, caminho, motivo) values ('pessoas', old.foto_caminho, 'desligado') on conflict do nothing;
    end if;
    new.foto_caminho := null; new.foto_mime := null; new.foto_tamanho := null; new.foto_sha256 := null;
    new.emergencia_nome := null; new.emergencia_telefone := null;
  end if;
  return new;
end $$;
create trigger pessoas_desligada before update of situacao on public.pessoas for each row execute function private.trg_pessoa_desligada();

-- autorização de imagem revogada: a foto sai
create function private.trg_imagem_revogada() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_antigo text;
begin
  if new.finalidade = 'imagem' and new.revogado_em is not null and old.revogado_em is null
     and not private.consentimento_ativo(new.pessoa_id, 'imagem') then
    select foto_caminho into v_antigo from public.pessoas where id = new.pessoa_id for update;
    if v_antigo is not null then
      update public.pessoas set foto_caminho = null, foto_mime = null, foto_tamanho = null, foto_sha256 = null, atualizado_em = now() where id = new.pessoa_id;
      insert into private.arquivos_remover (bucket, caminho, motivo) values ('pessoas', v_antigo, 'imagem_revogada') on conflict do nothing;
    end if;
  end if;
  return null;
end $$;
create trigger consentimentos_imagem_revogada after update of revogado_em on public.consentimentos for each row execute function private.trg_imagem_revogada();

insert into private.limites_operacao (operacao, maximo_por_hora) values ('salvar_ficha_atleta', 300), ('remover_foto_pessoa', 60);

create function public.salvar_ficha_atleta(p_pessoa uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_ficha_atleta(p_pessoa, p) $$;
create function public.remover_foto_pessoa(p_pessoa uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.remover_foto_pessoa(p_pessoa) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function private.trg_pessoa_desligada() from authenticated, service_role;
revoke all on function private.trg_imagem_revogada() from authenticated, service_role;
do $$
declare f text;
begin
  foreach f in array array['salvar_ficha_atleta(uuid,jsonb)','remover_foto_pessoa(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
