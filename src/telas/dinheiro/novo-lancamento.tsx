// O id nasce aqui e o servidor é idempotente: clique duplo ou internet ruim não duplica o lançamento.
// Sem internet, vira rascunho no aparelho (com as fotos) e é enviado depois.
import { abrirSeletor } from '@/lib/seletor';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, ClipboardPaste, FileUp, Paperclip, QrCode, Sparkles, Trash2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Folha } from '@/components/app/folha';
import { LeitorCodigo } from '@/components/app/leitor-codigo';
import { Segmentado } from '@/components/app/segmentado';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { usePerfil } from '@/app/sessao';
import { chaves, useCategorias, useContas, useProjetos, useRubricas, useTiposGasto } from '@/dados/consultas';
import { pode } from '@/lib/acesso';
import { fonte } from '@/dados/fonte';
import type { FormaPagamento, OrigemComprovante, TipoLancamento } from '@/dados/tipos';
import { lerBoleto } from '@/lib/boleto';
import { guardarRascunho, prepararComprovante, type ArquivoPronto } from '@/lib/comprovante';
import { hojeSP } from '@/lib/datas';
import { formatarBRL, lerValorBRL, mascararValor, paraCampo } from '@/lib/dinheiro';
import { ErroApp, mensagemErro } from '@/lib/erros';
import { lerQrNfce } from '@/lib/nfce';
import { lerXmlNfe } from '@/lib/nfe';

export const FORMAS: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: 'pix', rotulo: 'Pix' }, { valor: 'dinheiro', rotulo: 'Dinheiro' }, { valor: 'cartao_debito', rotulo: 'Cartão de débito' },
  { valor: 'cartao_credito', rotulo: 'Cartão de crédito' }, { valor: 'boleto', rotulo: 'Boleto' }, { valor: 'transferencia', rotulo: 'Transferência' },
  { valor: 'debito_automatico', rotulo: 'Débito automático' }, { valor: 'outro', rotulo: 'Outro' },
];

interface Ctx { abrir: (tipo?: TipoLancamento) => void }
const Contexto = createContext<Ctx | null>(null);
export function useNovoLancamento() {
  const c = useContext(Contexto);
  if (!c) throw new Error('useNovoLancamento fora do provedor');
  return c;
}

interface Estado {
  id: string; tipo: TipoLancamento; jaAconteceu: boolean; valor: string; descricao: string; data: string;
  contaId: string; categoriaId: string; forma: FormaPagamento | ''; tipoGastoId: string; detalhes: Record<string, string>;
  reembolso: boolean;
  projetoId: string; rubricaId: string;
}
interface Anexo extends ArquivoPronto { chave?: string; codigoBarras?: string; urlQr?: string }

const inicial = (tipo: TipoLancamento): Estado => ({
  id: crypto.randomUUID(), tipo, jaAconteceu: true, valor: '', descricao: '', data: hojeSP(), contaId: '', categoriaId: '',
  forma: 'pix', tipoGastoId: '', detalhes: {}, reembolso: false, projetoId: '', rubricaId: '',
});

