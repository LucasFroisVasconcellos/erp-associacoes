import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, ClipboardList, Download, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Valor } from '@/components/app/valor';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { chaves, useAcao, useCategorias, useRecorrencias, useTiposGasto } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { CampoGuiado, TipoLancamento } from '@/dados/tipos';
import { hojeSP } from '@/lib/datas';
import { lerValorBRL, mascararValor } from '@/lib/dinheiro';
import { ErroApp } from '@/lib/erros';
import { contar } from '@/lib/texto';

const erroMsg = (e: unknown) => (e instanceof ErroApp ? e.message : 'Não foi possível salvar.');

export function Cadastros() {
  const qc = useQueryClient();
  const categorias = useCategorias();
  const tipos = useTiposGasto();
  const recorrencias = useRecorrencias();
  const [folha, setFolha] = useState<null | 'categoria' | 'tipo' | 'recorrencia'>(null);
  const [importando, setImportando] = useState(false);
  async function importarModelos() {
    setImportando(true);
    try {
      const r = await fonte().rpc<{ importados?: number }>('importar_modelos_tipos_gasto');
      toast.success(r.importados ? `${contar(r.importados, 'modelo adicionado', 'modelos adicionados')}` : 'Os modelos já estavam cadastrados');
      void qc.invalidateQueries({ queryKey: chaves.tiposGasto });
    } catch (e) { toast.error(erroMsg(e)); } finally { setImportando(false); }
  }
  const saidas = (categorias.data ?? []).filter((c) => c.tipo === 'saida');
  const entradas = (categorias.data ?? []).filter((c) => c.tipo === 'entrada');
  return (
    <Pagina titulo="Cadastros" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}>
      <Grupo titulo="Categorias de saída" acao={<Button variant="link" size="xs" onClick={() => setFolha('categoria')}>Adicionar</Button>}>
        {saidas.length ? saidas.map((c) => <Linha key={c.id} icone={ArrowUpRight} cor="azul" titulo={c.nome} />) : <Linha titulo="Nenhuma ainda" descricao="Ex.: transporte, arbitragem, material esportivo." />}
      </Grupo>
      <Grupo titulo="Categorias de entrada" acao={<Button variant="link" size="xs" onClick={() => setFolha('categoria')}>Adicionar</Button>}>
        {entradas.length ? entradas.map((c) => <Linha key={c.id} icone={ArrowDownLeft} cor="verde" titulo={c.nome} />) : <Linha titulo="Nenhuma ainda" descricao="Ex.: doações, patrocínio, rifas e eventos." />}
      </Grupo>
      <Grupo titulo="Tipos de gasto com campos próprios" acao={<Button variant="link" size="xs" onClick={() => setFolha('tipo')}>Adicionar</Button>}
        rodape="Cada tipo pede os campos certos no lançamento: combustível pede litros e posto; alimentação pede local e número de pessoas.">
        {(tipos.data ?? []).map((t) => <Linha key={t.id} icone={ClipboardList} cor="laranja" titulo={t.nome} descricao={t.campos.map((c) => c.rotulo).join(', ') || 'Sem campos'} />)}
        <Linha icone={Download} cor="cinza" titulo={importando ? 'Importando…' : 'Usar modelos prontos'} descricao="Combustível, alimentação, pedágio, hospedagem e outros." aoTocar={() => void importarModelos()} desabilitada={importando} />
      </Grupo>
      <Grupo titulo="Contas recorrentes" acao={<Button variant="link" size="xs" onClick={() => setFolha('recorrencia')}>Adicionar</Button>}
        rodape="Aluguel, internet e outras contas fixas viram “a pagar” todo mês, sozinhas.">
        {(recorrencias.data ?? []).length ? recorrencias.data!.map((r) => (
          <Linha key={r.id} icone={Repeat} cor="indigo" titulo={r.descricao} descricao={`Todo dia ${r.dia}${r.ativa ? '' : ' · pausada'}`}
            valor={<Valor valor={r.valor} tipo={r.tipo} className="text-foreground text-[15px]" />} />
        )) : <Linha titulo="Nenhuma conta recorrente" />}
      </Grupo>
      {folha === 'categoria' && <FormCategoria aoFechar={() => setFolha(null)} />}
      {folha === 'tipo' && <FormTipo aoFechar={() => setFolha(null)} />}
      {folha === 'recorrencia' && <FormRecorrencia aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function FormCategoria({ aoFechar }: { aoFechar: () => void }) {
  const acao = useAcao('salvar_categoria', [chaves.categorias]);
  const [tipo, setTipo] = useState<TipoLancamento>('saida');
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    try { await acao.mutateAsync({ p: { id: crypto.randomUUID(), nome: nome.trim(), tipo } }); toast.success('Categoria criada'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Nova categoria"
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || acao.isPending} onClick={() => void salvar()}>{acao.isPending && <Spinner data-icon="inline-start" />}Criar categoria</Button>}>
      <FieldGroup className="pb-2">
        <Segmentado rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={[{ valor: 'saida', rotulo: 'Saída' }, { valor: 'entrada', rotulo: 'Entrada' }]} />
        <Field data-invalid={!!erro || undefined}>
          <FieldLabel htmlFor="cat-nome">Nome</FieldLabel>
          <Input name="cat-nome" id="cat-nome" maxLength={60} autoComplete="off" placeholder="Ex.: Arbitragem…" value={nome} onChange={(e) => setNome(e.target.value)} />
          {erro && <FieldError role="alert">{erro}</FieldError>}
        </Field>
      </FieldGroup>
    </Folha>
  );
}

const TIPOS_CAMPO: { valor: CampoGuiado['tipo']; rotulo: string }[] = [
  { valor: 'texto', rotulo: 'Texto' }, { valor: 'numero', rotulo: 'Número com vírgula' }, { valor: 'inteiro', rotulo: 'Número inteiro' }, { valor: 'data', rotulo: 'Data' },
];
const paraChave = (r: string) => r.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 30) || 'campo';

