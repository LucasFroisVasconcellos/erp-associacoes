-- 0038: cargos que o estatuto prevê e o sistema ainda não tinha.
--  * representante_atletas: membro da Diretoria Executiva eleito pelos atletas.
--    Modelo padrão = o do diretor (organização, agenda, viagens e leitura do resto).
--  * conselho_fiscal: presidente, conselheiros e suplente. Órgão autônomo de fiscalização:
--    só CONSULTA e EXPORTA o que fiscaliza (contas, contador, relatórios, verbas, projetos, patrimônio,
--    documentos, viagens, captação e filiações). Nunca cria, edita ou aprova; não é administrador
--    (não pode ocupar cargo de direção); não vê Pessoas nem Saúde (minimização, LGPD).
-- Como todo cargo, o modelo cadastrado em Acessos substitui o padrão.

create or replace function private.cargos() returns text[] language sql immutable set search_path = '' as $$
  select array['presidente','vice_presidente','secretario','tesoureiro','diretor','dev','representante_atletas','conselho_fiscal']
$$;
-- cargos_admin continua: presidente, vice-presidente, secretário e dev

create function private.permissoes_conselho_fiscal() returns jsonb
language sql immutable set search_path = '' as $$
  with regras(modulo, acoes) as (values
    ('financeiro', '{ver,exportar}'), ('contador', '{ver,exportar}'), ('relatorios', '{ver,exportar}'),
    ('verbas', '{ver,exportar}'), ('projetos', '{ver,exportar}'), ('patrimonio', '{ver}'), ('documentos', '{ver}'),
    ('viagens', '{ver}'), ('captacao', '{ver}'), ('filiacoes', '{ver}'), ('avisos', '{ver}'), ('agenda', '{ver}')
  )
  select jsonb_agg(jsonb_build_object('modulo', r.modulo, 'acao', a, 'alcance', 'tudo') order by r.modulo, a)
  from regras r, unnest(r.acoes::text[]) a
$$;

create or replace function private.permissoes_modelo(p_cargo text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.permissoes from public.modelos_permissao m where m.cargo = p_cargo),
    (select m.permissoes from public.modelos_permissao m where p_cargo = 'vice_presidente' and m.cargo = 'presidente'),
    case p_cargo
      when 'dev' then private.permissoes_todas()
      when 'conselho_fiscal' then private.permissoes_conselho_fiscal()
      when 'representante_atletas' then private.permissoes_modelo_padrao('diretor')
      else private.permissoes_modelo_padrao(p_cargo) end)
$$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function private.permissoes_conselho_fiscal() from authenticated, service_role, anon;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
