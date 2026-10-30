// O servidor monta a fotografia; aqui só se mostra, e texto do banco é sempre texto (o React escapa).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, EyeOff, FileDown, Globe, Landmark, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { FormularioRpc } from '@/components/app/formulario';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePerfil } from '@/app/sessao';
import { useLista, useRpc } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import { alcance, pode } from '@/lib/acesso';
import { formatarData, mesPorExtenso } from '@/lib/datas';
import { formatarBRL } from '@/lib/dinheiro';
import { ultimasCompetencias } from '@/telas/pessoas/comum';

export interface DadosTransparencia {
  entradas: string; saidas: string;
  por_mes: { mes: string; entradas: string | null; saidas: string | null }[];
  receitas: { grupo: string; valor: string }[]; despesas: { grupo: string; valor: string }[];
  verbas_publicas: { titulo: string; origem: string; situacao: string; aprovado: string; recebido_no_periodo: string }[];
  projetos: { nome: string; fonte: string | null; aprovado: string; executado_no_periodo: string; vigencia_inicio: string | null; vigencia_fim: string | null }[];
  filiacoes: { entidade: string; situacao: string }[];
  entidade: { nome: string | null; cnpj: string | null } | null;
}
export interface Publicacao { id: string; titulo: string; periodo_inicio: string; periodo_fim: string; publicado_em: string; observacao: string | null; dados: DadosTransparencia }

const SITUACAO_VERBA: Record<string, string> = { aprovado: 'Aprovada', formalizado: 'Formalizada', recebido_parcial: 'Recebida em parte', recebido: 'Recebida',
  em_execucao: 'Em execução', prestacao_contas: 'Prestação de contas', encerrado: 'Encerrada' };
const SITUACAO_FILIACAO: Record<string, string> = { ativa: 'Ativa', pendente: 'Pendente', suspensa: 'Suspensa' };
const cnpj = (c: string | null | undefined) => (c && /^\d{14}$/.test(c) ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : null);
const mesTitulo = (m: string) => mesPorExtenso(`${m}-01`).replace(/^./, (c) => c.toUpperCase());

function Barra({ parte, cor }: { parte: number; cor: string }) {
  return <span aria-hidden="true" className="bg-muted block h-2 overflow-hidden rounded-[4px]"><span className="block h-full rounded-[4px]" style={{ width: `${Math.max(1, Math.min(100, parte * 100))}%`, background: cor }} /></span>;
}

function Grupos({ titulo, itens, total, cor }: { titulo: string; itens: { grupo: string; valor: string }[]; total: string; cor: string }) {
  const t = Number(total) || 1;
  return (
    <Grupo titulo={titulo}>
      {itens.length === 0 && <Linha titulo="Nada no período" />}
      {itens.map((x) => (
        <div key={x.grupo} className="flex flex-col gap-1.5 px-4 py-2.5">
          <div className="flex justify-between gap-3 text-[15px]"><span className="min-w-0 truncate">{x.grupo}</span><span className="numeros shrink-0">{formatarBRL(x.valor)}</span></div>
          <Barra parte={Number(x.valor) / t} cor={cor} />
        </div>
      ))}
    </Grupo>
  );
}

