import type { Cargo, Perfil, Permissao } from '@/lib/acesso';

export type { Perfil, Permissao };
export type TipoConta = 'movimento' | 'projeto' | 'aplicacao' | 'caixinha';
export type TipoLancamento = 'entrada' | 'saida';
export type Situacao = 'prevista' | 'realizada' | 'cancelada';
export type FormaPagamento = 'pix' | 'dinheiro' | 'cartao_debito' | 'cartao_credito' | 'boleto' | 'transferencia' | 'debito_automatico' | 'outro';
export type OrigemComprovante = 'camera' | 'galeria' | 'pdf' | 'scanner' | 'colado' | 'arrastado' | 'qrcode' | 'codigo_barras' | 'xml' | 'outro';

export interface Conta {
  id: string; nome: string; banco: string | null; agencia: string | null; numero: string | null;
  tipo: TipoConta; saldo_inicial: string; data_saldo_inicial: string; ativa: boolean;
  projeto_id?: string | null;
}
export interface Categoria { id: string; nome: string; tipo: TipoLancamento; ativa: boolean; conta_contabil_id?: string | null }
export type Natureza = 'ativo' | 'passivo' | 'patrimonio' | 'receita' | 'despesa' | 'outra';
export interface ContaContabil { id: string; codigo: string; nome: string; natureza: Natureza; ativa: boolean }
export interface ComparacaoContador {
  competencia: string; balancete: { arquivo: string; importado_em: string } | null;
  contas: { codigo: string; nome: string; natureza: Natureza; sistema: string | null; contador: string | null; diferenca: string }[];
  categorias_sem_conta: { id: string; nome: string; tipo: TipoLancamento }[];
}
export interface CampoGuiado { chave: string; rotulo: string; tipo: 'texto' | 'numero' | 'inteiro' | 'data'; obrigatorio: boolean }
export interface TipoGasto { id: string; nome: string; campos: CampoGuiado[]; ativo: boolean; modelo: string | null }
export interface Contraparte { id: string; nome: string; tipo: 'fornecedor' | 'pagador' | 'ambos'; documento: string | null; ativa: boolean }
export interface Recorrencia {
  id: string; tipo: TipoLancamento; descricao: string; valor: string; categoria_id: string | null; conta_id: string | null;
  dia: number; inicio: string; fim: string | null; ativa: boolean;
}

export interface Lancamento {
  id: string; tipo: TipoLancamento; situacao: Situacao; valor: string; data: string; vencimento: string | null;
  data_documento: string | null; descricao: string; categoria_id: string | null; conta_id: string | null;
  forma_pagamento: FormaPagamento | null; contraparte_id: string | null; tipo_gasto_id: string | null; projeto_id?: string | null;
  detalhes: Record<string, string>; recorrencia_id: string | null; estorno_de: string | null; motivo: string | null;
  sem_comprovante_motivo: string | null; criado_por: string; criado_em: string;
  categoria?: string | null; conta?: string | null; autor?: string | null; comprovantes?: number; estornado?: boolean;
}

export interface Comprovante {
  id: string; lancamento_id: string; caminho: string; mime: string; tamanho: number; origem: OrigemComprovante;
  chave_acesso: string | null; codigo_barras: string | null; enviado_em: string;
}

export interface Reembolso {
  lancamento_id: string; solicitante: string; situacao: 'solicitado' | 'pago' | 'negado'; motivo: string | null;
  criado_em: string; lancamento?: Lancamento; nome_solicitante?: string;
}

export interface ItemPainel { id: string; descricao: string; valor: string; data: string; tipo: TipoLancamento }
export interface Painel {
  hoje: string;
  saldo_total: string | null; saldo_livre: string | null; saldo_projetos: string | null;
  contas: { id: string; nome: string; tipo: TipoConta; saldo: string }[];
  a_pagar: ItemPainel[]; a_receber: ItemPainel[];
  mes: { entradas: string; saidas: string };
  alertas: { sem_comprovante: number; vencidas: number; reembolsos_pendentes: number; mes_anterior_aberto: boolean };
}

export interface ItemChecklist { chave: string; titulo: string; pendentes: number | null; bloqueia: boolean; manual?: boolean }
export interface Checklist { competencia: string; ja_fechado: boolean; mes_encerrado: boolean; pode_fechar: boolean; itens: ItemChecklist[] }

