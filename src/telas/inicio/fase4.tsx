// Nada de saúde aqui, nem contagem.
import { AlertTriangle, BookUser, FileText, IdCard, Megaphone, Plane, Wallet } from 'lucide-react';
import { Linha } from '@/components/app/lista';
import { usePerfil } from '@/app/sessao';
import { useLista, usePainelFiliacoes, usePainelGovernanca, useResumoPessoas, useRpc } from '@/dados/consultas';
import type { NumerosViagem, PainelCaptacao, Viagem } from '@/dados/tipos';
import { hojeSP } from '@/lib/datas';
import { pode } from '@/lib/acesso';
import { formatarBRL } from '@/lib/dinheiro';
import { contar } from '@/lib/texto';

export function useLinhasFase4() {
  const perfil = usePerfil();
  const pessoas = useResumoPessoas(pode(perfil, 'pessoas', 'ver'));
  const gov = usePainelGovernanca(pode(perfil, 'documentos', 'ver'));
  const fil = usePainelFiliacoes(pode(perfil, 'filiacoes', 'ver'));
  const p = pessoas.data, g = gov.data;
  const emRisco = (fil.data ?? []).flatMap((x) => x.verbas_em_risco ?? []);
  const vencidas = (fil.data ?? []).filter((x) => x.vencida).length;
  const linhas = [
    p && p.mensalidades_atrasadas > 0 && <Linha key="m" icone={Wallet} cor="vermelho" para="/pessoas" titulo={contar(p.mensalidades_atrasadas, 'mensalidade atrasada', 'mensalidades atrasadas')} descricao={formatarBRL(p.valor_atrasado)} />,
    p && p.documentos_vencendo.length > 0 && <Linha key="d" icone={IdCard} cor="laranja" para="/pessoas" titulo={contar(p.documentos_vencendo.length, 'documento de atleta vencendo', 'documentos de atletas vencendo')} descricao="Nos próximos 30 dias ou já vencidos." />,
    g && g.vencendo.length > 0 && <Linha key="g" icone={FileText} cor="laranja" para="/documentos/governanca" titulo={contar(g.vencendo.length, 'certidão ou documento vencendo', 'certidões ou documentos vencendo')} descricao="Da associação, nos próximos 45 dias ou já vencidos." />,
    vencidas > 0 && <Linha key="f" icone={BookUser} cor="vermelho" para="/filiacoes" titulo={contar(vencidas, 'filiação vencida', 'filiações vencidas')} />,
    emRisco.length > 0 && <Linha key="r" icone={AlertTriangle} cor="vermelho" para="/filiacoes" titulo={contar(emRisco.length, 'verba em risco', 'verbas em risco')} descricao="Dependem de filiação que não está em dia." />,
  ].filter((x) => !!x);
  return linhas;
}

export function useLinhasFase5() {
  const perfil = usePerfil();
  const cap = useRpc<PainelCaptacao>('painel_captacao', {}, pode(perfil, 'captacao', 'ver'));
  const via = useRpc<{ viagens: NumerosViagem[] }>('painel_viagens', {}, pode(perfil, 'viagens', 'ver'));
  const viagens = useLista<Viagem>('viagens', undefined, pode(perfil, 'viagens', 'ver'));
  const hoje = hojeSP();
  const acertos = (via.data?.viagens ?? []).filter((n) => Number(n.saldo_acerto) > 0
    && viagens.data?.some((v) => v.id === n.id && v.retorno < hoje && ['planejada', 'em_andamento'].includes(v.situacao)));
  const c = cap.data;
  const linhas = [
    c && c.passos_atrasados > 0 && <Linha key="p" icone={Megaphone} cor="laranja" para="/captacao" titulo={contar(c.passos_atrasados, 'contato de captação atrasado', 'contatos de captação atrasados')} />,
    c && c.contrapartidas_atrasadas > 0 && <Linha key="c" icone={Megaphone} cor="vermelho" para="/captacao?aba=contrapartidas" titulo={contar(c.contrapartidas_atrasadas, 'contrapartida atrasada', 'contrapartidas atrasadas')} descricao="Prometida ao patrocinador e ainda não entregue." />,
    acertos.length > 0 && <Linha key="v" icone={Plane} cor="vermelho" para="/viagens" titulo={contar(acertos.length, 'viagem com acerto pendente', 'viagens com acerto pendente')} descricao="Adiantamento ainda não devolvido nem gasto." />,
  ].filter((x) => !!x);
  return linhas;
}