function FormTipo({ aoFechar }: { aoFechar: () => void }) {
  const acao = useAcao('salvar_tipo_gasto', [chaves.tiposGasto]);
  const [nome, setNome] = useState('');
  const [campos, setCampos] = useState<CampoGuiado[]>([{ chave: '', rotulo: '', tipo: 'texto', obrigatorio: false }]);
  const [erro, setErro] = useState<string | null>(null);
  const muda = (i: number, p: Partial<CampoGuiado>) => setCampos((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  async function salvar() {
    const prontos = campos.filter((c) => c.rotulo.trim()).map((c) => ({ ...c, rotulo: c.rotulo.trim(), chave: paraChave(c.rotulo) }));
    if (new Set(prontos.map((c) => c.chave)).size !== prontos.length) return setErro('Dois campos ficaram com o mesmo nome. Use nomes diferentes.');
    try { await acao.mutateAsync({ p: { id: crypto.randomUUID(), nome: nome.trim(), campos: prontos } }); toast.success('Tipo de gasto criado'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Novo tipo de gasto" larga
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || acao.isPending} onClick={() => void salvar()}>{acao.isPending && <Spinner data-icon="inline-start" />}Criar tipo de gasto</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="tg-nome">Nome</FieldLabel><Input name="tg-nome" id="tg-nome" maxLength={60} autoComplete="off" placeholder="Ex.: Hospedagem…" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <FieldSet>
          <FieldLegend variant="label">Campos que a pessoa preenche</FieldLegend>
          <FieldDescription>Até 15 campos. Ex.: “Número de pessoas” (inteiro), “Hotel” (texto).</FieldDescription>
          <FieldGroup>
            {campos.map((c, i) => (
              <div key={i} className="bg-muted/60 grid gap-3 rounded-[14px] p-3 sm:grid-cols-[1fr_180px_auto_auto] sm:items-end">
                <Field><FieldLabel htmlFor={`cg-r${i}`}>Nome do campo</FieldLabel><Input name="cg-r" id={`cg-r${i}`} maxLength={60} autoComplete="off" value={c.rotulo} onChange={(e) => muda(i, { rotulo: e.target.value })} /></Field>
                <Field>
                  <FieldLabel htmlFor={`cg-t${i}`}>Tipo</FieldLabel>
                  <Select value={c.tipo} onValueChange={(v) => muda(i, { tipo: v as CampoGuiado['tipo'] })}>
                    <SelectTrigger id={`cg-t${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{TIPOS_CAMPO.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>
                <Field orientation="horizontal" className="h-11 items-center">
                  <Switch id={`cg-o${i}`} checked={c.obrigatorio} onCheckedChange={(v) => muda(i, { obrigatorio: v })} />
                  <FieldLabel htmlFor={`cg-o${i}`}>Obrigatório</FieldLabel>
                </Field>
                <Button variant="ghost" size="icon" aria-label={`Remover o campo ${c.rotulo || i + 1}`} onClick={() => setCampos((cs) => cs.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /></Button>
              </div>
            ))}
            {campos.length < 15 && <Button variant="secondary" onClick={() => setCampos((cs) => [...cs, { chave: '', rotulo: '', tipo: 'texto', obrigatorio: false }])}><Plus data-icon="inline-start" aria-hidden="true" />Adicionar campo</Button>}
          </FieldGroup>
        </FieldSet>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormRecorrencia({ aoFechar }: { aoFechar: () => void }) {
  const categorias = useCategorias();
  const acao = useAcao('salvar_recorrencia', [chaves.recorrencias]);
  const [tipo, setTipo] = useState<TipoLancamento>('saida');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [dia, setDia] = useState('5');
  const [categoria, setCategoria] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    const v = lerValorBRL(valor);
    if (!v) return setErro('Digite o valor, como 120,00.');
    const d = Number(dia);
    if (!Number.isInteger(d) || d < 1 || d > 28) return setErro('Escolha um dia entre 1 e 28 (vale para todos os meses).');
    if (!categoria) return setErro('Escolha a categoria.');
    try {
      await acao.mutateAsync({ p: { id: crypto.randomUUID(), tipo, descricao: descricao.trim(), valor: v, dia: d, inicio: hojeSP(), categoria_id: categoria } });
      toast.success('Conta recorrente criada'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Nova conta recorrente"
      rodape={<Button size="lg" className="w-full" disabled={descricao.trim().length < 2 || acao.isPending} onClick={() => void salvar()}>{acao.isPending && <Spinner data-icon="inline-start" />}Criar</Button>}>
      <FieldGroup className="pb-2">
        <Segmentado rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={[{ valor: 'saida', rotulo: 'A pagar' }, { valor: 'entrada', rotulo: 'A receber' }]} />
        <Field><FieldLabel htmlFor="rc-desc">Descrição</FieldLabel><Input name="rc-desc" id="rc-desc" maxLength={200} autoComplete="off" placeholder="Ex.: Aluguel da quadra…" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field><FieldLabel htmlFor="rc-valor">Valor</FieldLabel><Input name="rc-valor" id="rc-valor" inputMode="numeric" autoComplete="off" placeholder="0,00" value={valor} onChange={(e) => setValor(mascararValor(e.target.value))} /></Field>
          <Field><FieldLabel htmlFor="rc-dia">Dia do mês</FieldLabel><Input name="rc-dia" id="rc-dia" inputMode="numeric" autoComplete="off" value={dia} onChange={(e) => setDia(e.target.value)} /></Field>
        </div>
        <Field>
          <FieldLabel htmlFor="rc-cat">Categoria</FieldLabel>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger id="rc-cat"><SelectValue placeholder="Escolha a categoria" /></SelectTrigger>
            <SelectContent><SelectGroup>{(categorias.data ?? []).filter((c) => c.tipo === tipo).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}
