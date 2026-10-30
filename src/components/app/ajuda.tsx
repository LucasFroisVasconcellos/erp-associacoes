import { ArrowRight, CircleHelp, Globe, LayoutGrid, Lightbulb, Plus, Search, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Folha } from '@/components/app/folha';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ajudaDa } from '@/lib/ajuda';
import { cn } from '@/lib/utils';

export function BotaoAjuda() {
  const { pathname } = useLocation();
  const [aberta, setAberta] = useState(false);
  const a = ajudaDa(pathname);
  if (!a) return null;
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} aria-label={`Ajuda: ${a.titulo}`}
        className="text-muted-foreground hover:text-tint hover:bg-tint/10 focus-visible:ring-ring/35 inline-flex size-8 shrink-0 items-center justify-center rounded-full align-middle transition-colors focus-visible:ring-4 focus-visible:outline-none">
        <CircleHelp aria-hidden="true" className="size-[22px]" strokeWidth={2} />
      </button>
      {aberta && (
        <Folha aberta aoMudar={(v) => !v && setAberta(false)} titulo={a.titulo} descricao={a.serve}>
          <div className="flex flex-col gap-5 pb-4">
            <ol className="flex flex-col gap-3">
              {a.passos.map((p, i) => (
                <li key={p} className="flex gap-3 text-[15px] leading-snug">
                  <span aria-hidden="true" className="bg-tint/12 text-tint font-rounded inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[14px] font-bold">{i + 1}</span>
                  <span className="pt-0.5">{p}</span>
                </li>
              ))}
            </ol>
            {a.dica && (
              <p className="bg-muted flex gap-2.5 rounded-[14px] px-3.5 py-3 text-[15px]">
                <Lightbulb aria-hidden="true" className="text-aviso mt-0.5 size-5 shrink-0" />{a.dica}
              </p>
            )}
            <Button variant="secondary" onClick={() => setAberta(false)}>Entendi</Button>
          </div>
        </Folha>
      )}
    </>
  );
}

interface Passo { icone: LucideIcon; titulo: ReactNode; texto: ReactNode }
const Interrogacao = () => <CircleHelp aria-label="botão de ajuda" className="inline size-[1.05em] -translate-y-px align-middle" strokeWidth={2.2} />;
const PASSOS: Passo[] = [
  { icone: Sparkles, titulo: 'Bem-vindo ao sistema da Associação Exemplo', texto: 'Aqui fica todo o dinheiro, a agenda, as tarefas e as pessoas da associação, num lugar só. Leva um minuto para conhecer.' },
  { icone: LayoutGrid, titulo: 'Cinco abas, por objetivo', texto: 'Início para o resumo. Dinheiro para entradas e saídas. Recursos para verbas e patrocínios. Equipe para atletas e viagens. Organização para agenda, tarefas e documentos.' },
  { icone: Plus, titulo: 'O botão + é o mais usado', texto: 'Gastou? Toque no +, tire a foto do comprovante e o sistema preenche valor, data e local. Você só confere.' },
  { icone: Search, titulo: 'Ache qualquer coisa', texto: 'Toque na lupa e digite: lançamento, pessoa, tarefa ou documento.' },
  { icone: CircleHelp, titulo: <>Dúvida? Toque no <Interrogacao /></>, texto: <>Cada tela tem um <Interrogacao /> ao lado do título com o que ela faz e por onde começar.</> },
  { icone: Globe, titulo: 'Tudo com segurança', texto: 'Cada pessoa vê só o que a diretoria liberou. Nada é apagado: tudo fica registrado para a prestação de contas.' },
];

const chave = (id: string) => `erp:tutorial:v1:${id}`;
// navegador automatizado (testes) não recebe o tour; o teste do próprio tour desliga essa marca
export function tutorialVisto(id: string) { if (navigator.webdriver) return true; try { return localStorage.getItem(chave(id)) === '1'; } catch { return true; } }
function marcarVisto(id: string) { try { localStorage.setItem(chave(id), '1'); } catch { /* sem armazenamento: aparece de novo, sem problema */ } }
export function reverTutorial(id: string) { try { localStorage.removeItem(chave(id)); } catch { /* idem */ } window.dispatchEvent(new Event('erp:tutorial')); }

export function Tutorial({ membroId }: { membroId: string }) {
  const [aberto, setAberto] = useState(() => !tutorialVisto(membroId));
  const [i, setI] = useState(0);
  useEffect(() => {
    const rever = () => { setI(0); setAberto(true); };
    window.addEventListener('erp:tutorial', rever);
    return () => window.removeEventListener('erp:tutorial', rever);
  }, []);
  const fechar = () => { marcarVisto(membroId); setAberto(false); };
  const principal = useRef<HTMLButtonElement>(null);
  const p = PASSOS[i]!; const ultimo = i === PASSOS.length - 1;
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="max-w-[min(26rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-[28px] p-0" showCloseButton={false}
        onOpenAutoFocus={(e) => { e.preventDefault(); principal.current?.focus({ preventScroll: true }); }}>
        <div className="from-tint/18 to-tint/0 flex flex-col items-center bg-gradient-to-b px-6 pt-9 pb-2 text-center">
          <span key={i} className="bg-tint text-primary-foreground animate-in fade-in zoom-in-90 inline-flex size-[72px] items-center justify-center rounded-[22px] shadow-[0_10px_30px_-8px_var(--tint)] duration-300">
            <p.icone aria-hidden="true" className="size-9" strokeWidth={2} />
          </span>
          <DialogTitle className="mt-5 text-[22px] leading-tight font-bold text-balance">{p.titulo}</DialogTitle>
          <DialogDescription className="text-muted-foreground mt-2 min-h-[4.5rem] text-[15px] leading-snug text-pretty">{p.texto}</DialogDescription>
        </div>
        <div className="flex justify-center gap-1.5 py-3" aria-label={`Passo ${i + 1} de ${PASSOS.length}`} role="img">
          {PASSOS.map((_, k) => <span key={k} className={cn('h-1.5 rounded-full transition-all duration-300', k === i ? 'bg-tint w-5' : 'bg-muted-foreground/30 w-1.5')} />)}
        </div>
        <div className="flex gap-2 px-5 pt-1 pb-5">
          {!ultimo && <Button variant="ghost" className="flex-1" onClick={fechar}>Pular</Button>}
          <Button ref={principal} className="flex-1" onClick={() => (ultimo ? fechar() : setI(i + 1))}>
            {ultimo ? 'Começar' : <>Próximo<ArrowRight data-icon="inline-end" aria-hidden="true" /></>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
