import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { AlertaRubrica, CategoriaOrigem, FormaRecebimento, RegraPendencia, Regras, SituacaoProjeto, SituacaoVerba } from '@/dados/tipos';
import { cn } from '@/lib/utils';

export const SITUACOES_VERBA: SituacaoVerba[] = ['ideia', 'pedido_enviado', 'em_analise', 'aprovado', 'formalizado', 'recebido_parcial',
  'recebido', 'em_execucao', 'prestacao_contas', 'encerrado', 'negado', 'cancelado'];
export const FINAIS: SituacaoVerba[] = ['encerrado', 'negado', 'cancelado'];
export const NOME_SITUACAO_VERBA: Record<SituacaoVerba, string> = {
  ideia: 'Ideia', pedido_enviado: 'Pedido enviado', em_analise: 'Em análise', aprovado: 'Aprovado', formalizado: 'Formalizado',
  recebido_parcial: 'Recebido em parte', recebido: 'Recebido', em_execucao: 'Em execução', prestacao_contas: 'Prestação de contas',
  encerrado: 'Encerrado', negado: 'Negado', cancelado: 'Cancelado',
};
export const NOME_FORMA: Record<FormaRecebimento, string> = {
  caixa_livre: 'Depósito no caixa livre', conta_especifica: 'Depósito em conta específica', pago_pela_origem: 'Pago direto pela origem', bens: 'Entrega em bens',
};
export const NOME_CATEGORIA: Record<CategoriaOrigem, string> = {
  orgao_publico: 'Órgão público', parlamentar: 'Parlamentar', entidade: 'Comitê, confederação ou federação', empresa: 'Empresa',
  pessoa_fisica: 'Pessoa física', outra: 'Outra',
};
export const NOME_SITUACAO_PROJETO: Record<SituacaoProjeto, string> = {
  planejamento: 'Planejamento', em_execucao: 'Em execução', prestacao_contas: 'Prestação de contas', encerrado: 'Encerrado', cancelado: 'Cancelado',
};
export const NOME_REGRA: Record<RegraPendencia, { titulo: string; acao: string }> = {
  sem_rubrica: { titulo: 'Sem rubrica', acao: 'Escolha a rubrica do gasto.' },
  sem_comprovante: { titulo: 'Sem comprovante', acao: 'Anexe o comprovante no Dinheiro.' },
  forma_dinheiro: { titulo: 'Pago em dinheiro vivo', acao: 'O projeto não aceita espécie: justifique.' },
  sem_transferencia: { titulo: 'Sem transferência ao fornecedor', acao: 'O projeto exige transferência, Pix ou boleto: justifique.' },
  reembolso: { titulo: 'Pago como reembolso', acao: 'O projeto não permite reembolso: justifique.' },
  fora_da_conta: { titulo: 'Fora da conta do projeto', acao: 'O projeto exige a conta específica: justifique.' },
  fora_da_vigencia: { titulo: 'Fora da vigência', acao: 'A data está fora do período do projeto: justifique.' },
};
export const JUSTIFICAVEIS: RegraPendencia[] = ['forma_dinheiro', 'sem_transferencia', 'reembolso', 'fora_da_conta', 'fora_da_vigencia'];
export const NOME_ALERTA: Record<Exclude<AlertaRubrica, null>, string> = {
  estourada: 'Passou do previsto', perto_do_limite: 'Perto do limite', adiantada: 'Gasto à frente do tempo', atrasada: 'Gasto atrasado',
};

export const REGRAS_PADRAO: Regras = {
  conta_especifica: false, exige_rubricas: false, exige_transferencia: false, aceita_dinheiro: true, permite_reembolso: true,
  prestacao_parcial: false, prazo_prestacao_dias: 30, guarda_anos: 5, contrapartidas: [], documentos_antes: [], documentos_depois: [],
};
export const regrasCompletas = (r: Partial<Regras> | undefined | null): Regras => ({ ...REGRAS_PADRAO, ...(r ?? {}) });

export function BarraRitmo({ pct, tempo, rotulo, alerta }: { pct: number | null; tempo: number | null; rotulo: string; alerta?: AlertaRubrica }) {
  const largura = Math.max(0, Math.min(100, pct ?? 0));
  const cor = alerta === 'estourada' ? 'bg-destructive' : alerta === 'perto_do_limite' || alerta === 'adiantada' ? 'bg-aviso' : 'bg-primary';
  return (
    <div className="flex flex-col gap-1">
      <div role="img" aria-label={`${rotulo}: ${pct === null ? 'sem orçamento' : `${pct.toLocaleString('pt-BR')}% gasto`}${tempo === null ? '' : `, ${tempo.toLocaleString('pt-BR')}% do prazo passou`}`}
        className="bg-muted relative h-2.5 overflow-hidden rounded-full">
        <div className={cn('h-full rounded-full transition-[width] duration-500', cor)} style={{ width: `${largura}%` }} />
        {tempo !== null && <div aria-hidden="true" className="bg-foreground/70 absolute inset-y-0 w-0.5" style={{ left: `${Math.min(100, tempo)}%` }} />}
      </div>
    </div>
  );
}

