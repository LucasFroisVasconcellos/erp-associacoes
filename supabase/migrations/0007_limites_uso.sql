-- 0007 · Limite de uso por pessoa e por operação (rate limit), em janela fixa de 1 hora.
-- Fica no banco (compartilhado entre instâncias). Não substitui a proteção de borda do
-- Supabase/CDN contra DDoS; serve para conter abuso de uma conta (ou de uma conta roubada).

create table private.limites (
  chave text not null,
  janela timestamptz not null,
  contagem int not null default 0,
  primary key (chave, janela)
);
revoke all on private.limites from public, anon, authenticated, service_role;

create table private.limites_operacao (
  operacao text primary key,
  maximo_por_hora int not null check (maximo_por_hora > 0)
);
revoke all on private.limites_operacao from public, anon, authenticated, service_role;
insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('autorizar_comprovante', 60),
  ('autorizar_arquivo_contador', 30),
  ('registrar_convite', 20),
  ('criar_lancamento', 300),
  ('editar_lancamento', 300),
  ('estornar_lancamento', 60),
  ('dados_relatorio', 30),
  ('fechar_mes', 10);

-- Conta uma chamada; devolve a contagem na janela atual (null se a operação não tem limite).
create function private.consumir_limite(p_operacao text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_max int; v_janela timestamptz := date_trunc('hour', now()); v_n int;
begin
  select maximo_por_hora into v_max from private.limites_operacao where operacao = p_operacao;
  if v_max is null or auth.uid() is null then return null; end if;
  insert into private.limites as l (chave, janela, contagem)
  values (p_operacao || ':' || auth.uid()::text, v_janela, 1)
  on conflict (chave, janela) do update set contagem = l.contagem + 1
  returning contagem into v_n;
  -- limpeza ocasional de janelas antigas (barata e sem tarefa agendada)
  if random() < 0.01 then delete from private.limites where janela < now() - interval '1 day'; end if;
  return v_n - v_max; -- > 0 significa acima do limite
end $$;

-- Mesma checagem de sempre, agora com o limite de uso no final.
create or replace function private.checar(p_operacao text, p_modulo text default null, p_acao text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := private.sessao_erro(); v_excesso int;
begin
  if v = 'sem_acesso' then return private.negar(p_operacao, v); end if;
  if v is not null then return private.erro(v); end if;
  if p_modulo = 'acessos' then
    if not private.is_admin() then return private.negar(p_operacao); end if;
    if not private.totp_recente() then return private.erro('confirme_2fa'); end if;
  elsif p_modulo is not null and not private.pode(p_modulo, p_acao) then
    return private.negar(p_operacao);
  end if;
  v_excesso := private.consumir_limite(p_operacao);
  if v_excesso is not null and v_excesso > 0 then
    if v_excesso = 1 then return private.negar(p_operacao, 'limite'); end if;  -- registra só a primeira vez
    return private.erro('limite');
  end if;
  return null;
end $$;

revoke all on function private.consumir_limite(text) from public;