export function ConteudoTransparencia({ p }: { p: Pick<Publicacao, 'periodo_inicio' | 'periodo_fim' | 'observacao' | 'publicado_em'> & { dados: DadosTransparencia } }) {
  const d = p.dados;
  const resultado = (Number(d.entradas) - Number(d.saidas)).toFixed(2);
  return (
    <>
      <p className="text-muted-foreground px-1 text-[15px]">
        Período de {formatarData(p.periodo_inicio)} a {formatarData(p.periodo_fim)}
        {d.entidade?.nome ? ` · ${d.entidade.nome}` : ''}{cnpj(d.entidade?.cnpj) ? ` · CNPJ ${cnpj(d.entidade?.cnpj)}` : ''}
      </p>
      {p.observacao && <p className="bg-card rounded-[14px] px-4 py-3 text-[15px]">{p.observacao}</p>}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[['Entradas', d.entradas], ['Saídas', d.saidas], ['Resultado', resultado]].map(([t, v]) => (
          <div key={t} className="bg-card rounded-[18px] px-2 py-3"><p className="text-muted-foreground text-[13px]">{t}</p><p className="font-rounded numeros text-[17px] font-bold">{formatarBRL(v)}</p></div>
        ))}
      </div>
      {d.por_mes.length > 1 && (
        <Grupo titulo="Mês a mês">
          {d.por_mes.map((m) => <Linha key={m.mes} titulo={mesTitulo(m.mes)} descricao={`Entradas ${formatarBRL(m.entradas ?? '0')} · Saídas ${formatarBRL(m.saidas ?? '0')}`} />)}
        </Grupo>
      )}
      <Grupos titulo="De onde veio o dinheiro" itens={d.receitas} total={d.entradas} cor="var(--serie-entrada)" />
      <Grupos titulo="Para onde foi o dinheiro" itens={d.despesas} total={d.saidas} cor="var(--serie-saida)" />
      {d.verbas_publicas.length > 0 && (
        <Grupo titulo="Recursos públicos" rodape="Verbas de órgãos públicos e emendas parlamentares.">
          {d.verbas_publicas.map((v) => <Linha key={v.titulo} titulo={v.titulo} descricao={`${v.origem} · ${SITUACAO_VERBA[v.situacao] ?? v.situacao} · aprovado ${formatarBRL(v.aprovado)}`}
            valor={<span className="numeros text-[15px]">{formatarBRL(v.recebido_no_periodo)}</span>} />)}
        </Grupo>
      )}
      {d.projetos.length > 0 && (
        <Grupo titulo="Projetos" rodape="Gasto no período sobre o valor aprovado do projeto.">
          {d.projetos.map((x) => <Linha key={x.nome} titulo={x.nome} descricao={`${x.fonte ? `${x.fonte} · ` : ''}aprovado ${formatarBRL(x.aprovado)}${x.vigencia_fim ? ` · até ${formatarData(x.vigencia_fim)}` : ''}`}
            valor={<span className="numeros text-[15px]">{formatarBRL(x.executado_no_periodo)}</span>} />)}
        </Grupo>
      )}
      {d.filiacoes.length > 0 && (
        <Grupo titulo="Filiações">
          {d.filiacoes.map((f) => <Linha key={f.entidade} titulo={f.entidade} valor={<span className="text-muted-foreground text-[15px]">{SITUACAO_FILIACAO[f.situacao] ?? f.situacao}</span>} />)}
        </Grupo>
      )}
      <p className="text-muted-foreground px-1 text-[13px]">Publicado em {formatarData(p.publicado_em.slice(0, 10))}. Números agregados, sem dados pessoais. A escrituração oficial é do contador da entidade.</p>
    </>
  );
}

