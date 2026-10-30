import {
  Bus, CalendarClock, CalendarDays, Dumbbell, FolderKanban, HandHeart, Landmark, Trophy, Users, Volleyball, type LucideIcon,
} from 'lucide-react';
import type { CorIcone } from '@/components/app/lista';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMembros } from '@/dados/consultas';
import type { IconeEvento, Membro, Prioridade, SituacaoTarefa, TipoEvento } from '@/dados/tipos';
import { ErroApp } from '@/lib/erros';

export const ICONE_EVENTO: Record<IconeEvento, LucideIcon> = {
  treino: Dumbbell, jogo: Volleyball, trofeu: Trophy, viagem: Bus, reuniao: Users, assembleia: Landmark,
  captacao: HandHeart, prazo: CalendarClock, projeto: FolderKanban, outro: CalendarDays,
};
export const NOME_ICONE: Record<IconeEvento, string> = {
  treino: 'Treino', jogo: 'Jogo', trofeu: 'Troféu', viagem: 'Viagem', reuniao: 'Reunião', assembleia: 'Assembleia',
  captacao: 'Captação', prazo: 'Prazo', projeto: 'Projeto', outro: 'Outro',
};
export const NOME_COR: Record<CorIcone, string> = {
  azul: 'Azul', verde: 'Verde', laranja: 'Laranja', vermelho: 'Vermelho', roxo: 'Roxo', cinza: 'Cinza', teal: 'Verde-azulado', indigo: 'Índigo',
};
export const FUNDO_COR: Record<CorIcone, string> = {
  azul: 'bg-[#0a68d4]', verde: 'bg-[#1e7b34]', laranja: 'bg-[#c45c00]', vermelho: 'bg-[#c00014]',
  roxo: 'bg-[#7a3fc4]', cinza: 'bg-[#6c6c70]', teal: 'bg-[#00737e]', indigo: 'bg-[#3e3ab8]',
};

export const NOME_SITUACAO: Record<SituacaoTarefa, string> = { a_fazer: 'A fazer', fazendo: 'Fazendo', feito: 'Feito', cancelada: 'Cancelada' };
export const NOME_PRIORIDADE: Record<Prioridade, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta' };

export const erroMsg = (e: unknown, padrao = 'Não foi possível salvar.') => (e instanceof ErroApp ? e.message : padrao);

export function tipoDe(tipos: TipoEvento[] | undefined, id: string) {
  return tipos?.find((t) => t.id === id);
}

export function nomeDe(membros: Membro[] | undefined, id: string | null | undefined) {
  if (!id) return '—';
  return membros?.find((m) => m.id === id)?.nome ?? 'Pessoa sem acesso';
}

export function SeletorPessoa({ id, rotulo, valor, aoMudar, opcional }: {
  id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; opcional?: boolean;
}) {
  const membros = useMembros();
  const ativos = (membros.data ?? []).filter((m) => m.ativo);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{rotulo}</FieldLabel>
      <Select value={valor || (opcional ? 'ninguem' : undefined)} onValueChange={(v) => aoMudar(v === 'ninguem' ? '' : v)}>
        <SelectTrigger id={id}><SelectValue placeholder="Escolha a pessoa" /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {opcional && <SelectItem value="ninguem">Eu mesmo(a)</SelectItem>}
            {ativos.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
