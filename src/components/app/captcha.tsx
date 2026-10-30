// Quem valida o token é o servidor. O token vale UMA vez:
// depois de cada tentativa o widget é reiniciado.
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useCallback, useRef, useState } from 'react';
import { fonte } from '@/dados/fonte';

export function useCaptcha(acao?: string) {
  const chave = fonte().captcha;
  const ref = useRef<TurnstileInstance | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  const reiniciar = useCallback(() => { setToken(null); ref.current?.reset(); }, []);

  const elemento = chave ? (
    <div className="flex min-h-[65px] flex-col items-center gap-1.5">
      <Turnstile
        ref={ref}
        siteKey={chave}
        options={{ language: 'pt-br', theme: 'auto', size: 'flexible', refreshExpired: 'auto', appearance: 'always', ...(acao ? { action: acao } : {}) }}
        onSuccess={(t) => { setToken(t); setFalhou(false); }}
        onExpire={() => setToken(null)}
        onError={() => { setToken(null); setFalhou(true); }}
      />
      {falhou && <p role="alert" className="text-destructive text-[13px]">A verificação não carregou. Confira a internet e recarregue a página.</p>}
    </div>
  ) : null;

  return {
    pendente: Boolean(chave) && !token,
    token: token ?? undefined,
    reiniciar,
    elemento,
    ligado: Boolean(chave),
  };
}
