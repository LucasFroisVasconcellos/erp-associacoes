import { AlertTriangle, Check, FileDown, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePerfil } from '@/app/sessao';
import { useRpc } from '@/dados/consultas';
import { alcance } from '@/lib/acesso';
import {
  benford, concentracao, custos, duplicidades, foraDoPadrao, funis, inadimplencia, porMes, prever, qualidade, reais,
  type Cenario, type DadosAnalise,
} from '@/lib/analises';
import { formatarData, mesPorExtenso } from '@/lib/datas';
import { formatarBRL, lerValorBRL, mascararValor } from '@/lib/dinheiro';

type Aba = 'previsao' | 'receitas' | 'qualidade' | 'custos';
const brl = (c: number) => formatarBRL(reais(c));
const mesCurto = (m: string) => `${mesPorExtenso(`${m}-01`).slice(0, 3)}/${m.slice(2, 4)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Analises() {
  const perfil = usePerfil();
  const [params, setParams] = useSearchParams();
  const aba = (['previsao', 'receitas', 'qualidade', 'custos'].includes(params.get('aba') ?? '') ? params.get('aba') : 'previsao') as Aba;
  const tudo = alcance(perfil, 'financeiro', 'ver') === 'tudo';
  const r = useRpc<DadosAnalise>('dados_analise', {}, tudo);
  return (
    <Pagina titulo="Previsão e análises" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}
      acoes={r.data ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><FileDown data-icon="inline-start" aria-hidden="true" />Relatório</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuGroup>
            {([['mes', 'Do mês (diretoria)'], ['trimestre', 'Do trimestre (conselho fiscal)'], ['ano', 'Do ano (assembleia)']] as const).map(([v, n]) => (
              <DropdownMenuItem key={v} onSelect={() => void import('@/lib/relatorio-mensal').then((m) => m.baixarRelatorioMensal(r.data!, v)).catch(() => toast.error('Não foi possível gerar o PDF.'))}>{n}</DropdownMenuItem>
            ))}
          </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>) : undefined}
      sob={<Segmentado rotulo="Análise" valor={aba} aoMudar={(v) => setParams(v === 'previsao' ? {} : { aba: v }, { replace: true })}
        opcoes={[{ valor: 'previsao', rotulo: 'Caixa' }, { valor: 'receitas', rotulo: 'Receitas' }, { valor: 'qualidade', rotulo: 'Conferência' }, { valor: 'custos', rotulo: 'Custos' }]} />}>
      {!tudo ? <Vazio icone={AlertTriangle} titulo="Só para quem vê todo o financeiro" descricao="As análises usam o movimento de todas as contas." />
        : r.isError ? <BlocoErro erro={r.error} tentarDeNovo={() => void r.refetch()} />
          : r.isPending ? <CarregandoLista />
            : aba === 'previsao' ? <Previsao d={r.data} /> : aba === 'receitas' ? <Receitas d={r.data} /> : aba === 'qualidade' ? <Conferencia d={r.data} /> : <Custos d={r.data} />}
    </Pagina>
  );
}

function Numero({ titulo, valor, detalhe, alerta }: { titulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className="bg-card rounded-[18px] p-3.5">
      <p className="text-muted-foreground text-[13px]">{titulo}</p>
      <p className={`font-rounded numeros text-[22px] font-bold ${alerta ? 'text-destructive' : ''}`}>{valor}</p>
      {detalhe && <p className="text-muted-foreground text-[13px]">{detalhe}</p>}
    </div>
  );
}

// recharts direto: o ChartContainer do shadcn injeta <style> por HTML, e o Trusted Types bloqueia.
// Cores validadas para daltonismo em claro e escuro (--serie-entrada × --serie-saida).
const EIXO = { tickLine: false, axisLine: false, fontSize: 12, stroke: 'var(--muted-foreground)' } as const;
function Dica({ active, payload, label, formatar }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; formatar: (n: string, v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-[10px] border px-2.5 py-1.5 text-[13px] shadow-md">
      {label && <p className="font-medium">{label}</p>}
      {payload.map((x) => <p key={x.name} className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full" style={{ background: x.color }} />{formatar(x.name ?? '', Number(x.value))}</p>)}
    </div>
  );
}
const reaisDe = (v: number) => formatarBRL(v.toFixed(2));
const mil = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} mil` : String(Math.round(v)));


