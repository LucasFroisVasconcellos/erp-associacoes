import { abrirSeletor } from '@/lib/seletor';
import { useQueryClient } from '@tanstack/react-query';
import { Check, FilePlus2, FileUp, GitCompareArrows, Undo2, Wand2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { FormularioRpc } from '@/components/app/formulario';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Valor } from '@/components/app/valor';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { usePerfil } from '@/app/sessao';
import { useAcaoF5, useCategorias, useContas, useRpc } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { LinhaExtrato, PainelConciliacao } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, mesPorExtenso } from '@/lib/datas';
import { ErroApp } from '@/lib/erros';
import { contar } from '@/lib/texto';
import { erroMsg } from '@/telas/organizacao/comum';
import { ultimasCompetencias } from '@/telas/pessoas/comum';

const fimDoMes = (c: string) => { const [a, m] = c.split('-').map(Number) as [number, number]; return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };

export function Conciliacao() {
  const perfil = usePerfil();
  const contas = useContas();
  const meses = useMemo(() => ultimasCompetencias(13), []);
  const [conta, setConta] = useState('');
  const [mes, setMes] = useState(meses[0]!);
  const contaAtual = conta || (contas.data ?? []).find((c) => c.ativa)?.id || '';
  const painel = useRpc<PainelConciliacao>('painel_conciliacao', { p_conta: contaAtual, p_inicio: mes, p_fim: fimDoMes(mes) }, !!contaAtual);
  const auto = useAcaoF5<Record<string, unknown>, { conciliadas: number }>('conciliar_automatico');
  const [ignorar, setIgnorar] = useState<LinhaExtrato | null>(null);
  const [lancar, setLancar] = useState<LinhaExtrato[] | null>(null);
  const criar = pode(perfil, 'financeiro', 'criar');
  const editar = pode(perfil, 'financeiro', 'editar');
  const linhas = painel.data?.linhas ?? [];
  const pendentes = linhas.filter((l) => !l.lancamento_id && !l.ignorada_motivo);
  const feitas = linhas.filter((l) => l.lancamento_id || l.ignorada_motivo);
  async function automatico() {
    try { const r = await auto.mutateAsync({ p_conta: contaAtual }); toast.success(r.conciliadas ? `${contar(r.conciliadas, 'linha conciliada', 'linhas conciliadas')}` : 'Nenhuma sugestão sem dúvida'); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Pagina titulo="Conciliação" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }} acoes={editar && contaAtual ? <ImportarExtrato conta={contaAtual} /> : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="cc-conta">Conta</FieldLabel>
          <Select value={contaAtual} onValueChange={setConta}>
            <SelectTrigger id="cc-conta"><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
            <SelectContent><SelectGroup>{(contas.data ?? []).filter((c) => c.ativa).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select></Field>
        <Field><FieldLabel htmlFor="cc-mes">Mês</FieldLabel>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger id="cc-mes"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{meses.map((m) => <SelectItem key={m} value={m}>{mesPorExtenso(m).replace(/^./, (c) => c.toUpperCase())}</SelectItem>)}</SelectGroup></SelectContent>
          </Select></Field>
      </div>
      {painel.isError ? <BlocoErro erro={painel.error} tentarDeNovo={() => void painel.refetch()} />
        : painel.isPending ? <CarregandoLista />
          : linhas.length === 0 ? (
            <Vazio icone={GitCompareArrows} titulo="Nenhum extrato importado neste mês"
              descricao="Baixe o extrato no app ou no site do banco (OFX, CSV ou PDF) e importe aqui. O sistema sugere o lançamento de cada linha." />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[['Para conciliar', pendentes.length], ['Conciliadas', feitas.length], ['Sem extrato', painel.data!.sem_extrato.length]].map(([t, n]) => (
                  <div key={t} className="bg-card rounded-[18px] p-3"><p className="font-rounded numeros text-[22px] font-bold">{n}</p><p className="text-muted-foreground text-[13px]">{t}</p></div>
                ))}
              </div>
              {editar && pendentes.some((l) => l.sugestoes?.length === 1) && (
                <Button variant="secondary" disabled={auto.isPending} onClick={() => void automatico()}>
                  {auto.isPending ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" aria-hidden="true" />}Aceitar as sugestões sem dúvida</Button>
              )}
              {editar && criar && pendentes.filter((l) => !l.sugestoes?.length).length > 1 && (
                <Button variant="secondary" onClick={() => setLancar(pendentes.filter((l) => !l.sugestoes?.length))}>
                  <FilePlus2 data-icon="inline-start" aria-hidden="true" />Lançar as {pendentes.filter((l) => !l.sugestoes?.length).length} linhas sem lançamento</Button>
              )}
              <Grupo titulo="Para conciliar" rodape="Cada linha do banco precisa de um lançamento, ou de um motivo para ficar de fora.">
                {pendentes.length === 0 && <Linha icone={Check} cor="verde" titulo="Tudo conciliado neste mês" />}
                {pendentes.map((l) => <LinhaPendente key={l.id} linha={l} editar={editar} aoIgnorar={() => setIgnorar(l)} aoLancar={criar ? () => setLancar([l]) : undefined} />)}
              </Grupo>
              {painel.data!.sem_extrato.length > 0 && (
                <Grupo titulo="Lançamentos sem linha no extrato" rodape="Confira se foram lançados na conta certa ou na data certa.">
                  {painel.data!.sem_extrato.map((l) => <Linha key={l.id} titulo={l.descricao} descricao={formatarData(l.data)} para={`/dinheiro/lancamento/${l.id}`}
                    valor={<Valor valor={l.valor} tipo={l.tipo} className="text-[15px]" />} />)}
                </Grupo>
              )}
              {feitas.length > 0 && (
                <Grupo titulo="Conciliadas">
                  {feitas.map((l) => <LinhaFeita key={l.id} linha={l} editar={editar} />)}
                </Grupo>
              )}
            </>
          )}
      {lancar && <LancarDoExtrato linhas={lancar} aoFechar={() => setLancar(null)} />}
      {ignorar && (
        <FormularioRpc titulo="Deixar de fora" descricao={`${ignorar.descricao} · ${formatarData(ignorar.data)}`} rpc="ignorar_linha" sucesso="Linha marcada"
          campos={[{ nome: 'motivo', rotulo: 'Por quê', tipo: 'textarea', obrigatorio: true, max: 300, ajuda: 'Ex.: transferência entre contas da Associação Exemplo, já lançada nas duas pontas.' }]}
          montar={(d) => ({ p_linha: ignorar.id, p_motivo: d.motivo })} aoFechar={() => setIgnorar(null)} />
      )}
    </Pagina>
  );
}

function LinhaPendente({ linha: l, editar, aoIgnorar, aoLancar }: { linha: LinhaExtrato; editar: boolean; aoIgnorar: () => void; aoLancar?: () => void }) {
  const conciliar = useAcaoF5('conciliar');
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-[17px]">{l.descricao}</p><p className="text-muted-foreground text-[13px]">{formatarData(l.data)}</p></div>
        <Valor valor={l.valor.replace('-', '')} tipo={l.valor.startsWith('-') ? 'saida' : 'entrada'} className="text-[17px]" />
      </div>
      {editar && (
        <div className="flex flex-wrap gap-2">
          {(l.sugestoes ?? []).map((s) => (
            <Button key={s.id} size="sm" variant="secondary" disabled={conciliar.isPending}
              onClick={() => conciliar.mutate({ p_linha: l.id, p_lancamento: s.id }, { onSuccess: () => toast.success('Conciliada'), onError: (e) => toast.error(erroMsg(e)) })}>
              <Check data-icon="inline-start" aria-hidden="true" /><span className="max-w-48 truncate">{formatarData(s.data)} · {s.descricao}</span>
            </Button>
          ))}
          {(l.sugestoes ?? []).length === 0 && aoLancar && <Button size="sm" variant="secondary" onClick={aoLancar}><FilePlus2 data-icon="inline-start" aria-hidden="true" />Criar lançamento</Button>}
          {(l.sugestoes ?? []).length === 0 && !aoLancar && <span className="text-muted-foreground self-center text-[13px]">Sem lançamento parecido. Lance no Dinheiro ou deixe de fora.</span>}
          <Button size="sm" variant="ghost" onClick={aoIgnorar}>Deixar de fora</Button>
        </div>
      )}
    </div>
  );
}

