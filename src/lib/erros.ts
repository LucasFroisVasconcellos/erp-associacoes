
export interface ProblemaLinha { linha: number; erro: string; campo?: string | null }
export interface ErroServidor { erro: string; campo?: string; requestId?: string; problemas?: ProblemaLinha[] }

const CAMPOS: Record<string, string> = {
  valor: 'o valor', data: 'a data', descricao: 'a descrição', categoria_id: 'a categoria', conta_id: 'a conta',
  forma_pagamento: 'a forma de pagamento', detalhes: 'os detalhes do gasto', email: 'o e-mail', nome: 'o nome',
  cargo: 'o cargo', permissoes: 'as permissões', tipo: 'o tipo', saldo_inicial: 'o saldo inicial',
  data_saldo_inicial: 'a data do saldo inicial', motivo: 'o motivo', competencia: 'o mês', dia: 'o dia do mês',
  extrato_conferido: 'a conferência do extrato', periodo: 'o período', arquivo: 'o arquivo', agencia: 'a agência',
  numero: 'o número da conta', documento: 'o CPF ou CNPJ', campos: 'os campos do tipo de gasto', id: 'o identificador',
  acesso_expira_em: 'o prazo do acesso', lancamento_id: 'o lançamento', origem: 'a origem do comprovante',
  titulo: 'o título', inicio: 'o início', fim: 'o fim', tipo_id: 'o tipo de evento', local: 'o local', participantes: 'os participantes',
  cor: 'a cor', icone: 'o ícone', responsavel: 'o responsável', prazo: 'o prazo', prioridade: 'a prioridade', situacao: 'a situação',
  itens: 'a lista de itens', texto: 'o texto', frequencia: 'a frequência', lembrete_dias: 'o aviso antes do prazo', evento_id: 'o evento',
  tipo_evento_id: 'o tipo de evento', responsaveis: 'os responsáveis', modelo: 'o modelo', evento: 'o evento', expira_em: 'a data de validade',
  lembretes: 'os lembretes', resumo_semanal: 'o resumo semanal', dia_inteiro: 'o “dia inteiro”',
  atleta: 'se é atleta ou associado', data_nascimento: 'a data de nascimento', telefone: 'o telefone', responsavel_nome: 'o nome do responsável',
  responsavel_contato: 'o contato do responsável', concedido_por: 'quem autorizou (menor de idade: o responsável)', nome_concedente: 'o nome de quem autorizou',
  concedido_em: 'a data da autorização', finalidade: 'a finalidade', base_legal: 'a base legal', chave: 'a chave Pix', cidade: 'a cidade',
  pessoa_id: 'a pessoa', bem_id: 'o bem', termo_versao: 'a versão do termo', termo_aceito_por: 'quem aceitou o termo (menor de idade: o responsável)',
  termo_aceito_em: 'a data do aceite do termo', previsao_devolucao: 'a previsão de devolução', proxima_em: 'a próxima manutenção', custo: 'o custo',
  projeto_id: 'o projeto', valor_mensalidade: 'o valor da mensalidade', percentual_salario_minimo: 'a porcentagem do salário mínimo (de 0,01% a 100%)',
  salario_minimo: 'o salário mínimo (cadastre o valor vigente em Pessoas › Mensalidades › Configurar a mensalidade)', vigente_desde: 'a data de início de vigência',
  percentual_parcela_unica: 'a porcentagem da parcela única (só em categoria por porcentagem, e menor que 12 mensalidades)',
  parcela_unica: 'a parcela única (a categoria da pessoa não tem, ou falta o salário mínimo)', ano: 'o ano', dia_vencimento: 'o dia de vencimento', classe_funcional: 'a classe funcional',
  deficiencia: 'a deficiência', observacoes: 'as observações', observacao: 'a observação', validade: 'a validade', emitido_em: 'a data de emissão',
  orgao: 'o órgão', membro_id: 'o membro', quorum_minimo: 'o quórum mínimo', pauta: 'a pauta', votos: 'os votos (não podem passar do número de presentes)',
  ordem: 'a ordem', ata: 'a ata', aprovada_em: 'a data de aprovação', presencas: 'a lista de presença', entidade: 'a entidade',
  contribuicao_valor: 'o valor da contribuição', contribuicao_periodicidade: 'a periodicidade da contribuição', renovacao: 'a data de renovação',
  beneficios: 'os benefícios', obrigacoes: 'as obrigações', filiacao_id: 'a filiação', documento_institucional_id: 'o documento',
  entregue: 'a entrega', categoria: 'a categoria', data_aquisicao: 'a data de aquisição', area: 'a área do documento',
  linhas: 'as linhas do extrato', doador_nome: 'o nome do doador', doador_documento: 'o CPF ou CNPJ do doador', forma: 'a forma da doação',
  oportunidade_id: 'o contato do funil', etapa: 'a etapa', proximo_passo: 'o próximo passo', proximo_passo_em: 'a data do próximo passo',
  verba_id: 'a verba', valor_estimado: 'o valor estimado', preco_unitario: 'o preço do bilhete', quantidade: 'o total de bilhetes',
  bilhetes: 'os bilhetes (a soma não pode passar do total)', vendidos: 'os vendidos (não podem passar dos recebidos)', valor_prestado: 'o valor entregue',
  autorizacao: 'a regra legal', destino: 'o destino', saida: 'a saída', retorno: 'o retorno (até 60 dias depois da saída)', distancia_km: 'a distância',
  orcamento: 'o orçamento', quartos_adaptados: 'os quartos adaptados', transporte_acessivel: 'o transporte acessível', delegacao: 'a delegação',
  papel: 'o tipo de ligação', cnpj: 'o CNPJ', endereco: 'o endereço', entregue_em: 'a data da entrega', contato: 'o contato',
};

