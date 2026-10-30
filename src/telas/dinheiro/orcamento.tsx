// "Ritmo" compara o realizado com o esperado até hoje (previsto × parte do ano que já passou).
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CircleSlash, Pencil, TrendingDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { usePerfil } from '@/app/sessao';
import { useRpc } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import { alcance, pode } from '@/lib/acesso';
import { cent, reais } from '@/lib/analises';
import { hojeSP } from '@/lib/datas';
import { formatarBRL, lerValorBRL, mascararValor, paraCampo } from '@/lib/dinheiro';
import { fracaoDoAno, situacao, totais, type LinhaOrcamento, type SituacaoOrcamento } from '@/lib/orcamento';
import { erroMsg } from '@/telas/organizacao/comum';

const brl = (c: number) => formatarBRL(reais(c));
const SIT: Record<SituacaoOrcamento, { texto: string; icone: typeof Check; cor: string }> = {
  ok: { texto: 'No ritmo', icone: Check, cor: 'text-[var(--chart-2)]' },
  ritmo: { texto: 'Acima do ritmo', icone: AlertTriangle, cor: 'text-aviso' },
  estourou: { texto: 'Passou do previsto', icone: AlertTriangle, cor: 'text-destructive' },
  abaixo: { texto: 'Abaixo do esperado', icone: TrendingDown, cor: 'text-aviso' },
  sem_orcamento: { texto: 'Sem orçamento', icone: CircleSlash, cor: 'text-muted-foreground' },
};

export function Orcamento() {
  const perfil = usePerfil();
  const hoje = hojeSP(); const anoAtual = Number(hoje.slice(0, 4));
  const [ano, setAno] = useState(String(anoAtual));
  const [editar, setEditar] = useState(false);
  const tudo = alcance(perfil, 'financeiro', 'ver') === 'tudo';
  const r = useRpc<{ categorias: LinhaOrcamento[] }>('orcamento_ano', { p_ano: Number(ano) }, tudo);
  const fracao = fracaoDoAno(Number(ano), hoje);
  const linhas = r.data?.categorias ?? [];
  const desp = totais(linhas, 'saida'), rec = totais(linhas, 'entrada');
  const adm = pode(perfil, 'financeiro', 'administrar');
  if (!tudo) return <Pagina titulo="Orçamento" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}><Vazio icone={AlertTriangle} titulo="Só para quem vê todo o financeiro" descricao="O orçamento usa o movimento de todas as contas." /></Pagina>;
  return (
    <Pagina titulo="Orçamento" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}
      acoes={adm && r.data ? <Button variant="ghost" size="sm" onClick={() => setEditar(true)}><Pencil data-icon="inline-start" aria-hidden="true" />Definir valores</Button> : undefined}
      sob={<Segmentado rotulo="Ano" valor={ano} aoMudar={setAno} opcoes={[anoAtual - 1, anoAtual, anoAtual + 1].map((a) => ({ valor: String(a), rotulo: String(a) }))} />}>
      {r.isError ? <BlocoErro erro={r.error} tentarDeNovo={() => void r.refetch()} /> : r.isPending ? <CarregandoLista /> : (
        <>
          {desp.previsto + rec.previsto === 0 && (
            <Vazio icone={Pencil} titulo={`Orçamento de ${ano} ainda vazio`}
              descricao={adm ? 'Toque em "Definir valores": dá para começar pelo que foi gasto no ano anterior e ajustar.' : 'Quem administra o financeiro define os valores do ano.'} />
          )}
          <div className="grid grid-cols-2 gap-3">
            {[['Despesas', desp], ['Receitas', rec]].map(([t, x]) => {
              const v = x as typeof desp; const parte = v.previsto ? v.realizado / v.previsto : 0;
              return (
                <div key={t as string} className="bg-card rounded-[18px] p-3.5">
                  <p className="text-muted-foreground text-[13px]">{t as string}</p>
                  <p className="font-rounded numeros text-[20px] font-bold">{brl(v.realizado)}</p>
                  <p className="text-muted-foreground text-[13px]">de {brl(v.previsto)} previstos{v.previsto ? ` · ${Math.round(parte * 100)}%` : ''}</p>
                </div>
              );
            })}
          </div>
          {fracao > 0 && fracao < 1 && <p className="text-muted-foreground px-1 text-[13px]">Já passou {Math.round(fracao * 100)}% do ano. "No ritmo" compara o realizado com essa parte do previsto.</p>}
          {(['saida', 'entrada'] as const).map((tipo) => (
            <Grupo key={tipo} titulo={tipo === 'saida' ? 'Despesas por categoria' : 'Receitas por categoria'}>
              {linhas.filter((l) => l.tipo === tipo).map((l) => <LinhaCategoria key={l.id} l={l} fracao={fracao} />)}
            </Grupo>
          ))}
        </>
      )}
      {editar && r.data && <EditarOrcamento ano={Number(ano)} linhas={linhas} aoFechar={() => setEditar(false)} />}
    </Pagina>
  );
}

