-- 0014 · Verbas previstas e Projetos completos (7.3).
--  * verba = todo dinheiro ou apoio esperado; nada vem pronto (modelos só se a diretoria pedir);
--  * regras por verba (jsonb com chaves fechadas), copiadas do tipo e ajustáveis caso a caso;
--  * verba formalizada vira projeto (com as regras); o projeto ganha vigência, rubricas e prazos;
--  * lançamento pertence ao projeto se tiver projeto_id, ou se estiver numa conta vinculada a ele;
--  * regras NÃO bloqueiam o lançamento (o dinheiro já saiu): viram pendências que pedem
--    classificação ou justificativa, e travam só a geração da prestação "sem pendências";
--  * a classificação por rubrica e as justificativas ficam em tabelas próprias: não mudam o
--    lançamento, por isso valem também para mês fechado (e ficam na auditoria).

create function private.situacoes_verba() returns text[] language sql immutable set search_path = '' as $$
  select array['ideia','pedido_enviado','em_analise','aprovado','formalizado','recebido_parcial','recebido',
               'em_execucao','prestacao_contas','encerrado','negado','cancelado']
$$;
create function private.situacoes_verba_finais() returns text[] language sql immutable set search_path = '' as $$
  select array['encerrado','negado','cancelado']
$$;
create function private.formas_recebimento() returns text[] language sql immutable set search_path = '' as $$
  select array['caixa_livre','conta_especifica','pago_pela_origem','bens']
$$;
create function private.categorias_origem() returns text[] language sql immutable set search_path = '' as $$
  select array['orgao_publico','parlamentar','entidade','empresa','pessoa_fisica','outra']
$$;
create function private.regras_justificaveis() returns text[] language sql immutable set search_path = '' as $$
  select array['forma_dinheiro','sem_transferencia','reembolso','fora_da_conta','fora_da_vigencia']
$$;

-- Lista de textos curtos (documentos, contrapartidas): até 30 itens de 2 a 200 caracteres.
create function private.lista_textos_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 30
     and not exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string' or not private.texto_ok(e #>> '{}', 2, 200))
$$;

-- Regras de uma verba ou projeto. Chaves fechadas; ausente = padrão (private.regras_completas).
create function private.regras_validas(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and private.so_chaves(p, array['conta_especifica','exige_rubricas','exige_transferencia','aceita_dinheiro','permite_reembolso',
                                    'prestacao_parcial','prazo_prestacao_dias','guarda_anos','contrapartidas','documentos_antes','documentos_depois'])
     and not exists (select 1 from unnest(array['conta_especifica','exige_rubricas','exige_transferencia','aceita_dinheiro','permite_reembolso','prestacao_parcial']) k
                     where p ? k and jsonb_typeof(p -> k) <> 'boolean')
     and (not p ? 'prazo_prestacao_dias' or coalesce(private.j_inteiro(p -> 'prazo_prestacao_dias'), -1) between 0 and 365)
     and (not p ? 'guarda_anos' or coalesce(private.j_inteiro(p -> 'guarda_anos'), -1) between 1 and 30)
     and (not p ? 'contrapartidas' or private.lista_textos_ok(p -> 'contrapartidas'))
     and (not p ? 'documentos_antes' or private.lista_textos_ok(p -> 'documentos_antes'))
     and (not p ? 'documentos_depois' or private.lista_textos_ok(p -> 'documentos_depois'))
$$;

create function private.regras_completas(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('conta_especifica', false, 'exige_rubricas', false, 'exige_transferencia', false,
           'aceita_dinheiro', true, 'permite_reembolso', true, 'prestacao_parcial', false, 'prazo_prestacao_dias', 30,
           'guarda_anos', 5, 'contrapartidas', '[]'::jsonb, 'documentos_antes', '[]'::jsonb, 'documentos_depois', '[]'::jsonb)
         || coalesce(p, '{}'::jsonb)
$$;

create table public.tipos_verba (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 80)),
  regras jsonb not null default '{}' check (private.regras_validas(regras)),
  ativo boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index tipos_verba_nome_unico on public.tipos_verba (lower(nome));
create index tipos_verba_criado_por_idx on public.tipos_verba (criado_por);

-- Origem: quem dá a verba. Pessoa física guarda só o nome (coleta mínima; sem CPF aqui).
create table public.origens_verba (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 120)),
  categoria text not null check (categoria = any (private.categorias_origem())),
  contato text check (private.texto_opcional_ok(contato, 160)),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index origens_verba_nome_unico on public.origens_verba (lower(nome));
create index origens_verba_criado_por_idx on public.origens_verba (criado_por);