export interface Membro { id: string; nome: string; email: string; cargo: Cargo; ativo: boolean; acesso_expira_em: string | null }
export interface ModeloPermissao { id: string; nome: string; cargo: Cargo | null; permissoes: Permissao[]; atualizado_em: string }
export interface PedidoAcesso { id: string; nome: string; email: string; criado_em: string }
export interface Convite { id: string; email: string; nome: string; cargo: Cargo; criado_em: string; expira_em: string; usado_em: string | null; cancelado_em: string | null }
export interface ItemAuditoria {
  id: number; em: string; membro_id: string | null; acao: string; tabela: string | null; registro_id: string | null;
  antes: unknown; depois: unknown; autor?: string | null;
}
export interface ArquivoContador {
  id: string; competencia: string; tipo: string; descricao: string | null; nome_original: string; caminho: string;
  mime: string; tamanho: number; enviado_em: string;
}
export interface Notificacao { id: string; texto: string; criada_em: string; lida_em: string | null }

export interface FiltroLancamentos {
  situacao?: Situacao | 'todas'; tipo?: TipoLancamento; inicio?: string; fim?: string; busca?: string;
  limite?: number; antesDe?: { data: string; criado_em: string };
}

export interface LinhaRelatorio {
  id: string; data: string; tipo: TipoLancamento; situacao: Situacao; valor: string; descricao: string;
  categoria: string | null; conta: string | null; forma_pagamento: string | null; contraparte: string | null;
  estorno_de: string | null; tem_comprovante: boolean; sem_comprovante_motivo: string | null; criado_por: string | null;
}

export interface SessaoInfo { usuarioId: string; email: string; aal: 'aal1' | 'aal2'; proximoAal: 'aal1' | 'aal2' }

export type CorEvento = 'azul' | 'verde' | 'laranja' | 'roxo' | 'vermelho' | 'teal' | 'indigo' | 'cinza';
export type IconeEvento = 'treino' | 'jogo' | 'trofeu' | 'viagem' | 'reuniao' | 'assembleia' | 'captacao' | 'prazo' | 'projeto' | 'outro';
export interface TipoEvento { id: string; nome: string; cor: CorEvento; icone: IconeEvento; ativo: boolean }
export interface Evento {
  id: string; tipo_id: string; titulo: string; inicio: string; fim: string; dia_inteiro: boolean;
  local: string | null; descricao: string | null; projeto_id: string | null; criado_por: string;
  cancelado_em: string | null; motivo_cancelamento: string | null; participantes: string[];
}
export interface PrazoAgenda { tipo: 'a_pagar' | 'a_receber' | 'fechamento' | 'tarefa' | 'verba' | 'projeto' | 'documento' | 'governanca' | 'reuniao' | 'filiacao' | 'patrimonio' | 'captacao' | 'contrapartida' | 'viagem'; titulo: string; data: string; ref: string; responsavel?: string }
export interface AgendaPeriodo { eventos: Evento[]; prazos: PrazoAgenda[] }

export type SituacaoTarefa = 'a_fazer' | 'fazendo' | 'feito' | 'cancelada';
export type Prioridade = 'baixa' | 'normal' | 'alta';
export interface Tarefa {
  id: string; titulo: string; descricao: string | null; responsavel: string; prazo: string | null; prioridade: Prioridade;
  situacao: SituacaoTarefa; evento_id: string | null; recorrencia_id: string | null; modelo_id: string | null;
  lembrete_dias: number; criado_por: string; criado_em: string; concluida_em: string | null;
  itens_total?: number; itens_feitos?: number;
}
export interface ItemTarefa { id: string; tarefa_id: string; ordem: number; texto: string; feito: boolean; feito_por: string | null; feito_em: string | null }
export interface ComentarioTarefa { id: string; tarefa_id: string; autor: string; texto: string; criado_em: string }
export interface TarefaRecorrente {
  id: string; titulo: string; descricao: string | null; responsavel: string; frequencia: 'mensal' | 'semanal'; dia: number;
  inicio: string; fim: string | null; lembrete_dias: number; ativa: boolean;
}
export interface ModeloTarefas { id: string; nome: string; tipo_evento_id: string | null; itens: { titulo: string; dias_antes: number }[]; ativo: boolean }
export interface Aviso {
  id: string; titulo: string; texto: string; autor: string; publicado_em: string; expira_em: string | null; arquivado_em: string | null;
  lido?: boolean;
}
export interface LeituraAviso { aviso_id: string; membro_id: string; lido_em: string }
export interface ResumoOrganizacao {
  minhas_tarefas: { id: string; titulo: string; prazo: string | null; situacao: SituacaoTarefa; prioridade: Prioridade; atrasada: boolean | null }[];
  tarefas_atrasadas: number;
  proximos_eventos: { id: string; titulo: string; inicio: string; dia_inteiro: boolean; tipo_id: string; local: string | null }[];
  avisos_nao_lidos: number;
}
export interface PreferenciasEmail { lembretes: boolean; resumo_semanal: boolean }