const MENSAGENS: Record<string, string> = {
  nao_autenticado: 'Sua sessão terminou. Entre de novo para continuar.',
  precisa_2fa: 'Confirme a verificação em duas etapas para continuar.',
  confirme_2fa: 'Por segurança, digite de novo o código do aplicativo autenticador para confirmar esta mudança.',
  sessao_expirada: 'Faz mais de 30 dias que você entrou neste aparelho. Entre de novo.',
  sem_acesso: 'Seu acesso ao sistema não está ativo. Fale com um administrador da diretoria.',
  sem_permissao: 'Você não tem permissão para fazer isso. Se precisar, peça a um administrador.',
  limite: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  limite_conta: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  mes_fechado: 'Esse mês já foi fechado. Para corrigir, faça um lançamento de ajuste no mês atual.',
  ja_fechado: 'Esse mês já está fechado.',
  pendencias: 'Ainda há pendências no checklist do mês. Resolva os itens marcados e tente de novo.',
  ja_estornado: 'Esse lançamento já foi estornado.',
  nao_encontrado: 'Não encontramos esse registro. Ele pode ter sido alterado por outra pessoa; atualize a tela.',
  conflito: 'Esse registro já existe com outro autor. Atualize a tela e tente de novo.',
  duplicado: 'Já existe um cadastro com esse nome.',
  ja_e_membro: 'Essa pessoa já faz parte da diretoria no sistema.',
  minimo_admins: 'O sistema precisa manter pelo menos dois administradores. Promova outra pessoa antes.',
  proprio_acesso: 'Ninguém altera o próprio acesso. Peça a outro administrador.',
  proprio_reembolso: 'Você não pode decidir o seu próprio reembolso. Outra pessoa da diretoria precisa decidir.',
  convite_invalido: 'Esse convite não vale mais. Peça um novo convite a um administrador.',
  conta_em_uso: 'O saldo inicial não pode mudar depois que a conta já tem lançamentos.',
  tem_historico: 'Essa pessoa já fez registros no sistema e não pode ser apagada (o histórico depende dela). Desligue o acesso em vez de apagar.',
  em_uso: 'Essa categoria já foi usada por alguém e não pode ser apagada (o histórico depende dela). Desative em vez de apagar.',
  linhas_invalidas: 'Algumas linhas do arquivo não passaram na conferência. Nada foi gravado; corrija e importe de novo.',
  grande_demais: 'O arquivo passou do limite: até 50 MB para PDF e 10 MB para os outros arquivos.',
  tipo_nao_permitido: 'Esse tipo de arquivo não é aceito. Envie foto (JPG, PNG, WEBP), PDF ou o XML da nota.',
  vazio: 'O arquivo está vazio. Escolha o arquivo de novo.',
  rede: 'Sem conexão com o servidor. Confira a internet; o rascunho fica guardado neste aparelho.',
  tempo_esgotado: 'O servidor demorou para responder. Tente de novo em instantes.',
  credenciais: 'E-mail ou senha não conferem. Confira e tente de novo, ou use "Esqueci a senha".',
  captcha: 'Não conseguimos confirmar que é uma pessoa. Refaça a verificação e tente de novo.',
  codigo: 'Código incorreto ou vencido. Abra o aplicativo autenticador e digite o código de 6 números que aparece agora.',
  cancelado: 'Esse evento foi cancelado e não pode mais ser alterado.',
  cancelada: 'Essa tarefa foi cancelada. Reabra antes de alterar.',
  responsavel_obrigatorio: 'Menor de idade precisa do nome e do contato do responsável legal.',
  sem_consentimento: 'Registre antes a autorização (consentimento) para dados de saúde desta pessoa.',
  pessoa_desligada: 'Esta pessoa está desligada. Reative o cadastro para mudar a ficha.',
  sem_convite: 'Faça antes o convite para este e-mail (botão Liberar); depois o pedido é marcado como aprovado.',
  ja_decidido: 'Este pedido já foi decidido por outro administrador.',
  captcha_invalido: 'A verificação de segurança falhou ou venceu. Faça de novo e envie.',
  captcha_indisponivel: 'A verificação de segurança está fora do ar agora. Tente de novo em alguns minutos.',
  captcha_ausente: 'Complete a verificação de segurança antes de enviar.',
  ja_existe: 'Já existe uma autorização ativa para essa finalidade.',
  ja_paga: 'Essa mensalidade já está paga.',
  bem_baixado: 'Esse bem já foi baixado e não pode mais ser alterado.',
  bem_emprestado: 'Esse bem está emprestado. Registre a devolução antes.',
  bem_indisponivel: 'Esse bem não está disponível para empréstimo agora.',
  ata_aprovada: 'A ata desta reunião já foi aprovada: nada mais pode ser alterado.',
  evento_futuro: 'A presença só pode ser marcada a partir do dia do evento.',
  arquivo_inexistente: 'O arquivo não chegou ao servidor. Envie de novo.',
  ja_conciliada: 'Essa linha ou esse lançamento já foi conciliado.',
  viagem_encerrada: 'Essa viagem já foi encerrada ou cancelada e não muda mais.',
  acerto_pendente: 'Ainda falta o acerto: o adiantamento que sobrou precisa voltar como devolução.',
  falha_interna: 'Algo deu errado do nosso lado. Tente de novo; se continuar, avise o administrador com o código mostrado.',
};

