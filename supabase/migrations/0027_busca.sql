-- 0027 · Busca única: lançamentos, pessoas, tarefas, eventos, documentos e reuniões.
-- SECURITY INVOKER de propósito: roda com a RLS de quem busca, então cada pessoa só acha o que já
-- poderia ver nas telas (alcance "próprios", tarefas visíveis, pessoas só com o módulo, etc.).
-- Nada de saúde: a área de saúde não entra na busca.

create function public.busca_global(p_termo text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v text; t text;
begin
  t := btrim(coalesce(p_termo, ''));
  if char_length(t) not between 2 and 60 or t ~ '[[:cntrl:]]' then return jsonb_build_object('ok', false, 'erro', 'invalido', 'campo', 'termo'); end if;
  -- curingas do LIKE viram texto comum
  v := '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_build_object('ok', true, 'resultados', (
    select coalesce(jsonb_agg(r), '[]') from (
      (select 'lancamento' tipo, l.id, l.descricao titulo, l.tipo || '|' || l.valor::text detalhe, l.data::text data
         from public.lancamentos l where l.descricao ilike v order by l.data desc limit 8)
      union all
      (select 'pessoa', p.id, p.nome, case when p.atleta then 'atleta' else 'associado' end, null
         from public.pessoas p where p.nome ilike v and p.situacao <> 'desligado' order by p.nome limit 8)
      union all
      (select 'tarefa', x.id, x.titulo, x.situacao, x.prazo::text from public.tarefas x where x.titulo ilike v order by x.criado_em desc limit 8)
      union all
      (select 'evento', e.id, e.titulo, null, (e.inicio at time zone 'America/Sao_Paulo')::date::text
         from public.eventos e where e.titulo ilike v and e.cancelado_em is null order by e.inicio desc limit 8)
      union all
      (select 'documento', d.id, d.titulo, d.tipo, d.validade::text from public.documentos_institucionais d where d.titulo ilike v order by d.titulo limit 8)
      union all
      (select 'reuniao', r.id, r.titulo, r.tipo, (r.data at time zone 'America/Sao_Paulo')::date::text from public.reunioes r where r.titulo ilike v order by r.data desc limit 8)
    ) r));
end $$;

revoke all on function public.busca_global(text) from public, anon;
grant execute on function public.busca_global(text) to authenticated;