export interface Regras {
  conta_especifica: boolean; exige_rubricas: boolean; exige_transferencia: boolean; aceita_dinheiro: boolean; permite_reembolso: boolean;
  prestacao_parcial: boolean; prazo_prestacao_dias: number; guarda_anos: number;
  contrapartidas: string[]; documentos_antes: string[]; documentos_depois: string[];
}
export type SituacaoVerba = 'ideia' | 'pedido_enviado' | 'em_analise' | 'aprovado' | 'formalizado' | 'recebido_parcial' | 'recebido'
  | 'em_execucao' | 'prestacao_contas' | 'encerrado' | 'negado' | 'cancelado';
export type FormaRecebimento = 'caixa_livre' | 'conta_especifica' | 'pago_pela_origem' | 'bens';
export type CategoriaOrigem = 'orgao_publico' | 'parlamentar' | 'entidade' | 'empresa' | 'pessoa_fisica' | 'outra';
export interface TipoVerba { id: string; nome: string; regras: Partial<Regras>; ativo: boolean }
export interface OrigemVerba { id: string; nome: string; categoria: CategoriaOrigem; contato: string | null; ativa: boolean }
export interface Verba {
  id: string; titulo: string; tipo_id: string; origem_id: string; descricao: string | null; forma_recebimento: FormaRecebimento;
  valor_pedido: string | null; valor_aprovado: string | null; situacao: SituacaoVerba; regras: Partial<Regras>;
  prazo_pedido: string | null; responsavel: string | null; criado_por: string; criado_em: string;
  filiacao_id?: string | null;
}
export interface ParcelaVerba {
  id: string; verba_id: string; numero: number; valor: string; data_prevista: string; recebido_em: string | null;
  valor_recebido: string | null; lancamento_id: string | null;
}
export interface DocumentoVerba { id: string; verba_id: string; momento: 'antes' | 'depois'; nome: string; entregue_em: string | null; entregue_por: string | null }
export type SituacaoProjeto = 'planejamento' | 'em_execucao' | 'prestacao_contas' | 'encerrado' | 'cancelado';
export type AlertaRubrica = 'estourada' | 'perto_do_limite' | 'adiantada' | 'atrasada' | null;
export interface RubricaExecucao { id: string; nome: string; previsto: string; realizado: string; pct: number | null; ativa: boolean; alerta: AlertaRubrica }
export type RegraPendencia = 'sem_rubrica' | 'sem_comprovante' | 'forma_dinheiro' | 'sem_transferencia' | 'reembolso' | 'fora_da_conta' | 'fora_da_vigencia';
export interface Pendencia {
  lancamento_id: string; regra: RegraPendencia; justificada: boolean; motivo: string | null;
  descricao: string; data: string; valor: string; forma_pagamento: string | null;
}
export interface ProjetoPainel {
  id: string; nome: string; ativo: boolean; verba_id: string | null; fonte: string | null; descricao: string | null;
  vigencia_inicio: string | null; vigencia_fim: string | null; valor_aprovado: string | null; valor_contrapartida: string;
  regras: Regras; responsavel: string | null; prazo_prestacao: string | null; prazo_prestacao_parcial: string | null; situacao: SituacaoProjeto;
  contas: { id: string; nome: string }[];
  gasto: string; entrou: string; recebido_verba: string; orcamento: string | null; saldo: string;
  pct_tempo: number | null; pct_gasto: number | null; rubricas: RubricaExecucao[];
  pendencias: { abertas: number; justificadas: number; itens: Pendencia[] | null };
}
export interface LancamentoProjeto { id: string; tipo: TipoLancamento; data: string; valor: string; descricao: string; forma_pagamento: string | null; rubrica_id: string | null; tem_comprovante: boolean }
export interface DetalheProjeto {
  projeto: ProjetoPainel; lancamentos: LancamentoProjeto[] | null;
  parcelas: { numero: number; valor: string; data_prevista: string; recebido_em: string | null; valor_recebido: string | null }[];
}
export interface DadosPrestacao {
  gerado_em: string; projeto: ProjetoPainel;
  verba: { titulo: string; origem: string; tipo: string; documentos: { momento: string; nome: string; entregue: boolean }[] } | null;
  pagamentos: { data: string; tipo: TipoLancamento; valor: string; descricao: string; favorecido: string | null; documento: string | null;
    forma_pagamento: string | null; conta: string | null; rubrica: string | null; comprovante: boolean; sem_comprovante_motivo: string | null }[];
  atividades: { titulo: string; inicio: string; fim: string; dia_inteiro: boolean; local: string | null; tipo: string; presentes?: number }[];
  bens?: { numero: string; nome: string; valor: string | null; data_aquisicao: string | null; situacao: SituacaoBem }[];
}
export interface ProjetoSimples { id: string; nome: string; ativo: boolean; verba_id: string | null }
export interface RubricaSimples { id: string; projeto_id: string; nome: string; ativa: boolean }

