import './lib/capturar-link-email'; // primeiro: antes do roteador ler o endereço
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProvedorSessao } from '@/app/sessao';
import { roteador } from '@/app/rotas';
import { definirFonte } from '@/dados/fonte';
import { aplicarTema } from '@/hooks/use-theme';
import { validarConfig } from '@/lib/config';
import { ErroApp } from '@/lib/erros';
import { instalarPoliticaTrustedTypes } from '@/lib/trusted-types';
import './index.css';

// Terceira camada contra clickjacking (além de frame-ancestors e X-Frame-Options): dentro de iframe de outro site, não funciona.
// Exceção só para a demonstração publicada em moldura (dados fictícios); a build de produção nunca entra aqui.
const demoEmArtefato = import.meta.env.MODE === 'demo' && import.meta.env.VITE_ARTEFATO === '1';
if (window.top !== window.self && !demoEmArtefato) {
  document.body.textContent = 'Por segurança, o sistema da Associação Exemplo não funciona dentro de outro site.';
  throw new Error('carregado dentro de iframe');
}

instalarPoliticaTrustedTypes();
aplicarTema();

async function iniciar() {
  const raiz = createRoot(document.getElementById('root')!);
  try {
    if (import.meta.env.MODE === 'demo') {
      const { criarFonteDemo } = await import('@/demo/fonte-demo');
      definirFonte(criarFonteDemo());
    } else {
      const { criarFonteSupabase } = await import('@/dados/fonte-supabase');
      definirFonte(criarFonteSupabase(validarConfig(import.meta.env)));
    }
  } catch (e) {
    raiz.render(<p role="alert" className="m-6 text-[17px]">O sistema não pôde iniciar: {(e as Error).message}</p>);
    return;
  }
  const consultas = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        // sem repetir quando o servidor disse "não" (permissão, inválido); só falha de rede
        retry: (n, e) => n < 2 && e instanceof ErroApp && (e.detalhe.erro === 'rede' || e.detalhe.erro === 'tempo_esgotado'),
      },
      mutations: { retry: false },
    },
  });
  raiz.render(
    <StrictMode>
      <QueryClientProvider client={consultas}>
        <TooltipProvider delayDuration={400}>
          <ProvedorSessao>
            <RouterProvider router={roteador} />
          </ProvedorSessao>
          <Toaster position="top-center" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void iniciar();
