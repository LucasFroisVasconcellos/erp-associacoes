-- 0016 · Patrimônio e materiais.
-- Bens com número de patrimônio e origem; bem comprado com recurso de projeto entra sozinho
-- na relação de bens da prestação de contas; empréstimo a atleta com termo de responsabilidade
-- registrado (versão do termo, quem aceitou e quando); manutenção com custo e próxima data.

create function private.categorias_bem() returns text[] language sql immutable set search_path = '' as $$
  select array['cadeira_jogo','bola','uniforme','equipamento_treino','informatica','outro']
$$;

create table public.bens (
  id uuid primary key,
  numero text not null unique check (numero ~ '^[A-Za-z0-9-]{1,20}$'),
  nome text not null check (private.texto_ok(nome, 2, 120)),
  categoria text not null check (categoria = any (private.categorias_bem())),
  origem text not null check (origem in ('compra', 'doacao', 'projeto', 'outro')),
  projeto_id uuid references public.projetos (id),
  lancamento_id uuid references public.lancamentos (id),
  valor numeric(14, 2) check (valor between 0 and 10000000),
  data_aquisicao date,
  situacao text not null default 'disponivel' check (situacao in ('disponivel', 'emprestado', 'manutencao', 'baixado')),
  baixa_motivo text check (private.texto_opcional_ok(baixa_motivo, 300)),
  observacao text check (char_length(observacao) <= 500 and observacao !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (origem <> 'projeto' or projeto_id is not null),
  check ((situacao = 'baixado') = (baixa_motivo is not null))
);
create index bens_projeto_idx on public.bens (projeto_id) where projeto_id is not null;
create index bens_lancamento_idx on public.bens (lancamento_id) where lancamento_id is not null;
create index bens_criado_por_idx on public.bens (criado_por);

create table public.emprestimos (
  id uuid primary key,
  bem_id uuid not null references public.bens (id),
  pessoa_id uuid not null references public.pessoas (id),
  inicio date not null,
  previsao_devolucao date,
  devolvido_em date,
  -- termo de responsabilidade: versão do texto, quem aceitou (atleta ou responsável) e quando
  termo_versao text not null check (termo_versao ~ '^v[0-9]{1,3}$'),
  termo_aceito_por text not null check (private.texto_ok(termo_aceito_por, 2, 120)),
  termo_aceito_em date not null,
  observacao text check (private.texto_opcional_ok(observacao, 300)),
  registrado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  check (devolvido_em is null or devolvido_em >= inicio),
  check (previsao_devolucao is null or previsao_devolucao >= inicio)
);
create unique index emprestimos_um_aberto on public.emprestimos (bem_id) where devolvido_em is null;
create index emprestimos_pessoa_idx on public.emprestimos (pessoa_id);
create index emprestimos_registrado_por_idx on public.emprestimos (registrado_por);

create table public.manutencoes (
  id uuid primary key,
  bem_id uuid not null references public.bens (id),
  data date not null,
  descricao text not null check (private.texto_ok(descricao, 2, 300)),
  custo numeric(14, 2) check (custo between 0 and 1000000),
  lancamento_id uuid references public.lancamentos (id),
  proxima_em date,
  registrado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create index manutencoes_bem_idx on public.manutencoes (bem_id, data desc);
create index manutencoes_proxima_idx on public.manutencoes (proxima_em) where proxima_em is not null;
create index manutencoes_lancamento_idx on public.manutencoes (lancamento_id) where lancamento_id is not null;
create index manutencoes_registrado_por_idx on public.manutencoes (registrado_por);

do $$ declare t text; begin
  foreach t in array array['bens','emprestimos','manutencoes'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.trg_auditar()', t || '_auditar', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.trg_sem_apagar()', t || '_sem_apagar', t);
    execute format('create policy ler on public.%I for select to authenticated using ((select private.pode(''patrimonio'', ''ver'')))', t);
  end loop;
end $$;

create function private.salvar_bem(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_bem', 'patrimonio', 'criar'); v_id uuid; b public.bens; v_proj uuid; v_lanc uuid; v_num text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','numero','nome','categoria','origem','projeto_id','lancamento_id','valor','data_aquisicao','observacao']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  v_num := upper(private.j_texto(p -> 'numero'));
  if coalesce(v_num, '') !~ '^[A-Z0-9-]{1,20}$' then return private.erro('invalido', 'numero'); end if;
  if not private.texto_ok(private.j_texto(p -> 'nome'), 2, 120) then return private.erro('invalido', 'nome'); end if;
  if not (coalesce(private.j_texto(p -> 'categoria'), '') = any (private.categorias_bem())) then return private.erro('invalido', 'categoria'); end if;
  if coalesce(private.j_texto(p -> 'origem'), '') not in ('compra', 'doacao', 'projeto', 'outro') then return private.erro('invalido', 'origem'); end if;
  if not private.vazio(p -> 'projeto_id') then
    v_proj := private.j_uuid(p -> 'projeto_id');
    if v_proj is null or not exists (select 1 from public.projetos where id = v_proj) then return private.erro('invalido', 'projeto_id'); end if;
  end if;
  if p ->> 'origem' = 'projeto' and v_proj is null then return private.erro('invalido', 'projeto_id'); end if;
  if not private.vazio(p -> 'lancamento_id') then
    v_lanc := private.j_uuid(p -> 'lancamento_id');
    if v_lanc is null or not exists (select 1 from public.lancamentos where id = v_lanc and tipo = 'saida') then return private.erro('invalido', 'lancamento_id'); end if;
  end if;
  if not private.vazio(p -> 'valor') and private.j_valor(p -> 'valor') is null then return private.erro('invalido', 'valor'); end if;
  if not private.vazio(p -> 'data_aquisicao') and (private.j_data(p -> 'data_aquisicao') is null or private.j_data(p -> 'data_aquisicao') > private.hoje()) then return private.erro('invalido', 'data_aquisicao'); end if;
  if not private.vazio(p -> 'observacao') and (jsonb_typeof(p -> 'observacao') <> 'string' or not private.texto_longo_ok(p ->> 'observacao', 500)) then return private.erro('invalido', 'observacao'); end if;
  if exists (select 1 from public.bens where numero = v_num and id <> v_id) then return private.erro('duplicado', 'numero'); end if;
  select * into b from public.bens where id = v_id for update;
  if b.id is not null and not private.pode('patrimonio', 'editar') then return private.negar('salvar_bem'); end if;
  if b.situacao = 'baixado' then return private.erro('bem_baixado'); end if;
  insert into public.bens (id, numero, nome, categoria, origem, projeto_id, lancamento_id, valor, data_aquisicao, observacao, criado_por)
  values (v_id, v_num, private.j_texto(p -> 'nome'), p ->> 'categoria', p ->> 'origem', v_proj, v_lanc, private.j_valor(p -> 'valor'),
          private.j_data(p -> 'data_aquisicao'), nullif(btrim(coalesce(p ->> 'observacao', '')), ''), auth.uid())
  on conflict (id) do update set numero = excluded.numero, nome = excluded.nome, categoria = excluded.categoria, origem = excluded.origem,
    projeto_id = excluded.projeto_id, lancamento_id = excluded.lancamento_id, valor = excluded.valor, data_aquisicao = excluded.data_aquisicao,
    observacao = excluded.observacao, atualizado_em = now();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.baixar_bem(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('baixar_bem', 'patrimonio', 'editar'); b public.bens;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into b from public.bens where id = p_id for update;
  if b.id is null then return private.erro('nao_encontrado'); end if;
  if b.situacao = 'baixado' then return jsonb_build_object('ok', true, 'repetido', true); end if;
  if b.situacao = 'emprestado' then return private.erro('bem_emprestado'); end if;
  update public.bens set situacao = 'baixado', baixa_motivo = btrim(p_motivo), atualizado_em = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Empréstimo: um aberto por bem (índice único); atleta ativo; termo aceito por ele ou pelo responsável.
create function private.emprestar_bem(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('emprestar_bem', 'patrimonio', 'editar'); v_id uuid; b public.bens; x public.pessoas; v_ini date; v_prev date; v_inserido uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','bem_id','pessoa_id','inicio','previsao_devolucao','termo_versao','termo_aceito_por','termo_aceito_em','observacao']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if exists (select 1 from public.emprestimos where id = v_id) then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
  select * into b from public.bens where id = private.j_uuid(p -> 'bem_id') for update;
  if b.id is null then return private.erro('invalido', 'bem_id'); end if;
  if b.situacao <> 'disponivel' then return private.erro('bem_indisponivel'); end if;
  select * into x from public.pessoas where id = private.j_uuid(p -> 'pessoa_id');
  if x.id is null or x.situacao <> 'ativo' then return private.erro('invalido', 'pessoa_id'); end if;
  v_ini := coalesce(private.j_data(p -> 'inicio'), private.hoje());
  if v_ini > private.hoje() + 30 or v_ini < private.hoje() - 365 then return private.erro('invalido', 'inicio'); end if;
  if not private.vazio(p -> 'previsao_devolucao') then
    v_prev := private.j_data(p -> 'previsao_devolucao');
    if v_prev is null or v_prev < v_ini or v_prev > v_ini + 730 then return private.erro('invalido', 'previsao_devolucao'); end if;
  end if;
  if coalesce(private.j_texto(p -> 'termo_versao'), '') !~ '^v[0-9]{1,3}$' then return private.erro('invalido', 'termo_versao'); end if;
  if not private.texto_ok(private.j_texto(p -> 'termo_aceito_por'), 2, 120) then return private.erro('invalido', 'termo_aceito_por'); end if;
  -- menor: quem aceita o termo é o responsável
  if private.menor_de_idade(x.data_nascimento) and lower(private.j_texto(p -> 'termo_aceito_por')) <> lower(coalesce(x.responsavel_nome, '')) then
    return private.erro('invalido', 'termo_aceito_por');
  end if;
  if private.j_data(p -> 'termo_aceito_em') is null or private.j_data(p -> 'termo_aceito_em') > private.hoje() then return private.erro('invalido', 'termo_aceito_em'); end if;
  if not private.vazio(p -> 'observacao') and not private.texto_ok(private.j_texto(p -> 'observacao'), 2, 300) then return private.erro('invalido', 'observacao'); end if;
  insert into public.emprestimos (id, bem_id, pessoa_id, inicio, previsao_devolucao, termo_versao, termo_aceito_por, termo_aceito_em, observacao, registrado_por)
  values (v_id, b.id, x.id, v_ini, v_prev, p ->> 'termo_versao', private.j_texto(p -> 'termo_aceito_por'), private.j_data(p -> 'termo_aceito_em'),
          nullif(private.j_texto(p -> 'observacao'), ''), auth.uid())
  on conflict do nothing returning id into v_inserido;
  if v_inserido is null then return private.erro('conflito', 'id'); end if;
  update public.bens set situacao = 'emprestado', atualizado_em = now() where id = b.id;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
end $$;

create function private.devolver_bem(p_emprestimo uuid, p_data date, p_observacao text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('devolver_bem', 'patrimonio', 'editar'); e public.emprestimos;
begin
  if v_erro is not null then return v_erro; end if;
  select * into e from public.emprestimos where id = p_emprestimo for update;
  if e.id is null then return private.erro('nao_encontrado'); end if;
  if e.devolvido_em is not null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  if p_data is null or p_data < e.inicio or p_data > private.hoje() then return private.erro('invalido', 'data'); end if;
  if p_observacao is not null and not private.texto_opcional_ok(p_observacao, 300) then return private.erro('invalido', 'observacao'); end if;
  update public.emprestimos set devolvido_em = p_data,
    observacao = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao) where id = p_emprestimo;
  update public.bens set situacao = 'disponivel', atualizado_em = now() where id = e.bem_id and situacao = 'emprestado';
  return jsonb_build_object('ok', true);
end $$;

-- Manutenção; "em_manutencao" tira (ou devolve) o bem de circulação.
create function private.registrar_manutencao(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('registrar_manutencao', 'patrimonio', 'editar'); v_id uuid; b public.bens; v_lanc uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','bem_id','data','descricao','custo','lancamento_id','proxima_em','em_manutencao']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if exists (select 1 from public.manutencoes where id = v_id) then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
  select * into b from public.bens where id = private.j_uuid(p -> 'bem_id') for update;
  if b.id is null or b.situacao = 'baixado' then return private.erro('invalido', 'bem_id'); end if;
  if private.j_data(p -> 'data') is null or private.j_data(p -> 'data') > private.hoje() then return private.erro('invalido', 'data'); end if;
  if not private.texto_ok(private.j_texto(p -> 'descricao'), 2, 300) then return private.erro('invalido', 'descricao'); end if;
  if not private.vazio(p -> 'custo') and private.j_valor(p -> 'custo') is null then return private.erro('invalido', 'custo'); end if;
  if not private.vazio(p -> 'lancamento_id') then
    v_lanc := private.j_uuid(p -> 'lancamento_id');
    if v_lanc is null or not exists (select 1 from public.lancamentos where id = v_lanc and tipo = 'saida') then return private.erro('invalido', 'lancamento_id'); end if;
  end if;
  if not private.vazio(p -> 'proxima_em') and (private.j_data(p -> 'proxima_em') is null or private.j_data(p -> 'proxima_em') <= private.j_data(p -> 'data')) then
    return private.erro('invalido', 'proxima_em');
  end if;
  if not private.vazio(p -> 'em_manutencao') and private.j_bool(p -> 'em_manutencao') is null then return private.erro('invalido', 'em_manutencao'); end if;
  if coalesce(private.j_bool(p -> 'em_manutencao'), false) and b.situacao = 'emprestado' then return private.erro('bem_emprestado'); end if;
  insert into public.manutencoes (id, bem_id, data, descricao, custo, lancamento_id, proxima_em, registrado_por)
  values (v_id, b.id, private.j_data(p -> 'data'), private.j_texto(p -> 'descricao'), private.j_valor(p -> 'custo'), v_lanc, private.j_data(p -> 'proxima_em'), auth.uid());
  if p ? 'em_manutencao' and b.situacao in ('disponivel', 'manutencao') then
    update public.bens set situacao = case when private.j_bool(p -> 'em_manutencao') then 'manutencao' else 'disponivel' end, atualizado_em = now() where id = b.id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
end $$;

-- Prestação de contas: agora com a relação de bens adquiridos com recurso do projeto.
create or replace function private.dados_prestacao(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('dados_prestacao', 'projetos', 'exportar'); pr public.projetos; v public.verbas;
begin
  if v_erro is not null then return v_erro; end if;
  if not (private.pode('financeiro', 'ver') and private.alcance('financeiro', 'ver') = 'tudo') then return private.negar('dados_prestacao'); end if;
  select * into pr from public.projetos where id = p_id;
  if pr.id is null then return private.erro('nao_encontrado'); end if;
  select * into v from public.verbas where id = pr.verba_id;
  perform private.registrar('exportar', 'projetos', p_id::text, null, jsonb_build_object('relatorio', 'prestacao_contas'));
  return jsonb_build_object('ok', true, 'gerado_em', now(),
    'projeto', private.projeto_json(pr) || private.execucao_projeto(pr, true),
    'verba', case when v.id is not null then jsonb_build_object('titulo', v.titulo,
               'origem', (select o.nome from public.origens_verba o where o.id = v.origem_id),
               'tipo', (select t.nome from public.tipos_verba t where t.id = v.tipo_id),
               'documentos', coalesce((select jsonb_agg(jsonb_build_object('momento', d.momento, 'nome', d.nome, 'entregue', d.entregue_em is not null) order by d.momento, d.nome)
                              from public.verba_documentos d where d.verba_id = v.id), '[]')) end,
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', to_char(l.data, 'YYYY-MM-DD'), 'tipo', l.tipo, 'valor', l.valor::text,
                     'descricao', l.descricao, 'favorecido', cp.nome, 'documento', cp.documento, 'forma_pagamento', l.forma_pagamento,
                     'conta', cb.nome, 'rubrica', r.nome, 'comprovante', exists (select 1 from public.comprovantes c where c.lancamento_id = l.id),
                     'sem_comprovante_motivo', l.sem_comprovante_motivo) order by l.data, l.criado_em)
                   from private.lancamentos_projeto(pr.id) l
                   left join public.contrapartes cp on cp.id = l.contraparte_id
                   left join public.contas_bancarias cb on cb.id = l.conta_id
                   left join public.lancamento_rubricas lr on lr.lancamento_id = l.id
                   left join public.projeto_rubricas r on r.id = lr.rubrica_id), '[]'),
    'atividades', coalesce((select jsonb_agg(jsonb_build_object('titulo', e.titulo, 'inicio', e.inicio, 'fim', e.fim, 'dia_inteiro', e.dia_inteiro,
                     'local', e.local, 'tipo', t.nome) order by e.inicio)
                   from public.eventos e join public.tipos_evento t on t.id = e.tipo_id
                   where e.projeto_id = pr.id and e.cancelado_em is null), '[]'),
    'bens', coalesce((select jsonb_agg(jsonb_build_object('numero', b.numero, 'nome', b.nome, 'valor', b.valor::text,
                 'data_aquisicao', to_char(b.data_aquisicao, 'YYYY-MM-DD'), 'situacao', b.situacao) order by b.numero)
               from public.bens b where b.projeto_id = pr.id), '[]'));
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('salvar_bem', 300), ('baixar_bem', 60), ('emprestar_bem', 200), ('devolver_bem', 200), ('registrar_manutencao', 200);

create function public.salvar_bem(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_bem(p) $$;
create function public.baixar_bem(p_id uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.baixar_bem(p_id, p_motivo) $$;
create function public.emprestar_bem(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.emprestar_bem(p) $$;
create function public.devolver_bem(p_emprestimo uuid, p_data date, p_observacao text) returns jsonb language sql security invoker set search_path = '' as $$ select private.devolver_bem(p_emprestimo, p_data, p_observacao) $$;
create function public.registrar_manutencao(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_manutencao(p) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['salvar_bem(jsonb)','baixar_bem(uuid,text)','emprestar_bem(jsonb)','devolver_bem(uuid,date,text)','registrar_manutencao(jsonb)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