export interface ConfigPix { chave: string; nome: string; cidade: string }
/** percentual_salario_minimo preenchido: a mensalidade é essa % do salário mínimo (valor_mensalidade fica 0). */
export interface CategoriaSocio { id: string; nome: string; valor_mensalidade: string; percentual_salario_minimo: string | null; percentual_parcela_unica: string | null; dia_vencimento: number; ativa: boolean }
export interface ParcelaUnica { id: string; pessoa_id: string; ano: number; valor: string; pago_em: string; lancamento_id: string }
export interface SalarioMinimo { vigente_desde: string; valor: string }
export type SituacaoPessoa = 'ativo' | 'inativo' | 'desligado';
export interface Pessoa {
  id: string; nome: string; atleta: boolean; associado: boolean; categoria_id: string | null; situacao: SituacaoPessoa;
  data_nascimento: string | null; email: string | null; telefone: string | null;
  responsavel_nome: string | null; responsavel_contato: string | null; responsavel_parentesco: string | null;
  observacao: string | null; desligado_em: string | null; criado_em: string;
  foto_caminho: string | null; apelido: string | null; numero_camisa: number | null; posicao: string | null; tamanho_uniforme: string | null;
  registro_federacao: string | null; na_associacao_desde: string | null; emergencia_nome: string | null; emergencia_telefone: string | null;
}
export type SituacaoMensalidade = 'aberta' | 'paga' | 'dispensada' | 'cancelada';
export interface Mensalidade {
  id: string; pessoa_id: string; competencia: string; valor: string; vencimento: string; situacao: SituacaoMensalidade;
  txid: string; lancamento_id: string | null; pago_em: string | null; motivo: string | null;
}
export type TipoDocumentoPessoa = 'registro_federacao' | 'autorizacao_imagem' | 'termo_equipamento' | 'outro';
export interface DocumentoPessoa {
  id: string; pessoa_id: string; tipo: TipoDocumentoPessoa; descricao: string | null; validade: string | null; entregue_em: string | null;
  arquivo_caminho: string | null; arquivo_mime: string | null; arquivado_em: string | null;
}
export type FinalidadeConsentimento = 'saude' | 'imagem';
export interface Consentimento {
  id: string; pessoa_id: string; finalidade: FinalidadeConsentimento; base_legal: 'consentimento' | 'exigencia_esportiva';
  concedido_por: 'titular' | 'responsavel'; nome_concedente: string; concedido_em: string; revogado_em: string | null;
}
export interface SaudePessoa { pessoa_id: string; deficiencia: string | null; classe_funcional: string | null; observacoes: string | null; atualizado_em: string }
export type TipoDocumentoSaude = 'atestado_medico' | 'laudo' | 'classificacao_funcional' | 'outro';
export interface DocumentoSaude {
  id: string; pessoa_id: string; tipo: TipoDocumentoSaude; emitido_em: string | null; validade: string | null;
  arquivo_caminho: string | null; arquivo_mime: string | null;
}
export interface ResumoPessoas {
  ativos: number; atletas: number; associados: number; menores_sem_responsavel: number;
  mensalidades_atrasadas: number; valor_atrasado: string;
  documentos_vencendo: { id: string; pessoa_id: string; pessoa: string; tipo: TipoDocumentoPessoa; validade: string }[];
  saude_vencendo: number | null;
}

