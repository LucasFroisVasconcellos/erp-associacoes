import type {
  ArquivoContador, Aviso, Categoria, ComentarioTarefa, Comprovante, Conta, Contraparte, Convite, ModeloPermissao, PedidoAcesso, FiltroLancamentos, ItemAuditoria,
  ItemTarefa, Lancamento, LeituraAviso, Membro, ModeloTarefas, Notificacao, Permissao, PreferenciasEmail, Recorrencia, Reembolso,
  SessaoInfo, Tarefa, TarefaRecorrente, TipoEvento, TipoGasto,
  DocumentoVerba, OrigemVerba, ParcelaVerba, ProjetoSimples, RubricaSimples, TipoVerba, Verba,
  Bem, CategoriaSocio, SalarioMinimo, ParcelaUnica, ConfigPix, Consentimento, Deliberacao, DocumentoFiliacao, DocumentoInstitucional, DocumentoPessoa, DocumentoSaude,
  Emprestimo, Filiacao, Manutencao, Mandato, Mensalidade, Pessoa, Presenca, PresencaEvento, Reuniao, SaudePessoa, TipoFiliacao,
} from './tipos';

/** Buckets privados; o link assinado dura 60 s e a política do banco confere a permissão. */
export type BucketArquivo = 'comprovantes' | 'contador' | 'pessoas' | 'saude' | 'institucional' | 'captacao';

/** Tabelas lidas por um método genérico (a RLS decide as linhas). Lista fechada. */
export const TABELAS_LEITURA = ['oportunidades', 'oportunidade_interacoes', 'contrapartidas', 'acoes_captacao', 'acao_vendedores', 'recibos',
  'viagens', 'viagem_delegacao', 'viagem_lancamentos', 'configuracoes', 'plano_contas', 'transparencia_publicacoes'] as const;
export type TabelaLeitura = (typeof TABELAS_LEITURA)[number];
export interface OpcoesLista { onde?: Record<string, string>; ordem?: string; desc?: boolean; limite?: number }

export type EventoSessao = 'entrou' | 'saiu' | 'atualizou';

