export const FASE_ATUAL = 7;
import {
  Bell, BookUser, Globe, Boxes, CalendarDays, FileText, HandCoins, House, KeyRound, Landmark,
  LayoutGrid, LineChart, ListChecks, Megaphone, PieChart, Plane, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { pode, type Acao, type Modulo, type Perfil } from './acesso';

export interface InfoModulo {
  id: string;
  nome: string;
  rota: string;
  icone: LucideIcon;
  fase: number;
  /** permissões que fazem o menu aparecer (basta UMA; o servidor confere de novo) */
  requer?: [Modulo, Acao][];
  resumo: string;
  itens: string[];
}

export const MODULOS: InfoModulo[] = [
  { id: 'inicio', nome: 'Início', rota: '/', icone: House, fase: 1, resumo: 'Saldo, contas a vencer, alertas e atalhos.',
    itens: ['Saldo total e por conta', 'Dinheiro livre e de projetos', 'Contas a vencer em 15 dias', 'Alertas do mês'] },
  { id: 'dinheiro', nome: 'Dinheiro', rota: '/dinheiro', icone: Wallet, fase: 1, requer: [['financeiro', 'ver']],
    resumo: 'Entradas e saídas com comprovante, contas, reembolsos e fechamento do mês.',
    itens: ['Lançamentos com comprovante', 'Contas a pagar e a receber', 'Reembolsos', 'Contas bancárias', 'Conciliação com o extrato (OFX/CSV)', 'Fechamento mensal'] },
  { id: 'analises', nome: 'Previsão e análises', rota: '/analises', icone: LineChart, fase: 6, requer: [['financeiro', 'ver']],
    resumo: 'Previsão de caixa, cenários "e se", saúde das receitas, qualidade dos dados e custos.',
    itens: ['Previsão de 3, 6 e 12 meses', 'Simulador de cenários', 'Concentração das receitas', 'Gastos fora do padrão e duplicidades', 'Custo por atleta, treino e viagem', 'Relatório mensal em PDF'] },
  { id: 'transparencia', nome: 'Transparência', rota: '/transparencia/gestao', icone: Globe, fase: 7, requer: [['financeiro', 'ver']],
    resumo: 'Prestação de contas pública: a diretoria confere a prévia e publica só números agregados.',
    itens: ['Prévia por período', 'Publicar e retirar do ar', 'Página pública sem login', 'PDF para assembleia e patrocinadores'] },
  { id: 'verbas', nome: 'Verbas previstas', rota: '/verbas', icone: HandCoins, fase: 3, requer: [['verbas', 'ver']],
    resumo: 'Todo dinheiro ou apoio que a Associação Exemplo espera receber, com as regras de cada um.',
    itens: ['O que é e de quem vem', 'Como chega, quanto e quando', 'Situação de cada pedido', 'Regras de uso e prestação de contas'] },
  { id: 'projetos', nome: 'Projetos', rota: '/projetos', icone: Landmark, fase: 3, requer: [['projetos', 'ver']],
    resumo: 'Verbas formalizadas com orçamento por rubrica e prestação de contas.',
    itens: ['Orçamento por rubrica', 'Ritmo de execução', 'Relatórios de prestação de contas', 'Guarda de documentos'] },
  { id: 'captacao', nome: 'Captação', rota: '/captacao', icone: Megaphone, fase: 5, requer: [['captacao', 'ver']],
    resumo: 'Patrocinadores, doadores, contrapartidas, rifas e eventos.',
    itens: ['Funil de patrocínio e apoiadores', 'Contrapartidas com foto', 'Campanha do Imposto de Renda', 'Rifas, eventos e recibos numerados'] },
  { id: 'agenda', nome: 'Agenda', rota: '/agenda', icone: CalendarDays, fase: 2, requer: [['agenda', 'ver']],
    resumo: 'Treinos, jogos, viagens, reuniões e prazos, ligados ao financeiro.',
    itens: ['Visões por mês, semana e lista', 'Prazos automáticos', 'Exportar para o Google Agenda', 'Lista de presença dos atletas'] },
  { id: 'tarefas', nome: 'Tarefas', rota: '/tarefas', icone: ListChecks, fase: 2, requer: [['tarefas', 'ver']],
    resumo: 'Quadro com responsável, prazo e checklist.',
    itens: ['Quadro A fazer, Fazendo e Feito', 'Tarefas recorrentes', 'Modelos por tipo de evento'] },
  { id: 'viagens', nome: 'Viagens', rota: '/viagens', icone: Plane, fase: 5, requer: [['viagens', 'ver']],
    resumo: 'Orçamento, delegação, despesas na estrada e acerto final.',
    itens: ['Delegação e acessibilidade', 'Adiantamento e acerto', 'Custo por atleta e por km', 'Ligação com a verba'] },
  { id: 'pessoas', nome: 'Pessoas', rota: '/pessoas', icone: Users, fase: 4, requer: [['pessoas', 'ver']],
    resumo: 'Associados e atletas, mensalidades e documentos com validade.',
    itens: ['Cadastro com o mínimo necessário', 'Mensalidades por Pix', 'Documentos com validade', 'Dados de saúde em área separada'] },
  { id: 'patrimonio', nome: 'Patrimônio', rota: '/patrimonio', icone: Boxes, fase: 4, requer: [['patrimonio', 'ver']],
    resumo: 'Cadeiras de jogo, materiais, empréstimos e manutenção.',
    itens: ['Número de patrimônio', 'Origem do bem', 'Empréstimo com termo', 'Manutenção programada'] },
  { id: 'filiacoes', nome: 'Filiações', rota: '/filiacoes', icone: BookUser, fase: 4, requer: [['filiacoes', 'ver']],
    resumo: 'Filiações e vínculos: situação, validade, contribuição e documentos.',
    itens: ['Entidade, tipo e categoria', 'Validade e renovação', 'Documentos exigidos', 'Verbas que dependem dela'] },
  { id: 'documentos', nome: 'Documentos', rota: '/documentos', icone: FileText, fase: 1, requer: [['contador', 'ver'], ['documentos', 'ver']],
    resumo: 'Arquivos do contador; estatuto, certidões, mandatos, reuniões e atas.',
    itens: ['Arquivos do contador por mês', 'Certidões com validade', 'Mandatos da diretoria', 'Reuniões, votações e ata'] },
  { id: 'relatorios', nome: 'Relatórios', rota: '/relatorios', icone: PieChart, fase: 1, requer: [['financeiro', 'exportar']],
    resumo: 'Exportação em PDF e CSV; previsão de caixa e cenários chegam na Fase 6.',
    itens: ['Lançamentos do período em PDF e CSV', 'Previsão de caixa (Fase 6)', 'Simulador de cenários (Fase 6)'] },
  { id: 'avisos', nome: 'Avisos', rota: '/avisos', icone: Bell, fase: 2, requer: [['avisos', 'ver']],
    resumo: 'Mural da diretoria com confirmação de leitura e resumo semanal.',
    itens: ['Mural com confirmação de leitura'] },
  { id: 'acessos', nome: 'Acessos', rota: '/acessos', icone: KeyRound, fase: 1, requer: [['acessos', 'administrar']],
    resumo: 'Convites, níveis de acesso e trilha de auditoria.',
    itens: ['Convidar diretores', 'Perfis e ajuste fino', 'Acesso com prazo', 'Trilha de auditoria'] },
];

export function podeVerModulo(perfil: Perfil | null | undefined, m: InfoModulo): boolean {
  return !m.requer || m.requer.some(([mod, acao]) => pode(perfil, mod, acao));
}

export function moduloPorRota(caminho: string): InfoModulo | undefined {
  if (caminho === '/' || caminho === '') return MODULOS[0];
  return MODULOS.filter((m) => m.rota !== '/').find((m) => caminho === m.rota || caminho.startsWith(m.rota + '/'));
}

export interface GrupoMenu { id: string; nome: string; rota: string; icone: LucideIcon; resumo: string; modulos: string[] }
export const GRUPOS: GrupoMenu[] = [
  { id: 'inicio', nome: 'Início', rota: '/', icone: House, resumo: 'Saldo, pendências e avisos.', modulos: ['inicio', 'avisos'] },
  { id: 'dinheiro', nome: 'Dinheiro', rota: '/dinheiro', icone: Wallet, resumo: 'Lançamentos, extrato, fechamento e relatórios.', modulos: ['dinheiro', 'analises', 'relatorios', 'transparencia'] },
  { id: 'recursos', nome: 'Recursos', rota: '/recursos', icone: HandCoins, resumo: 'De onde vem o dinheiro e como ele é usado.', modulos: ['verbas', 'projetos', 'captacao', 'filiacoes'] },
  { id: 'equipe', nome: 'Equipe', rota: '/equipe', icone: Users, resumo: 'Atletas, associados, viagens e materiais.', modulos: ['pessoas', 'viagens', 'patrimonio'] },
  { id: 'organizacao', nome: 'Organização', rota: '/organizacao', icone: LayoutGrid, resumo: 'Agenda, tarefas, documentos e acessos.', modulos: ['agenda', 'tarefas', 'documentos', 'acessos'] },
];

export function grupoPorRota(caminho: string): GrupoMenu {
  const g = GRUPOS.find((x) => x.rota !== '/' && (caminho === x.rota || caminho.startsWith(x.rota + '/')));
  if (g) return g;
  const m = moduloPorRota(caminho);
  if (m && (caminho !== '/' || m.id === 'inicio')) return GRUPOS.find((x) => x.modulos.includes(m.id)) ?? GRUPOS[4]!;
  return caminho === '/' ? GRUPOS[0]! : GRUPOS[4]!;
}
