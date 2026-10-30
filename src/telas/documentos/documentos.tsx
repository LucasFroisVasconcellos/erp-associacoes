import { abrirSeletor } from '@/lib/seletor';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, FolderOpen, Landmark, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePerfil } from '@/app/sessao';
import { chaves, useArquivosContador } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { ArquivoContador } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP, mesAnterior, mesPorExtenso } from '@/lib/datas';
import { ErroApp, mensagemErro } from '@/lib/erros';

const TIPOS = [
  { valor: 'balancete', rotulo: 'Balancete' }, { valor: 'demonstracao', rotulo: 'Demonstração contábil' }, { valor: 'relatorio', rotulo: 'Relatório' },
  { valor: 'obrigacoes', rotulo: 'Prazos e obrigações' }, { valor: 'folha', rotulo: 'Folha / encargos' }, { valor: 'outro', rotulo: 'Outro' },
];

export function Documentos() {
  const perfil = usePerfil();
  // quem só cuida da governança (sem os arquivos do contador) vai direto para ela
  if (!pode(perfil, 'contador', 'ver')) return <Navigate to="/documentos/governanca" replace />;
  return <ArquivosContador />;
}

function ArquivosContador() {
  const perfil = usePerfil();
  const arquivos = useArquivosContador();
  const [enviar, setEnviar] = useState(false);
  const [csv, setCsv] = useState<{ nome: string; linhas: string[][] } | null>(null);
  const porMes = useMemo(() => {
    const m = new Map<string, ArquivoContador[]>();
    for (const a of arquivos.data ?? []) m.set(a.competencia, [...(m.get(a.competencia) ?? []), a]);
    return [...m.entries()];
  }, [arquivos.data]);
  async function abrir(a: ArquivoContador) {
    const csvArq = a.mime === 'text/csv' || a.nome_original.toLowerCase().endsWith('.csv');
    const janela = csvArq ? null : window.open('about:blank', '_blank');
    try {
      const url = await fonte().urlArquivo('contador', a.caminho);
      if (csvArq) {
        const texto = await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).text();
        const Papa = (await import('papaparse')).default;
        const r = Papa.parse<string[]>(texto.slice(0, 2_000_000), { skipEmptyLines: true });
        setCsv({ nome: a.nome_original, linhas: r.data.slice(0, 500) });
      } else if (janela) { janela.opener = null; janela.location.href = url; }
    } catch (e) { janela?.close(); toast.error(e instanceof ErroApp ? e.message : 'Não foi possível abrir o arquivo.'); }
  }
  return (
    <Pagina titulo="Documentos" acoes={pode(perfil, 'contador', 'criar') ? <Button variant="ghost" size="sm" onClick={() => setEnviar(true)}><Upload data-icon="inline-start" aria-hidden="true" />Enviar</Button> : undefined}>
      {pode(perfil, 'documentos', 'ver') && (
        <Grupo><Linha icone={Landmark} cor="indigo" titulo="Governança" descricao="Estatuto, certidões com validade, mandatos, reuniões e atas." para="/documentos/governanca" /></Grupo>
      )}
      <p className="text-muted-foreground text-[15px] text-pretty">Arquivos enviados pelo contador, organizados por mês. A escrituração oficial continua com ele.</p>
      {arquivos.isPending ? <CarregandoLista /> : arquivos.isError ? <BlocoErro erro={arquivos.error} tentarDeNovo={() => void arquivos.refetch()} />
        : porMes.length === 0
          ? <Vazio icone={FolderOpen} titulo="Nenhum arquivo do contador ainda" descricao="Quando o contador mandar balancetes ou relatórios, guarde aqui para achar fácil numa auditoria."
              acao={pode(perfil, 'contador', 'criar') ? <Button onClick={() => setEnviar(true)}><Upload data-icon="inline-start" aria-hidden="true" />Enviar arquivo</Button> : undefined} />
          : porMes.map(([mes, lista]) => (
            <Grupo key={mes} titulo={mesPorExtenso(mes).replace(/^./, (c) => c.toUpperCase())}>
              {lista.map((a) => (
                <Linha key={a.id} icone={a.mime.includes('csv') || a.mime.includes('sheet') || a.mime.includes('excel') ? FileSpreadsheet : FileText} cor="teal"
                  titulo={a.descricao ?? a.nome_original} descricao={`${TIPOS.find((t) => t.valor === a.tipo)?.rotulo ?? a.tipo} · ${a.nome_original} · ${formatarData(a.enviado_em)}`}
                  aoTocar={() => void abrir(a)} seta />
              ))}
            </Grupo>
          ))}
      {enviar && <EnviarArquivo aoFechar={() => setEnviar(false)} />}
      {csv && (
        <Folha aberta aoMudar={(v) => !v && setCsv(null)} titulo={csv.nome} descricao={`Primeiras ${csv.linhas.length} linhas da planilha`} larga>
          <div className="pb-4">
            <Table>
              <TableHeader><TableRow>{(csv.linhas[0] ?? []).map((c, i) => <TableHead key={i}>{c}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{csv.linhas.slice(1).map((l, i) => <TableRow key={i}>{l.map((c, j) => <TableCell key={j} className="numeros whitespace-nowrap">{c}</TableCell>)}</TableRow>)}</TableBody>
            </Table>
          </div>
        </Folha>
      )}
    </Pagina>
  );
}

function EnviarArquivo({ aoFechar }: { aoFechar: () => void }) {
  const qc = useQueryClient();
  const meses = [mesAnterior(hojeSP().slice(0, 8) + '01'), hojeSP().slice(0, 8) + '01'];
  let c = meses[0]!; for (let i = 0; i < 22; i++) { c = mesAnterior(c); meses.push(c); }
  meses.sort().reverse();
  const [competencia, setCompetencia] = useState(meses[1]!);
  const [tipo, setTipo] = useState('balancete');
  const [descricao, setDescricao] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  async function enviar() {
    if (!arquivo || enviando) return;
    setEnviando(true); setErro(null);
    try {
      const fd = new FormData();
      fd.set('destino', 'contador'); fd.set('competencia', competencia); fd.set('tipo', tipo); fd.set('arquivo', arquivo);
      if (descricao.trim()) fd.set('descricao', descricao.trim());
      await fonte().enviarArquivo(fd);
      toast.success('Arquivo guardado');
      void qc.invalidateQueries({ queryKey: chaves.contador });
      aoFechar();
    } catch (e) { setErro(e instanceof ErroApp ? e.message : mensagemErro({ erro: 'falha_interna' })); }
    finally { setEnviando(false); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && !enviando && aoFechar()} titulo="Enviar arquivo do contador"
      rodape={<Button size="lg" className="w-full" disabled={!arquivo || enviando} onClick={() => void enviar()}>{enviando && <Spinner data-icon="inline-start" />}{enviando ? 'Enviando…' : 'Guardar arquivo'}</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="ac-mes">Mês de referência</FieldLabel>
          <Select value={competencia} onValueChange={setCompetencia}>
            <SelectTrigger id="ac-mes" className="capitalize"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{meses.map((m) => <SelectItem key={m} value={m} className="capitalize">{mesPorExtenso(m)}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="ac-tipo">Tipo</FieldLabel>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger id="ac-tipo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{TIPOS.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field><FieldLabel htmlFor="ac-desc">Descrição (opcional)</FieldLabel><Input name="ac-desc" id="ac-desc" maxLength={200} autoComplete="off" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
        <Field data-invalid={!!erro || undefined}>
          <FieldLabel htmlFor="ac-arq">Arquivo</FieldLabel>
          <Button variant="secondary" onClick={() => abrirSeletor(entrada.current)}><Upload data-icon="inline-start" aria-hidden="true" /><span className="truncate">{arquivo ? arquivo.name : 'Escolher arquivo'}</span></Button>
          <input id="ac-arq" ref={entrada} type="file" className="sr-only" accept=".pdf,.csv,.txt,.xml,.xlsx,.xls,.docx,.ofx" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          <FieldDescription>PDF, planilha (CSV, XLSX, XLS), DOCX, XML, OFX ou TXT, até 10&nbsp;MB.</FieldDescription>
          {erro && <FieldError role="alert">{erro}</FieldError>}
        </Field>
      </FieldGroup>
    </Folha>
  );
}