export interface Fonte {
  readonly demo: boolean;
  readonly captcha: string | null;
  sessao(): Promise<SessaoInfo | null>;
  aoMudarSessao(cb: (e: EventoSessao) => void): () => void;
  entrar(email: string, senha: string, captcha?: string, manter?: boolean): Promise<void>;
  lembrado(): boolean;
  sair(todos?: boolean): Promise<void>;
  pedirRecuperacao(email: string, redirectTo: string, captcha?: string): Promise<void>;
  confirmarLink(tokenHash: string, tipo: 'invite' | 'recovery'): Promise<void>;
  sessaoDoLink(acesso: string, renovacao: string): Promise<void>;
  definirSenha(senha: string): Promise<void>;
  fatores(): Promise<{ id: string; status: 'verified' | 'unverified' }[]>;
  cadastrarFator(): Promise<{ id: string; qr: string; segredo: string }>;
  confirmarCodigo(fatorId: string, codigo: string): Promise<void>;
  rpc<T = Record<string, unknown>>(nome: string, args?: Record<string, unknown>, opcoes?: { tempoLimiteMs?: number }): Promise<T>;
  convidar(dados: { email: string; nome: string; cargo: string; permissoes: Permissao[] }): Promise<{ ja_tem_login?: boolean }>;
  enviarArquivo(form: FormData): Promise<{ id: string; duplicado?: boolean }>;
  urlArquivo(bucket: BucketArquivo, caminho: string): Promise<string>;
  contas(): Promise<Conta[]>;
  categorias(): Promise<Categoria[]>;
  tiposGasto(): Promise<TipoGasto[]>;
  contrapartes(): Promise<Contraparte[]>;
  recorrencias(): Promise<Recorrencia[]>;
  lancamentos(f: FiltroLancamentos): Promise<Lancamento[]>;
  lancamento(id: string): Promise<Lancamento | null>;
  comprovantes(lancamentoId: string): Promise<Comprovante[]>;
  reembolsos(): Promise<Reembolso[]>;
  membros(): Promise<Membro[]>;
  permissoesDe(membroId: string): Promise<Permissao[]>;
  convites(): Promise<Convite[]>;
  pedidosAcesso(): Promise<PedidoAcesso[]>;
  modelosPermissao(): Promise<ModeloPermissao[]>;
  pedirAcesso(dados: { nome: string; email: string; captcha: string }): Promise<void>;
  auditoria(antesDe?: number): Promise<ItemAuditoria[]>;
  arquivosContador(): Promise<ArquivoContador[]>;
  notificacoes(): Promise<Notificacao[]>;
  fechamentos(): Promise<{ competencia: string; fechado_em: string }[]>;
  tiposEvento(): Promise<TipoEvento[]>;
  tarefas(): Promise<Tarefa[]>;
  tarefa(id: string): Promise<Tarefa | null>;
  itensTarefa(id: string): Promise<ItemTarefa[]>;
  comentariosTarefa(id: string): Promise<ComentarioTarefa[]>;
  tarefasRecorrentes(): Promise<TarefaRecorrente[]>;
  modelosTarefas(): Promise<ModeloTarefas[]>;
  avisos(): Promise<Aviso[]>;
  leiturasAviso(id: string): Promise<LeituraAviso[]>;
  preferenciasEmail(): Promise<PreferenciasEmail>;
  tiposVerba(): Promise<TipoVerba[]>;
  origensVerba(): Promise<OrigemVerba[]>;
  verbas(): Promise<Verba[]>;
  parcelasVerba(id: string): Promise<ParcelaVerba[]>;
  documentosVerba(id: string): Promise<DocumentoVerba[]>;
  projetos(): Promise<ProjetoSimples[]>;
  rubricas(): Promise<RubricaSimples[]>;
  // Saúde: a RLS só entrega a quem tem o módulo "saude".
  configPix(): Promise<ConfigPix | null>;
  categoriasSocio(): Promise<CategoriaSocio[]>;
  salariosMinimos(): Promise<SalarioMinimo[]>;
  parcelasUnicas(pessoaId: string): Promise<ParcelaUnica[]>;
  pessoas(): Promise<Pessoa[]>;
  mensalidades(pessoaId?: string): Promise<Mensalidade[]>;
  documentosPessoa(pessoaId: string): Promise<DocumentoPessoa[]>;
  consentimentos(pessoaId: string): Promise<Consentimento[]>;
  saude(pessoaId: string): Promise<SaudePessoa | null>;
  documentosSaude(pessoaId: string): Promise<DocumentoSaude[]>;
  bens(): Promise<Bem[]>;
  emprestimos(): Promise<Emprestimo[]>;
  manutencoes(bemId: string): Promise<Manutencao[]>;
  documentosInstitucionais(): Promise<DocumentoInstitucional[]>;
  mandatos(): Promise<Mandato[]>;
  reunioes(): Promise<Reuniao[]>;
  presencas(reuniaoId: string): Promise<Presenca[]>;
  deliberacoes(reuniaoId: string): Promise<Deliberacao[]>;
  tiposFiliacao(): Promise<TipoFiliacao[]>;
  filiacoes(): Promise<Filiacao[]>;
  documentosFiliacao(filiacaoId: string): Promise<DocumentoFiliacao[]>;
  presencasEvento(eventoId: string): Promise<PresencaEvento[]>;
  lista<T>(tabela: TabelaLeitura, opcoes?: OpcoesLista): Promise<T[]>;
}

let atual: Fonte | null = null;
export function definirFonte(f: Fonte) { atual = f; }
export function fonte(): Fonte {
  if (!atual) throw new Error('fonte de dados não iniciada');
  return atual;
}
