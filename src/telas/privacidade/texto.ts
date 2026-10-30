// Fonte única da política: a tela /privacidade e docs/politica-privacidade.md saem daqui (um teste compara os dois).
// RASCUNHO: precisa de revisão por advogado antes de publicar.

// Fica aqui porque o gerador (npm run politica) lê este arquivo sozinho; o resto importa de '@/lib/associacao'.
export const ASSOCIACAO = {
  nome: 'Associação Exemplo',
  cnpj: '11.222.333/0001-81',
  email: 'contato@exemplo.org',
  telefone: '(11) 90000-0000',
} as const;

export const VERSAO_POLITICA = 'Rascunho 0.8 · 28/10/2026';
/** Canal de privacidade (art. 41 da LGPD). */
export const CONTATO_ENCARREGADO = `${ASSOCIACAO.email} ou ${ASSOCIACAO.telefone}`;

export interface Secao { titulo: string; paragrafos?: string[]; itens?: string[] }

export const SECOES: Secao[] = [
  {
    titulo: 'Quem cuida dos seus dados',
    paragrafos: [
      `A Associação Exemplo (CNPJ ${ASSOCIACAO.cnpj}) é a controladora dos dados tratados neste sistema de gestão, usado só pela diretoria da associação. Atletas e associados não acessam o sistema; os dados deles são cadastrados pela diretoria.`,
      `Para falar sobre os seus dados: ${CONTATO_ENCARREGADO}.`,
    ],
  },
  {
    titulo: 'Quais dados o sistema guarda e para quê',
    itens: [
      'Nome, e-mail e cargo de quem usa o sistema: para controlar quem pode fazer o quê e registrar quem fez cada ação.',
      'Senha (guardada só de forma cifrada) e o cadastro do código de verificação em duas etapas: para proteger o acesso.',
      'Nome e CPF ou CNPJ de fornecedores e de quem paga a Associação Exemplo, e os comprovantes (notas, recibos, cupons): para a contabilidade e a prestação de contas.',
      'A trilha de auditoria: registro de quem criou, alterou, aprovou ou exportou cada coisa, para segurança e prova.',
      'Atletas e associados: nome, vínculo, data de nascimento, telefone e e-mail, mensalidades, documentos exigidos pela federação, autorização de uso de imagem, presença em treinos e jogos e empréstimos de material: para a vida associativa, as competições e a prestação de contas.',
      'Foto 3x4 do atleta (opcional): só com a autorização de uso de imagem registrada, para identificar o atleta no cadastro. Revogada a autorização ou desligado o atleta, a foto é apagada.',
      'Ficha esportiva do atleta: apelido, número da camisa, posição, tamanho de uniforme, desde quando está na Associação Exemplo e um contato de emergência, para a organização dos treinos, jogos e viagens.',
      'Pedido de acesso (tela de entrada): só nome e e-mail de quem pede, para a diretoria decidir se libera. O endereço IP é guardado só embaralhado (sem como voltar ao número) e só enquanto o pedido está pendente, para barrar abuso.',
      'Responsável legal de atleta menor de idade: nome, contato e parentesco, porque é ele quem autoriza e responde pelo atleta.',
      'Dados de saúde (deficiência, classificação funcional, laudos e atestados): só com autorização registrada (ou quando a entidade esportiva exige para competir), numa área separada que só a comissão técnica autorizada acessa. Revogada a autorização, esses dados são apagados.',
      'Reuniões e assembleias: lista de presença, votações, atas e mandatos da diretoria e do conselho fiscal.',
      'Doadores: nome e CPF ou CNPJ no recibo de doação, para a contabilidade e para o doador abater no Imposto de Renda quando couber.',
      'Patrocinadores e apoiadores: nome, contato de trabalho e o histórico das conversas, para a captação de recursos.',
      'Extrato do banco: data, valor e descrição de cada movimento (que podem trazer o nome de quem pagou ou recebeu), para conferir o caixa. O arquivo do banco não é guardado.',
      'Viagens: quem vai na delegação e em que quarto. Necessidade de acessibilidade é registrada só no total da viagem, nunca por pessoa.',
    ],
    paragrafos: ['O sistema não guarda biometria nem localização. Fotos de comprovantes e de documentos têm a localização removida antes de sair do celular. Dados de saúde nunca aparecem na agenda, nos avisos, nos e-mails nem nos relatórios de prestação de contas.'],
  },
  {
    titulo: 'Com base em quê',
    itens: [
      'Obrigação legal e regulatória: guardar a escrituração contábil e os comprovantes.',
      'Relação associativa (estatuto): organizar o trabalho da diretoria.',
      'Legítimo interesse e segurança: controle de acesso, prevenção a fraude e auditoria.',
      'Exercício regular de direitos: guardar prova em caso de disputa.',
      'Consentimento: uso de imagem e dados de saúde, quando não houver exigência da entidade esportiva. Para menores de idade, quem consente é o responsável. O consentimento pode ser revogado a qualquer momento.',
    ],
  },
  {
    titulo: 'Com quem os dados são compartilhados',
    itens: [
      'Supabase: banco de dados, autenticação e arquivos, no servidor da região de São Paulo.',
      'Cloudflare: entrega o site e, quando ligada, faz a verificação contra robôs no login e no pedido de acesso; vê o endereço IP de quem acessa.',
      'O contador da Associação Exemplo: recebe o que precisa para a contabilidade.',
      'O público, na página de Transparência: só números agregados que a diretoria decide publicar (totais por mês e por categoria, recursos públicos, projetos e filiações). Nenhum nome de atleta, associado ou doador pessoa física, nenhuma descrição de lançamento e nenhum dado de saúde.',
    ],
    paragrafos: ['Supabase e Cloudflare são empresas estrangeiras e podem ter fornecedores fora do Brasil. Ninguém recebe os dados para publicidade. A Associação Exemplo não vende dados.'],
  },
  {
    titulo: 'Por quanto tempo',
    itens: [
      'Registros contábeis, comprovantes e auditoria: pelo prazo de guarda exigido pela lei e pelos convênios da associação [prazo a definir com o contador].',
      'Convites não aceitos: apagados 90 dias depois de vencerem.',
      'Pedidos de acesso: apagados 90 dias depois da decisão; pedidos sem resposta somem em 60 dias.',
      'Foto 3x4 e contato de emergência de quem se desliga: apagados no desligamento.',
      'Notificações do sistema já lidas: apagadas 180 dias depois da leitura.',
      'Quem sai da diretoria tem o acesso desativado; o histórico fica bloqueado pelo prazo de guarda, sem outro uso.',
      'Dados de saúde de quem se desliga da Associação Exemplo: apagados 1 ano depois do desligamento [prazo a confirmar].',
      'Contatos, nascimento e responsável de quem se desliga: apagados 5 anos depois; o nome fica com o histórico de mensalidades [prazo a confirmar].',
    ],
  },
  {
    titulo: 'Como os dados são protegidos',
    itens: [
      'Conexão sempre cifrada (HTTPS) e dados cifrados no servidor.',
      'Verificação em duas etapas obrigatória para todos.',
      'Cada pessoa só vê o que o seu acesso permite; as regras ficam no servidor, não na tela.',
      'Arquivos guardados em área privada, abertos só por links que valem 60 segundos.',
      'Dados de saúde numa área separada, liberada só para quem a diretoria autorizar; quem pode ver o cadastro não vê a saúde.',
      'Sessão encerrada depois de 30 minutos sem uso.',
    ],
  },
  {
    titulo: 'Seus direitos',
    paragrafos: [
      'Você pode pedir: confirmação de que tratamos seus dados, acesso a eles, correção, informação sobre com quem compartilhamos, e a eliminação do que não precisa mais ser guardado. Dados com guarda obrigatória ficam bloqueados até o fim do prazo, e explicamos o motivo.',
      `Peça pelo contato ${CONTATO_ENCARREGADO}. Para sua segurança, confirmamos a sua identidade antes de entregar ou apagar qualquer coisa. Respondemos em até 15 dias.`,
      'Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).',
    ],
  },
  {
    titulo: 'Armazenamento no seu aparelho',
    paragrafos: ['O sistema não usa cookies de propaganda nem de rastreamento. Ele guarda no seu navegador só a sessão de acesso (apagada ao fechar a aba; se você marcar "manter conectado", fica no aparelho por até 30 dias e some ao tocar em Sair), a preferência de tema e os lançamentos feitos sem internet (apagados ao enviar ou ao sair).'],
  },
  {
    titulo: 'Se algo der errado',
    paragrafos: ['Se houver um incidente de segurança com risco para você, a Associação Exemplo avisa você e a ANPD, em linguagem simples, dizendo o que aconteceu, quais dados foram afetados e o que fazer.'],
  },
  {
    titulo: 'Mudanças nesta política',
    paragrafos: ['Quando esta política mudar, a nova versão aparece aqui, com a data. Mudanças importantes são avisadas no próprio sistema.'],
  },
];

export function politicaEmMarkdown(): string {
  const partes = [
    '# Política de privacidade — Sistema de Gestão da Associação Exemplo',
    '',
    `> ${VERSAO_POLITICA}. **Rascunho: revisar com advogado antes de publicar.** Gerado de \`src/telas/privacidade/texto.ts\` (\`npm run politica\`); não edite este arquivo à mão.`,
    '',
  ];
  for (const s of SECOES) {
    partes.push(`## ${s.titulo}`, '');
    for (const p of s.paragrafos?.slice(0, s.itens ? 0 : undefined) ?? []) partes.push(p, '');
    if (s.itens) {
      for (const i of s.itens) partes.push(`- ${i}`);
      partes.push('');
      for (const p of s.paragrafos ?? []) partes.push(p, '');
    }
  }
  return partes.join('\n').replace(/\n+$/, '\n');
}