function ListaTextos({ id, rotulo, ajuda, valor, aoMudar }: { id: string; rotulo: string; ajuda: string; valor: string[]; aoMudar: (v: string[]) => void }) {
  const [novo, setNovo] = useState('');
  return (
    <FieldSet>
      <FieldLegend variant="label">{rotulo}</FieldLegend>
      <FieldDescription>{ajuda}</FieldDescription>
      <ul className="flex flex-col gap-1">
        {valor.map((t, i) => (
          <li key={`${t}-${i}`} className="bg-muted/60 flex items-center gap-2 rounded-[10px] py-1 pr-1 pl-3 text-[15px]">
            <span className="flex-1">{t}</span>
            <Button size="icon-sm" variant="ghost" aria-label={`Remover ${t}`} onClick={() => aoMudar(valor.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /></Button>
          </li>
        ))}
      </ul>
      {valor.length < 30 && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = novo.trim(); if (t.length >= 2) { aoMudar([...valor, t]); setNovo(''); } }}>
          <Field className="flex-1"><FieldLabel htmlFor={id} className="sr-only">Adicionar a {rotulo}</FieldLabel>
            <Input id={id} name={id} maxLength={200} autoComplete="off" placeholder="Adicionar…" value={novo} onChange={(e) => setNovo(e.target.value)} /></Field>
          <Button type="submit" size="icon" variant="secondary" aria-label={`Adicionar a ${rotulo}`} disabled={novo.trim().length < 2}><Plus aria-hidden="true" /></Button>
        </form>
      )}
    </FieldSet>
  );
}

export function EditorRegras({ valor, aoMudar, prefixo }: { valor: Regras; aoMudar: (r: Regras) => void; prefixo: string }) {
  const muda = <K extends keyof Regras>(k: K, v: Regras[K]) => aoMudar({ ...valor, [k]: v });
  const chave = (k: keyof Regras, rotulo: string, ajuda: string) => (
    <Field orientation="horizontal" key={k}>
      <div className="flex flex-1 flex-col gap-0.5">
        <FieldLabel htmlFor={`${prefixo}-${k}`}>{rotulo}</FieldLabel>
        <FieldDescription>{ajuda}</FieldDescription>
      </div>
      <Switch id={`${prefixo}-${k}`} checked={valor[k] as boolean} onCheckedChange={(v) => muda(k, v as never)} />
    </Field>
  );
  return (
    <FieldGroup>
      {chave('conta_especifica', 'Conta específica', 'O dinheiro fica numa conta separada do caixa livre.')}
      {chave('exige_rubricas', 'Gastos só em rubricas aprovadas', 'Cada saída precisa ser classificada numa rubrica, com limite.')}
      {chave('exige_transferencia', 'Pagar por transferência ao fornecedor', 'Transferência, Pix ou boleto; outra forma pede justificativa.')}
      {chave('aceita_dinheiro', 'Aceita pagamento em dinheiro vivo', 'Desligado: pagamento em espécie pede justificativa.')}
      {chave('permite_reembolso', 'Permite reembolso', 'Desligado: gasto pago do próprio bolso pede justificativa.')}
      {chave('prestacao_parcial', 'Tem prestação de contas parcial', 'Além da final.')}
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${prefixo}-prazo`}>Prazo da prestação (dias)</FieldLabel>
          <Input id={`${prefixo}-prazo`} name="prazo_prestacao_dias" type="number" inputMode="numeric" min={0} max={365} value={valor.prazo_prestacao_dias}
            onChange={(e) => muda('prazo_prestacao_dias', Math.max(0, Math.min(365, Number(e.target.value) || 0)))} />
          <FieldDescription>Contados do fim da vigência.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefixo}-guarda`}>Guardar documentos (anos)</FieldLabel>
          <Input id={`${prefixo}-guarda`} name="guarda_anos" type="number" inputMode="numeric" min={1} max={30} value={valor.guarda_anos}
            onChange={(e) => muda('guarda_anos', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
        </Field>
      </div>
      <ListaTextos id={`${prefixo}-antes`} rotulo="Documentos antes do pedido" ajuda="Ex.: plano de trabalho, certidões." valor={valor.documentos_antes} aoMudar={(v) => muda('documentos_antes', v)} />
      <ListaTextos id={`${prefixo}-depois`} rotulo="Documentos depois do recebimento" ajuda="Ex.: relatório de execução, extratos." valor={valor.documentos_depois} aoMudar={(v) => muda('documentos_depois', v)} />
      <ListaTextos id={`${prefixo}-contra`} rotulo="Contrapartidas" ajuda="O que a Associação Exemplo se comprometeu a entregar." valor={valor.contrapartidas} aoMudar={(v) => muda('contrapartidas', v)} />
    </FieldGroup>
  );
}