export type CategoriaBem = 'cadeira_jogo' | 'bola' | 'uniforme' | 'equipamento_treino' | 'informatica' | 'outro';
export type OrigemBem = 'compra' | 'doacao' | 'projeto' | 'outro';
export type SituacaoBem = 'disponivel' | 'emprestado' | 'manutencao' | 'baixado';
export interface Bem {
  id: string; numero: string; nome: string; categoria: CategoriaBem; origem: OrigemBem; projeto_id: string | null; lancamento_id: string | null;
  valor: string | null; data_aquisicao: string | null; situacao: SituacaoBem; baixa_motivo: string | null; observacao: string | null; criado_em: string;
}
export interface Emprestimo {
  id: string; bem_id: string; pessoa_id: string; inicio: string; previsao_devolucao: string | null; devolvido_em: string | null;
  termo_versao: string; termo_aceito_por: string; termo_aceito_em: string; observacao: string | null;
}
export interface Manutencao { id: string; bem_id: string; data: string; descricao: string; custo: string | null; proxima_em: string | null }

export type TipoDocumentoInstitucional = 'estatuto' | 'regimento' | 'ata_registrada' | 'cnpj' | 'procuracao' | 'certidao_federal' | 'certidao_estadual'
  | 'certidao_municipal' | 'certidao_fgts' | 'certidao_trabalhista' | 'alvara' | 'outro';
export interface DocumentoInstitucional {
  id: string; tipo: TipoDocumentoInstitucional; titulo: string; emitido_em: string | null; validade: string | null; observacao: string | null;
  arquivo_caminho: string | null; arquivo_mime: string | null; arquivado_em: string | null;
}
export type OrgaoMandato = 'diretoria' | 'conselho_fiscal' | 'outro';
export interface Mandato { id: string; nome: string; membro_id: string | null; cargo: string; orgao: OrgaoMandato; inicio: string; fim: string }
export type TipoReuniao = 'diretoria' | 'assembleia_ordinaria' | 'assembleia_extraordinaria' | 'conselho_fiscal';
export interface Reuniao {
  id: string; tipo: TipoReuniao; titulo: string; data: string; local: string | null; pauta: string; quorum_minimo: number | null;
  situacao: 'convocada' | 'realizada' | 'cancelada'; ata: string | null; ata_aprovada_em: string | null;
}
export interface Presenca { reuniao_id: string; nome: string; membro_id: string | null }
export interface Deliberacao {
  id: string; reuniao_id: string; ordem: number; texto: string; votos_favor: number; votos_contra: number; abstencoes: number;
  resultado: 'aprovada' | 'rejeitada' | 'retirada';
}
export interface PainelGovernanca {
  vencendo: { id: string; titulo: string; tipo: TipoDocumentoInstitucional; validade: string }[];
  mandatos_acabando: { id: string; nome: string; cargo: string; fim: string }[];
  proximas_reunioes: number; atas_pendentes: number;
}

export interface TipoFiliacao { id: string; nome: string; ativo: boolean }
export type SituacaoFiliacao = 'preparacao' | 'ativa' | 'pendente' | 'suspensa' | 'encerrada';
export type Periodicidade = 'mensal' | 'anual' | 'outra';
export interface Filiacao {
  id: string; entidade: string; tipo_id: string; categoria: string | null; situacao: SituacaoFiliacao;
  inicio: string | null; validade: string | null; renovacao: string | null;
  contribuicao_valor: string | null; contribuicao_periodicidade: Periodicidade | null; recorrencia_id: string | null;
  beneficios: string | null; obrigacoes: string | null; responsavel: string | null; criado_por: string;
}
export interface DocumentoFiliacao { id: string; filiacao_id: string; nome: string; documento_institucional_id: string | null; entregue_em: string | null }
export interface SituacaoPainelFiliacao {
  id: string; vencida: boolean; vence_em_breve: boolean; documentos_pendentes: number;
  verbas_em_risco: { id: string; titulo: string }[] | null;
}