export function ProvedorNovoLancamento({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const [semente, setSemente] = useState<Estado>(() => inicial('saida'));
  const abrir = useCallback((tipo: TipoLancamento = 'saida') => { setSemente(inicial(tipo)); setAberto(true); }, []);
  const valor = useMemo(() => ({ abrir }), [abrir]);
  return (
    <Contexto.Provider value={valor}>
      {children}
      {aberto && <Formulario key={semente.id} semente={semente} aoFechar={() => setAberto(false)} />}
    </Contexto.Provider>
  );
}

function Formulario({ semente, aoFechar }: { semente: Estado; aoFechar: () => void }) {
  const qc = useQueryClient();
  const perfil = usePerfil();
  const contas = useContas();
  const categorias = useCategorias();
  const tipos = useTiposGasto();
  const veProjetos = pode(perfil, 'projetos', 'ver') || pode(perfil, 'financeiro', 'ver');
  const projetos = useProjetos(veProjetos);
  const rubricas = useRubricas(veProjetos);
  const [e, setE] = useState<Estado>(semente);
  const [passo, setPasso] = useState<1 | 2>(1);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [leitor, setLeitor] = useState(false);
  const [lendoFoto, setLendoFoto] = useState(0);
  const [metaPendente, setMetaPendente] = useState<Pick<Anexo, 'chave' | 'urlQr' | 'codigoBarras'>>({});
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const sujo = Boolean(e.valor.trim() || e.descricao.trim() || anexos.length);
  const tentarFechar = () => { if (salvando) return; if (sujo) setConfirmarSaida(true); else aoFechar(); };
  const campoValor = useRef<HTMLInputElement>(null);

  const mudar = <K extends keyof Estado>(k: K, v: Estado[K]) => { setE((x) => ({ ...x, [k]: v })); setErros((x) => ({ ...x, [k]: '' })); };
  const tipoGasto = tipos.data?.find((t) => t.id === e.tipoGastoId);
  const cats = (categorias.data ?? []).filter((c) => c.tipo === e.tipo && c.ativa);
  const contasAtivas = (contas.data ?? []).filter((c) => c.ativa);
  const realizada = e.jaAconteceu && !e.reembolso;
  const hoje = hojeSP();
  const projetosAtivos = (projetos.data ?? []).filter((x) => x.ativo);
  // conta de projeto escolhida: o lançamento já pertence ao projeto dela
  const projetoDaConta = realizada ? contasAtivas.find((c) => c.id === e.contaId)?.projeto_id ?? '' : '';
  const projetoEfetivo = projetoDaConta || e.projetoId;
  const rubricasDoProjeto = (rubricas.data ?? []).filter((x) => x.projeto_id === projetoEfetivo && x.ativa);

  function validarPasso1(): boolean {
    const er: Record<string, string> = {};
    if (!lerValorBRL(e.valor)) er.valor = 'Digite um valor maior que zero, como 45,90.';
    if (e.descricao.trim().length < 2) er.descricao = 'Escreva o que foi, em poucas palavras.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.data)) er.data = 'Escolha a data.';
    else if (realizada && e.data > hoje) er.data = 'Algo que já aconteceu não pode ter data no futuro.';
    if (realizada && !e.contaId) er.contaId = 'Escolha de qual conta saiu ou para qual entrou.';
    if (!e.categoriaId) er.categoriaId = 'Escolha a categoria: ela organiza os relatórios e a prestação de contas.';
    for (const c of tipoGasto?.campos ?? []) {
      const v = (e.detalhes[c.chave] ?? '').trim();
      if (c.obrigatorio && !v) er[`d_${c.chave}`] = `Preencha ${c.rotulo.toLowerCase()}.`;
      else if (v && c.tipo === 'numero' && !/^\d{1,9}([.,]\d{1,3})?$/.test(v)) er[`d_${c.chave}`] = 'Use só números, como 40,5.';
      else if (v && c.tipo === 'inteiro' && !/^\d{1,9}$/.test(v)) er[`d_${c.chave}`] = 'Use só números inteiros.';
    }
    setErros(er);
    const primeiro = Object.keys(er)[0];
    if (primeiro) document.getElementById(`campo-${primeiro}`)?.focus();
    return !primeiro;
  }

  async function adicionarArquivos(lista: FileList | File[], origem: OrigemComprovante) {
    for (const f of Array.from(lista).slice(0, 6)) {
      const r = await prepararComprovante(f, origem);
      if ('erro' in r) { toast.error(mensagemErro({ erro: r.erro })); continue; }
      if (r.origem === 'xml') {
        const nota = lerXmlNfe(await r.arquivo.text());
        if (nota.ok) {
          setE((x) => ({ ...x, valor: x.valor || (nota.valor ? formatarBRL(nota.valor).replace('R$ ', '') : ''),
            descricao: x.descricao || (nota.emitente ? `Compra — ${nota.emitente}` : x.descricao), data: nota.data && nota.data <= hoje ? nota.data : x.data }));
          toast.success('Dados lidos da nota fiscal. Confira antes de salvar.');
          setAnexos((a) => [...a, { ...r, chave: nota.chave }]);
          continue;
        }
      }
      setAnexos((a) => [...a, { ...r, ...metaPendente }]);
      setMetaPendente({});
      if (r.arquivo.type.startsWith('image/')) void lerFoto(r.arquivo);
    }
  }

  // Só na demonstração (a build real nem inclui este trecho).
  async function usarExemplo() {
    if (import.meta.env.MODE !== 'demo') return;
    const { cupomDeExemplo } = await import('@/demo/exemplo-cupom');
    const x = await cupomDeExemplo(hoje);
    const r = await prepararComprovante(x.arquivo, 'galeria');
    if ('erro' in r) { toast.error(mensagemErro({ erro: r.erro })); return; }
    setAnexos((a) => [...a, r]);
    setE((v) => ({ ...v, valor: v.valor || x.valor, descricao: v.descricao || x.descricao }));
    toast.success('Cupom de exemplo lido. Confira os campos no próximo passo.');
  }

  async function lerFoto(foto: Blob) {
    setLendoFoto((n) => n + 1);
    try {
      const { lerTextoDaFoto, extrairDados } = await import('@/lib/ocr');
      const d = extrairDados(await lerTextoDaFoto(foto), hoje);
      if (!d.valor && !d.data && !d.emitente) { toast.info('Não conseguimos ler os dados da foto. Preencha à mão no próximo passo.'); return; }
      setE((x) => ({ ...x, valor: x.valor || paraCampo(d.valor), data: d.data && x.data === hoje ? d.data : x.data,
        descricao: x.descricao || (d.emitente ? `${x.tipo === 'saida' ? 'Compra' : 'Recebido'} — ${d.emitente}` : '') }));
      toast.success('Lemos a foto e preenchemos o que deu. Confira os campos antes de salvar.');
    } catch {
      toast.info('Não foi possível ler a foto agora. Preencha à mão no próximo passo.');
    } finally {
      setLendoFoto((n) => n - 1);
    }
  }

  function aoLerCodigo(texto: string) {
    setLeitor(false);
    const qr = lerQrNfce(texto);
    if (qr.ok) {
      setMetaPendente({ chave: qr.chave, urlQr: qr.url });
      toast.success('QR code da nota lido. Agora tire a foto do cupom para guardar junto.');
      return;
    }
    const b = lerBoleto(texto, hoje);
    if (b.ok) {
      setE((x) => ({ ...x, valor: x.valor || (b.valor ? formatarBRL(b.valor).replace('R$ ', '') : ''),
        data: b.vencimento ?? x.data, jaAconteceu: b.vencimento ? b.vencimento <= hoje && x.jaAconteceu : x.jaAconteceu, forma: 'boleto' }));
      setMetaPendente({ codigoBarras: b.codigoBarras });
      toast.success('Boleto lido. Confira o valor e o vencimento; depois anexe o PDF ou a foto do boleto.');
      return;
    }
    toast.error('Não reconhecemos esse código. Confira se é o QR code do cupom fiscal ou a linha do boleto.');
  }

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    const p: Record<string, unknown> = {
      id: e.id, tipo: e.tipo, situacao: realizada ? 'realizada' : 'prevista', valor: lerValorBRL(e.valor), data: e.data,
      descricao: e.descricao.trim(), categoria_id: e.categoriaId || null, conta_id: realizada ? e.contaId : null,
      forma_pagamento: e.forma || null, tipo_gasto_id: e.tipoGastoId || null, projeto_id: projetoEfetivo || null,
      detalhes: Object.fromEntries(Object.entries(e.detalhes).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim().replace(',', '.')])),
      ...(e.reembolso ? { reembolso: true } : {}),
    };
    let salvo = false;
    try {
      await fonte().rpc('criar_lancamento', { p });
      salvo = true;
      if (e.tipo === 'saida' && e.rubricaId && rubricasDoProjeto.some((x) => x.id === e.rubricaId)) {
        // idempotente; se falhar, a rubrica pode ser escolhida depois na tela do projeto
        await fonte().rpc('classificar_lancamento', { p_lancamento: e.id, p_rubrica: e.rubricaId })
          .catch(() => toast.warning('Lançamento salvo, mas a rubrica não foi gravada. Escolha na tela do projeto.'));
      }
      let duplicado = false;
      for (const a of anexos) {
        const fd = new FormData();
        fd.set('destino', 'comprovante'); fd.set('lancamento_id', e.id); fd.set('origem', a.origem); fd.set('arquivo', a.arquivo);
        if (a.chave) fd.set('chave_acesso', a.chave);
        if (a.codigoBarras) fd.set('codigo_barras', a.codigoBarras);
        if (a.urlQr) fd.set('url_qrcode', a.urlQr);
        const r = await fonte().enviarArquivo(fd);
        duplicado ||= Boolean(r.duplicado);
      }
      toast.success(e.tipo === 'entrada' ? 'Entrada registrada' : e.reembolso ? 'Pedido de reembolso enviado' : 'Saída registrada');
      if (duplicado) toast.warning('Um dos comprovantes já tinha sido usado em outro lançamento. Confira se não é repetido.');
      if (realizada && e.tipo === 'saida' && anexos.length === 0) toast.info('Lançamento sem comprovante: ele aparece como pendente até você anexar.');
      for (const k of [chaves.painel, ['lancamentos'], chaves.reembolsos]) void qc.invalidateQueries({ queryKey: k });
      aoFechar();
    } catch (err) {
      const codigo = err instanceof ErroApp ? err.detalhe.erro : 'falha_interna';
      if (codigo === 'rede' || codigo === 'tempo_esgotado') {
        await guardarRascunho({ id: e.id, usuarioId: perfil.membro.id, criadoEm: new Date().toISOString(), dados: p, lancamentoSalvo: salvo,
          arquivos: anexos.map((a) => ({ blob: a.arquivo, nome: a.arquivo.name, origem: a.origem })) });
        toast.warning('Sem conexão: o lançamento ficou guardado neste aparelho e pode ser enviado na tela Início.');
        aoFechar();
      } else {
        const d = err instanceof ErroApp ? err.detalhe : { erro: 'falha_interna' };
        if (d.erro === 'invalido' && d.campo) { setPasso(2); setErros({ [campoDoServidor(d.campo)]: mensagemErro(d) }); }
        toast.error(mensagemErro(d));
      }
    } finally {
      setSalvando(false);
    }
  }

  const rodape = passo === 1 ? (
    <Button size="lg" className="w-full" variant={anexos.length ? 'default' : 'ghost'} onClick={() => setPasso(2)}>
      {anexos.length ? 'Continuar' : 'Preencher sem comprovante'}
    </Button>
  ) : (
    <div className="flex w-full gap-2">
      <Button size="lg" variant="secondary" onClick={() => setPasso(1)} disabled={salvando}>Voltar</Button>
      <Button size="lg" className="flex-1" onClick={() => { if (validarPasso1()) void salvar(); }} disabled={salvando}>
        {salvando && <Spinner data-icon="inline-start" />}
        {salvando ? 'Salvando…' : e.reembolso ? 'Pedir reembolso' : 'Salvar lançamento'}
      </Button>
    </div>
  );

  return (
    <>
      <Folha aberta={!confirmarSaida} aoMudar={(v) => { if (!v) tentarFechar(); }} titulo="Novo lançamento"
        descricao={passo === 1 ? 'Passo 1 de 2 — comprovante' : 'Passo 2 de 2 — confira e complete'} rodape={rodape}>
        {passo === 2 ? (
          <FieldGroup className="pb-2">
            <Segmentado rotulo="Tipo de lançamento" valor={e.tipo} aoMudar={(v) => setE((x) => ({ ...x, tipo: v, categoriaId: '', reembolso: false }))}
              opcoes={[{ valor: 'saida', rotulo: 'Saiu dinheiro' }, { valor: 'entrada', rotulo: 'Entrou dinheiro' }]} />
            <Field data-invalid={!!erros.valor || undefined}>
              <FieldLabel htmlFor="campo-valor">Valor</FieldLabel>
              <InputGroup className="h-16">
                <InputGroupAddon><InputGroupText className="text-foreground text-[22px] font-semibold">R$</InputGroupText></InputGroupAddon>
                <InputGroupInput id="campo-valor" ref={campoValor} name="valor" inputMode="numeric" autoComplete="off" placeholder="0,00"
                  aria-invalid={!!erros.valor || undefined} aria-describedby={erros.valor ? 'erro-valor' : undefined}
                  className="font-rounded numeros text-[30px] font-semibold" value={e.valor} onChange={(ev) => mudar('valor', mascararValor(ev.target.value))} />
              </InputGroup>
              {erros.valor && <FieldError id="erro-valor">{erros.valor}</FieldError>}
            </Field>
            <Field data-invalid={!!erros.descricao || undefined}>
              <FieldLabel htmlFor="campo-descricao">{e.tipo === 'saida' ? 'Com o que foi' : 'De onde veio'}</FieldLabel>
              <Input id="campo-descricao" name="descricao" autoComplete="off" maxLength={200} aria-invalid={!!erros.descricao || undefined}
                placeholder={e.tipo === 'saida' ? 'Ex.: almoço da delegação em Campinas…' : 'Ex.: doação da Empresa Exemplo…'}
                value={e.descricao} onChange={(ev) => mudar('descricao', ev.target.value)} />
              {erros.descricao && <FieldError>{erros.descricao}</FieldError>}
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="campo-ja">{e.tipo === 'saida' ? 'Já foi pago' : 'Já foi recebido'}</FieldLabel>
                <FieldDescription>Desligue para registrar uma conta {e.tipo === 'saida' ? 'a pagar' : 'a receber'}.</FieldDescription>
              </FieldContent>
              <Switch id="campo-ja" checked={e.jaAconteceu} onCheckedChange={(v) => mudar('jaAconteceu', v)} disabled={e.reembolso} />
            </Field>
            {e.tipo === 'saida' && (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="campo-reembolso">Paguei do meu bolso</FieldLabel>
                  <FieldDescription>Vira um pedido de reembolso para a tesouraria decidir.</FieldDescription>
                </FieldContent>
                <Switch id="campo-reembolso" checked={e.reembolso} onCheckedChange={(v) => mudar('reembolso', v)} />
              </Field>
            )}
            <Field data-invalid={!!erros.data || undefined}>
              <FieldLabel htmlFor="campo-data">{realizada || e.reembolso ? 'Data' : 'Vencimento'}</FieldLabel>
              <Input id="campo-data" name="data" type="date" max={realizada ? hoje : undefined} value={e.data} onChange={(ev) => mudar('data', ev.target.value)} />
              {erros.data && <FieldError>{erros.data}</FieldError>}
            </Field>
            {realizada && (
              <Field data-invalid={!!erros.contaId || undefined}>
                <FieldLabel htmlFor="campo-contaId">Conta</FieldLabel>
                <Select value={e.contaId} onValueChange={(v) => mudar('contaId', v)}>
                  <SelectTrigger id="campo-contaId" aria-invalid={!!erros.contaId || undefined}><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
                  <SelectContent><SelectGroup>{contasAtivas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                {contasAtivas.length === 0 && <FieldDescription>Nenhuma conta cadastrada ainda: cadastre em Dinheiro › Contas.</FieldDescription>}
                {erros.contaId && <FieldError>{erros.contaId}</FieldError>}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!erros.categoriaId || undefined}>
                <FieldLabel htmlFor="campo-categoriaId">Categoria</FieldLabel>
                <Select value={e.categoriaId} onValueChange={(v) => mudar('categoriaId', v)}>
                  <SelectTrigger id="campo-categoriaId" aria-invalid={!!erros.categoriaId || undefined}><SelectValue placeholder="Escolha a categoria" /></SelectTrigger>
                  <SelectContent><SelectGroup>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                {cats.length === 0 && <FieldDescription>Nenhuma categoria de {e.tipo === 'saida' ? 'saída' : 'entrada'} ainda: crie em Dinheiro › Categorias e tipos de gasto.</FieldDescription>}
                {erros.categoriaId && <FieldError>{erros.categoriaId}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="campo-forma">Forma de pagamento</FieldLabel>
                <Select value={e.forma} onValueChange={(v) => mudar('forma', v as FormaPagamento)}>
                  <SelectTrigger id="campo-forma"><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent><SelectGroup>{FORMAS.map((f) => <SelectItem key={f.valor} value={f.valor}>{f.rotulo}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
            </div>
            {projetosAtivos.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="campo-projeto">Projeto (opcional)</FieldLabel>
                  <Select value={projetoEfetivo || 'nenhum'} disabled={!!projetoDaConta}
                    onValueChange={(v) => setE((x) => ({ ...x, projetoId: v === 'nenhum' ? '' : v, rubricaId: '' }))}>
                    <SelectTrigger id="campo-projeto"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="nenhum">Nenhum (caixa livre)</SelectItem>
                      {projetosAtivos.map((x) => <SelectItem key={x.id} value={x.id}>{x.nome}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                  {projetoDaConta && <FieldDescription>A conta escolhida é a do projeto.</FieldDescription>}
                </Field>
                {e.tipo === 'saida' && rubricasDoProjeto.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor="campo-rubrica">Rubrica</FieldLabel>
                    <Select value={e.rubricaId || 'nenhuma'} onValueChange={(v) => mudar('rubricaId', v === 'nenhuma' ? '' : v)}>
                      <SelectTrigger id="campo-rubrica"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>
                        <SelectItem value="nenhuma">Escolher depois</SelectItem>
                        {rubricasDoProjeto.map((x) => <SelectItem key={x.id} value={x.id}>{x.nome}</SelectItem>)}
                      </SelectGroup></SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
            )}
            {e.tipo === 'saida' && (tipos.data?.length ?? 0) > 0 && (
              <Field>
                <FieldLabel htmlFor="campo-tipo-gasto">Tipo de gasto</FieldLabel>
                <Select value={e.tipoGastoId || 'nenhum'} onValueChange={(v) => setE((x) => ({ ...x, tipoGastoId: v === 'nenhum' ? '' : v, detalhes: {} }))}>
                  <SelectTrigger id="campo-tipo-gasto"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="nenhum">Sem detalhes</SelectItem>
                    {tipos.data!.filter((t) => t.ativo).map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
                <FieldDescription>Combustível, alimentação e outros pedem campos próprios.</FieldDescription>
              </Field>
            )}
            {tipoGasto && tipoGasto.campos.length > 0 && (
              <FieldSet>
                <FieldLegend variant="label">Detalhes — {tipoGasto.nome}</FieldLegend>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  {tipoGasto.campos.map((c) => (
                    <Field key={c.chave} data-invalid={!!erros[`d_${c.chave}`] || undefined}>
                      <FieldLabel htmlFor={`campo-d_${c.chave}`}>{c.rotulo}{c.obrigatorio ? '' : ' (opcional)'}</FieldLabel>
                      <Input id={`campo-d_${c.chave}`} name={c.chave} autoComplete="off" type={c.tipo === 'data' ? 'date' : 'text'}
                        inputMode={c.tipo === 'numero' ? 'decimal' : c.tipo === 'inteiro' ? 'numeric' : undefined} maxLength={200}
                        value={e.detalhes[c.chave] ?? ''} onChange={(ev) => setE((x) => ({ ...x, detalhes: { ...x.detalhes, [c.chave]: ev.target.value } }))} />
                      {erros[`d_${c.chave}`] && <FieldError>{erros[`d_${c.chave}`]}</FieldError>}
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            )}
          </FieldGroup>
        ) : (
          <Comprovantes anexos={anexos} remover={(i) => setAnexos((a) => a.filter((_, j) => j !== i))}
            adicionar={adicionarArquivos} abrirLeitor={() => setLeitor(true)} metaPendente={metaPendente} lendo={lendoFoto > 0}
            exemplo={import.meta.env.MODE === 'demo' ? () => void usarExemplo() : undefined} />
        )}
      </Folha>
      <LeitorCodigo aberto={leitor} aoMudar={setLeitor} aoLer={aoLerCodigo} />
      <AlertDialog open={confirmarSaida} onOpenChange={setConfirmarSaida}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar este lançamento?</AlertDialogTitle>
            <AlertDialogDescription>O que você digitou e os comprovantes anexados ainda não foram salvos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={aoFechar}>Descartar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function campoDoServidor(c: string) { return c === 'conta_id' ? 'contaId' : c === 'categoria_id' ? 'categoriaId' : c; }

function Comprovantes({ anexos, remover, adicionar, abrirLeitor, metaPendente, lendo, exemplo }: {
  anexos: Anexo[]; remover: (i: number) => void; adicionar: (l: FileList | File[], o: OrigemComprovante) => Promise<void>;
  abrirLeitor: () => void; metaPendente: Pick<Anexo, 'chave' | 'codigoBarras'>; lendo: boolean; exemplo?: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  return (
    <div
      className="flex flex-col gap-4 pb-2"
      onPaste={(ev) => { if (ev.clipboardData.files.length) void adicionar(ev.clipboardData.files, 'colado'); }}
    >
      <Button size="lg" className="h-14 w-full text-[17px]" onClick={() => abrirSeletor(camera.current)}><Camera data-icon="inline-start" aria-hidden="true" />Tirar foto do comprovante</Button>
      <p className="text-muted-foreground -mt-1 text-center text-[13px]">O sistema lê valor, data e local. Você confere no próximo passo.</p>
      <div className="grid grid-cols-2 gap-2.5">
        <Button variant="secondary" onClick={() => abrirSeletor(arquivo.current)}><FileUp data-icon="inline-start" aria-hidden="true" />Escolher arquivo</Button>
        <Button variant="secondary" onClick={abrirLeitor}><QrCode data-icon="inline-start" aria-hidden="true" />Ler QR code</Button>
        {import.meta.env.MODE === 'demo' && exemplo && <Button variant="ghost" className="col-span-2" onClick={exemplo}><Sparkles data-icon="inline-start" aria-hidden="true" />Usar cupom de exemplo (demonstração)</Button>}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(ev) => { if (ev.target.files) void adicionar(ev.target.files, 'camera'); ev.target.value = ''; }} />
      <input ref={arquivo} type="file" accept="image/*,application/pdf,.pdf,.xml,text/xml,application/xml" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(ev) => { if (ev.target.files) void adicionar(ev.target.files, 'galeria'); ev.target.value = ''; }} />
      <div
        onDragOver={(ev) => { ev.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(ev) => { ev.preventDefault(); setArrastando(false); void adicionar(ev.dataTransfer.files, 'arrastado'); }}
        className={`text-muted-foreground hidden items-center justify-center gap-2 rounded-[14px] border-2 border-dashed px-4 py-6 text-[15px] transition-colors sm:flex ${arrastando ? 'border-tint bg-tint/8 text-tint' : ''}`}
      >
        <ClipboardPaste aria-hidden="true" className="size-5" />
        Arraste o arquivo para cá ou cole um print (Ctrl+V)
      </div>
      {lendo && <p role="status" className="text-tint flex items-center gap-2 text-[13px] font-medium"><Spinner /> Lendo a foto no seu aparelho…</p>}
      {(metaPendente.chave || metaPendente.codigoBarras) && (
        <p role="status" className="text-tint text-[13px] font-medium">Código lido — será guardado junto com o próximo arquivo anexado.</p>
      )}
      {anexos.length > 0 ? (
        <ul className="bg-card flex flex-col divide-y overflow-hidden rounded-[14px]" aria-label="Comprovantes anexados">
          {anexos.map((a, i) => (
            <li key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              {a.previa ? <img src={a.previa} alt="" width={44} height={44} className="size-11 rounded-[8px] object-cover" />
                : <span className="bg-muted inline-flex size-11 items-center justify-center rounded-[8px]"><Paperclip aria-hidden="true" className="size-5" /></span>}
              <div className="min-w-0 flex-1 text-[15px]">
                <p className="truncate font-medium">{a.origem === 'xml' ? 'XML da nota fiscal' : a.arquivo.type === 'application/pdf' ? 'PDF' : 'Foto do comprovante'}</p>
                <p className="text-muted-foreground numeros text-[13px]">
                  {Math.round(a.arquivo.size / 1024)}&nbsp;KB
                  {a.tamanhoOriginal > a.arquivo.size * 1.5 && <> (era {Math.round(a.tamanhoOriginal / 1024)}&nbsp;KB)</>}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Remover este comprovante" onClick={() => remover(i)}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 text-[13px]"><X aria-hidden="true" className="size-4" />Nenhum comprovante ainda.</p>
      )}
    </div>
  );
}
