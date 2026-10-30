import { Landmark, Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Valor } from '@/components/app/valor';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { usePerfil } from '@/app/sessao';
import { chaves, useAcao, useContas, usePainel } from '@/dados/consultas';
import type { Conta, TipoConta } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData } from '@/lib/datas';
import { lerValorBRL } from '@/lib/dinheiro';
import { ErroApp } from '@/lib/erros';

const TIPOS: { valor: TipoConta; rotulo: string; dica: string }[] = [
  { valor: 'movimento', rotulo: 'Conta movimento', dica: 'Dinheiro livre do dia a dia.' },
  { valor: 'projeto', rotulo: 'Conta de projeto', dica: 'Recurso de projeto: separado do caixa livre.' },
  { valor: 'aplicacao', rotulo: 'Aplicação', dica: 'Poupança ou investimento.' },
  { valor: 'caixinha', rotulo: 'Caixinha', dica: 'Fundo em dinheiro para pequenas despesas.' },
];

/** Saldo inicial pode ser zero ou negativo (conta no vermelho). */
function lerSaldo(s: string): string | null {
  const t = s.trim();
  const neg = t.startsWith('-');
  const sem = t.replace(/^-/, '').trim();
  if (/^(R\$\s*)?0+([.,]0{1,2})?$/.test(sem)) return '0.00';
  const v = lerValorBRL(sem);
  return v ? (neg ? `-${v}` : v) : null;
}

export function Contas() {
  const perfil = usePerfil();
  const contas = useContas();
  const painel = usePainel();
  const [editando, setEditando] = useState<Conta | 'nova' | null>(null);
  const adm = pode(perfil, 'financeiro', 'administrar');
  const saldo = (id: string) => painel.data?.contas.find((c) => c.id === id)?.saldo;
  return (
    <Pagina titulo="Contas" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}
      acoes={adm ? <Button variant="ghost" size="icon" aria-label="Cadastrar conta" onClick={() => setEditando('nova')}><Plus aria-hidden="true" /></Button> : undefined}>
      {contas.isPending ? <CarregandoLista /> : contas.isError ? <BlocoErro erro={contas.error} tentarDeNovo={() => void contas.refetch()} />
        : contas.data.length === 0
          ? <Vazio icone={Landmark} titulo="Nenhuma conta cadastrada" descricao="Cadastre cada conta da Associação Exemplo, inclusive as específicas de projetos."
              acao={adm ? <Button onClick={() => setEditando('nova')}><Plus data-icon="inline-start" aria-hidden="true" />Cadastrar conta</Button> : undefined} />
          : (
            <Grupo titulo="Contas da Associação Exemplo" rodape="O saldo considera o saldo inicial e todos os lançamentos realizados.">
              {contas.data.map((c) => (
                <Linha key={c.id} icone={Wallet} cor={c.tipo === 'projeto' ? 'roxo' : c.ativa ? 'azul' : 'cinza'} titulo={c.nome}
                  descricao={`${TIPOS.find((t) => t.valor === c.tipo)?.rotulo}${c.banco ? ` · ${c.banco}` : ''}${c.ativa ? '' : ' · desativada'}`}
                  valor={<Valor valor={saldo(c.id) ?? null} className="text-foreground text-[15px] font-medium" />}
                  aoTocar={adm ? () => setEditando(c) : undefined} seta={adm} />
              ))}
            </Grupo>
          )}
      {editando && <FormConta conta={editando === 'nova' ? null : editando} aoFechar={() => setEditando(null)} />}
    </Pagina>
  );
}

function FormConta({ conta, aoFechar }: { conta: Conta | null; aoFechar: () => void }) {
  const acao = useAcao('salvar_conta', [chaves.contas]);
  const [id] = useState(conta?.id ?? crypto.randomUUID());
  const [nome, setNome] = useState(conta?.nome ?? '');
  const [banco, setBanco] = useState(conta?.banco ?? '');
  const [agencia, setAgencia] = useState(conta?.agencia ?? '');
  const [numero, setNumero] = useState(conta?.numero ?? '');
  const [tipo, setTipo] = useState<TipoConta>(conta?.tipo ?? 'movimento');
  const [saldoInicial, setSaldoInicial] = useState(conta ? conta.saldo_inicial.replace('.', ',') : '0,00');
  const [dataSaldo, setDataSaldo] = useState(conta?.data_saldo_inicial ?? '');
  const [ativa, setAtiva] = useState(conta?.ativa ?? true);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    const v = lerSaldo(saldoInicial);
    if (nome.trim().length < 2) return setErro('Dê um nome para a conta.');
    if (v === null) return setErro('Saldo inicial inválido. Use, por exemplo, 1.250,00.');
    if (!dataSaldo) return setErro('Informe a data do saldo inicial.');
    const p: Record<string, unknown> = { id, nome: nome.trim(), tipo, saldo_inicial: v, data_saldo_inicial: dataSaldo, ativa };
    if (banco.trim()) p.banco = banco.trim();
    if (agencia.trim()) p.agencia = agencia.trim();
    if (numero.trim()) p.numero = numero.trim();
    try { await acao.mutateAsync({ p }); toast.success(conta ? 'Conta atualizada' : 'Conta cadastrada'); aoFechar(); }
    catch (e) { setErro(e instanceof ErroApp ? e.message : 'Não foi possível salvar.'); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={conta ? 'Editar conta' : 'Nova conta'}
      rodape={<Button size="lg" className="w-full" disabled={acao.isPending} onClick={() => void salvar()}>{acao.isPending && <Spinner data-icon="inline-start" />}Salvar conta</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="c-nome">Nome</FieldLabel><Input name="c-nome" id="c-nome" maxLength={80} autoComplete="off" placeholder="Ex.: Conta movimento…" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field>
          <FieldLabel htmlFor="c-tipo">Tipo</FieldLabel>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoConta)}>
            <SelectTrigger id="c-tipo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{TIPOS.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <FieldDescription>{TIPOS.find((t) => t.valor === tipo)?.dica}</FieldDescription>
        </Field>
        <Field><FieldLabel htmlFor="c-banco">Banco (opcional)</FieldLabel><Input name="c-banco" id="c-banco" maxLength={80} autoComplete="off" value={banco} onChange={(e) => setBanco(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field><FieldLabel htmlFor="c-ag">Agência</FieldLabel><Input name="c-ag" id="c-ag" inputMode="numeric" maxLength={10} autoComplete="off" value={agencia} onChange={(e) => setAgencia(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="c-num">Conta</FieldLabel><Input name="c-num" id="c-num" inputMode="numeric" maxLength={20} autoComplete="off" value={numero} onChange={(e) => setNumero(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field><FieldLabel htmlFor="c-saldo">Saldo inicial</FieldLabel><Input name="c-saldo" id="c-saldo" inputMode="decimal" autoComplete="off" disabled={!!conta} value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="c-data">Na data</FieldLabel><Input name="c-data" id="c-data" type="date" min="2020-01-01" disabled={!!conta} value={dataSaldo} onChange={(e) => setDataSaldo(e.target.value)} /></Field>
        </div>
        {conta && <FieldDescription>O saldo inicial não muda depois de criada a conta (em {formatarData(conta.data_saldo_inicial)}).</FieldDescription>}
        <Field orientation="horizontal">
          <FieldContent><FieldLabel htmlFor="c-ativa">Conta ativa</FieldLabel><FieldDescription>Contas desativadas somem dos formulários.</FieldDescription></FieldContent>
          <Switch id="c-ativa" checked={ativa} onCheckedChange={setAtiva} />
        </Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}