export interface PresencaEvento { evento_id: string; pessoa_id: string; presente: boolean; justificativa: string | null }
export interface FrequenciaAtleta { pessoa_id: string; presentes: number; marcados: number }

export interface LinhaExtrato {
  id: string; data: string; valor: string; descricao: string; lancamento_id: string | null; ignorada_motivo: string | null;
  sugestoes: { id: string; data: string; descricao: string }[] | null;
}
export interface PainelConciliacao {
  linhas: LinhaExtrato[];
  sem_extrato: { id: string; data: string; tipo: TipoLancamento; valor: string; descricao: string }[];
}
export type TipoOportunidade = 'patrocinio' | 'doacao' | 'incentivo_ir' | 'edital' | 'outro';
export type EtapaFunil = 'prospeccao' | 'contato' | 'proposta' | 'fechado' | 'renovacao' | 'perdido';
export interface Oportunidade {
  id: string; tipo: TipoOportunidade; nome: string; contato: string | null; etapa: EtapaFunil; valor_estimado: string | null;
  proximo_passo: string | null; proximo_passo_em: string | null; verba_id: string | null; responsavel: string | null; criado_por: string; atualizado_em: string;
}
export interface Interacao { id: string; oportunidade_id: string; data: string; texto: string; autor: string; criado_em: string }
export interface Contrapartida {
  id: string; verba_id: string; descricao: string; prazo: string | null; entregue_em: string | null; observacao: string | null;
  arquivo_caminho: string | null; arquivo_mime: string | null; criado_por: string;
}
export interface AcaoCaptacao {
  id: string; tipo: 'rifa' | 'evento'; nome: string; data: string; preco_unitario: string | null; quantidade: number | null; custo: string;
  situacao: 'planejada' | 'em_andamento' | 'encerrada' | 'cancelada'; autorizacao: string | null; evento_id: string | null; criado_por: string;
}
export interface Vendedor { id: string; acao_id: string; nome: string; membro_id: string | null; bilhetes: number; vendidos: number; valor_prestado: string; lancamento_id: string | null }
export interface Recibo {
  id: string; ano: number; numero: number; doador_nome: string; doador_documento: string | null; valor: string; data: string;
  forma: 'dinheiro' | 'bens' | 'servicos'; descricao: string | null; lancamento_id: string | null; oportunidade_id: string | null;
  emitido_por: string; emitido_em: string; cancelado_em: string | null; motivo_cancelamento: string | null;
}
export interface PainelCaptacao {
  etapas: Partial<Record<EtapaFunil, { n: number; valor: string }>>; passos_atrasados: number; contrapartidas_atrasadas: number;
  acoes: { id: string; arrecadado: string; vendidos: number; resultado: string }[];
}
export interface ConfigEntidade { nome: string; cnpj: string; endereco: string }
export type SituacaoViagem = 'planejada' | 'em_andamento' | 'encerrada' | 'cancelada';
export interface Viagem {
  id: string; titulo: string; destino: string; saida: string; retorno: string; distancia_km: number | null; orcamento: string | null;
  situacao: SituacaoViagem; quartos_adaptados: number | null; transporte_acessivel: boolean; observacoes: string | null;
  evento_id: string | null; verba_id: string | null; projeto_id: string | null; responsavel: string | null; criado_por: string;
}
export type FuncaoDelegacao = 'atleta' | 'tecnico' | 'staff' | 'acompanhante' | 'outro';
export interface MembroDelegacao { id: string; viagem_id: string; pessoa_id: string | null; membro_id: string | null; nome: string; funcao: FuncaoDelegacao; quarto: string | null }
export interface LancamentoViagem { lancamento_id: string; viagem_id: string; papel: 'adiantamento' | 'despesa' | 'devolucao' }
export interface NumerosViagem {
  id: string; gasto: string; adiantado: string; devolvido: string; saldo_acerto: string; atletas: number; delegacao: number;
  custo_por_atleta: string | null; custo_por_km: string | null;
}