async function baixarPdf(p: Publicacao) {
  const [{ jsPDF }, { autoTable }, { baixar }] = await Promise.all([import('jspdf'), import('jspdf-autotable'), import('@/lib/exportar')]);
  const d = p.dados; const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(`Transparência — ${p.titulo}`, 40, 54);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${d.entidade?.nome ?? 'Associação Exemplo'}${cnpj(d.entidade?.cnpj) ? ` · CNPJ ${cnpj(d.entidade?.cnpj)}` : ''} · período de ${formatarData(p.periodo_inicio)} a ${formatarData(p.periodo_fim)}`, 40, 72);
  const corpo = (t: string, head: string[], body: string[][]) => {
    const y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80) + 22;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(t, 40, y);
    autoTable(doc, { startY: y + 6, head: [head], body, styles: { fontSize: 10 }, headStyles: { fillColor: [0, 91, 184] } });
  };
  corpo('Resumo', ['Entradas', 'Saídas', 'Resultado'], [[formatarBRL(d.entradas), formatarBRL(d.saidas), formatarBRL((Number(d.entradas) - Number(d.saidas)).toFixed(2))]]);
  corpo('De onde veio o dinheiro', ['Grupo', 'Valor'], d.receitas.map((x) => [x.grupo, formatarBRL(x.valor)]));
  corpo('Para onde foi o dinheiro', ['Grupo', 'Valor'], d.despesas.map((x) => [x.grupo, formatarBRL(x.valor)]));
  if (d.verbas_publicas.length) corpo('Recursos públicos', ['Verba', 'Origem', 'Aprovado', 'Recebido no período'], d.verbas_publicas.map((v) => [v.titulo, v.origem, formatarBRL(v.aprovado), formatarBRL(v.recebido_no_periodo)]));
  if (d.projetos.length) corpo('Projetos', ['Projeto', 'Aprovado', 'Gasto no período'], d.projetos.map((x) => [x.nome, formatarBRL(x.aprovado), formatarBRL(x.executado_no_periodo)]));
  baixar(doc.output('blob'), `transparencia-${p.periodo_inicio}-${p.periodo_fim}.pdf`, 'application/pdf');
}

export function TransparenciaPublica() {
  const r = useQuery({ queryKey: ['transparencia-publica'], queryFn: () => fonte().rpc<{ publicacoes: Publicacao[] }>('transparencia_publica'), staleTime: 60_000 });
  const [escolhida, setEscolhida] = useState('');
  const lista = r.data?.publicacoes ?? [];
  const p = lista.find((x) => x.id === escolhida) ?? lista[0];
  return (
    <Pagina titulo="Transparência" voltar={{ para: '/', rotulo: 'Início' }}
      acoes={p ? <Button variant="ghost" size="sm" onClick={() => void baixarPdf(p).catch(() => toast.error('Não foi possível gerar o PDF.'))}><FileDown data-icon="inline-start" aria-hidden="true" />PDF</Button> : undefined}>
      <p className="text-muted-foreground -mt-2 px-1 text-[15px] text-pretty">Prestação de contas da Associação Exemplo: de onde vem e para onde vai o dinheiro, publicada pela diretoria.</p>
      {r.isError ? <BlocoErro erro={r.error} tentarDeNovo={() => void r.refetch()} />
        : r.isPending ? <CarregandoLista />
          : !p ? <Vazio icone={Globe} titulo="Nada publicado ainda" descricao="Quando a diretoria publicar a prestação de contas, ela aparece aqui." />
            : (
              <>
                {lista.length > 1 && (
                  <Field><FieldLabel htmlFor="tp-periodo">Período</FieldLabel>
                    <Select value={p.id} onValueChange={setEscolhida}>
                      <SelectTrigger id="tp-periodo"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>{lista.map((x) => <SelectItem key={x.id} value={x.id}>{x.titulo}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select></Field>
                )}
                <h2 className="px-1 text-[22px] font-bold">{p.titulo}</h2>
                <ConteudoTransparencia p={p} />
              </>
            )}
    </Pagina>
  );
}

export function GestaoTransparencia() {
  const perfil = usePerfil();
  const qc = useQueryClient();
  const meses = useMemo(() => ultimasCompetencias(24), []);
  const [ini, setIni] = useState(meses[3] ?? meses.at(-1)!);
  const [fimMes, setFimMes] = useState(meses[1] ?? meses[0]!);
  const [publicar, setPublicar] = useState(false);
  const [retirar, setRetirar] = useState<Publicacao | null>(null);
  const fim = useMemo(() => { const [a, m] = fimMes.split('-').map(Number) as [number, number]; return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); }, [fimMes]);
  const tudo = alcance(perfil, 'financeiro', 'ver') === 'tudo';
  const aprovar = pode(perfil, 'financeiro', 'aprovar');
  const valido = ini <= fim;
  const previa = useRpc<{ dados: DadosTransparencia }>('previa_transparencia', { p_inicio: ini, p_fim: fim }, tudo && valido);
  const publicadas = useLista<Publicacao & { retirado_em: string | null; motivo_retirada: string | null }>('transparencia_publicacoes', { ordem: 'periodo_fim', desc: true, limite: 50 }, tudo);
  const tituloPadrao = ini.slice(0, 7) === fimMes ? mesTitulo(fimMes) : `${mesTitulo(ini.slice(0, 7))} a ${mesPorExtenso(`${fimMes}-01`)}`;
  if (!tudo) return <Pagina titulo="Transparência" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}><Vazio icone={Landmark} titulo="Só para quem vê todo o financeiro" descricao="A prévia mostra o movimento de todas as contas." /></Pagina>;
  const opcoesMes = <SelectContent><SelectGroup>{meses.map((m) => <SelectItem key={m} value={m.slice(0, 7)}>{mesTitulo(m.slice(0, 7))}</SelectItem>)}</SelectGroup></SelectContent>;
  return (
    <Pagina titulo="Transparência" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}
      acoes={<Button asChild variant="ghost" size="sm"><Link to="/transparencia"><ExternalLink data-icon="inline-start" aria-hidden="true" />Ver página pública</Link></Button>}>
      <p className="text-muted-foreground -mt-2 px-1 text-[15px] text-pretty">Escolha o período, confira a prévia e publique. Vai ao ar só o que está na prévia: totais, recursos públicos, projetos e filiações. Nenhum dado pessoal.</p>
      <Grupo titulo="Publicadas" rodape="Retirar tira do ar, mas guarda a fotografia para a auditoria.">
        {(publicadas.data ?? []).length === 0 && <Linha titulo="Nenhuma publicação ainda" />}
        {(publicadas.data ?? []).map((x) => (
          <Linha key={x.id} icone={x.retirado_em ? EyeOff : Globe} cor={x.retirado_em ? 'cinza' : 'verde'} titulo={x.titulo}
            descricao={x.retirado_em ? `Retirada: ${x.motivo_retirada}` : `No ar desde ${formatarData(x.publicado_em.slice(0, 10))}`}
            valor={!x.retirado_em && aprovar ? <Button size="sm" variant="ghost" onClick={() => setRetirar(x)}>Retirar</Button> : undefined} />
        ))}
      </Grupo>
      <div className="grid grid-cols-2 gap-3">
        <Field><FieldLabel htmlFor="tr-ini">De</FieldLabel><Select value={ini.slice(0, 7)} onValueChange={(m) => setIni(`${m}-01`)}><SelectTrigger id="tr-ini"><SelectValue /></SelectTrigger>{opcoesMes}</Select></Field>
        <Field><FieldLabel htmlFor="tr-fim">Até</FieldLabel><Select value={fimMes} onValueChange={setFimMes}><SelectTrigger id="tr-fim"><SelectValue /></SelectTrigger>{opcoesMes}</Select></Field>
      </div>
      {!valido ? <p role="alert" className="text-destructive text-[15px]">O início precisa ser antes do fim.</p>
        : previa.isError ? <BlocoErro erro={previa.error} tentarDeNovo={() => void previa.refetch()} />
          : previa.isPending ? <CarregandoLista />
            : (
              <>
                {aprovar
                  ? <Button size="lg" onClick={() => setPublicar(true)}><Send data-icon="inline-start" aria-hidden="true" />Publicar este período</Button>
                  : <p className="text-muted-foreground px-1 text-[13px]">Publicar é para quem aprova no financeiro (tesouraria ou presidência).</p>}
                <h2 className="px-1 pt-2 text-[17px] font-semibold">Prévia — como vai aparecer</h2>
                <ConteudoTransparencia p={{ periodo_inicio: ini, periodo_fim: fim, observacao: null, publicado_em: new Date().toISOString(), dados: previa.data.dados }} />
              </>
            )}
      {publicar && (
        <FormularioRpc titulo="Publicar transparência" descricao="A fotografia fica congelada: lançamentos feitos depois não mudam o que está no ar." rpc="publicar_transparencia" botao="Publicar" sucesso="Publicado"
          campos={[{ nome: 'titulo', rotulo: 'Título', tipo: 'texto', obrigatorio: true, max: 120 }, { nome: 'observacao', rotulo: 'Observação para o público', tipo: 'textarea', max: 500 }]}
          inicial={{ titulo: tituloPadrao }} montar={(dd, idNovo) => ({ p_id: idNovo, p_titulo: dd.titulo, p_inicio: ini, p_fim: fim, p_observacao: dd.observacao })}
          aoSalvar={() => void qc.invalidateQueries({ queryKey: ['transparencia-publica'] })} aoFechar={() => setPublicar(false)} />
      )}
      {retirar && (
        <FormularioRpc titulo="Retirar do ar" descricao={retirar.titulo} rpc="retirar_transparencia" botao="Retirar" sucesso="Retirada do ar"
          campos={[{ nome: 'motivo', rotulo: 'Por quê', tipo: 'textarea', obrigatorio: true, max: 300, ajuda: 'Ex.: valor corrigido; uma nova publicação substitui esta.' }]}
          montar={(dd) => ({ p_id: retirar.id, p_motivo: dd.motivo })} aoFechar={() => setRetirar(null)} />
      )}
    </Pagina>
  );
}
