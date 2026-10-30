import { abrirSeletor } from '@/lib/seletor';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpenCheck, Check, FileSpreadsheet, GitCompareArrows, Landmark, Scale } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { usePerfil } from '@/app/sessao';
import { useAcaoF5, useCategorias, useContas, useLista, useRpc } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { ComparacaoContador, ContaContabil, Natureza } from '@/dados/tipos';
import { alcance, pode } from '@/lib/acesso';
import { hojeSP, mesPorExtenso } from '@/lib/datas';
import { formatarBRL } from '@/lib/dinheiro';
import { ErroApp } from '@/lib/erros';
import {
  lerBalancete, lerPlanoContas, lerTabela, montarLancamentos, NATUREZA_PADRAO, normal, payloadLancamentos,
  type ItemLancamento, type LinhaBalancete, type Tabela,
} from '@/lib/importar';
import { contar } from '@/lib/texto';
import { erroMsg } from '@/telas/organizacao/comum';
import { ultimasCompetencias } from '@/telas/pessoas/comum';

type Fluxo = 'lancamentos' | 'plano' | 'balancete' | null;
const NOMES_NATUREZA: Record<Natureza, string> = { ativo: 'Ativo', passivo: 'Passivo', patrimonio: 'Patrimônio', receita: 'Receita', despesa: 'Despesa', outra: 'Outra' };
const ACEITA = '.xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function Importar() {
  const perfil = usePerfil();
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') === 'contador' ? 'contador' : 'importar';
  const [fluxo, setFluxo] = useState<Fluxo>(null);
  const adm = pode(perfil, 'financeiro', 'administrar');
  const editar = pode(perfil, 'financeiro', 'editar');
  return (
    <Pagina titulo="Importar e contador" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}
      sob={<Segmentado rotulo="O que mostrar" valor={aba} aoMudar={(v) => setParams(v === 'contador' ? { aba: v } : {}, { replace: true })}
        opcoes={[{ valor: 'importar', rotulo: 'Importar arquivos' }, { valor: 'contador', rotulo: 'Comparar com o contador' }]} />}>
      {aba === 'importar' ? (
        <>
          <Grupo titulo="Contabilidade antiga e do contador" rodape="O arquivo é lido no seu aparelho e não é enviado. Antes de gravar, você vê uma prévia; o servidor confere tudo e grava tudo ou nada, sem duplicar.">
            {adm && <Linha icone={FileSpreadsheet} cor="verde" titulo="Lançamentos antigos" descricao="Planilha Excel (.xlsx) ou CSV com data, descrição e valor" aoTocar={() => setFluxo('lancamentos')} />}
            <Linha icone={GitCompareArrows} cor="azul" titulo="Extrato do banco" descricao="OFX, CSV ou PDF — na Conciliação, onde cada linha vira lançamento" para="/dinheiro/conciliacao" />
            {adm && <Linha icone={BookOpenCheck} cor="indigo" titulo="Plano de contas do contador" descricao="Lista de contas (código e nome) para ligar às categorias" aoTocar={() => setFluxo('plano')} />}
            {editar && <Linha icone={Scale} cor="roxo" titulo="Balancete do contador" descricao="Balancete do mês (Excel ou CSV) para comparar com o sistema" aoTocar={() => setFluxo('balancete')} />}
          </Grupo>
          {!adm && <p className="text-muted-foreground px-1 text-[13px]">Importar lançamentos e o plano de contas é só para quem administra o financeiro.</p>}
        </>
      ) : <Comparar adm={adm} />}
      {fluxo === 'lancamentos' && <ImportarLancamentos aoFechar={() => setFluxo(null)} />}
      {fluxo === 'plano' && <ImportarPlano aoFechar={() => setFluxo(null)} />}
      {fluxo === 'balancete' && <ImportarBalancete aoFechar={() => setFluxo(null)} />}
    </Pagina>
  );
}

