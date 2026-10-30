// Mês fechado fica travado e não reabre: correção só por lançamento de ajuste no mês aberto.
import { CalendarCheck, CheckCircle2, CircleDashed, Lock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista } from '@/components/app/estados';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { usePerfil } from '@/app/sessao';
import { chaves, useAcao, useChecklist, useFechamentos } from '@/dados/consultas';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP, mesAnterior, mesPorExtenso } from '@/lib/datas';
import { ErroApp } from '@/lib/erros';
import { contar } from '@/lib/texto';

function ultimosMeses(n: number) {
  const r: string[] = []; let c = mesAnterior(hojeSP().slice(0, 8) + '01');
  for (let i = 0; i < n; i++) { r.push(c); c = mesAnterior(c); }
  return r;
}

export function Fechamento() {
  const perfil = usePerfil();
  const meses = ultimosMeses(12);
  const [comp, setComp] = useState(meses[0]!);
  const ck = useChecklist(comp);
  const fechados = useFechamentos();
  const [extrato, setExtrato] = useState(false);
  const acao = useAcao('fechar_mes', [chaves.fechamentos, chaves.checklist(comp)]);
  const podeFechar = pode(perfil, 'financeiro', 'aprovar');
  async function fechar() {
    try { await acao.mutateAsync({ p_competencia: comp, p_confirmacoes: { extrato_conferido: extrato } }); toast.success(`Mês de ${mesPorExtenso(comp)} fechado`); }
    catch (e) { toast.error(e instanceof ErroApp ? e.message : 'Não foi possível fechar.'); }
  }
  const bloqueado = !ck.data || ck.data.ja_fechado || !ck.data.pode_fechar || !extrato;
  return (
    <Pagina titulo="Fechamento" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}
      sob={
        <Field>
          <FieldLabel htmlFor="mes-fech">Mês</FieldLabel>
          <Select value={comp} onValueChange={(v) => { setComp(v); setExtrato(false); }}>
            <SelectTrigger id="mes-fech" className="capitalize"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{meses.map((m) => <SelectItem key={m} value={m} className="capitalize">{mesPorExtenso(m)}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
      }>
      {ck.isPending ? <CarregandoLista /> : ck.isError ? <BlocoErro erro={ck.error} tentarDeNovo={() => void ck.refetch()} /> : (
        <>
          {ck.data.ja_fechado && <Grupo><Linha icone={Lock} cor="verde" titulo="Mês fechado" descricao="Correções só por lançamento de ajuste no mês atual." /></Grupo>}
          <Grupo titulo="Conferência" rodape="Itens marcados como obrigatórios precisam estar resolvidos para fechar.">
            {ck.data.itens.filter((i) => !i.manual || i.pendentes !== null).map((i) => (
              <Linha key={i.chave} icone={i.pendentes ? CircleDashed : CheckCircle2} cor={i.pendentes ? (i.bloqueia ? 'vermelho' : 'laranja') : 'verde'}
                titulo={i.titulo} descricao={i.pendentes ? `${contar(i.pendentes, 'pendente', 'pendentes')}${i.bloqueia ? ' — obrigatório' : ' — recomendado'}` : 'Tudo certo'}
                para={i.chave === 'comprovantes' && i.pendentes ? '/dinheiro?situacao=sem_comprovante' : i.chave === 'reembolsos' && i.pendentes ? '/dinheiro?aba=reembolsos' : i.chave === 'extrato' ? '/dinheiro/conciliacao' : undefined} />
            ))}
            {!ck.data.ja_fechado && (
              <div className="px-4 py-3">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="extrato">Conferi o extrato do banco</FieldLabel>
                    <FieldDescription>Compare o extrato de cada conta com os lançamentos do mês, ou importe o extrato em Conciliação.</FieldDescription>
                  </FieldContent>
                  <Switch id="extrato" checked={extrato} onCheckedChange={setExtrato} disabled={!podeFechar} />
                </Field>
              </div>
            )}
          </Grupo>
          {podeFechar && !ck.data.ja_fechado && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="lg" disabled={bloqueado || acao.isPending}><CalendarCheck data-icon="inline-start" aria-hidden="true" />Fechar {mesPorExtenso(comp)}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Fechar {mesPorExtenso(comp)}?</AlertDialogTitle>
                  <AlertDialogDescription>Depois de fechado, ninguém altera os lançamentos desse mês. Correções viram ajustes no mês atual. Não dá para reabrir.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void fechar()}>{acao.isPending && <Spinner data-icon="inline-start" />}Fechar o mês</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!ck.data.mes_encerrado && <p className="text-muted-foreground px-4 text-[13px]">Só dá para fechar um mês que já terminou.</p>}
        </>
      )}
      <Grupo titulo="Meses fechados">
        {(fechados.data ?? []).length === 0 ? <Linha titulo="Nenhum mês fechado ainda" />
          : fechados.data!.map((f) => <Linha key={f.competencia} icone={Lock} cor="cinza" titulo={<span className="capitalize">{mesPorExtenso(f.competencia)}</span>} valor={`em ${formatarData(f.fechado_em)}`} />)}
      </Grupo>
    </Pagina>
  );
}