export function mensagemErro(e: ErroServidor | null | undefined): string {
  if (!e) return MENSAGENS.falha_interna!;
  if (e.erro === 'invalido') {
    const nome = e.campo ? CAMPOS[e.campo] : undefined;
    return nome ? `Confira ${nome}: o valor informado não é válido.` : 'Alguma informação não está válida. Confira os campos e tente de novo.';
  }
  const base = MENSAGENS[e.erro] ?? MENSAGENS.falha_interna!;
  return e.requestId ? `${base} (código ${e.requestId.slice(0, 8)})` : base;
}

export class ErroApp extends Error {
  constructor(public readonly detalhe: ErroServidor) {
    super(mensagemErro(detalhe));
    this.name = 'ErroApp';
  }
}

/**
 * Erro do Supabase Auth → erro do sistema. A falha de CAPTCHA tem código próprio e NÃO pode
 * virar "senha errada" (confundiria a pessoa). Senha errada e conta inexistente dão a mesma
 * mensagem, para não revelar quem tem conta.
 */
export function erroDeAuth(error: { message?: string; status?: number; code?: string }): ErroApp {
  if (error.code === 'captcha_failed' || /captcha/i.test(error.message ?? '')) return new ErroApp({ erro: 'captcha' });
  // limite por e-mail (um pedido de senha por minuto, por conta) é diferente do limite por IP:
  // ele só acontece para conta que existe, então não pode aparecer na recuperação de senha
  if (error.code === 'over_email_send_rate_limit') return new ErroApp({ erro: 'limite_conta' });
  if (error.status === 429 || error.code === 'over_request_rate_limit') return new ErroApp({ erro: 'limite' });
  if (/fetch|network/i.test(error.message ?? '')) return new ErroApp({ erro: 'rede' });
  return new ErroApp({ erro: error.code === 'invalid_credentials' || error.status === 400 ? 'credenciais' : 'falha_interna' });
}

/**
 * Recuperação de senha: quais erros podem aparecer para a pessoa. Só os que NÃO dependem de a
 * conta existir: CAPTCHA, limite por IP e falta de internet (senão a tela diria "enviamos" sem
 * enviar). Ficam escondidos, com a mesma resposta de sucesso: limite por e-mail (só existe para
 * conta cadastrada), credenciais e falha interna — esta porque o envio do e-mail só acontece
 * para conta cadastrada, e um erro de envio revelaria a conta. Decisão registrada em seguranca.md.
 */
export function erroVisivelNaRecuperacao(e: unknown): boolean {
  return e instanceof ErroApp && ['captcha', 'limite', 'rede'].includes(e.detalhe.erro);
}