function EscolherArquivo({ aoLer, rotulo = 'Escolher arquivo' }: { aoLer: (nome: string, t: Tabela) => void; rotulo?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  async function ler(f: File | undefined) {
    if (!f) return;
    setLendo(true);
    try { aoLer(f.name.slice(0, 160), await lerTabela(f.name, await f.arrayBuffer())); }
    catch (e) { toast.error((e as Error).message === 'grande_demais' ? 'O arquivo passou de 5 MB. Divida em partes menores.' : 'Não foi possível ler esse arquivo. Use Excel (.xlsx) ou CSV.'); }
    finally { setLendo(false); if (ref.current) ref.current.value = ''; }
  }
  return (
    <>
      <Button size="lg" variant="secondary" className="w-full" disabled={lendo} onClick={() => abrirSeletor(ref.current)}>
        {lendo ? <Spinner data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" aria-hidden="true" />}{rotulo}
      </Button>
      <input ref={ref} type="file" accept={ACEITA} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void ler(e.target.files?.[0])} />
    </>
  );
}

function Problemas({ itens }: { itens: { linha: number; texto: string }[] }) {
  if (!itens.length) return null;
  return (
    <div role="alert" className="bg-destructive/8 flex flex-col gap-1 rounded-[14px] px-3.5 py-3 text-[15px]">
      <p className="text-destructive flex items-center gap-2 font-semibold"><AlertTriangle aria-hidden="true" className="size-4" />{contar(itens.length, 'linha precisa', 'linhas precisam')} de ajuste</p>
      <ul className="text-muted-foreground max-h-48 overflow-y-auto text-[13px]">
        {itens.slice(0, 50).map((p, i) => <li key={i}>Linha {p.linha}: {p.texto}</li>)}
      </ul>
      {itens.length > 50 && <p className="text-muted-foreground text-[13px]">… e mais {itens.length - 50}.</p>}
    </div>
  );
}

const CAMPO_NOME: Record<string, string> = { categoria_id: 'categoria', conta_id: 'conta', data: 'data', valor: 'valor', descricao: 'descrição', id: 'linha repetida' };

function ImportarLancamentos({ aoFechar }: { aoFechar: () => void }) {
  const qc = useQueryClient();
  const categorias = useCategorias(); const contas = useContas();
  const [arquivo, setArquivo] = useState<{ nome: string; t: Tabela } | null>(null);
  const [contaPadrao, setContaPadrao] = useState('');
  const [mapa, setMapa] = useState<Record<string, string>>({}); // "tipo|nome da planilha" → categoria
  const [enviando, setEnviando] = useState(false);
  const [doServidor, setDoServidor] = useState<{ linha: number; texto: string }[]>([]);
  const contasAtivas = (contas.data ?? []).filter((c) => c.ativa);
  const conta = contaPadrao || contasAtivas[0]?.id || '';
  const leitura = useMemo(() => arquivo ? montarLancamentos(arquivo.t, { categorias: categorias.data ?? [], contas: contasAtivas.map((c) => ({ id: c.id, nome: c.nome })), contaPadrao: conta || null, hoje: hojeSP() }) : null,
    [arquivo, categorias.data, contasAtivas, conta]);
  const itens: ItemLancamento[] = useMemo(() => (leitura?.itens ?? []).map((i) => {
    const escolhida = mapa[`${i.tipo}|${normal(i.categoriaNome)}`];
    return i.categoria_id || !escolhida ? i : { ...i, categoria_id: escolhida };
  }), [leitura, mapa]);
  const semCategoria = [...new Set(itens.filter((i) => !i.categoria_id && !i.problemas.length).map((i) => `${i.tipo}|${normal(i.categoriaNome)}`))]
    .map((k) => ({ chave: k, tipo: k.split('|')[0] as 'entrada' | 'saida', nome: itens.find((i) => `${i.tipo}|${normal(i.categoriaNome)}` === k)!.categoriaNome }));
  const prontos = itens.filter((i) => !i.problemas.length && i.categoria_id);
  const problemas = [...itens.filter((i) => i.problemas.length).map((i) => ({ linha: i.linha, texto: i.problemas.join(', ') })), ...doServidor];

  async function importar() {
    if (!arquivo || enviando) return;
    setEnviando(true); setDoServidor([]);
    try {
      const p = await payloadLancamentos(prontos);
      let novas = 0, repetidas = 0;
      for (let i = 0; i < p.length; i += 1000) {
        const parte = p.slice(i, i + 1000);
        const r = await fonte().rpc<{ ok: boolean; erro?: string; novas?: number; repetidas?: number; problemas?: { linha: number; campo?: string }[] }>(
          'importar_lancamentos', { p_lote: crypto.randomUUID(), p_arquivo: arquivo.nome, p: parte }, { tempoLimiteMs: 90_000 });
        if (r.erro === 'linhas_invalidas') throw new ErroApp({ erro: 'linhas_invalidas', problemas: (r.problemas ?? []) as never });
        novas += r.novas ?? 0; repetidas += r.repetidas ?? 0;
      }
      void qc.invalidateQueries();
      toast.success(`${contar(novas, 'lançamento importado', 'lançamentos importados')}${repetidas ? `; ${repetidas} já existiam` : ''}`);
      aoFechar();
    } catch (e) {
      const d = e instanceof ErroApp ? e.detalhe : null;
      if (d?.problemas?.length) setDoServidor(d.problemas.map((x) => ({ linha: prontos[x.linha - 1]?.linha ?? x.linha, texto: `confira ${CAMPO_NOME[x.campo ?? ''] ?? 'os dados'}${x.campo === 'data' ? ' (antes do saldo inicial da conta, no futuro ou em mês fechado)' : ''}` })));
      toast.error(erroMsg(e, 'Não foi possível importar.'));
    } finally { setEnviando(false); }
  }

  return (
    <Folha aberta larga aoMudar={(v) => !v && !enviando && aoFechar()} titulo="Lançamentos antigos"
      descricao={arquivo ? arquivo.nome : 'A planilha precisa ter colunas de data, descrição e valor (ou entrada e saída). Categoria e conta são opcionais.'}
      rodape={arquivo ? (
        <Button size="lg" className="w-full" disabled={!prontos.length || enviando} onClick={() => void importar()}>
          {enviando && <Spinner data-icon="inline-start" />}Importar {contar(prontos.length, 'lançamento', 'lançamentos')}
        </Button>) : undefined}>
      <div className="flex flex-col gap-4 pb-2">
        <EscolherArquivo rotulo={arquivo ? 'Trocar arquivo' : 'Escolher planilha'} aoLer={(nome, t) => { setArquivo({ nome, t }); setMapa({}); setDoServidor([]); }} />
        {arquivo && !leitura && <p role="alert" className="text-destructive text-[15px]">Não achamos as colunas de data, descrição e valor. Confira o cabeçalho da planilha.</p>}
        {leitura && (
          <>
            <Field>
              <FieldLabel htmlFor="im-conta">Conta das linhas sem coluna de conta</FieldLabel>
              <Select value={conta} onValueChange={setContaPadrao}>
                <SelectTrigger id="im-conta"><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
                <SelectContent><SelectGroup>{contasAtivas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <FieldDescription>Datas antes do saldo inicial da conta são recusadas: ajuste o saldo inicial em Contas se a planilha for mais antiga.</FieldDescription>
            </Field>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Prontos', prontos.length], ['Sem categoria', itens.filter((i) => !i.categoria_id && !i.problemas.length).length], ['Com problema', itens.filter((i) => i.problemas.length).length]].map(([t, n]) => (
                <div key={t} className="bg-muted rounded-[14px] p-2.5"><p className="font-rounded numeros text-[20px] font-bold">{n}</p><p className="text-muted-foreground text-[13px]">{t}</p></div>
              ))}
            </div>
            {semCategoria.length > 0 && (
              <Grupo titulo="Escolha a categoria" rodape="Cada nome da planilha vira uma categoria do sistema. Vale para todas as linhas com o mesmo nome.">
                {semCategoria.slice(0, 40).map((s) => (
                  <div key={s.chave} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 truncate text-[15px]">{s.nome || '(sem categoria)'} <span className="text-muted-foreground">· {s.tipo === 'saida' ? 'saída' : 'entrada'}</span></span>
                    <Select value={mapa[s.chave] ?? ''} onValueChange={(v) => setMapa((m) => ({ ...m, [s.chave]: v }))}>
                      <SelectTrigger className="w-48 shrink-0" aria-label={`Categoria para ${s.nome || 'linhas sem categoria'}`}><SelectValue placeholder="Escolher" /></SelectTrigger>
                      <SelectContent><SelectGroup>{(categorias.data ?? []).filter((c) => c.ativa && c.tipo === s.tipo).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  </div>
                ))}
              </Grupo>
            )}
            <Problemas itens={problemas} />
            {prontos.length > 0 && (
              <Grupo titulo="Prévia" rodape={prontos.length > 8 ? `Mostrando 8 de ${prontos.length}.` : undefined}>
                {prontos.slice(0, 8).map((i) => (
                  <Linha key={i.linha} titulo={i.descricao} descricao={`${i.data!.split('-').reverse().join('/')} · ${(categorias.data ?? []).find((c) => c.id === i.categoria_id)?.nome ?? ''}`}
                    valor={<span className="numeros text-[15px]">{i.tipo === 'saida' ? '-' : '+'}{formatarBRL(i.valor)}</span>} />
                ))}
              </Grupo>
            )}
            {leitura.ignoradas > 0 && <p className="text-muted-foreground text-[13px]">{contar(leitura.ignoradas, 'linha de saldo ignorada', 'linhas de saldo ignoradas')}.</p>}
          </>
        )}
      </div>
    </Folha>
  );
}