function LinhaFeita({ linha: l, editar }: { linha: LinhaExtrato; editar: boolean }) {
  const desfazer = useAcaoF5('desfazer_conciliacao');
  return (
    <Linha icone={Check} cor={l.lancamento_id ? 'verde' : 'cinza'} titulo={l.descricao}
      descricao={`${formatarData(l.data)} · ${l.lancamento_id ? 'conciliada' : `fora: ${l.ignorada_motivo}`}`}
      valor={<span className="flex items-center gap-2"><Valor valor={l.valor.replace('-', '')} tipo={l.valor.startsWith('-') ? 'saida' : 'entrada'} className="text-[15px]" />
        {editar && <Button size="icon-sm" variant="ghost" aria-label={`Desfazer: ${l.descricao}`} disabled={desfazer.isPending}
          onClick={() => desfazer.mutate({ p_linha: l.id }, { onError: (e) => toast.error(erroMsg(e)) })}><Undo2 aria-hidden="true" /></Button>}</span>} />
  );
}

function ImportarExtrato({ conta }: { conta: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const qc = useQueryClient();
  async function importar(f: File | undefined) {
    if (!f) return;
    setLendo(true);
    try {
      if (f.size > 5 * 1024 * 1024) throw new ErroApp({ erro: 'grande_demais' });
      const { lerExtrato } = await import('@/lib/extrato');
      const r = await lerExtrato(f.name, await f.arrayBuffer());
      if (!r.linhas.length) { toast.error('Não encontramos movimentos nesse arquivo. Tente o OFX ou o CSV do extrato; o PDF depende do layout do banco.'); return; }
      let novas = 0, repetidas = 0;
      for (let i = 0; i < r.linhas.length; i += 2000) {
        const res = await fonte().rpc<{ novas: number; repetidas: number }>('importar_extrato', { p_conta: conta, p: r.linhas.slice(i, i + 2000) }, { tempoLimiteMs: 60_000 });
        novas += res.novas; repetidas += res.repetidas;
      }
      void qc.invalidateQueries();
      toast.success(`${contar(novas, 'linha nova', 'linhas novas')}${repetidas ? `, ${repetidas} já importadas` : ''}${r.ignoradas ? `, ${r.ignoradas} ignoradas (saldo ou formato estranho)` : ''}`);
    } catch (e) { toast.error(e instanceof ErroApp ? e.message : erroMsg(e, 'Não foi possível importar.')); }
    finally { setLendo(false); if (entrada.current) entrada.current.value = ''; }
  }
  return (
    <>
      <Button variant="ghost" size="sm" disabled={lendo} onClick={() => abrirSeletor(entrada.current)}>
        {lendo ? <Spinner data-icon="inline-start" /> : <FileUp data-icon="inline-start" aria-hidden="true" />}Importar</Button>
      <input ref={entrada} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".ofx,.qfx,.csv,.txt,.pdf,application/pdf" onChange={(e) => void importar(e.target.files?.[0])} />
    </>
  );
}

function LancarDoExtrato({ linhas, aoFechar }: { linhas: LinhaExtrato[]; aoFechar: () => void }) {
  const categorias = useCategorias();
  const acao = useAcaoF5<{ p: unknown[] }, { criados: number }>('lancar_do_extrato');
  const [cat, setCat] = useState<{ entrada: string; saida: string }>({ entrada: '', saida: '' });
  const [ids] = useState(() => linhas.map(() => crypto.randomUUID())); // mesmo id a cada tentativa: repetir não duplica
  const tipos = [...new Set(linhas.map((l) => (l.valor.startsWith('-') ? 'saida' : 'entrada') as 'entrada' | 'saida'))];
  const pronto = tipos.every((t) => cat[t]);
  async function salvar() {
    try {
      const r = await acao.mutateAsync({ p: linhas.map((l, i) => ({ linha: l.id, id: ids[i], categoria_id: cat[l.valor.startsWith('-') ? 'saida' : 'entrada'] })) });
      toast.success(`${contar(r.criados, 'lançamento criado e conciliado', 'lançamentos criados e conciliados')}`);
      aoFechar();
    } catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && !acao.isPending && aoFechar()} titulo={linhas.length === 1 ? 'Criar lançamento' : `Lançar ${linhas.length} linhas`}
      descricao={linhas.length === 1 ? `${linhas[0]!.descricao} · ${formatarData(linhas[0]!.data)}` : 'Cada linha vira um lançamento com a data, o valor e a descrição do banco, já conciliado.'}
      rodape={<Button size="lg" className="w-full" disabled={!pronto || acao.isPending} onClick={() => void salvar()}>{acao.isPending && <Spinner data-icon="inline-start" />}Criar e conciliar</Button>}>
      <div className="flex flex-col gap-4 pb-2">
        {tipos.map((t) => (
          <Field key={t}>
            <FieldLabel htmlFor={`lx-${t}`}>Categoria {tipos.length > 1 ? (t === 'saida' ? 'das saídas' : 'das entradas') : ''}</FieldLabel>
            <Select value={cat[t]} onValueChange={(v) => setCat((c) => ({ ...c, [t]: v }))}>
              <SelectTrigger id={`lx-${t}`}><SelectValue placeholder="Escolha a categoria" /></SelectTrigger>
              <SelectContent><SelectGroup>{(categorias.data ?? []).filter((c) => c.ativa && c.tipo === t).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
        ))}
        <p className="text-muted-foreground text-[13px]">Saídas criadas assim ficam sem comprovante: anexe depois no lançamento ou justifique antes de fechar o mês.</p>
      </div>
    </Folha>
  );
}