create table public.verbas (
  id uuid primary key,
  titulo text not null check (private.texto_ok(titulo, 2, 160)),
  tipo_id uuid not null references public.tipos_verba (id),
  origem_id uuid not null references public.origens_verba (id),
  descricao text check (char_length(descricao) <= 2000 and descricao !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  forma_recebimento text not null check (forma_recebimento = any (private.formas_recebimento())),
  valor_pedido numeric(14, 2) check (valor_pedido between 0 and 100000000),
  valor_aprovado numeric(14, 2) check (valor_aprovado between 0 and 100000000),
  situacao text not null default 'ideia' check (situacao = any (private.situacoes_verba())),
  regras jsonb not null default '{}' check (private.regras_validas(regras)),
  prazo_pedido date,
  responsavel uuid references public.membros (id),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index verbas_situacao_idx on public.verbas (situacao);
create index verbas_tipo_idx on public.verbas (tipo_id);
create index verbas_origem_idx on public.verbas (origem_id);
create index verbas_responsavel_idx on public.verbas (responsavel) where responsavel is not null;
create index verbas_criado_por_idx on public.verbas (criado_por);

create table public.verba_parcelas (
  id uuid primary key,
  verba_id uuid not null references public.verbas (id),
  numero int not null check (numero between 1 and 120),
  valor numeric(14, 2) not null check (valor > 0 and valor <= 100000000),
  data_prevista date not null,
  recebido_em date,
  valor_recebido numeric(14, 2) check (valor_recebido > 0 and valor_recebido <= 100000000),
  lancamento_id uuid unique references public.lancamentos (id),
  registrado_por uuid references public.membros (id),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  unique (verba_id, numero),
  check ((recebido_em is null) = (valor_recebido is null))
);
create index verba_parcelas_previstas_idx on public.verba_parcelas (data_prevista) where recebido_em is null;
create index verba_parcelas_registrado_por_idx on public.verba_parcelas (registrado_por) where registrado_por is not null;
create index verba_parcelas_criado_por_idx on public.verba_parcelas (criado_por);

create table public.verba_documentos (
  id uuid primary key,
  verba_id uuid not null references public.verbas (id),
  momento text not null check (momento in ('antes', 'depois')),
  nome text not null check (private.texto_ok(nome, 2, 200)),
  entregue_em timestamptz,
  entregue_por uuid references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index verba_documentos_unico on public.verba_documentos (verba_id, momento, lower(nome));
create index verba_documentos_entregue_por_idx on public.verba_documentos (entregue_por) where entregue_por is not null;

alter table public.projetos
  add column verba_id uuid unique references public.verbas (id),
  add column fonte text check (private.texto_opcional_ok(fonte, 120)),
  add column descricao text check (char_length(descricao) <= 2000 and descricao !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  add column vigencia_inicio date,
  add column vigencia_fim date,
  add column valor_aprovado numeric(14, 2) check (valor_aprovado between 0 and 100000000),
  add column valor_contrapartida numeric(14, 2) not null default 0 check (valor_contrapartida between 0 and 100000000),
  add column regras jsonb not null default '{}' check (private.regras_validas(regras)),
  add column responsavel uuid references public.membros (id),
  add column prazo_prestacao date,
  add column prazo_prestacao_parcial date,
  add column situacao text not null default 'em_execucao'
    check (situacao in ('planejamento', 'em_execucao', 'prestacao_contas', 'encerrado', 'cancelado')),
  add column atualizado_em timestamptz not null default now(),
  add constraint projetos_vigencia_ok check (vigencia_fim is null or vigencia_inicio is null or vigencia_fim >= vigencia_inicio);
create index projetos_responsavel_idx on public.projetos (responsavel) where responsavel is not null;

create table public.projeto_rubricas (
  id uuid primary key,
  projeto_id uuid not null references public.projetos (id),
  nome text not null check (private.texto_ok(nome, 2, 80)),
  valor_previsto numeric(14, 2) not null check (valor_previsto between 0 and 100000000),
  ordem int not null default 0 check (ordem between 0 and 999),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index projeto_rubricas_nome_unico on public.projeto_rubricas (projeto_id, lower(nome));
create index projeto_rubricas_criado_por_idx on public.projeto_rubricas (criado_por);

-- Em qual rubrica cada saída entra (uma por lançamento). Não altera o lançamento.
create table public.lancamento_rubricas (
  lancamento_id uuid primary key references public.lancamentos (id),
  rubrica_id uuid not null references public.projeto_rubricas (id),
  classificado_por uuid not null references public.membros (id),
  classificado_em timestamptz not null default now()
);
create index lancamento_rubricas_rubrica_idx on public.lancamento_rubricas (rubrica_id);
create index lancamento_rubricas_classificado_por_idx on public.lancamento_rubricas (classificado_por);

-- Justificativa de quem decidiu aceitar um lançamento fora de uma regra do projeto.
create table public.lancamento_justificativas (
  lancamento_id uuid not null references public.lancamentos (id),
  projeto_id uuid not null references public.projetos (id),
  regra text not null check (regra = any (private.regras_justificaveis())),
  motivo text not null check (private.texto_ok(motivo, 3, 300)),
  justificado_por uuid not null references public.membros (id),
  justificado_em timestamptz not null default now(),
  primary key (lancamento_id, regra)
);
create index lancamento_justificativas_projeto_idx on public.lancamento_justificativas (projeto_id);
create index lancamento_justificativas_por_idx on public.lancamento_justificativas (justificado_por);

do $$ declare t text; begin
  foreach t in array array['tipos_verba','origens_verba','verbas','verba_parcelas','verba_documentos',
                           'projeto_rubricas','lancamento_rubricas','lancamento_justificativas'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.trg_auditar()', t || '_auditar', t);
  end loop;
  foreach t in array array['tipos_verba','origens_verba','verbas','verba_documentos','projeto_rubricas','lancamento_justificativas'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.trg_sem_apagar()', t || '_sem_apagar', t);
  end loop;
end $$;
create trigger projetos_sem_apagar before delete on public.projetos for each row execute function private.trg_sem_apagar();
-- justificativa não muda depois de dada
create trigger lancamento_justificativas_sem_alterar before update on public.lancamento_justificativas
  for each row execute function private.trg_sem_apagar();

create function private.ve_verba(p_criado_por uuid, p_responsavel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pode('verbas', 'ver')
     and (private.alcance('verbas', 'ver') = 'tudo' or auth.uid() in (p_criado_por, coalesce(p_responsavel, p_criado_por)))
$$;
create function private.ve_verba_id(p_verba uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.verbas v where v.id = p_verba and private.ve_verba(v.criado_por, v.responsavel))
$$;

create policy ler on public.tipos_verba for select to authenticated using ((select private.pode('verbas', 'ver')));
create policy ler on public.origens_verba for select to authenticated using ((select private.pode('verbas', 'ver')));
create policy ler on public.verbas for select to authenticated using (private.ve_verba(criado_por, responsavel));
create policy ler on public.verba_parcelas for select to authenticated using (private.ve_verba_id(verba_id));
create policy ler on public.verba_documentos for select to authenticated using (private.ve_verba_id(verba_id));
create policy ler on public.projeto_rubricas for select to authenticated
  using ((select private.pode('projetos', 'ver')) or (select private.pode('financeiro', 'ver')));
create policy ler on public.lancamento_rubricas for select to authenticated
  using ((select private.pode('projetos', 'ver')) or (select private.pode('financeiro', 'ver')));
create policy ler on public.lancamento_justificativas for select to authenticated
  using ((select private.pode('projetos', 'ver')) or (select private.pode('financeiro', 'ver')));

create function private.salvar_tipo_verba(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_tipo_verba', 'verbas', 'editar'); v_id uuid; v_nome text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','regras','ativo']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 80) then return private.erro('invalido', 'nome'); end if;
  if not coalesce(private.regras_validas(coalesce(p -> 'regras', '{}')), false) then return private.erro('invalido', 'regras'); end if;
  if not private.vazio(p -> 'ativo') and private.j_bool(p -> 'ativo') is null then return private.erro('invalido', 'ativo'); end if;
  if exists (select 1 from public.tipos_verba where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.tipos_verba (id, nome, regras, ativo, criado_por)
  values (v_id, v_nome, coalesce(p -> 'regras', '{}'), coalesce(private.j_bool(p -> 'ativo'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, regras = excluded.regras, ativo = excluded.ativo;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Modelos de exemplo (7.15). Só entram se a diretoria pedir; nomes existentes são pulados.
create function private.importar_modelos_verba() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('importar_modelos_verba', 'verbas', 'editar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  insert into public.tipos_verba (id, nome, regras, criado_por)
  select gen_random_uuid(), m.nome, m.regras::jsonb, auth.uid()
  from (values
    ('Emenda parlamentar (termo de fomento)',
     '{"conta_especifica":true,"exige_rubricas":true,"exige_transferencia":true,"aceita_dinheiro":false,"permite_reembolso":false,"prestacao_parcial":true,"prazo_prestacao_dias":90,"guarda_anos":10,"documentos_antes":["Plano de trabalho","Certidões negativas","Estatuto e ata de eleição"],"documentos_depois":["Relatório de execução do objeto","Relatório de execução financeira","Extratos da conta específica","Relatório fotográfico"]}'),
    ('Lei de incentivo ao esporte',
     '{"conta_especifica":true,"exige_rubricas":true,"exige_transferencia":true,"aceita_dinheiro":false,"permite_reembolso":false,"prestacao_parcial":false,"prazo_prestacao_dias":60,"guarda_anos":10,"documentos_antes":["Projeto aprovado","Certidões negativas"],"documentos_depois":["Relatório de receitas e despesas","Relação de pagamentos","Extratos da conta específica","Relação de bens adquiridos","Relação de beneficiários","Cronograma de atividades realizadas"]}'),
    ('Edital de entidade (a entidade paga as despesas)',
     '{"conta_especifica":false,"exige_rubricas":false,"prazo_prestacao_dias":30,"guarda_anos":5,"documentos_depois":["Relatório da atividade"]}'),
    ('Patrocínio privado',
     '{"conta_especifica":false,"exige_rubricas":false,"prazo_prestacao_dias":30,"guarda_anos":5,"contrapartidas":["Marca no uniforme","Publicações nas redes sociais"]}'),
    ('Doação',
     '{"conta_especifica":false,"exige_rubricas":false,"prazo_prestacao_dias":0,"guarda_anos":5,"documentos_depois":["Recibo de doação"]}')
  ) m(nome, regras)
  where not exists (select 1 from public.tipos_verba t where lower(t.nome) = lower(m.nome))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criados', v_n);
end $$;

create function private.salvar_origem_verba(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_origem_verba', 'verbas', 'criar'); v_id uuid; v_nome text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','categoria','contato','ativa']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 120) then return private.erro('invalido', 'nome'); end if;
  if not (coalesce(private.j_texto(p -> 'categoria'), '') = any (private.categorias_origem())) then return private.erro('invalido', 'categoria'); end if;
  if not private.vazio(p -> 'contato') and (jsonb_typeof(p -> 'contato') <> 'string' or not private.texto_opcional_ok(private.j_texto(p -> 'contato'), 160)) then
    return private.erro('invalido', 'contato');
  end if;
  if not private.vazio(p -> 'ativa') and private.j_bool(p -> 'ativa') is null then return private.erro('invalido', 'ativa'); end if;
  if exists (select 1 from public.origens_verba where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  -- editar origem existente: verbas/editar (criar basta para cadastrar uma nova)
  if exists (select 1 from public.origens_verba where id = v_id) and not private.pode('verbas', 'editar') then
    return private.negar('salvar_origem_verba');
  end if;
  insert into public.origens_verba (id, nome, categoria, contato, ativa, criado_por)
  values (v_id, v_nome, p ->> 'categoria', nullif(private.j_texto(p -> 'contato'), ''), coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, categoria = excluded.categoria, contato = excluded.contato, ativa = excluded.ativa;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_verba(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('salvar_verba', 'verbas', 'criar');
  v_id uuid; v public.verbas; t public.tipos_verba; v_regras jsonb; v_inserido uuid; v_uuid uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','titulo','tipo_id','origem_id','descricao','forma_recebimento','valor_pedido',
       'valor_aprovado','regras','prazo_pedido','responsavel']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id');
  if v_id is null then return private.erro('invalido', 'id'); end if;
  if not private.texto_ok(private.j_texto(p -> 'titulo'), 2, 160) then return private.erro('invalido', 'titulo'); end if;
  select * into t from public.tipos_verba where id = private.j_uuid(p -> 'tipo_id');
  if t.id is null then return private.erro('invalido', 'tipo_id'); end if;
  v_uuid := private.j_uuid(p -> 'origem_id');
  if v_uuid is null or not exists (select 1 from public.origens_verba where id = v_uuid) then return private.erro('invalido', 'origem_id'); end if;
  if not private.vazio(p -> 'descricao') and (jsonb_typeof(p -> 'descricao') <> 'string' or not private.texto_longo_ok(p ->> 'descricao', 2000)) then
    return private.erro('invalido', 'descricao');
  end if;
  if not (coalesce(private.j_texto(p -> 'forma_recebimento'), '') = any (private.formas_recebimento())) then return private.erro('invalido', 'forma_recebimento'); end if;
  if not private.vazio(p -> 'valor_pedido') and private.j_valor(p -> 'valor_pedido') is null then return private.erro('invalido', 'valor_pedido'); end if;
  if not private.vazio(p -> 'valor_aprovado') and private.j_valor(p -> 'valor_aprovado') is null then return private.erro('invalido', 'valor_aprovado'); end if;
  if not private.vazio(p -> 'regras') and not coalesce(private.regras_validas(p -> 'regras'), false) then return private.erro('invalido', 'regras'); end if;
  if not private.vazio(p -> 'prazo_pedido') and (private.j_data(p -> 'prazo_pedido') is null
       or private.j_data(p -> 'prazo_pedido') not between private.hoje() - 730 and private.hoje() + 1100) then
    return private.erro('invalido', 'prazo_pedido');
  end if;
  if not private.vazio(p -> 'responsavel') and not private.membro_ativo(private.j_uuid(p -> 'responsavel')) then return private.erro('invalido', 'responsavel'); end if;

  select * into v from public.verbas where id = v_id for update;
  if v.id is null then
    if not t.ativo then return private.erro('invalido', 'tipo_id'); end if;
    v_regras := coalesce(nullif(p -> 'regras', 'null'::jsonb), t.regras);
    insert into public.verbas (id, titulo, tipo_id, origem_id, descricao, forma_recebimento, valor_pedido, valor_aprovado, regras,
                               prazo_pedido, responsavel, criado_por)
    values (v_id, private.j_texto(p -> 'titulo'), t.id, v_uuid, nullif(btrim(coalesce(p ->> 'descricao', '')), ''),
            p ->> 'forma_recebimento', private.j_valor(p -> 'valor_pedido'), private.j_valor(p -> 'valor_aprovado'), v_regras,
            private.j_data(p -> 'prazo_pedido'), private.j_uuid(p -> 'responsavel'), auth.uid())
    on conflict (id) do nothing returning id into v_inserido;
    if v_inserido is null then return private.erro('conflito', 'id'); end if;
    -- checklist de documentos a partir das regras
    insert into public.verba_documentos (id, verba_id, momento, nome)
    select gen_random_uuid(), v_id, x.momento, btrim(e #>> '{}')
    from (select 'antes' momento, v_regras -> 'documentos_antes' l union all select 'depois', v_regras -> 'documentos_depois') x,
         jsonb_array_elements(coalesce(x.l, '[]')) e
    on conflict do nothing;
    return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
  end if;
  -- editar: verbas/editar, ou quem criou
  if not (private.pode('verbas', 'editar') or v.criado_por = auth.uid()) or not private.ve_verba(v.criado_por, v.responsavel) then
    return private.negar('salvar_verba');
  end if;
  if v.situacao = any (private.situacoes_verba_finais()) then return private.erro('verba_encerrada'); end if;
  update public.verbas set titulo = private.j_texto(p -> 'titulo'), tipo_id = t.id, origem_id = v_uuid,
    descricao = nullif(btrim(coalesce(p ->> 'descricao', '')), ''), forma_recebimento = p ->> 'forma_recebimento',
    valor_pedido = private.j_valor(p -> 'valor_pedido'), valor_aprovado = private.j_valor(p -> 'valor_aprovado'),
    regras = case when p ? 'regras' and not private.vazio(p -> 'regras') then p -> 'regras' else regras end,
    prazo_pedido = private.j_data(p -> 'prazo_pedido'), responsavel = private.j_uuid(p -> 'responsavel'), atualizado_em = now()
  where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true);
end $$;

-- Situação: qualquer etapa a partir de uma não final; sair de uma final (encerrado, negado,
-- cancelado) só um administrador. Tudo vai para a auditoria pelo gatilho.
create function private.mudar_situacao_verba(p_id uuid, p_situacao text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('mudar_situacao_verba', 'verbas', 'editar'); v public.verbas;
begin
  if v_erro is not null then return v_erro; end if;
  if not (coalesce(p_situacao, '') = any (private.situacoes_verba())) then return private.erro('invalido', 'situacao'); end if;
  select * into v from public.verbas where id = p_id for update;
  if v.id is null or not private.ve_verba(v.criado_por, v.responsavel) then return private.erro('nao_encontrado'); end if;
  if v.situacao = p_situacao then return jsonb_build_object('ok', true, 'repetido', true); end if;
  if v.situacao = any (private.situacoes_verba_finais()) and not private.is_admin() then return private.negar('mudar_situacao_verba', 'verba_encerrada'); end if;
  update public.verbas set situacao = p_situacao, atualizado_em = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Parcelas previstas: substitui as que ainda não foram recebidas. p = [{ id, valor, data_prevista }]
create function private.salvar_parcelas(p_verba uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_parcelas', 'verbas', 'editar'); v public.verbas; v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  select * into v from public.verbas where id = p_verba for update;
  if v.id is null or not private.ve_verba(v.criado_por, v.responsavel) then return private.erro('nao_encontrado'); end if;
  if v.situacao = any (private.situacoes_verba_finais()) then return private.erro('verba_encerrada'); end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 60
     or exists (select 1 from jsonb_array_elements(p) e
                where not private.so_chaves(e, array['id','valor','data_prevista'])
                   or private.j_uuid(e -> 'id') is null or coalesce(private.j_valor(e -> 'valor'), 0) <= 0
                   or private.j_data(e -> 'data_prevista') is null
                   or private.j_data(e -> 'data_prevista') not between private.hoje() - 730 and private.hoje() + 1830)
     or (select count(distinct private.j_uuid(e -> 'id')) from jsonb_array_elements(p) e) <> jsonb_array_length(p) then
    return private.erro('invalido', 'parcelas');
  end if;
  -- id de parcela de outra verba, ou de parcela já recebida, não pode ser reaproveitado
  if exists (select 1 from jsonb_array_elements(p) e join public.verba_parcelas x on x.id = private.j_uuid(e -> 'id')
             where x.verba_id <> p_verba or x.recebido_em is not null) then
    return private.erro('conflito', 'parcelas');
  end if;
  delete from public.verba_parcelas where verba_id = p_verba and recebido_em is null;
  -- numeração continua depois das já recebidas
  insert into public.verba_parcelas (id, verba_id, numero, valor, data_prevista, criado_por)
  select private.j_uuid(e -> 'id'), p_verba,
         coalesce((select max(numero) from public.verba_parcelas where verba_id = p_verba), 0)
           + row_number() over (order by private.j_data(e -> 'data_prevista'), o)::int,
         private.j_valor(e -> 'valor'), private.j_data(e -> 'data_prevista'), auth.uid()
  from jsonb_array_elements(p) with ordinality x(e, o);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'parcelas', v_n);
end $$;

-- Recebimento de uma parcela. Dinheiro (caixa livre ou conta específica): liga a uma entrada
-- realizada já lançada no Dinheiro. Pago pela origem ou em bens: só data e valor estimado.
create function private.registrar_recebimento(p_parcela uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('registrar_recebimento', 'verbas', 'editar');
  x public.verba_parcelas; v public.verbas; l public.lancamentos; v_data date; v_valor numeric; v_proj uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['lancamento_id','data','valor']), false) then return private.erro('invalido'); end if;
  select * into x from public.verba_parcelas where id = p_parcela for update;
  if x.id is null then return private.erro('nao_encontrado'); end if;
  select * into v from public.verbas where id = x.verba_id;
  if not private.ve_verba(v.criado_por, v.responsavel) then return private.erro('nao_encontrado'); end if;
  if x.recebido_em is not null then return private.erro('ja_recebida'); end if;
  if v.forma_recebimento in ('caixa_livre', 'conta_especifica') then
    if not private.pode('financeiro', 'ver') then return private.negar('registrar_recebimento'); end if;
    select * into l from public.lancamentos where id = private.j_uuid(p -> 'lancamento_id');
    if l.id is null or l.tipo <> 'entrada' or l.situacao <> 'realizada' or l.estorno_de is not null
       or exists (select 1 from public.lancamentos e where e.estorno_de = l.id) then
      return private.erro('invalido', 'lancamento_id');
    end if;
    if exists (select 1 from public.verba_parcelas o where o.lancamento_id = l.id) then return private.erro('conflito', 'lancamento_id'); end if;
    -- verba com conta específica: a entrada precisa estar numa conta do projeto da verba
    if private.regras_completas(v.regras) ->> 'conta_especifica' = 'true' then
      select id into v_proj from public.projetos where verba_id = v.id;
      if v_proj is null or not exists (select 1 from public.contas_bancarias c where c.id = l.conta_id and c.projeto_id = v_proj) then
        return private.erro('invalido', 'conta_especifica');
      end if;
    end if;
    v_data := l.data; v_valor := l.valor;
  else
    if not private.vazio(p -> 'lancamento_id') then return private.erro('invalido', 'lancamento_id'); end if;
    v_data := private.j_data(p -> 'data'); v_valor := private.j_valor(p -> 'valor');
    if v_data is null or v_data > private.hoje() or v_data < private.hoje() - 1830 then return private.erro('invalido', 'data'); end if;
    if coalesce(v_valor, 0) <= 0 then return private.erro('invalido', 'valor'); end if;
  end if;
  update public.verba_parcelas set recebido_em = v_data, valor_recebido = v_valor, lancamento_id = l.id, registrado_por = auth.uid()
   where id = p_parcela;
  return jsonb_build_object('ok', true);
end $$;

create function private.desfazer_recebimento(p_parcela uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('desfazer_recebimento', 'verbas', 'editar'); x public.verba_parcelas; v public.verbas;
begin
  if v_erro is not null then return v_erro; end if;
  select * into x from public.verba_parcelas where id = p_parcela for update;
  if x.id is null then return private.erro('nao_encontrado'); end if;
  select * into v from public.verbas where id = x.verba_id;
  if not private.ve_verba(v.criado_por, v.responsavel) then return private.erro('nao_encontrado'); end if;
  if x.recebido_em is null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.verba_parcelas set recebido_em = null, valor_recebido = null, lancamento_id = null, registrado_por = null where id = p_parcela;
  return jsonb_build_object('ok', true);
end $$;

-- Checklist de documentos: marcar/desmarcar ou incluir um novo.
create function private.salvar_documento_verba(p_verba uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_documento_verba', 'verbas', 'ver'); v public.verbas; d public.verba_documentos; v_id uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','momento','nome','entregue']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  select * into v from public.verbas where id = p_verba;
  if v.id is null or not private.ve_verba(v.criado_por, v.responsavel) then return private.erro('nao_encontrado'); end if;
  -- quem cuida da verba (responsável), quem criou ou quem edita verbas
  if not (private.pode('verbas', 'editar') or auth.uid() in (v.criado_por, coalesce(v.responsavel, v.criado_por))) then
    return private.negar('salvar_documento_verba');
  end if;
  if not private.vazio(p -> 'entregue') and private.j_bool(p -> 'entregue') is null then return private.erro('invalido', 'entregue'); end if;
  select * into d from public.verba_documentos where id = v_id;
  if d.id is not null and d.verba_id <> p_verba then return private.erro('conflito', 'id'); end if;
  if d.id is null then
    if coalesce(private.j_texto(p -> 'momento'), '') not in ('antes', 'depois') then return private.erro('invalido', 'momento'); end if;
    if not private.texto_ok(private.j_texto(p -> 'nome'), 2, 200) then return private.erro('invalido', 'nome'); end if;
    if exists (select 1 from public.verba_documentos where verba_id = p_verba and momento = p ->> 'momento' and lower(nome) = lower(private.j_texto(p -> 'nome'))) then
      return private.erro('duplicado', 'nome');
    end if;
    insert into public.verba_documentos (id, verba_id, momento, nome) values (v_id, p_verba, p ->> 'momento', private.j_texto(p -> 'nome'));
  end if;
  if not private.vazio(p -> 'entregue') then
    update public.verba_documentos set entregue_em = case when private.j_bool(p -> 'entregue') then coalesce(entregue_em, now()) end,
      entregue_por = case when private.j_bool(p -> 'entregue') then coalesce(entregue_por, auth.uid()) end
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Tarefa de prestação de contas: id determinístico por projeto e tipo (gerar de novo não duplica;
-- muda o prazo enquanto a tarefa estiver aberta).
create function private.tarefa_prestacao(p_projeto uuid, p_tipo text) returns void
language plpgsql security definer set search_path = '' as $$
declare pr public.projetos; v_prazo date; v_id uuid := md5('prestacao:' || p_projeto::text || ':' || p_tipo)::uuid; v_resp uuid;
begin
  select * into pr from public.projetos where id = p_projeto;
  v_prazo := case p_tipo when 'final' then pr.prazo_prestacao else pr.prazo_prestacao_parcial end;
  if v_prazo is null then return; end if;
  v_resp := case when private.membro_ativo(pr.responsavel) then pr.responsavel else pr.criado_por end;
  insert into public.tarefas (id, titulo, responsavel, prazo, prioridade, lembrete_dias, criado_por)
  values (v_id, left('Prestação de contas ' || case p_tipo when 'final' then 'final' else 'parcial' end || ' — ' || pr.nome, 160),
          v_resp, v_prazo, 'alta', 7, coalesce(auth.uid(), pr.criado_por))
  on conflict (id) do update set prazo = excluded.prazo, titulo = excluded.titulo, atualizado_em = now()
    where public.tarefas.situacao in ('a_fazer', 'fazendo') and public.tarefas.prazo is distinct from excluded.prazo;
end $$;

-- Formalizar: a verba vira projeto (com as regras dela). Idempotente: se já tem projeto, devolve.
create function private.formalizar_verba(p_verba uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('formalizar_verba', 'projetos', 'criar');
  v public.verbas; v_id uuid; v_ini date; v_fim date; v_regras jsonb; v_existente uuid; v_inserido uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('verbas', 'editar') then return private.negar('formalizar_verba'); end if;
  if not coalesce(private.so_chaves(p, array['projeto_id','nome','vigencia_inicio','vigencia_fim','valor_aprovado','valor_contrapartida','responsavel']), false) then
    return private.erro('invalido');
  end if;
  select * into v from public.verbas where id = p_verba for update;
  if v.id is null or not private.ve_verba(v.criado_por, v.responsavel) then return private.erro('nao_encontrado'); end if;
  select id into v_existente from public.projetos where verba_id = p_verba;
  if v_existente is not null then return jsonb_build_object('ok', true, 'id', v_existente, 'repetido', true); end if;
  if v.situacao = any (private.situacoes_verba_finais()) then return private.erro('verba_encerrada'); end if;
  v_id := private.j_uuid(p -> 'projeto_id'); if v_id is null then return private.erro('invalido', 'projeto_id'); end if;
  v_ini := private.j_data(p -> 'vigencia_inicio'); v_fim := private.j_data(p -> 'vigencia_fim');
  if v_ini is null or v_ini not between private.hoje() - 1830 and private.hoje() + 1100 then return private.erro('invalido', 'vigencia_inicio'); end if;
  if v_fim is null or v_fim < v_ini or v_fim > v_ini + 1830 then return private.erro('invalido', 'vigencia_fim'); end if;
  if not private.vazio(p -> 'nome') and not private.texto_ok(private.j_texto(p -> 'nome'), 2, 120) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'valor_aprovado') and private.j_valor(p -> 'valor_aprovado') is null then return private.erro('invalido', 'valor_aprovado'); end if;
  if not private.vazio(p -> 'valor_contrapartida') and private.j_valor(p -> 'valor_contrapartida') is null then return private.erro('invalido', 'valor_contrapartida'); end if;
  if not private.vazio(p -> 'responsavel') and not private.membro_ativo(private.j_uuid(p -> 'responsavel')) then return private.erro('invalido', 'responsavel'); end if;
  v_regras := private.regras_completas(v.regras);
  insert into public.projetos (id, nome, ativo, criado_por, verba_id, fonte, descricao, vigencia_inicio, vigencia_fim, valor_aprovado,
                               valor_contrapartida, regras, responsavel, prazo_prestacao, situacao)
  values (v_id, coalesce(nullif(private.j_texto(p -> 'nome'), ''), left(v.titulo, 120)), true, auth.uid(), v.id,
          (select left(t.nome, 120) from public.tipos_verba t where t.id = v.tipo_id), v.descricao, v_ini, v_fim,
          coalesce(private.j_valor(p -> 'valor_aprovado'), v.valor_aprovado, v.valor_pedido), coalesce(private.j_valor(p -> 'valor_contrapartida'), 0),
          v.regras, coalesce(private.j_uuid(p -> 'responsavel'), v.responsavel),
          v_fim + (v_regras ->> 'prazo_prestacao_dias')::int, 'em_execucao')
  on conflict (id) do nothing returning id into v_inserido;
  if v_inserido is null then return private.erro('conflito', 'projeto_id'); end if;
  if array_position(private.situacoes_verba(), v.situacao) < array_position(private.situacoes_verba(), 'formalizado') then
    update public.verbas set situacao = 'formalizado', atualizado_em = now() where id = v.id;
  end if;
  perform private.tarefa_prestacao(v_id, 'final');
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
end $$;

-- Editar um projeto (também os criados sem verba).
create function private.editar_projeto(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('editar_projeto', 'projetos', 'editar'); pr public.projetos; m jsonb; v_ini date; v_fim date;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['nome','fonte','descricao','vigencia_inicio','vigencia_fim','valor_aprovado','valor_contrapartida',
       'regras','responsavel','prazo_prestacao','prazo_prestacao_parcial','situacao']), false) then
    return private.erro('invalido');
  end if;
  select * into pr from public.projetos where id = p_id for update;
  if pr.id is null then return private.erro('nao_encontrado'); end if;
  if pr.situacao in ('encerrado', 'cancelado') and not private.is_admin() then return private.negar('editar_projeto', 'projeto_encerrado'); end if;
  m := jsonb_build_object('nome', pr.nome, 'fonte', pr.fonte, 'descricao', pr.descricao,
         'vigencia_inicio', to_char(pr.vigencia_inicio, 'YYYY-MM-DD'), 'vigencia_fim', to_char(pr.vigencia_fim, 'YYYY-MM-DD'),
         'valor_aprovado', pr.valor_aprovado::text, 'valor_contrapartida', pr.valor_contrapartida::text, 'regras', pr.regras,
         'responsavel', pr.responsavel, 'prazo_prestacao', to_char(pr.prazo_prestacao, 'YYYY-MM-DD'),
         'prazo_prestacao_parcial', to_char(pr.prazo_prestacao_parcial, 'YYYY-MM-DD'), 'situacao', pr.situacao) || p;
  if not private.texto_ok(private.j_texto(m -> 'nome'), 2, 120) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(m -> 'fonte') and (jsonb_typeof(m -> 'fonte') <> 'string' or not private.texto_opcional_ok(private.j_texto(m -> 'fonte'), 120)) then return private.erro('invalido', 'fonte'); end if;
  if not private.vazio(m -> 'descricao') and (jsonb_typeof(m -> 'descricao') <> 'string' or not private.texto_longo_ok(m ->> 'descricao', 2000)) then return private.erro('invalido', 'descricao'); end if;
  v_ini := private.j_data(m -> 'vigencia_inicio'); v_fim := private.j_data(m -> 'vigencia_fim');
  if not private.vazio(m -> 'vigencia_inicio') and v_ini is null then return private.erro('invalido', 'vigencia_inicio'); end if;
  if not private.vazio(m -> 'vigencia_fim') and (v_fim is null or (v_ini is not null and (v_fim < v_ini or v_fim > v_ini + 1830))) then return private.erro('invalido', 'vigencia_fim'); end if;
  if not private.vazio(m -> 'valor_aprovado') and private.j_valor(m -> 'valor_aprovado') is null then return private.erro('invalido', 'valor_aprovado'); end if;
  if not private.vazio(m -> 'valor_contrapartida') and private.j_valor(m -> 'valor_contrapartida') is null then return private.erro('invalido', 'valor_contrapartida'); end if;
  if not coalesce(private.regras_validas(coalesce(nullif(m -> 'regras', 'null'::jsonb), '{}')), false) then return private.erro('invalido', 'regras'); end if;
  if not private.vazio(m -> 'responsavel') and not private.membro_ativo(private.j_uuid(m -> 'responsavel'))
     and private.j_uuid(m -> 'responsavel') is distinct from pr.responsavel then
    return private.erro('invalido', 'responsavel');
  end if;
  if not private.vazio(m -> 'prazo_prestacao') and private.j_data(m -> 'prazo_prestacao') is null then return private.erro('invalido', 'prazo_prestacao'); end if;
  if not private.vazio(m -> 'prazo_prestacao_parcial') and private.j_data(m -> 'prazo_prestacao_parcial') is null then return private.erro('invalido', 'prazo_prestacao_parcial'); end if;
  if coalesce(private.j_texto(m -> 'situacao'), '') not in ('planejamento', 'em_execucao', 'prestacao_contas', 'encerrado', 'cancelado') then return private.erro('invalido', 'situacao'); end if;
  update public.projetos set nome = private.j_texto(m -> 'nome'), fonte = nullif(private.j_texto(m -> 'fonte'), ''),
    descricao = nullif(btrim(coalesce(m ->> 'descricao', '')), ''), vigencia_inicio = v_ini, vigencia_fim = v_fim,
    valor_aprovado = private.j_valor(m -> 'valor_aprovado'), valor_contrapartida = coalesce(private.j_valor(m -> 'valor_contrapartida'), 0),
    regras = coalesce(nullif(m -> 'regras', 'null'::jsonb), '{}'), responsavel = private.j_uuid(m -> 'responsavel'),
    prazo_prestacao = private.j_data(m -> 'prazo_prestacao'), prazo_prestacao_parcial = private.j_data(m -> 'prazo_prestacao_parcial'),
    situacao = private.j_texto(m -> 'situacao'), ativo = private.j_texto(m -> 'situacao') not in ('encerrado', 'cancelado'), atualizado_em = now()
  where id = p_id;
  perform private.tarefa_prestacao(p_id, 'final');
  perform private.tarefa_prestacao(p_id, 'parcial');
  return jsonb_build_object('ok', true);
end $$;

-- Conta específica: liga (ou desliga) uma conta ao projeto. Mexe no cadastro de contas: financeiro/administrar.
create function private.vincular_conta_projeto(p_projeto uuid, p_conta uuid, p_vincular boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('vincular_conta_projeto', 'financeiro', 'administrar'); c public.contas_bancarias;
begin
  if v_erro is not null then return v_erro; end if;
  if p_vincular is null then return private.erro('invalido', 'vincular'); end if;
  if not exists (select 1 from public.projetos where id = p_projeto) then return private.erro('nao_encontrado'); end if;
  select * into c from public.contas_bancarias where id = p_conta for update;
  if c.id is null then return private.erro('invalido', 'conta_id'); end if;
  if p_vincular then
    if c.projeto_id is not null and c.projeto_id <> p_projeto then return private.erro('conflito', 'conta_id'); end if;
    update public.contas_bancarias set projeto_id = p_projeto, tipo = 'projeto', atualizado_em = now() where id = p_conta;
  else
    if c.projeto_id is distinct from p_projeto then return private.erro('invalido', 'conta_id'); end if;
    update public.contas_bancarias set projeto_id = null, atualizado_em = now() where id = p_conta;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function private.salvar_rubrica(p_projeto uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_rubrica', 'projetos', 'editar'); r public.projeto_rubricas; v_id uuid; v_nome text; v_soma numeric; pr public.projetos;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','valor_previsto','ordem','ativa']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  select * into pr from public.projetos where id = p_projeto;
  if pr.id is null then return private.erro('nao_encontrado'); end if;
  if pr.situacao in ('encerrado', 'cancelado') then return private.erro('projeto_encerrado'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 80) then return private.erro('invalido', 'nome'); end if;
  if private.j_valor(p -> 'valor_previsto') is null then return private.erro('invalido', 'valor_previsto'); end if;
  if not private.vazio(p -> 'ordem') and coalesce(private.j_inteiro(p -> 'ordem'), -1) not between 0 and 999 then return private.erro('invalido', 'ordem'); end if;
  if not private.vazio(p -> 'ativa') and private.j_bool(p -> 'ativa') is null then return private.erro('invalido', 'ativa'); end if;
  select * into r from public.projeto_rubricas where id = v_id for update;
  if r.id is not null and r.projeto_id <> p_projeto then return private.erro('conflito', 'id'); end if;
  if exists (select 1 from public.projeto_rubricas where projeto_id = p_projeto and lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.projeto_rubricas (id, projeto_id, nome, valor_previsto, ordem, ativa, criado_por)
  values (v_id, p_projeto, v_nome, private.j_valor(p -> 'valor_previsto'),
          coalesce(private.j_inteiro(p -> 'ordem'), (select coalesce(max(ordem) + 1, 0) from public.projeto_rubricas where projeto_id = p_projeto)),
          coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, valor_previsto = excluded.valor_previsto,
    ordem = case when p ? 'ordem' then excluded.ordem else public.projeto_rubricas.ordem end, ativa = excluded.ativa;
  select sum(valor_previsto) into v_soma from public.projeto_rubricas where projeto_id = p_projeto and ativa;
  return jsonb_build_object('ok', true, 'id', v_id,
    'aviso', case when pr.valor_aprovado is not null and v_soma > pr.valor_aprovado + pr.valor_contrapartida then 'rubricas_acima_do_aprovado' end);
end $$;

-- Lançamentos de um projeto: com projeto_id, ou numa conta vinculada a ele (quando sem projeto_id).
-- "Efetivos" = realizados, sem estorno e que não são estorno (o par estornado se anula).
create function private.lancamentos_projeto(p_projeto uuid) returns setof public.lancamentos
language sql stable security definer set search_path = '' as $$
  select l.* from public.lancamentos l
  left join public.contas_bancarias c on c.id = l.conta_id
  where l.situacao = 'realizada' and l.estorno_de is null
    and not exists (select 1 from public.lancamentos e where e.estorno_de = l.id)
    and (l.projeto_id = p_projeto or (l.projeto_id is null and c.projeto_id = p_projeto))
$$;

create function private.classificar_lancamento(p_lancamento uuid, p_rubrica uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('classificar_lancamento'); l public.lancamentos; r public.projeto_rubricas;
begin
  if v_erro is not null then return v_erro; end if;
  select * into l from public.lancamentos where id = p_lancamento;
  if l.id is null or not private.ve_registro('financeiro', l.criado_por) then return private.erro('nao_encontrado'); end if;
  -- quem edita projetos, ou quem fez o lançamento (logo depois de criar, no formulário)
  if not (private.pode('projetos', 'editar') or (l.criado_por = auth.uid() and private.pode('financeiro', 'criar'))) then
    return private.negar('classificar_lancamento');
  end if;
  if p_rubrica is null then
    delete from public.lancamento_rubricas where lancamento_id = p_lancamento;
    return jsonb_build_object('ok', true);
  end if;
  select * into r from public.projeto_rubricas where id = p_rubrica;
  if r.id is null or not r.ativa then return private.erro('invalido', 'rubrica_id'); end if;
  if l.tipo <> 'saida' then return private.erro('invalido', 'lancamento'); end if;
  -- a rubrica precisa ser do projeto a que o lançamento pertence (previsto também vale, para já nascer classificado)
  -- (coalesce: com projeto_id nulo a comparação daria nulo, e "not nulo" deixaria passar)
  if not (coalesce(l.projeto_id = r.projeto_id, false)
          or (l.projeto_id is null and exists (select 1 from public.contas_bancarias c where c.id = l.conta_id and c.projeto_id = r.projeto_id))) then
    return private.erro('invalido', 'rubrica_id');
  end if;
  insert into public.lancamento_rubricas (lancamento_id, rubrica_id, classificado_por) values (p_lancamento, p_rubrica, auth.uid())
  on conflict (lancamento_id) do update set rubrica_id = excluded.rubrica_id, classificado_por = excluded.classificado_por, classificado_em = now()
    where public.lancamento_rubricas.rubrica_id is distinct from excluded.rubrica_id;
  return jsonb_build_object('ok', true);
end $$;

-- Pendências de regra de um projeto (uma linha por lançamento e regra quebrada).
create function private.pendencias_projeto(p_projeto uuid) returns table (lancamento_id uuid, regra text, justificada boolean, motivo text)
language sql stable security definer set search_path = '' as $$
  with pr as (select p.*, private.regras_completas(p.regras) rg from public.projetos p where p.id = p_projeto),
  ls as (select l.* from private.lancamentos_projeto(p_projeto) l where l.tipo = 'saida'),
  q as (
    select l.id, 'sem_rubrica'::text regra from ls l, pr
     where (pr.rg ->> 'exige_rubricas')::boolean and not exists (select 1 from public.lancamento_rubricas lr where lr.lancamento_id = l.id)
    union all
    select l.id, 'sem_comprovante' from ls l
     where l.sem_comprovante_motivo is null and not exists (select 1 from public.comprovantes c where c.lancamento_id = l.id)
    union all
    select l.id, 'forma_dinheiro' from ls l, pr where not (pr.rg ->> 'aceita_dinheiro')::boolean and l.forma_pagamento = 'dinheiro'
    union all
    select l.id, 'sem_transferencia' from ls l, pr
     where (pr.rg ->> 'exige_transferencia')::boolean and coalesce(l.forma_pagamento, '') not in ('transferencia', 'pix', 'boleto')
    union all
    select l.id, 'reembolso' from ls l, pr
     where not (pr.rg ->> 'permite_reembolso')::boolean and exists (select 1 from public.reembolsos r where r.lancamento_id = l.id)
    union all
    select l.id, 'fora_da_conta' from ls l, pr
     where (pr.rg ->> 'conta_especifica')::boolean
       and not exists (select 1 from public.contas_bancarias c where c.id = l.conta_id and c.projeto_id = p_projeto)
    union all
    select l.id, 'fora_da_vigencia' from ls l, pr
     where (pr.vigencia_inicio is not null and l.data < pr.vigencia_inicio) or (pr.vigencia_fim is not null and l.data > pr.vigencia_fim)
  )
  select q.id, q.regra, j.lancamento_id is not null, j.motivo
  from q left join public.lancamento_justificativas j on j.lancamento_id = q.id and j.regra = q.regra
$$;

create function private.justificar_regra(p_lancamento uuid, p_projeto uuid, p_regra text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('justificar_regra', 'projetos', 'editar');
begin
  if v_erro is not null then return v_erro; end if;
  if not (coalesce(p_regra, '') = any (private.regras_justificaveis())) then return private.erro('invalido', 'regra'); end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  if not exists (select 1 from private.pendencias_projeto(p_projeto) x where x.lancamento_id = p_lancamento and x.regra = p_regra) then
    return private.erro('nao_encontrado');
  end if;
  insert into public.lancamento_justificativas (lancamento_id, projeto_id, regra, motivo, justificado_por)
  values (p_lancamento, p_projeto, p_regra, btrim(p_motivo), auth.uid())
  on conflict (lancamento_id, regra) do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- Execução de um projeto: valores, ritmo (gasto x tempo), rubricas e pendências.
create function private.execucao_projeto(pr public.projetos, p_detalhe boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := private.hoje(); v_gasto numeric; v_entrou numeric; v_orc numeric; v_pct_tempo numeric; v_pct_gasto numeric;
  v_rubricas jsonb; v_pend jsonb; v_recebido numeric;
begin
  select coalesce(sum(valor) filter (where tipo = 'saida'), 0), coalesce(sum(valor) filter (where tipo = 'entrada'), 0)
    into v_gasto, v_entrou from private.lancamentos_projeto(pr.id);
  select coalesce(sum(valor_recebido), 0) into v_recebido from public.verba_parcelas where verba_id = pr.verba_id and recebido_em is not null;
  v_orc := nullif(coalesce(pr.valor_aprovado, 0) + pr.valor_contrapartida, 0);
  if pr.vigencia_inicio is not null and pr.vigencia_fim is not null then
    v_pct_tempo := round(100.0 * greatest(0, least(v_hoje, pr.vigencia_fim) - pr.vigencia_inicio)
                   / greatest(1, pr.vigencia_fim - pr.vigencia_inicio), 1);
  end if;
  v_pct_gasto := case when v_orc is not null then round(100.0 * v_gasto / v_orc, 1) end;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome, 'previsto', r.valor_previsto::text, 'realizado', r.realizado::text,
           'pct', case when r.valor_previsto > 0 then round(100.0 * r.realizado / r.valor_previsto, 1) end, 'ativa', r.ativa,
           'alerta', case when r.valor_previsto = 0 and r.realizado > 0 then 'estourada'
                          when r.valor_previsto > 0 and r.realizado > r.valor_previsto then 'estourada'
                          when r.valor_previsto > 0 and r.realizado >= 0.9 * r.valor_previsto then 'perto_do_limite'
                          when v_pct_tempo is not null and r.valor_previsto > 0 and 100.0 * r.realizado / r.valor_previsto > v_pct_tempo + 25 then 'adiantada'
                          when v_pct_tempo is not null and v_pct_tempo >= 50 and r.valor_previsto > 0 and 100.0 * r.realizado / r.valor_previsto < v_pct_tempo - 35 then 'atrasada'
                     end) order by r.ordem, r.nome), '[]')
    into v_rubricas
  from (select x.*, coalesce((select sum(l.valor) from private.lancamentos_projeto(pr.id) l
                               join public.lancamento_rubricas lr on lr.lancamento_id = l.id and lr.rubrica_id = x.id
                              where l.tipo = 'saida'), 0) realizado
        from public.projeto_rubricas x where x.projeto_id = pr.id) r;
  select jsonb_build_object('abertas', count(*) filter (where not justificada), 'justificadas', count(*) filter (where justificada),
           'itens', case when p_detalhe then coalesce(jsonb_agg(jsonb_build_object('lancamento_id', x.lancamento_id, 'regra', x.regra,
              'justificada', x.justificada, 'motivo', x.motivo, 'descricao', l.descricao, 'data', to_char(l.data, 'YYYY-MM-DD'),
              'valor', l.valor::text, 'forma_pagamento', l.forma_pagamento) order by l.data, x.regra), '[]') end)
    into v_pend
  from private.pendencias_projeto(pr.id) x join public.lancamentos l on l.id = x.lancamento_id;
  return jsonb_build_object('gasto', v_gasto::text, 'entrou', v_entrou::text, 'recebido_verba', v_recebido::text,
    'orcamento', v_orc::text, 'saldo', (v_entrou - v_gasto)::text, 'pct_tempo', v_pct_tempo, 'pct_gasto', v_pct_gasto,
    'rubricas', v_rubricas, 'pendencias', v_pend);
end $$;

create function private.projeto_json(pr public.projetos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', pr.id, 'nome', pr.nome, 'ativo', pr.ativo, 'verba_id', pr.verba_id, 'fonte', pr.fonte,
    'descricao', pr.descricao, 'vigencia_inicio', to_char(pr.vigencia_inicio, 'YYYY-MM-DD'), 'vigencia_fim', to_char(pr.vigencia_fim, 'YYYY-MM-DD'),
    'valor_aprovado', pr.valor_aprovado::text, 'valor_contrapartida', pr.valor_contrapartida::text, 'regras', private.regras_completas(pr.regras),
    'responsavel', pr.responsavel, 'prazo_prestacao', to_char(pr.prazo_prestacao, 'YYYY-MM-DD'),
    'prazo_prestacao_parcial', to_char(pr.prazo_prestacao_parcial, 'YYYY-MM-DD'), 'situacao', pr.situacao,
    'contas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome)) from public.contas_bancarias c where c.projeto_id = pr.id), '[]'))
$$;

create function private.painel_projetos() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('painel_projetos', 'projetos', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true, 'projetos', coalesce((
    select jsonb_agg(private.projeto_json(p) || private.execucao_projeto(p, false) order by p.ativo desc, p.vigencia_fim nulls last, p.nome)
    from public.projetos p), '[]'));
end $$;

create function private.painel_projeto(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('painel_projeto', 'projetos', 'ver'); pr public.projetos; v_fin boolean;
begin
  if v_erro is not null then return v_erro; end if;
  select * into pr from public.projetos where id = p_id;
  if pr.id is null then return private.erro('nao_encontrado'); end if;
  -- detalhe de lançamentos (descrições e valores um a um) só para quem vê todo o financeiro
  v_fin := private.pode('financeiro', 'ver') and private.alcance('financeiro', 'ver') = 'tudo';
  return jsonb_build_object('ok', true, 'projeto', private.projeto_json(pr) || private.execucao_projeto(pr, v_fin),
    'lancamentos', case when v_fin then coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'tipo', l.tipo, 'data', to_char(l.data, 'YYYY-MM-DD'), 'valor', l.valor::text,
               'descricao', l.descricao, 'forma_pagamento', l.forma_pagamento, 'rubrica_id', lr.rubrica_id,
               'tem_comprovante', exists (select 1 from public.comprovantes c where c.lancamento_id = l.id)) order by l.data desc)
      from (select * from private.lancamentos_projeto(pr.id) order by data desc limit 500) l
      left join public.lancamento_rubricas lr on lr.lancamento_id = l.id), '[]') end,
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('numero', x.numero, 'valor', x.valor::text, 'data_prevista', x.data_prevista,
                 'recebido_em', x.recebido_em, 'valor_recebido', x.valor_recebido::text) order by x.numero)
                 from public.verba_parcelas x where x.verba_id = pr.verba_id), '[]'));
end $$;

-- Dados para os relatórios de prestação de contas. A tela monta o PDF e o CSV.
create function private.dados_prestacao(p_id uuid) returns jsonb
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
                   where e.projeto_id = pr.id and e.cancelado_em is null), '[]'));
end $$;

create or replace function private.agenda_periodo(p_inicio date, p_fim date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('agenda_periodo', 'agenda', 'ver');
  v_eu uuid := auth.uid(); v_fin boolean; v_fin_tudo boolean;
  v_ini timestamptz; v_fim timestamptz; v_prazos jsonb := '[]';
begin
  if v_erro is not null then return v_erro; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 120 then return private.erro('invalido', 'periodo'); end if;
  v_ini := private.meia_noite(p_inicio); v_fim := private.meia_noite(p_fim + 1);
  v_fin := private.pode('financeiro', 'ver'); v_fin_tudo := v_fin and private.alcance('financeiro', 'ver') = 'tudo';

  if v_fin then
    select coalesce(jsonb_agg(jsonb_build_object('tipo', case when l.tipo = 'saida' then 'a_pagar' else 'a_receber' end,
             'titulo', l.descricao, 'data', to_char(l.data, 'YYYY-MM-DD'), 'ref', l.id) order by l.data), '[]')
      into v_prazos
    from (select * from public.lancamentos l where l.situacao = 'prevista' and l.data between p_inicio and p_fim
            and (v_fin_tudo or l.criado_por = v_eu) order by l.data limit 300) l;
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(jsonb_build_object('tipo', 'fechamento',
               'titulo', 'Fechar ' || to_char(m - interval '1 month', 'MM/YYYY') || ' e enviar ao contador',
               'data', to_char(m + interval '9 days', 'YYYY-MM-DD'), 'ref', to_char(m - interval '1 month', 'YYYY-MM-DD')))
      from generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') m
      where (m + interval '9 days')::date between p_inicio and p_fim
        and not private.mes_fechado((m - interval '1 month')::date)), '[]');
  end if;
  if private.pode('tarefas', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(jsonb_build_object('tipo', 'tarefa', 'titulo', t.titulo, 'data', to_char(t.prazo, 'YYYY-MM-DD'),
               'ref', t.id, 'responsavel', t.responsavel) order by t.prazo)
      from (select * from public.tarefas t where t.prazo between p_inicio and p_fim and t.situacao in ('a_fazer', 'fazendo')
              and private.ve_tarefa(t.responsavel, t.criado_por) order by t.prazo limit 300) t), '[]');
  end if;
  -- Fase 3: verbas (prazo do pedido e parcelas a receber) e projetos (fim da vigência e prestação de contas)
  if private.pode('verbas', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(x.j order by x.d) from (
        select v.prazo_pedido d, jsonb_build_object('tipo', 'verba', 'titulo', 'Prazo do pedido: ' || v.titulo, 'data', to_char(v.prazo_pedido, 'YYYY-MM-DD'), 'ref', v.id) j
          from public.verbas v where v.prazo_pedido between p_inicio and p_fim and v.situacao in ('ideia', 'pedido_enviado', 'em_analise')
            and private.ve_verba(v.criado_por, v.responsavel)
        union all
        select x.data_prevista, jsonb_build_object('tipo', 'verba', 'titulo', 'Parcela ' || x.numero || ' a receber: ' || v.titulo, 'data', to_char(x.data_prevista, 'YYYY-MM-DD'), 'ref', v.id)
          from public.verba_parcelas x join public.verbas v on v.id = x.verba_id
         where x.recebido_em is null and x.data_prevista between p_inicio and p_fim
           and v.situacao <> all (private.situacoes_verba_finais()) and private.ve_verba(v.criado_por, v.responsavel)
        limit 300) x), '[]');
  end if;
  if private.pode('projetos', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(x.j order by x.d) from (
        select p.vigencia_fim d, jsonb_build_object('tipo', 'projeto', 'titulo', 'Fim da vigência: ' || p.nome, 'data', to_char(p.vigencia_fim, 'YYYY-MM-DD'), 'ref', p.id) j
          from public.projetos p where p.vigencia_fim between p_inicio and p_fim and p.situacao in ('planejamento', 'em_execucao')
        union all
        select p.prazo_prestacao, jsonb_build_object('tipo', 'projeto', 'titulo', 'Prestação de contas final: ' || p.nome, 'data', to_char(p.prazo_prestacao, 'YYYY-MM-DD'), 'ref', p.id)
          from public.projetos p where p.prazo_prestacao between p_inicio and p_fim and p.situacao not in ('encerrado', 'cancelado')
        union all
        select p.prazo_prestacao_parcial, jsonb_build_object('tipo', 'projeto', 'titulo', 'Prestação de contas parcial: ' || p.nome, 'data', to_char(p.prazo_prestacao_parcial, 'YYYY-MM-DD'), 'ref', p.id)
          from public.projetos p where p.prazo_prestacao_parcial between p_inicio and p_fim and p.situacao not in ('encerrado', 'cancelado')
        limit 300) x), '[]');
  end if;

  return jsonb_build_object('ok', true,
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'tipo_id', e.tipo_id, 'titulo', e.titulo, 'inicio', e.inicio, 'fim', e.fim,
               'dia_inteiro', e.dia_inteiro, 'local', e.local, 'descricao', e.descricao, 'projeto_id', e.projeto_id,
               'criado_por', e.criado_por, 'cancelado_em', e.cancelado_em, 'motivo_cancelamento', e.motivo_cancelamento,
               'participantes', coalesce((select jsonb_agg(ep.membro_id) from public.evento_participantes ep where ep.evento_id = e.id), '[]'))
             order by e.inicio)
      from (select * from public.eventos e
             where e.inicio < v_fim
               and (case when e.dia_inteiro then e.fim + interval '1 day'
                         when e.fim = e.inicio then e.fim + interval '1 second' else e.fim end) > v_ini
             order by e.inicio limit 500) e), '[]'),
    'prazos', v_prazos);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('salvar_tipo_verba', 60), ('importar_modelos_verba', 10), ('salvar_origem_verba', 60), ('salvar_verba', 200),
  ('mudar_situacao_verba', 200), ('salvar_parcelas', 100), ('registrar_recebimento', 100), ('desfazer_recebimento', 30),
  ('salvar_documento_verba', 300), ('formalizar_verba', 30), ('editar_projeto', 100), ('vincular_conta_projeto', 30),
  ('salvar_rubrica', 200), ('classificar_lancamento', 600), ('justificar_regra', 200), ('painel_projetos', 300),
  ('painel_projeto', 600), ('dados_prestacao', 30);