function ImportarPlano({ aoFechar }: { aoFechar: () => void }) {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = useState<{ nome: string; t: Tabela } | null>(null);
  const [porDigito, setPorDigito] = useState(NATUREZA_PADRAO);
  const [enviando, setEnviando] = useState(false);
  const leitura = useMemo(() => (arquivo ? lerPlanoContas(arquivo.t, porDigito) : null), [arquivo, porDigito]);
  const digitos = [...new Set((leitura?.contas ?? []).map((c) => c.codigo[0]!))].sort();
  async function importar() {
    if (!arquivo || !leitura || enviando) return;
    setEnviando(true);
    try {
      const r = await fonte().rpc<{ novas?: number; repetido?: boolean }>('importar_plano_contas', { p_lote: crypto.randomUUID(), p_arquivo: arquivo.nome, p: leitura.contas.slice(0, 2000) });
      void qc.invalidateQueries();
      toast.success(`Plano de contas importado${r.novas ? `: ${contar(r.novas, 'conta nova', 'contas novas')}` : ''}. Agora ligue as categorias em "Comparar com o contador".`);
      aoFechar();
    } catch (e) { toast.error(erroMsg(e, 'Não foi possível importar.')); } finally { setEnviando(false); }
  }
  return (
    <Folha aberta larga aoMudar={(v) => !v && !enviando && aoFechar()} titulo="Plano de contas do contador"
      descricao={arquivo ? arquivo.nome : 'Peça ao contador o plano de contas em Excel ou CSV, com as colunas código e nome (natureza é opcional).'}
      rodape={leitura?.contas.length ? <Button size="lg" className="w-full" disabled={enviando} onClick={() => void importar()}>{enviando && <Spinner data-icon="inline-start" />}Importar {contar(leitura.contas.length, 'conta', 'contas')}</Button> : undefined}>
      <div className="flex flex-col gap-4 pb-2">
        <EscolherArquivo rotulo={arquivo ? 'Trocar arquivo' : 'Escolher arquivo'} aoLer={(nome, t) => setArquivo({ nome, t })} />
        {arquivo && !leitura && <p role="alert" className="text-destructive text-[15px]">Não achamos as colunas de código e nome.</p>}
        {leitura && (
          <>
            <Grupo titulo="O que cada grupo é" rodape="Pelo primeiro número do código. O nome da conta (ex.: “Receita…”, “Despesa…”) ou a coluna de natureza têm prioridade. Confira com o contador.">
              {digitos.map((d) => (
                <div key={d} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-[15px]">Contas que começam com {d}</span>
                  <Select value={porDigito[d] ?? 'outra'} onValueChange={(v) => setPorDigito((x) => ({ ...x, [d]: v as Natureza }))}>
                    <SelectTrigger className="w-40" aria-label={`Natureza das contas com ${d}`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{Object.entries(NOMES_NATUREZA).map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </div>
              ))}
            </Grupo>
            <Grupo titulo="Prévia" rodape={leitura.ignoradas ? `${contar(leitura.ignoradas, 'linha ignorada', 'linhas ignoradas')} (código inválido ou repetido).` : undefined}>
              {leitura.contas.slice(0, 10).map((c) => <Linha key={c.codigo} titulo={`${c.codigo} · ${c.nome}`} valor={<span className="text-muted-foreground text-[13px]">{NOMES_NATUREZA[c.natureza]}</span>} />)}
            </Grupo>
          </>
        )}
      </div>
    </Folha>
  );
}

function ImportarBalancete({ aoFechar }: { aoFechar: () => void }) {
  const qc = useQueryClient();
  const meses = useMemo(() => ultimasCompetencias(24), []);
  const [mes, setMes] = useState(meses[1] ?? meses[0]!);
  const [arquivo, setArquivo] = useState<{ nome: string; linhas: LinhaBalancete[]; ignoradas: number } | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function importar() {
    if (!arquivo || enviando) return;
    setEnviando(true);
    try {
      await fonte().rpc('importar_balancete', { p_lote: crypto.randomUUID(), p_arquivo: arquivo.nome, p_competencia: mes, p: arquivo.linhas.slice(0, 3000) });
      void qc.invalidateQueries();
      toast.success('Balancete guardado. Veja a comparação em "Comparar com o contador".');
      aoFechar();
    } catch (e) { toast.error(erroMsg(e, 'Não foi possível importar.')); } finally { setEnviando(false); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && !enviando && aoFechar()} titulo="Balancete do contador"
      descricao="Excel ou CSV com código, nome, débito e crédito de cada conta. O PDF original continua em Documentos › Arquivos do contador."
      rodape={arquivo?.linhas.length ? <Button size="lg" className="w-full" disabled={enviando} onClick={() => void importar()}>{enviando && <Spinner data-icon="inline-start" />}Guardar balancete de {mesPorExtenso(mes)}</Button> : undefined}>
      <div className="flex flex-col gap-4 pb-2">
        <Field>
          <FieldLabel htmlFor="bal-mes">Mês do balancete</FieldLabel>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger id="bal-mes"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{meses.map((m) => <SelectItem key={m} value={m}>{mesPorExtenso(m).replace(/^./, (c) => c.toUpperCase())}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <EscolherArquivo rotulo={arquivo ? 'Trocar arquivo' : 'Escolher arquivo'} aoLer={(nome, t) => {
          const r = lerBalancete(t);
          if (!r || !r.linhas.length) { toast.error('Não achamos as colunas de código, nome, débito e crédito.'); return; }
          setArquivo({ nome, ...r });
        }} />
        {arquivo && <p className="text-[15px]"><Check aria-hidden="true" className="text-tint mr-1 inline size-4" />{contar(arquivo.linhas.length, 'conta lida', 'contas lidas')} de {arquivo.nome}{arquivo.ignoradas ? ` (${arquivo.ignoradas} linhas sem código ignoradas)` : ''}.</p>}
      </div>
    </Folha>
  );
}

function Comparar({ adm }: { adm: boolean }) {
  const perfil = usePerfil();
  const meses = useMemo(() => ultimasCompetencias(24), []);
  const [mes, setMes] = useState(meses[1] ?? meses[0]!);
  const verTudo = alcance(perfil, 'financeiro', 'ver') === 'tudo';
  const r = useRpc<ComparacaoContador>('comparar_balancete', { p_competencia: mes }, verTudo);
  const plano = useLista<ContaContabil>('plano_contas', { ordem: 'codigo' }, adm);
  const vincular = useAcaoF5('vincular_categoria_conta');
  if (!verTudo) return <Vazio icone={Landmark} titulo="Só para quem vê todo o financeiro" descricao="A comparação mostra o movimento de todas as contas." />;
  const diferencas = (r.data?.contas ?? []).filter((c) => c.diferenca !== '0.00');
  return (
    <>
      <Field>
        <FieldLabel htmlFor="cmp-mes">Mês</FieldLabel>
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger id="cmp-mes"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{meses.map((m) => <SelectItem key={m} value={m}>{mesPorExtenso(m).replace(/^./, (c) => c.toUpperCase())}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>
      {r.isError ? <BlocoErro erro={r.error} tentarDeNovo={() => void r.refetch()} /> : r.isPending ? <CarregandoLista /> : (
        <>
          {!r.data.balancete
            ? <Vazio icone={Scale} titulo="Sem balancete deste mês" descricao="Importe o balancete do contador na aba Importar arquivos para comparar." />
            : (
              <Grupo titulo={diferencas.length ? `${contar(diferencas.length, 'conta com diferença', 'contas com diferença')}` : 'Tudo bate com o contador'}
                rodape={`Balancete: ${r.data.balancete.arquivo}. "Sistema" é o que a diretoria lançou nas categorias ligadas a cada conta.`}>
                {r.data.contas.map((c) => (
                  <Linha key={c.codigo} icone={c.diferenca === '0.00' ? Check : AlertTriangle} cor={c.diferenca === '0.00' ? 'verde' : 'laranja'}
                    titulo={`${c.codigo} · ${c.nome}`}
                    descricao={`Sistema ${formatarBRL(c.sistema ?? '0')} · Contador ${formatarBRL(c.contador ?? '0')}`}
                    valor={c.diferenca === '0.00' ? undefined : <span className="numeros text-aviso text-[15px] font-semibold">{formatarBRL(c.diferenca)}</span>} />
                ))}
              </Grupo>
            )}
          {r.data.categorias_sem_conta.length > 0 && (
            <Grupo titulo="Categorias sem conta do contador" rodape="Ligue cada categoria a uma conta do plano para a comparação e a transparência saírem no formato contábil.">
              {r.data.categorias_sem_conta.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 truncate text-[15px]">{c.nome} <span className="text-muted-foreground">· {c.tipo === 'saida' ? 'saída' : 'entrada'}</span></span>
                  {adm ? (
                    <Select value="" onValueChange={(v) => vincular.mutate({ p_categoria: c.id, p_conta: v }, { onSuccess: () => toast.success('Categoria ligada'), onError: (e) => toast.error(erroMsg(e)) })}>
                      <SelectTrigger className="w-52 shrink-0" aria-label={`Conta do contador para ${c.nome}`}><SelectValue placeholder="Escolher conta" /></SelectTrigger>
                      <SelectContent><SelectGroup>{(plano.data ?? []).filter((p) => p.ativa && [c.tipo === 'entrada' ? 'receita' : 'despesa', 'outra'].includes(p.natureza))
                        .map((p) => <SelectItem key={p.id} value={p.id}>{p.codigo} · {p.nome}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  ) : <span className="text-muted-foreground text-[13px]">Peça a quem administra</span>}
                </div>
              ))}
            </Grupo>
          )}
        </>
      )}
    </>
  );
}
