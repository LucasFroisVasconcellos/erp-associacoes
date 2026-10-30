-- 0021 · Captação de recursos.
-- Funil de patrocínio e de apoiadores (inclusive a campanha de Imposto de Renda) com histórico
-- de conversas; contrapartidas prometidas, com foto da entrega; rifas e eventos com vendedores
-- e resultado; recibos de doação numerados sem buraco, emitidos pela tesouraria.

create table public.oportunidades (
  id uuid primary key,
  tipo text not null check (tipo in ('patrocinio', 'doacao', 'incentivo_ir', 'edital', 'outro')),
  nome text not null check (private.texto_ok(nome, 2, 160)),
  contato text check (private.texto_opcional_ok(contato, 160)),
  etapa text not null default 'prospeccao' check (etapa in ('prospeccao', 'contato', 'proposta', 'fechado', 'renovacao', 'perdido')),
  valor_estimado numeric(14, 2) check (valor_estimado between 0 and 100000000),
  proximo_passo text check (private.texto_opcional_ok(proximo_passo, 200)),
  proximo_passo_em date,
  verba_id uuid references public.verbas (id),
  responsavel uuid references public.membros (id),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index oportunidades_proximo_idx on public.oportunidades (proximo_passo_em) where proximo_passo_em is not null and etapa not in ('fechado', 'perdido');
create index oportunidades_verba_idx on public.oportunidades (verba_id) where verba_id is not null;
create index oportunidades_responsavel_idx on public.oportunidades (responsavel) where responsavel is not null;
create index oportunidades_criado_por_idx on public.oportunidades (criado_por);

create table public.oportunidade_interacoes (
  id uuid primary key,
  oportunidade_id uuid not null references public.oportunidades (id),
  data date not null,
  texto text not null check (char_length(btrim(texto)) between 2 and 1000 and texto !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  autor uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create index oportunidade_interacoes_op_idx on public.oportunidade_interacoes (oportunidade_id, data desc);
create index oportunidade_interacoes_autor_idx on public.oportunidade_interacoes (autor);

create table public.contrapartidas (
  id uuid primary key,
  verba_id uuid not null references public.verbas (id),
  descricao text not null check (private.texto_ok(descricao, 2, 200)),
  prazo date,
  entregue_em date,
  observacao text check (private.texto_opcional_ok(observacao, 300)),
  arquivo_caminho text unique,
  arquivo_mime text,
  arquivo_tamanho int check (arquivo_tamanho between 1 and 10485760),
  arquivo_sha256 text check (arquivo_sha256 ~ '^[0-9a-f]{64}$'),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create index contrapartidas_verba_idx on public.contrapartidas (verba_id);
create index contrapartidas_prazo_idx on public.contrapartidas (prazo) where entregue_em is null;
create index contrapartidas_criado_por_idx on public.contrapartidas (criado_por);

create table public.acoes_captacao (
  id uuid primary key,
  tipo text not null check (tipo in ('rifa', 'evento')),
  nome text not null check (private.texto_ok(nome, 2, 160)),
  data date not null,
  preco_unitario numeric(14, 2) check (preco_unitario between 0 and 100000),
  quantidade int check (quantidade between 1 and 100000),
  custo numeric(14, 2) not null default 0 check (custo between 0 and 10000000),
  situacao text not null default 'planejada' check (situacao in ('planejada', 'em_andamento', 'encerrada', 'cancelada')),
  -- rifas e sorteios têm regras legais próprias: onde está a autorização ou o parecer do contador
  autorizacao text check (private.texto_opcional_ok(autorizacao, 300)),
  evento_id uuid references public.eventos (id),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index acoes_captacao_data_idx on public.acoes_captacao (data);
create index acoes_captacao_evento_idx on public.acoes_captacao (evento_id) where evento_id is not null;
create index acoes_captacao_criado_por_idx on public.acoes_captacao (criado_por);

create table public.acao_vendedores (
  id uuid primary key,
  acao_id uuid not null references public.acoes_captacao (id),
  nome text not null check (private.texto_ok(nome, 2, 120)),
  membro_id uuid references public.membros (id),
  bilhetes int not null default 0 check (bilhetes between 0 and 100000),
  vendidos int not null default 0 check (vendidos between 0 and 100000),
  valor_prestado numeric(14, 2) not null default 0 check (valor_prestado between 0 and 10000000),
  lancamento_id uuid unique references public.lancamentos (id),
  check (vendidos <= bilhetes or bilhetes = 0)
);
create index acao_vendedores_acao_idx on public.acao_vendedores (acao_id);
create index acao_vendedores_membro_idx on public.acao_vendedores (membro_id) where membro_id is not null;
create unique index acao_vendedores_nome_unico on public.acao_vendedores (acao_id, lower(nome));

create table private.recibo_contadores (ano int primary key, ultimo int not null);

create function private.documento_valido(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare d int[]; s int; r int; i int; pesos int[];
begin
  if p is null or p !~ '^([0-9]{11}|[0-9]{14})$' or p ~ '^(.)\1+$' then return false; end if;
  d := array(select substr(p, k, 1)::int from generate_series(1, length(p)) k);
  if length(p) = 11 then
    for i in 1..2 loop
      s := 0;
      for k in 1..(8 + i) loop s := s + d[k] * ((10 + i) - k); end loop;
      r := (s * 10) % 11; if r = 10 then r := 0; end if;
      if r <> d[9 + i] then return false; end if;
    end loop;
    return true;
  end if;
  for i in 1..2 loop
    pesos := case when i = 1 then array[5,4,3,2,9,8,7,6,5,4,3,2] else array[6,5,4,3,2,9,8,7,6,5,4,3,2] end;
    s := 0;
    for k in 1..(11 + i) loop s := s + d[k] * pesos[k]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> d[12 + i] then return false; end if;
  end loop;
  return true;
end $$;

create table public.recibos (
  id uuid primary key,
  ano int not null check (ano between 2023 and 2200),
  numero int not null check (numero >= 1),
  doador_nome text not null check (private.texto_ok(doador_nome, 2, 160)),
  doador_documento text check (doador_documento is null or private.documento_valido(doador_documento)),
  valor numeric(14, 2) not null check (valor > 0 and valor <= 100000000),
  data date not null,
  forma text not null check (forma in ('dinheiro', 'bens', 'servicos')),
  descricao text check (private.texto_opcional_ok(descricao, 300)),
  lancamento_id uuid unique references public.lancamentos (id),
  oportunidade_id uuid references public.oportunidades (id),
  emitido_por uuid not null references public.membros (id),
  emitido_em timestamptz not null default now(),
  cancelado_em timestamptz,
  cancelado_por uuid references public.membros (id),
  motivo_cancelamento text check (private.texto_opcional_ok(motivo_cancelamento, 300)),
  unique (ano, numero),
  check ((forma = 'dinheiro') = (lancamento_id is not null)),
  check ((cancelado_em is null) = (motivo_cancelamento is null))
);
create index recibos_oportunidade_idx on public.recibos (oportunidade_id) where oportunidade_id is not null;
create index recibos_emitido_por_idx on public.recibos (emitido_por);
create index recibos_cancelado_por_idx on public.recibos (cancelado_por) where cancelado_por is not null;

do $$ declare t text; begin
  foreach t in array array['oportunidades','oportunidade_interacoes','contrapartidas','acoes_captacao','acao_vendedores','recibos'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.trg_auditar()', t || '_auditar', t);
  end loop;
  foreach t in array array['oportunidades','oportunidade_interacoes','contrapartidas','acoes_captacao','recibos'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.trg_sem_apagar()', t || '_sem_apagar', t);
  end loop;
  foreach t in array array['oportunidades','oportunidade_interacoes','acoes_captacao','acao_vendedores'] loop
    execute format('create policy ler on public.%I for select to authenticated using ((select private.pode(''captacao'', ''ver'')))', t);
  end loop;
end $$;
create policy ler on public.contrapartidas for select to authenticated
  using ((select private.pode('captacao', 'ver')) or (select private.pode('verbas', 'ver')));
-- recibo traz CPF do doador: só tesouraria e quem cuida da captação
create policy ler on public.recibos for select to authenticated
  using (((select private.pode('financeiro', 'ver')) and (select private.alcance('financeiro', 'ver')) = 'tudo') or (select private.pode('captacao', 'editar')));

alter table public.configuracoes drop constraint configuracoes_chave_check;
alter table public.configuracoes add constraint configuracoes_chave_check check (chave in ('pix', 'entidade'));

create function private.salvar_config_entidade(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_config_entidade', 'financeiro', 'administrar'); v_cnpj text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['nome','cnpj','endereco']), false) then return private.erro('invalido'); end if;
  if not private.texto_ok(private.j_texto(p -> 'nome'), 3, 160) then return private.erro('invalido', 'nome'); end if;
  v_cnpj := regexp_replace(coalesce(private.j_texto(p -> 'cnpj'), ''), '[.\-/ ]', '', 'g');
  if length(v_cnpj) <> 14 or not private.documento_valido(v_cnpj) then return private.erro('invalido', 'cnpj'); end if;
  if not private.texto_ok(private.j_texto(p -> 'endereco'), 5, 200) then return private.erro('invalido', 'endereco'); end if;
  insert into public.configuracoes (chave, valor, atualizado_por)
  values ('entidade', jsonb_build_object('nome', private.j_texto(p -> 'nome'), 'cnpj', v_cnpj, 'endereco', private.j_texto(p -> 'endereco')), auth.uid())
  on conflict (chave) do update set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now();
  return jsonb_build_object('ok', true);
end $$;

create function private.salvar_oportunidade(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_oportunidade', 'captacao', 'criar'); v_id uuid; o public.oportunidades;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','tipo','nome','contato','etapa','valor_estimado','proximo_passo','proximo_passo_em','verba_id','responsavel']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if coalesce(private.j_texto(p -> 'tipo'), '') not in ('patrocinio', 'doacao', 'incentivo_ir', 'edital', 'outro') then return private.erro('invalido', 'tipo'); end if;
  if not private.texto_ok(private.j_texto(p -> 'nome'), 2, 160) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'contato') and not private.texto_ok(private.j_texto(p -> 'contato'), 2, 160) then return private.erro('invalido', 'contato'); end if;
  if coalesce(private.j_texto(p -> 'etapa'), 'prospeccao') not in ('prospeccao', 'contato', 'proposta', 'fechado', 'renovacao', 'perdido') then return private.erro('invalido', 'etapa'); end if;
  if not private.vazio(p -> 'valor_estimado') and private.j_valor(p -> 'valor_estimado') is null then return private.erro('invalido', 'valor_estimado'); end if;
  if not private.vazio(p -> 'proximo_passo') and not private.texto_ok(private.j_texto(p -> 'proximo_passo'), 2, 200) then return private.erro('invalido', 'proximo_passo'); end if;
  if not private.vazio(p -> 'proximo_passo_em') and (private.j_data(p -> 'proximo_passo_em') is null or private.j_data(p -> 'proximo_passo_em') > private.hoje() + 1000) then
    return private.erro('invalido', 'proximo_passo_em');
  end if;
  if not private.vazio(p -> 'verba_id') and not exists (select 1 from public.verbas where id = private.j_uuid(p -> 'verba_id')) then return private.erro('invalido', 'verba_id'); end if;
  if not private.vazio(p -> 'responsavel') and not private.membro_ativo(private.j_uuid(p -> 'responsavel')) then return private.erro('invalido', 'responsavel'); end if;
  select * into o from public.oportunidades where id = v_id for update;
  if o.id is not null and not private.pode('captacao', 'editar') and auth.uid() not in (o.criado_por, coalesce(o.responsavel, o.criado_por)) then
    return private.negar('salvar_oportunidade');
  end if;
  insert into public.oportunidades (id, tipo, nome, contato, etapa, valor_estimado, proximo_passo, proximo_passo_em, verba_id, responsavel, criado_por)
  values (v_id, p ->> 'tipo', private.j_texto(p -> 'nome'), nullif(private.j_texto(p -> 'contato'), ''), coalesce(private.j_texto(p -> 'etapa'), 'prospeccao'),
          private.j_valor(p -> 'valor_estimado'), nullif(private.j_texto(p -> 'proximo_passo'), ''), private.j_data(p -> 'proximo_passo_em'),
          private.j_uuid(p -> 'verba_id'), private.j_uuid(p -> 'responsavel'), auth.uid())
  on conflict (id) do update set tipo = excluded.tipo, nome = excluded.nome, contato = excluded.contato, etapa = excluded.etapa,
    valor_estimado = excluded.valor_estimado, proximo_passo = excluded.proximo_passo, proximo_passo_em = excluded.proximo_passo_em,
    verba_id = excluded.verba_id, responsavel = excluded.responsavel, atualizado_em = now();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.registrar_interacao(p_oportunidade uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('registrar_interacao', 'captacao', 'criar'); v_id uuid; v_novo uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','data','texto']), false) then return private.erro('invalido'); end if;
  if not exists (select 1 from public.oportunidades where id = p_oportunidade) then return private.erro('nao_encontrado'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if private.j_data(p -> 'data') is null or private.j_data(p -> 'data') > private.hoje() then return private.erro('invalido', 'data'); end if;
  if jsonb_typeof(p -> 'texto') <> 'string' or char_length(btrim(p ->> 'texto')) not between 2 and 1000 or not private.texto_longo_ok(p ->> 'texto', 1000) then
    return private.erro('invalido', 'texto');
  end if;
  insert into public.oportunidade_interacoes (id, oportunidade_id, data, texto, autor)
  values (v_id, p_oportunidade, private.j_data(p -> 'data'), btrim(p ->> 'texto'), auth.uid())
  on conflict (id) do nothing returning id into v_novo;
  update public.oportunidades set atualizado_em = now() where id = p_oportunidade;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', v_novo is null);
end $$;

create function private.salvar_contrapartida(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_contrapartida', 'captacao', 'criar'); v_id uuid; c public.contrapartidas;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','verba_id','descricao','prazo','entregue_em','observacao']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if not exists (select 1 from public.verbas where id = private.j_uuid(p -> 'verba_id')) then return private.erro('invalido', 'verba_id'); end if;
  if not private.texto_ok(private.j_texto(p -> 'descricao'), 2, 200) then return private.erro('invalido', 'descricao'); end if;
  if not private.vazio(p -> 'prazo') and private.j_data(p -> 'prazo') is null then return private.erro('invalido', 'prazo'); end if;
  if not private.vazio(p -> 'entregue_em') and (private.j_data(p -> 'entregue_em') is null or private.j_data(p -> 'entregue_em') > private.hoje()) then
    return private.erro('invalido', 'entregue_em');
  end if;
  if not private.vazio(p -> 'observacao') and not private.texto_ok(private.j_texto(p -> 'observacao'), 2, 300) then return private.erro('invalido', 'observacao'); end if;
  select * into c from public.contrapartidas where id = v_id for update;
  if c.id is not null and c.verba_id <> private.j_uuid(p -> 'verba_id') then return private.erro('conflito', 'id'); end if;
  if c.id is not null and not private.pode('captacao', 'editar') and c.criado_por <> auth.uid() then return private.negar('salvar_contrapartida'); end if;
  insert into public.contrapartidas (id, verba_id, descricao, prazo, entregue_em, observacao, criado_por)
  values (v_id, private.j_uuid(p -> 'verba_id'), private.j_texto(p -> 'descricao'), private.j_data(p -> 'prazo'), private.j_data(p -> 'entregue_em'),
          nullif(private.j_texto(p -> 'observacao'), ''), auth.uid())
  on conflict (id) do update set descricao = excluded.descricao, prazo = excluded.prazo, entregue_em = excluded.entregue_em, observacao = excluded.observacao;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_acao_captacao(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_acao_captacao', 'captacao', 'criar'); v_id uuid; a public.acoes_captacao;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','tipo','nome','data','preco_unitario','quantidade','custo','situacao','autorizacao','evento_id']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if coalesce(private.j_texto(p -> 'tipo'), '') not in ('rifa', 'evento') then return private.erro('invalido', 'tipo'); end if;
  if not private.texto_ok(private.j_texto(p -> 'nome'), 2, 160) then return private.erro('invalido', 'nome'); end if;
  if private.j_data(p -> 'data') is null or private.j_data(p -> 'data') not between private.hoje() - 3700 and private.hoje() + 1000 then return private.erro('invalido', 'data'); end if;
  if not private.vazio(p -> 'preco_unitario') and private.j_valor(p -> 'preco_unitario') is null then return private.erro('invalido', 'preco_unitario'); end if;
  if not private.vazio(p -> 'quantidade') and coalesce(private.j_inteiro(p -> 'quantidade'), 0) not between 1 and 100000 then return private.erro('invalido', 'quantidade'); end if;
  if not private.vazio(p -> 'custo') and private.j_valor(p -> 'custo') is null then return private.erro('invalido', 'custo'); end if;
  if coalesce(private.j_texto(p -> 'situacao'), 'planejada') not in ('planejada', 'em_andamento', 'encerrada', 'cancelada') then return private.erro('invalido', 'situacao'); end if;
  if not private.vazio(p -> 'autorizacao') and not private.texto_ok(private.j_texto(p -> 'autorizacao'), 2, 300) then return private.erro('invalido', 'autorizacao'); end if;
  if not private.vazio(p -> 'evento_id') and not exists (select 1 from public.eventos where id = private.j_uuid(p -> 'evento_id')) then return private.erro('invalido', 'evento_id'); end if;
  select * into a from public.acoes_captacao where id = v_id for update;
  if a.id is not null and not private.pode('captacao', 'editar') and a.criado_por <> auth.uid() then return private.negar('salvar_acao_captacao'); end if;
  insert into public.acoes_captacao (id, tipo, nome, data, preco_unitario, quantidade, custo, situacao, autorizacao, evento_id, criado_por)
  values (v_id, p ->> 'tipo', private.j_texto(p -> 'nome'), private.j_data(p -> 'data'), private.j_valor(p -> 'preco_unitario'), private.j_inteiro(p -> 'quantidade'),
          coalesce(private.j_valor(p -> 'custo'), 0), coalesce(private.j_texto(p -> 'situacao'), 'planejada'), nullif(private.j_texto(p -> 'autorizacao'), ''),
          private.j_uuid(p -> 'evento_id'), auth.uid())
  on conflict (id) do update set tipo = excluded.tipo, nome = excluded.nome, data = excluded.data, preco_unitario = excluded.preco_unitario,
    quantidade = excluded.quantidade, custo = excluded.custo, situacao = excluded.situacao, autorizacao = excluded.autorizacao,
    evento_id = excluded.evento_id, atualizado_em = now();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Vendedor da rifa (ou equipe do evento): bilhetes recebidos, vendidos e valor prestado, ligado à entrada no Dinheiro.
create function private.salvar_vendedor(p_acao uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_vendedor', 'captacao', 'criar'); v_id uuid; a public.acoes_captacao; v public.acao_vendedores; v_lanc uuid; v_bil int; v_vend int;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','membro_id','bilhetes','vendidos','valor_prestado','lancamento_id']), false) then return private.erro('invalido'); end if;
  select * into a from public.acoes_captacao where id = p_acao for update;
  if a.id is null then return private.erro('nao_encontrado'); end if;
  if a.situacao in ('encerrada', 'cancelada') then return private.erro('invalido', 'situacao'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  select * into v from public.acao_vendedores where id = v_id for update;
  if v.id is not null and v.acao_id <> p_acao then return private.erro('conflito', 'id'); end if;
  if not private.texto_ok(private.j_texto(p -> 'nome'), 2, 120) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'membro_id') and not private.membro_ativo(private.j_uuid(p -> 'membro_id')) then return private.erro('invalido', 'membro_id'); end if;
  v_bil := coalesce(private.j_inteiro(p -> 'bilhetes'), 0); v_vend := coalesce(private.j_inteiro(p -> 'vendidos'), 0);
  if v_bil not between 0 and 100000 or v_vend not between 0 and 100000 or (v_bil > 0 and v_vend > v_bil) then return private.erro('invalido', 'vendidos'); end if;
  if a.quantidade is not null and (select coalesce(sum(bilhetes), 0) from public.acao_vendedores where acao_id = p_acao and id <> v_id) + v_bil > a.quantidade then
    return private.erro('invalido', 'bilhetes');
  end if;
  if not private.vazio(p -> 'valor_prestado') and private.j_valor(p -> 'valor_prestado') is null then return private.erro('invalido', 'valor_prestado'); end if;
  if not private.vazio(p -> 'lancamento_id') then
    v_lanc := private.j_uuid(p -> 'lancamento_id');
    if v_lanc is null or not exists (select 1 from public.lancamentos l where l.id = v_lanc and l.tipo = 'entrada' and l.situacao = 'realizada' and l.estorno_de is null)
       or exists (select 1 from public.acao_vendedores x where x.lancamento_id = v_lanc and x.id <> v_id)
       or exists (select 1 from public.recibos r where r.lancamento_id = v_lanc) then
      return private.erro('invalido', 'lancamento_id');
    end if;
  end if;
  if exists (select 1 from public.acao_vendedores where acao_id = p_acao and lower(nome) = lower(private.j_texto(p -> 'nome')) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.acao_vendedores (id, acao_id, nome, membro_id, bilhetes, vendidos, valor_prestado, lancamento_id)
  values (v_id, p_acao, private.j_texto(p -> 'nome'), private.j_uuid(p -> 'membro_id'), v_bil, v_vend, coalesce(private.j_valor(p -> 'valor_prestado'), 0), v_lanc)
  on conflict (id) do update set nome = excluded.nome, membro_id = excluded.membro_id, bilhetes = excluded.bilhetes, vendidos = excluded.vendidos,
    valor_prestado = excluded.valor_prestado, lancamento_id = excluded.lancamento_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Número sequencial por ano, sem buraco: o contador sobe na mesma transação do recibo.
create function private.emitir_recibo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('emitir_recibo', 'financeiro', 'editar'); v_id uuid; v_ano int; v_num int; v_forma text; v_lanc uuid; l public.lancamentos; v_doc text; r public.recibos;
begin
  if v_erro is not null then return v_erro; end if;
  -- recibo é documento do dinheiro da Associação Exemplo: só a tesouraria emite (e precisa ver a captação)
  if not private.pode('captacao', 'ver') then return private.negar('emitir_recibo'); end if;
  if not coalesce(private.so_chaves(p, array['id','doador_nome','doador_documento','valor','data','forma','descricao','lancamento_id','oportunidade_id']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  select * into r from public.recibos where id = v_id;
  if r.id is not null then return jsonb_build_object('ok', true, 'id', r.id, 'ano', r.ano, 'numero', r.numero, 'repetido', true); end if;
  if not private.texto_ok(private.j_texto(p -> 'doador_nome'), 2, 160) then return private.erro('invalido', 'doador_nome'); end if;
  if not private.vazio(p -> 'doador_documento') then
    v_doc := regexp_replace(coalesce(private.j_texto(p -> 'doador_documento'), ''), '[.\-/ ]', '', 'g');
    if not private.documento_valido(v_doc) then return private.erro('invalido', 'doador_documento'); end if;
  end if;
  if private.j_valor(p -> 'valor') is null or private.j_valor(p -> 'valor') <= 0 then return private.erro('invalido', 'valor'); end if;
  if private.j_data(p -> 'data') is null or private.j_data(p -> 'data') > private.hoje() or private.j_data(p -> 'data') < private.hoje() - 800 then return private.erro('invalido', 'data'); end if;
  v_forma := private.j_texto(p -> 'forma');
  if coalesce(v_forma, '') not in ('dinheiro', 'bens', 'servicos') then return private.erro('invalido', 'forma'); end if;
  if not private.vazio(p -> 'descricao') and not private.texto_ok(private.j_texto(p -> 'descricao'), 2, 300) then return private.erro('invalido', 'descricao'); end if;
  if v_forma <> 'dinheiro' and private.vazio(p -> 'descricao') then return private.erro('invalido', 'descricao'); end if;
  if not private.vazio(p -> 'oportunidade_id') and not exists (select 1 from public.oportunidades where id = private.j_uuid(p -> 'oportunidade_id')) then
    return private.erro('invalido', 'oportunidade_id');
  end if;
  if v_forma = 'dinheiro' then
    -- doação em dinheiro só com a entrada já lançada, do mesmo valor, sem outro recibo
    v_lanc := private.j_uuid(p -> 'lancamento_id');
    select * into l from public.lancamentos where id = v_lanc for update;
    if l.id is null or l.tipo <> 'entrada' or l.situacao <> 'realizada' or l.estorno_de is not null or l.valor <> private.j_valor(p -> 'valor')
       or exists (select 1 from public.lancamentos e where e.estorno_de = l.id)
       or exists (select 1 from public.recibos x where x.lancamento_id = l.id)
       or exists (select 1 from public.acao_vendedores x where x.lancamento_id = l.id) then
      return private.erro('invalido', 'lancamento_id');
    end if;
  elsif not private.vazio(p -> 'lancamento_id') then
    return private.erro('invalido', 'lancamento_id');
  end if;
  v_ano := extract(year from private.j_data(p -> 'data'))::int;
  insert into private.recibo_contadores (ano, ultimo) values (v_ano, 1)
  on conflict (ano) do update set ultimo = private.recibo_contadores.ultimo + 1
  returning ultimo into v_num;
  insert into public.recibos (id, ano, numero, doador_nome, doador_documento, valor, data, forma, descricao, lancamento_id, oportunidade_id, emitido_por)
  values (v_id, v_ano, v_num, private.j_texto(p -> 'doador_nome'), v_doc, private.j_valor(p -> 'valor'), private.j_data(p -> 'data'), v_forma,
          nullif(private.j_texto(p -> 'descricao'), ''), v_lanc, private.j_uuid(p -> 'oportunidade_id'), auth.uid());
  return jsonb_build_object('ok', true, 'id', v_id, 'ano', v_ano, 'numero', v_num);
end $$;

-- Recibo emitido não some: cancela com motivo e o número fica marcado como cancelado.
create function private.cancelar_recibo(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('cancelar_recibo', 'financeiro', 'editar'); r public.recibos;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into r from public.recibos where id = p_id for update;
  if r.id is null then return private.erro('nao_encontrado'); end if;
  if r.cancelado_em is not null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.recibos set cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = btrim(p_motivo) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Resumo do funil (Início e tela de Captação).
create function private.painel_captacao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('painel_captacao', 'captacao', 'ver'); v_hoje date := private.hoje();
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true,
    'etapas', coalesce((select jsonb_object_agg(etapa, jsonb_build_object('n', n, 'valor', v::text))
       from (select etapa, count(*) n, coalesce(sum(valor_estimado), 0) v from public.oportunidades group by etapa) x), '{}'),
    'passos_atrasados', (select count(*) from public.oportunidades where proximo_passo_em < v_hoje and etapa not in ('fechado', 'perdido')),
    'contrapartidas_atrasadas', (select count(*) from public.contrapartidas where entregue_em is null and prazo < v_hoje),
    'acoes', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'arrecadado', s.arrecadado::text, 'vendidos', s.vendidos,
         'resultado', (s.arrecadado - a.custo)::text))
       from public.acoes_captacao a
       cross join lateral (select coalesce(sum(valor_prestado), 0) arrecadado, coalesce(sum(vendidos), 0) vendidos from public.acao_vendedores v where v.acao_id = a.id) s), '[]'));
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('captacao', 'captacao', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy erp_captacao_ler on storage.objects for select to authenticated
  using (bucket_id = 'captacao' and ((select private.pode('captacao', 'ver')) or (select private.pode('verbas', 'ver')))
         and exists (select 1 from public.contrapartidas c where c.arquivo_caminho = storage.objects.name));

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
  v_bucket := case v_area when 'pessoa' then 'pessoas' when 'saude' then 'saude' when 'institucional' then 'institucional' when 'contrapartida' then 'captacao' end;
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
  if v_area = 'pessoa' then
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

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('salvar_oportunidade', 300), ('registrar_interacao', 300), ('salvar_contrapartida', 300), ('salvar_acao_captacao', 100),
  ('salvar_vendedor', 500), ('emitir_recibo', 100), ('cancelar_recibo', 30), ('painel_captacao', 300), ('salvar_config_entidade', 20);

create function public.salvar_oportunidade(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_oportunidade(p) $$;
create function public.registrar_interacao(p_oportunidade uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_interacao(p_oportunidade, p) $$;
create function public.salvar_contrapartida(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_contrapartida(p) $$;
create function public.salvar_acao_captacao(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_acao_captacao(p) $$;
create function public.salvar_vendedor(p_acao uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_vendedor(p_acao, p) $$;
create function public.emitir_recibo(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.emitir_recibo(p) $$;
create function public.cancelar_recibo(p_id uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.cancelar_recibo(p_id, p_motivo) $$;
create function public.salvar_config_entidade(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_config_entidade(p) $$;
create function public.painel_captacao() returns jsonb language sql security invoker set search_path = '' as $$ select private.painel_captacao() $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['salvar_oportunidade(jsonb)','registrar_interacao(uuid,jsonb)','salvar_contrapartida(jsonb)','salvar_acao_captacao(jsonb)',
                           'salvar_vendedor(uuid,jsonb)','emitir_recibo(jsonb)','cancelar_recibo(uuid,text)','painel_captacao()','salvar_config_entidade(jsonb)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
