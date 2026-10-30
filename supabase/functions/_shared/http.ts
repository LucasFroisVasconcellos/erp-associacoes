
export function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/** Erro inesperado: a pessoa recebe só um código genérico e o requestId; o detalhe vai para o log, sem dados pessoais nem segredos. */
export function erroInterno(etapa: string, e?: unknown): Response {
  const requestId = crypto.randomUUID();
  const nome = e instanceof Error ? e.name : typeof e;
  console.error(JSON.stringify({ requestId, etapa, erro: nome }));
  return json(500, { erro: 'falha_interna', requestId });
}

/** CORS só para a origem do sistema (variável APP_ORIGIN). Sem origem configurada: falha fechada. */
export function cabecalhosCors(origem: string | undefined): Record<string, string> {
  if (!origem || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origem)) {
    throw new Error('APP_ORIGIN ausente ou inválida');
  }
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