function LinhaCategoria({ l, fracao }: { l: LinhaOrcamento; fracao: number }) {
  const s = situacao(l, fracao); const S = SIT[s];
  const p = cent(l.previsto), r = cent(l.realizado);
  const parte = p ? Math.min(1, r / p) : 0;
  const cor = s === 'estourou' ? 'var(--destructive)' : s === 'ritmo' || s === 'abaixo' ? 'var(--aviso)' : l.tipo === 'saida' ? 'var(--serie-saida)' : 'var(--serie-entrada)';
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[17px]">{l.nome}</span>
        <span className="numeros shrink-0 text-[15px]">{brl(r)}{p ? <span className="text-muted-foreground"> / {brl(p)}</span> : null}</span>
      </div>
      {p > 0 && (
        <span className="bg-muted relative block h-2 overflow-hidden rounded-[4px]" aria-hidden="true">
          <span className="block h-full rounded-[4px]" style={{ width: `${Math.max(1, parte * 100)}%`, background: cor }} />
          {fracao > 0 && fracao < 1 && <span className="bg-foreground/50 absolute top-0 h-full w-0.5" style={{ left: `${fracao * 100}%` }} />}
        </span>
      )}
      <p className={`flex items-center gap-1 text-[13px] ${S.cor}`}><S.icone aria-hidden="true" className="size-3.5" />{S.texto}
        {cent(l.a_realizar) > 0 && <span className="text-muted-foreground"> · {brl(cent(l.a_realizar))} ainda {l.tipo === 'saida' ? 'a pagar' : 'a receber'}</span>}</p>
    </div>
  );
}

function EditarOrcamento({ ano, linhas, aoFechar }: { ano: number; linhas: LinhaOrcamento[]; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(linhas.map((l) => [l.id, cent(l.previsto) ? paraCampo(l.previsto) : ''])));
  const [salvando, setSalvando] = useState(false);
  const anterior = useRpc<{ categorias: LinhaOrcamento[] }>('orcamento_ano', { p_ano: ano - 1 });
  const invalidos = useMemo(() => Object.entries(v).filter(([, x]) => x && !lerValorBRL(x)).length, [v]);
  function sugerir() {
    const ant = new Map((anterior.data?.categorias ?? []).map((l) => [l.id, l.realizado]));
    setV((x) => Object.fromEntries(Object.entries(x).map(([id, atual]) => [id, atual || (cent(ant.get(id)) ? paraCampo(ant.get(id)) : '')])));
    toast.info(`Preenchido com o realizado de ${ano - 1} onde estava vazio. Ajuste o que mudar.`);
  }
  async function salvar() {
    setSalvando(true);
    try {
      await fonte().rpc('salvar_orcamento', { p_ano: ano, p: linhas.map((l) => ({ categoria_id: l.id, valor: lerValorBRL(v[l.id] ?? '') ?? '0' })) });
      void qc.invalidateQueries(); toast.success('Orçamento salvo'); aoFechar();
    } catch (e) { toast.error(erroMsg(e)); } finally { setSalvando(false); }
  }
  return (
    <Folha aberta larga aoMudar={(x) => !x && !salvando && aoFechar()} titulo={`Orçamento de ${ano}`} descricao="Quanto a Associação Exemplo planeja receber e gastar no ano em cada categoria. Deixe vazio o que não quiser acompanhar."
      rodape={<Button size="lg" className="w-full" disabled={salvando || invalidos > 0} onClick={() => void salvar()}>{salvando && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <div className="flex flex-col gap-4 pb-2">
        <Button variant="secondary" disabled={!anterior.data} onClick={sugerir}>Sugerir pelo que foi realizado em {ano - 1}</Button>
        {(['saida', 'entrada'] as const).map((tipo) => (
          <Grupo key={tipo} titulo={tipo === 'saida' ? 'Despesas' : 'Receitas'}>
            {linhas.filter((l) => l.tipo === tipo).map((l) => (
              <label key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate text-[15px]">{l.nome}</span>
                <Input className="numeros w-36 shrink-0 text-right" inputMode="numeric" autoComplete="off" placeholder="0,00" aria-label={`Orçamento de ${l.nome}`}
                  value={v[l.id] ?? ''} onChange={(e) => setV((x) => ({ ...x, [l.id]: mascararValor(e.target.value) }))} />
              </label>
            ))}
          </Grupo>
        ))}
      </div>
    </Folha>
  );
}