create function public.salvar_tipo_verba(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_tipo_verba(p) $$;
create function public.importar_modelos_verba() returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_modelos_verba() $$;
create function public.salvar_origem_verba(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_origem_verba(p) $$;
create function public.salvar_verba(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_verba(p) $$;
create function public.mudar_situacao_verba(p_id uuid, p_situacao text) returns jsonb language sql security invoker set search_path = '' as $$ select private.mudar_situacao_verba(p_id, p_situacao) $$;
create function public.salvar_parcelas(p_verba uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_parcelas(p_verba, p) $$;
create function public.registrar_recebimento(p_parcela uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_recebimento(p_parcela, p) $$;
create function public.desfazer_recebimento(p_parcela uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.desfazer_recebimento(p_parcela) $$;
create function public.salvar_documento_verba(p_verba uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_documento_verba(p_verba, p) $$;
create function public.formalizar_verba(p_verba uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.formalizar_verba(p_verba, p) $$;
create function public.editar_projeto(p_id uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.editar_projeto(p_id, p) $$;
create function public.vincular_conta_projeto(p_projeto uuid, p_conta uuid, p_vincular boolean) returns jsonb language sql security invoker set search_path = '' as $$ select private.vincular_conta_projeto(p_projeto, p_conta, p_vincular) $$;
create function public.salvar_rubrica(p_projeto uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_rubrica(p_projeto, p) $$;
create function public.classificar_lancamento(p_lancamento uuid, p_rubrica uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.classificar_lancamento(p_lancamento, p_rubrica) $$;
create function public.justificar_regra(p_lancamento uuid, p_projeto uuid, p_regra text, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.justificar_regra(p_lancamento, p_projeto, p_regra, p_motivo) $$;
create function public.painel_projetos() returns jsonb language sql security invoker set search_path = '' as $$ select private.painel_projetos() $$;
create function public.painel_projeto(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.painel_projeto(p_id) $$;
create function public.dados_prestacao(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.dados_prestacao(p_id) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare
  f text;
  usuario text[] := array['salvar_tipo_verba(jsonb)','importar_modelos_verba()','salvar_origem_verba(jsonb)','salvar_verba(jsonb)',
    'mudar_situacao_verba(uuid,text)','salvar_parcelas(uuid,jsonb)','registrar_recebimento(uuid,jsonb)','desfazer_recebimento(uuid)',
    'salvar_documento_verba(uuid,jsonb)','formalizar_verba(uuid,jsonb)','editar_projeto(uuid,jsonb)','vincular_conta_projeto(uuid,uuid,boolean)',
    'salvar_rubrica(uuid,jsonb)','classificar_lancamento(uuid,uuid)','justificar_regra(uuid,uuid,text,text)','painel_projetos()',
    'painel_projeto(uuid)','dados_prestacao(uuid)'];
begin
  foreach f in array usuario loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
-- usadas nas políticas de RLS
grant execute on function private.ve_verba(uuid, uuid), private.ve_verba_id(uuid) to authenticated;