function Previsao({ d }: { d: DadosAnalise }) {
  const [horizonte, setHorizonte] = useState('6');
  const [cenarios, setCenarios] = useState<Cenario[]>([]);
  const [novo, setNovo] = useState(false);
  const p = useMemo(() => prever(d, Number(horizonte), cenarios), [d, horizonte, cenarios]);
  const base = useMemo(() => prever(d, Number(horizonte)), [d, horizonte]);
  const dados = p.meses.map((m) => ({ mes: mesCurto(m.mes), saldo: m.saldo / 100, entradas: (m.entradasCertas + m.entradasProvaveis) / 100, saidas: m.saidas / 100 }));
  const fim = p.meses.at(-1)!;
  return (
    <>
      <Segmentado rotulo="Horizonte" valor={horizonte} aoMudar={setHorizonte} opcoes={[{ valor: '3', rotulo: '3 meses' }, { valor: '6', rotulo: '6 meses' }, { valor: '12', rotulo: '12 meses' }]} />
      <div className="grid grid-cols-2 gap-3">
        <Numero titulo="Saldo hoje" valor={formatarBRL(d.saldo)} />
        <Numero titulo={`Saldo em ${mesCurto(fim.mes)}`} valor={brl(fim.saldo)} alerta={fim.saldo < 0}
          detalhe={cenarios.length ? `sem os cenários: ${brl(base.meses.at(-1)!.saldo)}` : undefined} />
        <Numero titulo="Menor saldo" valor={brl(p.menorSaldo)} detalhe={mesCurto(p.mesMenor)} alerta={p.menorSaldo < 0} />
        <Numero titulo="Fôlego" valor={p.folego === null ? 'Positivo' : p.folego === 0 ? 'Negativo já' : `${p.folego} ${p.folego === 1 ? 'mês' : 'meses'}`}
          detalhe={p.folego === null ? `em todo o período` : 'até o caixa ficar negativo'} alerta={p.folego !== null} />
      </div>
      <figure className="bg-card rounded-[18px] p-3" aria-label="Saldo previsto mês a mês">
        <figcaption className="text-muted-foreground px-1 pb-1 text-[13px]">Saldo previsto mês a mês</figcaption>
        <div className="aspect-[16/9] w-full">
          <ResponsiveContainer>
            <AreaChart data={dados} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="mes" {...EIXO} />
              <YAxis {...EIXO} width={52} tickFormatter={mil} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              <Tooltip content={<Dica formatar={(_, v) => `Saldo: ${reaisDe(v)}`} />} cursor={{ stroke: 'var(--muted-foreground)' }} />
              <Area dataKey="saldo" name="saldo" type="monotone" stroke="var(--serie-entrada)" strokeWidth={2} fill="var(--serie-entrada)" fillOpacity={0.12} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="bg-card rounded-[18px] p-3" aria-label="Entradas e saídas previstas por mês">
        <figcaption className="text-muted-foreground px-1 pb-1 text-[13px]">Entradas (certas + prováveis) e saídas por mês</figcaption>
        <p className="flex gap-4 px-1 pb-1 text-[13px]">
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px] bg-[var(--serie-entrada)]" />Entradas</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px] bg-[var(--serie-saida)]" />Saídas</span>
        </p>
        <div className="aspect-[16/9] w-full">
          <ResponsiveContainer>
            <BarChart data={dados} margin={{ left: 4, right: 8, top: 8 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="mes" {...EIXO} />
              <YAxis {...EIXO} width={52} tickFormatter={mil} />
              <Tooltip content={<Dica formatar={(n, v) => `${n}: ${reaisDe(v)}`} />} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
              <Bar dataKey="entradas" name="Entradas" fill="var(--serie-entrada)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="saidas" name="Saídas" fill="var(--serie-saida)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <Grupo titulo="Mês a mês" rodape={`"Prováveis" são parcelas de verbas pesadas pela chance de chegar (ex.: em análise 40%, aprovada 80%) e mensalidades pela taxa de pagamento dos últimos 12 meses.${p.atrasadasReceber || p.atrasadasPagar ? ` Contas vencidas entram no mês atual: ${brl(p.atrasadasReceber)} a receber e ${brl(p.atrasadasPagar)} a pagar.` : ''}`}>
        {p.meses.map((m) => (
          <Linha key={m.mes} titulo={mesPorExtenso(`${m.mes}-01`).replace(/^./, (c) => c.toUpperCase())}
            descricao={`+${brl(m.entradasCertas)} certas · +${brl(m.entradasProvaveis)} prováveis · −${brl(m.saidas)}`}
            valor={<span className={`numeros text-[15px] font-semibold ${m.saldo < 0 ? 'text-destructive' : ''}`}>{brl(m.saldo)}</span>} />
        ))}
      </Grupo>
      <Grupo titulo='Cenários "e se…"' rodape="Os cenários só existem nesta tela: nada é gravado. Use para planejar antes de decidir.">
        {cenarios.map((c) => (
          <Linha key={c.id} titulo={c.rotulo} valor={<Button size="icon-sm" variant="ghost" aria-label={`Tirar o cenário: ${c.rotulo}`} onClick={() => setCenarios((x) => x.filter((y) => y.id !== c.id))}><Trash2 aria-hidden="true" /></Button>} />
        ))}
        <Linha icone={Plus} cor="azul" titulo="Adicionar cenário" descricao="Patrocínio que atrasa, viagem a mais, receita nova, corte de gasto fixo" aoTocar={() => setNovo(true)} />
      </Grupo>
      {novo && <NovoCenario d={d} meses={p.meses.map((m) => m.mes)} aoCriar={(c) => setCenarios((x) => [...x, c])} aoFechar={() => setNovo(false)} />}
    </>
  );
}

function NovoCenario({ d, meses, aoCriar, aoFechar }: { d: DadosAnalise; meses: string[]; aoCriar: (c: Cenario) => void; aoFechar: () => void }) {
  const [tipo, setTipo] = useState<Cenario['tipo']>('gasto_extra');
  const [mes, setMes] = useState(meses[1] ?? meses[0]!);
  const [valor, setValor] = useState('');
  const [verba, setVerba] = useState('');
  const [atraso, setAtraso] = useState('3');
  const [rec, setRec] = useState('');
  const verbas = [...new Set(d.parcelas.map((p) => p.verba))];
  const recorrentes = [...new Set(d.recorrencias.map((r) => r.descricao))];
  const v = lerValorBRL(valor);
  const ok = tipo === 'atrasar_verba' ? !!verba : tipo === 'cortar_recorrente' ? !!rec : !!v;
  function criar() {
    const rotulo = tipo === 'atrasar_verba' ? `${verba} atrasa ${atraso} meses` : tipo === 'cortar_recorrente' ? `Cortar "${rec}" a partir de ${mesCurto(mes)}`
      : `${tipo === 'gasto_extra' ? 'Gasto extra' : 'Receita extra'} de ${formatarBRL(v)} em ${mesCurto(mes)}`;
    aoCriar({ id: crypto.randomUUID(), tipo, rotulo, mes, valor: v ?? undefined, verba, meses: Number(atraso), descricao: rec });
    aoFechar();
  }
  const opcoes = (l: string[]) => <SelectContent><SelectGroup>{l.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectGroup></SelectContent>;
  return (
    <Folha aberta aoMudar={(x) => !x && aoFechar()} titulo="Novo cenário" rodape={<Button size="lg" className="w-full" disabled={!ok} onClick={criar}>Simular</Button>}>
      <div className="flex flex-col gap-4 pb-2">
        <Field><FieldLabel htmlFor="cn-tipo">E se…</FieldLabel>
          <Select value={tipo} onValueChange={(x) => setTipo(x as Cenario['tipo'])}>
            <SelectTrigger id="cn-tipo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="gasto_extra">Tivermos um gasto extra (ex.: viagem a mais)</SelectItem>
              <SelectItem value="receita_extra">Entrar uma receita nova</SelectItem>
              {verbas.length > 0 && <SelectItem value="atrasar_verba">Uma verba ou patrocínio atrasar</SelectItem>}
              {recorrentes.length > 0 && <SelectItem value="cortar_recorrente">Cortarmos um gasto fixo</SelectItem>}
            </SelectGroup></SelectContent>
          </Select></Field>
        {tipo === 'atrasar_verba' ? (
          <>
            <Field><FieldLabel htmlFor="cn-verba">Verba</FieldLabel><Select value={verba} onValueChange={setVerba}><SelectTrigger id="cn-verba"><SelectValue placeholder="Escolha" /></SelectTrigger>{opcoes(verbas)}</Select></Field>
            <Field><FieldLabel htmlFor="cn-atraso">Atraso</FieldLabel><Select value={atraso} onValueChange={setAtraso}><SelectTrigger id="cn-atraso"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{['1', '2', '3', '6'].map((x) => <SelectItem key={x} value={x}>{x} {x === '1' ? 'mês' : 'meses'}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          </>
        ) : (
          <>
            {tipo === 'cortar_recorrente'
              ? <Field><FieldLabel htmlFor="cn-rec">Gasto fixo</FieldLabel><Select value={rec} onValueChange={setRec}><SelectTrigger id="cn-rec"><SelectValue placeholder="Escolha" /></SelectTrigger>{opcoes(recorrentes)}</Select></Field>
              : <Field><FieldLabel htmlFor="cn-valor">Valor (R$)</FieldLabel><Input id="cn-valor" inputMode="numeric" autoComplete="off" placeholder="0,00" value={valor} onChange={(e) => setValor(mascararValor(e.target.value))} /></Field>}
            <Field><FieldLabel htmlFor="cn-mes">{tipo === 'cortar_recorrente' ? 'A partir de' : 'Mês'}</FieldLabel>
              <Select value={mes} onValueChange={setMes}><SelectTrigger id="cn-mes"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{meses.map((m) => <SelectItem key={m} value={m}>{mesPorExtenso(`${m}-01`)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          </>
        )}
      </div>
    </Folha>
  );
}


function Receitas({ d }: { d: DadosAnalise }) {
  const c = useMemo(() => concentracao(d.realizados), [d]);
  const f = useMemo(() => funis(d), [d]);
  const top = c.fontes.slice(0, 6).map((x) => ({ fonte: x.fonte, parte: Math.round(x.parte * 1000) / 10 }));
  if (!c.total) return <Vazio icone={AlertTriangle} titulo="Ainda sem receitas nos últimos 12 meses" descricao="Quando houver entradas lançadas, a concentração aparece aqui." />;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Numero titulo="Receitas em 12 meses" valor={brl(c.total)} />
        <Numero titulo="Dependência" valor={c.nivel === 'alto' ? 'Alta' : c.nivel === 'moderado' ? 'Moderada' : 'Baixa'} alerta={c.nivel === 'alto'}
          detalhe={`índice ${c.hhi.toFixed(2)} (0 a 1)`} />
      </div>
      {c.nivel !== 'baixo' && c.fontes[0] && (
        <p role="note" className="bg-aviso/10 text-foreground flex gap-2 rounded-[14px] px-3.5 py-3 text-[15px]">
          <AlertTriangle aria-hidden="true" className="text-aviso mt-0.5 size-4 shrink-0" />
          {c.fontes[0].fonte} responde por {pct(c.fontes[0].parte)} das receitas. Perder essa fonte comprometeria o ano: vale buscar novas.
        </p>
      )}
      <figure className="bg-card rounded-[18px] p-3" aria-label="Maiores fontes de receita">
        <figcaption className="text-muted-foreground px-1 pb-1 text-[13px]">Maiores fontes (% das receitas)</figcaption>
        <ul className="flex flex-col gap-2.5 px-1 py-1">
          {top.map((x) => (
            <li key={x.fonte} className="grid grid-cols-[minmax(0,8rem)_1fr_3rem] items-center gap-2 text-[13px]">
              <span className="truncate">{x.fonte}</span>
              <span className="bg-muted h-3 overflow-hidden rounded-[4px]" aria-hidden="true"><span className="block h-full rounded-[4px] bg-[var(--serie-entrada)]" style={{ width: `${Math.max(1, x.parte)}%` }} /></span>
              <span className="numeros text-right">{x.parte.toLocaleString('pt-BR')}%</span>
            </li>
          ))}
        </ul>
      </figure>
      <Grupo titulo="Funil de captação" rodape="Oportunidades por etapa (Captação).">
        {f.captacao.map((e) => <Linha key={e.etapa} titulo={{ prospeccao: 'Prospecção', contato: 'Contato', proposta: 'Proposta', fechado: 'Fechado' }[e.etapa]}
          valor={<span className="numeros text-[15px]">{e.n} · {brl(e.valor)}</span>} />)}
      </Grupo>
      <Grupo titulo="Funil de verbas" rodape="Valor pedido, aprovado e recebido das verbas (sem ideias e canceladas).">
        <Linha titulo="Pedido" valor={<span className="numeros text-[15px]">{brl(f.verbas.pedido)}</span>} />
        <Linha titulo="Aprovado" valor={<span className="numeros text-[15px]">{brl(f.verbas.aprovado)}</span>} />
        <Linha titulo="Recebido" valor={<span className="numeros text-[15px]">{brl(f.verbas.recebido)}</span>} />
        {f.verbas.taxaAprovacao !== null && <Linha titulo="Taxa de aprovação" valor={<span className="numeros text-[15px]">{pct(f.verbas.taxaAprovacao)}</span>} />}
      </Grupo>
    </>
  );
}

function Conferencia({ d }: { d: DadosAnalise }) {
  const q = useMemo(() => qualidade(d.realizados), [d]);
  const fora = useMemo(() => foraDoPadrao(d.realizados).slice(0, 20), [d]);
  const dup = useMemo(() => duplicidades(d.realizados).slice(0, 20), [d]);
  const b = useMemo(() => benford(d.realizados), [d]);
  return (
    <>
      <p className="text-muted-foreground px-1 text-[15px]">Os alertas abaixo são sinais para conferir, nunca acusações. A decisão é sempre de uma pessoa.</p>
      <div className="grid grid-cols-2 gap-3">
        <Numero titulo="Saídas com comprovante" valor={pct(q.comComprovante)} detalhe={q.semComprovante ? `${q.semComprovante} sem comprovante` : 'todas em dia'} alerta={q.comComprovante < 0.9} />
        <Numero titulo="Tempo até lançar" valor={`${Math.round(q.atrasoMediano)} ${Math.round(q.atrasoMediano) === 1 ? 'dia' : 'dias'}`} detalhe="mediana entre o gasto e o lançamento" />
      </div>
      <Grupo titulo="Gastos fora do padrão" rodape="Muito acima do normal da própria categoria (mediana e desvio robusto). Só com 6 ou mais gastos na categoria.">
        {fora.length === 0 && <Linha icone={Check} cor="verde" titulo="Nada fora do padrão" />}
        {fora.map((x) => <Linha key={x.id} icone={AlertTriangle} cor="laranja" titulo={x.descricao} descricao={`${formatarData(x.data)} · ${x.categoria} · normal ≈ ${brl(x.tipico)}`}
          para={`/dinheiro/lancamento/${x.id}`} valor={<span className="numeros text-[15px]">{formatarBRL(x.valor)}</span>} />)}
      </Grupo>
      <Grupo titulo="Possíveis lançamentos repetidos" rodape="Mesmo valor, mesma contraparte ou descrição, em até 3 dias. Pode ser normal (duas compras iguais); confira.">
        {dup.length === 0 && <Linha icone={Check} cor="verde" titulo="Nenhuma repetição suspeita" />}
        {dup.map(([a, x]) => <Linha key={`${a.id}${x.id}`} icone={AlertTriangle} cor="laranja" titulo={a.descricao} descricao={`${formatarData(a.data)} e ${formatarData(x.data)}`}
          para={`/dinheiro/lancamento/${x.id}`} valor={<span className="numeros text-[15px]">{formatarBRL(a.valor)}</span>} />)}
      </Grupo>
      <Grupo titulo="Lei de Benford" rodape="Ferramenta de apoio ao conselho fiscal: compara o primeiro dígito dos valores com o padrão esperado.">
        {b ? <Linha icone={b.conforme ? Check : AlertTriangle} cor={b.conforme ? 'verde' : 'laranja'} titulo={b.conforme ? 'Dentro do esperado' : 'Fora do esperado — vale uma conferência'}
          descricao={`${b.n} valores · desvio ${(b.mad * 100).toFixed(1)} pontos`} />
          : <Linha titulo="Precisa de 300 lançamentos ou mais" descricao="Com poucos dados o teste não diz nada." />}
      </Grupo>
    </>
  );
}

function Custos({ d }: { d: DadosAnalise }) {
  const c = useMemo(() => custos(d), [d]);
  const inad = useMemo(() => inadimplencia(d), [d]);
  const serie = useMemo(() => porMes(d.realizados, d.inicio, d.hoje), [d]);
  const ou = (x: number | null) => (x === null ? '—' : brl(x));
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Numero titulo="Custo por atleta" valor={ou(c.porAtletaMes)} detalhe={`por mês · ${d.atletas_ativos} atletas ativos`} />
        <Numero titulo="Custo por treino" valor={ou(c.porTreino)} detalhe={c.presencaMedia === null ? 'sem treinos com presença' : `média de ${c.presencaMedia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} atletas`} />
        <Numero titulo="Viagem por atleta" valor={ou(c.porAtletaViagem)} detalhe="viagens encerradas em 12 meses" />
        <Numero titulo="Viagem por km" valor={ou(c.porKm)} />
      </div>
      <Grupo titulo="Mês a mês (realizado)">
        {serie.slice(-6).reverse().map((m) => <Linha key={m.mes} titulo={mesPorExtenso(`${m.mes}-01`).replace(/^./, (x) => x.toUpperCase())}
          descricao={`+${brl(m.entradas)} · −${brl(m.saidas)}`} valor={<span className="numeros text-[15px] font-semibold">{brl(m.entradas - m.saidas)}</span>} />)}
      </Grupo>
      <Grupo titulo="Mensalidades em atraso" rodape="Só números. Para lembrar alguém, use Pessoas › Mensalidades — sempre um lembrete gentil, nunca exposição.">
        <Linha titulo="Taxa de atraso" valor={<span className="numeros text-[15px]">{pct(inad.taxa)} · {inad.quantidade}</span>} />
        {inad.faixas.map((f) => <Linha key={f.rotulo} titulo={f.rotulo} valor={<span className="numeros text-[15px]">{brl(f.valor)}</span>} />)}
      </Grupo>
      {d.tarefas && (
        <Grupo titulo="Tarefas por diretor" rodape="Concluídas nos últimos 90 dias. Serve para dividir melhor o trabalho, não para cobrar.">
          {d.tarefas.map((t) => {
            const feitas = t.feitas_no_prazo + t.feitas_atrasadas;
            return <Linha key={t.nome} titulo={t.nome} descricao={`${t.abertas} abertas${t.atrasadas ? ` · ${t.atrasadas} atrasadas` : ''}${feitas ? ` · ${pct(t.feitas_no_prazo / feitas)} no prazo` : ''}`} />;
          })}
        </Grupo>
      )}
    </>
  );
}
