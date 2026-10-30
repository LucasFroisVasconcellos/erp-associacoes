import { ErroApp } from '@/lib/erros';
import { hojeSP, somarDias } from '@/lib/datas';
import { fimFevereiro, valorDaCategoria, valorParcelaUnica } from '@/lib/mensalidade';
import type {
  Bem, CategoriaSocio, SalarioMinimo, ParcelaUnica, ConfigPix, Consentimento, Deliberacao, DocumentoFiliacao, DocumentoInstitucional, DocumentoPessoa, DocumentoSaude,
  Emprestimo, Filiacao, Lancamento, Manutencao, Mandato, Mensalidade, PainelGovernanca, Pessoa, PrazoAgenda, Presenca, ResumoPessoas,
  PresencaEvento, Reuniao, SaudePessoa, SituacaoPainelFiliacao, TipoFiliacao, Verba,
} from '@/dados/tipos';

type Args = Record<string, unknown>;
const uuid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const falhar = (erro: string, campo?: string): never => { throw new ErroApp({ erro, campo }); };
const texto = (v: unknown, min: number, max: number, campo: string) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) falhar('invalido', campo);
  return s;
};
const txid = () => 'ERPX' + Array.from(crypto.getRandomValues(new Uint8Array(11)), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 21).toUpperCase();
function upsert<T extends { id: string }>(lista: T[], item: T) {
  const i = lista.findIndex((x) => x.id === item.id);
  if (i >= 0) lista[i] = { ...lista[i]!, ...item }; else lista.push(item);
}
const menor = (nasc: string | null) => !!nasc && nasc > somarDias(hojeSP(), -18 * 365.25);

export function criarFase4Demo(eu: string, ctx: {
  lancamentos: Lancamento[]; verbas: () => Promise<Verba[]>;
  novo: (p: Partial<Lancamento> & Pick<Lancamento, 'tipo' | 'valor' | 'data' | 'descricao'>) => Lancamento;
  projetoId: () => Promise<string | null>;
}) {
  const hoje = hojeSP();
  const d = (n: number) => somarDias(hoje, n);
  const mesAtual = hoje.slice(0, 8) + '01';
  const mesPassado = somarDias(mesAtual, -1).slice(0, 8) + '01';

  let pix: ConfigPix | null = { chave: 'tesouraria@exemplo.test', nome: 'ASSOCIACAO EXEMPLO', cidade: 'CIDADE EXEMPLO' };
  const categorias: CategoriaSocio[] = [
    { id: uuid(), nome: 'Associado', valor_mensalidade: '0.00', percentual_salario_minimo: '1.00', percentual_parcela_unica: '10.00', dia_vencimento: 10, ativa: true },
    { id: uuid(), nome: 'Isento', valor_mensalidade: '0.00', percentual_salario_minimo: null, percentual_parcela_unica: null, dia_vencimento: 10, ativa: true },
  ];
  // valores oficiais (decretos): os mesmos que a migration 0032 cadastra
  const parcelas: ParcelaUnica[] = [];
  const salarios: SalarioMinimo[] = [{ vigente_desde: '2026-01-01', valor: '1621.00' }, { vigente_desde: '2025-01-01', valor: '1518.00' }];
  const p = (nome: string, extra: Partial<Pessoa>): Pessoa => ({
    id: uuid(), nome, atleta: true, associado: true, categoria_id: categorias[0]!.id, situacao: 'ativo', data_nascimento: null, email: null, telefone: null,
    responsavel_nome: null, responsavel_contato: null, responsavel_parentesco: null, observacao: null, desligado_em: null, criado_em: agora(),
    foto_caminho: null, apelido: null, numero_camisa: null, posicao: null, tamanho_uniforme: null, registro_federacao: null, na_associacao_desde: null,
    emergencia_nome: null, emergencia_telefone: null, ...extra,
  });
  const pessoas: Pessoa[] = [
    p('Ana Exemplo', { data_nascimento: '1994-03-12', telefone: '16900000001', apelido: 'Aninha', numero_camisa: 7, posicao: 'Pivô', tamanho_uniforme: 'M', na_associacao_desde: '2019-02-01' }),
    p('Bruno Fictício', { data_nascimento: '1988-07-30', email: 'bruno@exemplo.test' }),
    p('Caio Demonstração', { data_nascimento: d(-14 * 365), responsavel_nome: 'Marta Demonstração', responsavel_contato: '(16) 90000-0002', responsavel_parentesco: 'mãe' }),
    p('Daniela Modelo', { data_nascimento: '1990-11-02' }),
    p('Eduardo Teste', { atleta: false, categoria_id: categorias[1]!.id }),
    p('Fernanda Amostra', { situacao: 'inativo' }),
  ];
  const mensalidades: Mensalidade[] = [];
  for (const x of pessoas.filter((y) => y.situacao === 'ativo')) {
    const cat = categorias.find((c) => c.id === x.categoria_id)!;
    for (const [comp, paga] of [[mesPassado, x.nome !== 'Daniela Modelo'], [mesAtual, x.nome === 'Ana Exemplo']] as const) {
      const valor = valorDaCategoria(cat, salarios, comp.slice(0, 8) + '10');
      if (!valor || Number(valor) <= 0) continue;
      mensalidades.push({ id: uuid(), pessoa_id: x.id, competencia: comp, valor, vencimento: comp.slice(0, 8) + '10',
        situacao: paga ? 'paga' : 'aberta', txid: txid(), lancamento_id: null, pago_em: paga ? comp.slice(0, 8) + '08' : null, motivo: null });
    }
  }
  const docsPessoa: DocumentoPessoa[] = [
    { id: uuid(), pessoa_id: pessoas[0]!.id, tipo: 'termo_equipamento', descricao: 'Termo da cadeira de jogo', validade: d(20), entregue_em: d(-300), arquivo_caminho: null, arquivo_mime: null, arquivado_em: null },
    { id: uuid(), pessoa_id: pessoas[2]!.id, tipo: 'autorizacao_imagem', descricao: null, validade: d(200), entregue_em: d(-30), arquivo_caminho: null, arquivo_mime: null, arquivado_em: null },
  ];
  const consentimentos: Consentimento[] = [
    { id: uuid(), pessoa_id: pessoas[0]!.id, finalidade: 'saude', base_legal: 'exigencia_esportiva', concedido_por: 'titular', nome_concedente: 'Ana Exemplo', concedido_em: d(-200), revogado_em: null },
    { id: uuid(), pessoa_id: pessoas[2]!.id, finalidade: 'imagem', base_legal: 'consentimento', concedido_por: 'responsavel', nome_concedente: 'Marta Demonstração', concedido_em: d(-30), revogado_em: null },
  ];
  const saude: SaudePessoa[] = [{ pessoa_id: pessoas[0]!.id, deficiencia: 'Exemplo fictício', classe_funcional: '2.5', observacoes: null, atualizado_em: agora() }];
  const docsSaude: DocumentoSaude[] = [{ id: uuid(), pessoa_id: pessoas[0]!.id, tipo: 'classificacao_funcional', emitido_em: d(-200), validade: d(165), arquivo_caminho: null, arquivo_mime: null }];

  const bens: Bem[] = [
    { id: uuid(), numero: 'CAD-001', nome: 'Cadeira de jogo (exemplo)', categoria: 'cadeira_jogo', origem: 'projeto', projeto_id: null, lancamento_id: null, valor: '4500.00', data_aquisicao: d(-60), situacao: 'emprestado', baixa_motivo: null, observacao: null, criado_em: agora() },
    { id: uuid(), numero: 'CAD-002', nome: 'Cadeira de jogo (exemplo)', categoria: 'cadeira_jogo', origem: 'projeto', projeto_id: null, lancamento_id: null, valor: '4500.00', data_aquisicao: d(-60), situacao: 'disponivel', baixa_motivo: null, observacao: null, criado_em: agora() },
    { id: uuid(), numero: 'BOL-001', nome: 'Bolas de basquete (lote de 6)', categoria: 'bola', origem: 'doacao', projeto_id: null, lancamento_id: null, valor: null, data_aquisicao: d(-400), situacao: 'disponivel', baixa_motivo: null, observacao: null, criado_em: agora() },
    { id: uuid(), numero: 'EQP-001', nome: 'Kit de ferramentas para cadeiras', categoria: 'equipamento_treino', origem: 'compra', projeto_id: null, lancamento_id: null, valor: '380.00', data_aquisicao: d(-500), situacao: 'manutencao', baixa_motivo: null, observacao: null, criado_em: agora() },
  ];
  void ctx.projetoId().then((id) => { for (const b of bens.filter((x) => x.origem === 'projeto')) b.projeto_id = id; });
  const emprestimos: Emprestimo[] = [
    { id: uuid(), bem_id: bens[0]!.id, pessoa_id: pessoas[2]!.id, inicio: d(-20), previsao_devolucao: d(70), devolvido_em: null, termo_versao: 'v1', termo_aceito_por: 'Marta Demonstração', termo_aceito_em: d(-20), observacao: null },
  ];
  const manutencoes: Manutencao[] = [
    { id: uuid(), bem_id: bens[3]!.id, data: d(-5), descricao: 'Revisão geral', custo: '60.00', proxima_em: d(25) },
    { id: uuid(), bem_id: bens[1]!.id, data: d(-50), descricao: 'Troca de pneus', custo: '220.00', proxima_em: d(130) },
  ];

  const docsInst: DocumentoInstitucional[] = [
    { id: uuid(), tipo: 'estatuto', titulo: 'Estatuto social (exemplo)', emitido_em: '2019-05-10', validade: null, observacao: null, arquivo_caminho: null, arquivo_mime: null, arquivado_em: null },
    { id: uuid(), tipo: 'cnpj', titulo: 'Cartão CNPJ', emitido_em: d(-90), validade: null, observacao: null, arquivo_caminho: null, arquivo_mime: null, arquivado_em: null },
    { id: uuid(), tipo: 'certidao_federal', titulo: 'CND Federal', emitido_em: d(-160), validade: d(20), observacao: null, arquivo_caminho: null, arquivo_mime: null, arquivado_em: null },
    { id: uuid(), tipo: 'certidao_fgts', titulo: 'CRF do FGTS', emitido_em: d(-35), validade: d(-5), observacao: null, arquivo_caminho: null, arquivo_mime: null, arquivado_em: null },
  ];
  const mandatos: Mandato[] = [
    { id: uuid(), nome: 'Lia Demonstração', membro_id: eu, cargo: 'Presidente', orgao: 'diretoria', inicio: '2024-01-01', fim: d(70) },
    { id: uuid(), nome: 'Beatriz Fictícia', membro_id: null, cargo: 'Tesoureira', orgao: 'diretoria', inicio: '2024-01-01', fim: d(70) },
    { id: uuid(), nome: 'Conselheiro Exemplo', membro_id: null, cargo: 'Conselho fiscal', orgao: 'conselho_fiscal', inicio: '2024-01-01', fim: d(70) },
  ];
  const instante = (n: number, h: string) => new Date(`${d(n)}T${h}:00-03:00`).toISOString();
  const reunioes: Reuniao[] = [
    { id: uuid(), tipo: 'assembleia_ordinaria', titulo: 'Assembleia geral ordinária', data: instante(-40, '19:00'), local: 'Sede (exemplo)', pauta: '1. Contas do ano anterior\n2. Plano do ano',
      quorum_minimo: 10, situacao: 'realizada', ata: 'Aos dias ... reuniram-se os associados (texto de exemplo).', ata_aprovada_em: d(-10) },
    { id: uuid(), tipo: 'diretoria', titulo: 'Reunião de diretoria', data: instante(-3, '20:00'), local: 'Online', pauta: '1. Viagem do campeonato\n2. Renovação da federação',
      quorum_minimo: 3, situacao: 'realizada', ata: null, ata_aprovada_em: null },
    { id: uuid(), tipo: 'diretoria', titulo: 'Reunião de diretoria', data: instante(11, '20:00'), local: 'Online', pauta: '1. Fechamento do mês', quorum_minimo: 3, situacao: 'convocada', ata: null, ata_aprovada_em: null },
  ];
  const presencas: Presenca[] = ['Lia Demonstração', 'Beatriz Fictícia', 'Carlos Exemplo', 'Júlia Exemplo'].map((nome) => ({ reuniao_id: reunioes[1]!.id, nome, membro_id: null }));
  const deliberacoes: Deliberacao[] = [
    { id: uuid(), reuniao_id: reunioes[1]!.id, ordem: 1, texto: 'Aprovar o orçamento da viagem ao campeonato', votos_favor: 4, votos_contra: 0, abstencoes: 0, resultado: 'aprovada' },
  ];

  const tiposFiliacao: TipoFiliacao[] = ['Confederação', 'Federação', 'Comitê', 'Conselho', 'Cadastro governamental', 'Parceria'].map((nome) => ({ id: uuid(), nome, ativo: true }));
  const tipo = (n: string) => tiposFiliacao.find((t) => t.nome === n)!.id;
  const filiacoes: Filiacao[] = [
    { id: uuid(), entidade: 'Confederação Exemplo de Basquete em Cadeira de Rodas', tipo_id: tipo('Confederação'), categoria: 'Clube filiado', situacao: 'ativa', inicio: '2021-02-01',
      validade: d(150), renovacao: d(120), contribuicao_valor: '800.00', contribuicao_periodicidade: 'anual', recorrencia_id: null,
      beneficios: 'Participação nos campeonatos nacionais.', obrigacoes: 'Anuidade e certidões em dia.', responsavel: eu, criado_por: eu },
    { id: uuid(), entidade: 'Federação Estadual Exemplo', tipo_id: tipo('Federação'), categoria: null, situacao: 'pendente', inicio: '2022-03-01',
      validade: d(12), renovacao: d(5), contribuicao_valor: '60.00', contribuicao_periodicidade: 'mensal', recorrencia_id: null,
      beneficios: 'Campeonato estadual.', obrigacoes: 'Mensalidade e documentos dos atletas.', responsavel: eu, criado_por: eu },
    { id: uuid(), entidade: 'Conselho Municipal Exemplo', tipo_id: tipo('Conselho'), categoria: 'Registro', situacao: 'ativa', inicio: '2023-01-01',
      validade: d(400), renovacao: null, contribuicao_valor: null, contribuicao_periodicidade: null, recorrencia_id: null, beneficios: 'Acesso a editais municipais.', obrigacoes: null, responsavel: null, criado_por: eu },
  ];
  const docsFiliacao: DocumentoFiliacao[] = [
    { id: uuid(), filiacao_id: filiacoes[1]!.id, nome: 'CRF do FGTS', documento_institucional_id: docsInst[3]!.id, entregue_em: d(-35) },
    { id: uuid(), filiacao_id: filiacoes[1]!.id, nome: 'Ata de eleição da diretoria', documento_institucional_id: null, entregue_em: null },
    { id: uuid(), filiacao_id: filiacoes[0]!.id, nome: 'CND Federal', documento_institucional_id: docsInst[2]!.id, entregue_em: d(-150) },
  ];
  void ctx.verbas().then((vs) => { const v = vs.find((x) => x.titulo.startsWith('Passagens')); if (v) v.filiacao_id = filiacoes[1]!.id; });

  const presencasEvento: PresencaEvento[] = [];

  const pessoa = (id: unknown) => pessoas.find((x) => x.id === id) ?? falhar('invalido', 'pessoa_id');
  const consentAtivo = (id: string, f: string) => consentimentos.some((c) => c.pessoa_id === id && c.finalidade === f && !c.revogado_em);

  const rpc: Record<string, (a: Args) => unknown> = {
    salvar_config_pix: ({ p }) => {
      const q = p as ConfigPix;
      if (!/^[A-Za-z0-9 .-]{3,25}$/.test(q.nome ?? '')) falhar('invalido', 'nome');
      if (!/^[A-Za-z .-]{2,15}$/.test(q.cidade ?? '')) falhar('invalido', 'cidade');
      if (!texto(q.chave, 5, 77, 'chave')) falhar('invalido', 'chave');
      pix = { chave: q.chave.trim(), nome: q.nome.toUpperCase(), cidade: q.cidade.toUpperCase() };
      return { ok: true };
    },
    salvar_categoria_socio: ({ p }) => {
      const q = p as CategoriaSocio; texto(q.nome, 2, 60, 'nome');
      const pct = q.percentual_salario_minimo ?? null;
      if (pct != null && !(Number(pct) >= 0.01 && Number(pct) <= 100)) falhar('invalido', 'percentual_salario_minimo');
      if (pct != null && Number(q.valor_mensalidade ?? 0) !== 0) falhar('invalido', 'valor_mensalidade');
      const pu = q.percentual_parcela_unica ?? null;
      if (pu != null && (pct == null || !(Number(pu) >= 0.01 && Number(pu) <= Number(pct) * 12))) falhar('invalido', 'percentual_parcela_unica');
      if (pct == null && !/^[0-9]{1,8}(\.[0-9]{1,2})?$/.test(String(q.valor_mensalidade ?? ''))) falhar('invalido', 'valor_mensalidade');
      upsert(categorias, Object.assign({ ativa: true }, q, { percentual_salario_minimo: pct, percentual_parcela_unica: q.percentual_parcela_unica ?? null, valor_mensalidade: pct != null ? '0.00' : q.valor_mensalidade, dia_vencimento: Number(q.dia_vencimento) }));
      return { ok: true };
    },
    apagar_categoria_socio: ({ p_id }) => {
      const i = categorias.findIndex((c) => c.id === p_id);
      if (i < 0) falhar('nao_encontrado');
      if (pessoas.some((x) => x.categoria_id === p_id)) falhar('em_uso');
      categorias.splice(i, 1);
      return { ok: true };
    },
    salvar_salario_minimo: ({ p_vigente_desde, p_valor }) => {
      const v = String(p_vigente_desde ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '2000-01-01' || v > somarDias(hoje, 366)) falhar('invalido', 'vigente_desde');
      if (!/^[0-9]{1,8}(\.[0-9]{1,2})?$/.test(String(p_valor ?? '')) || Number(p_valor) < 100 || Number(p_valor) > 100000) falhar('invalido', 'salario_minimo');
      const atual = salarios.find((s) => s.vigente_desde === v);
      if (atual) atual.valor = Number(p_valor).toFixed(2); else salarios.push({ vigente_desde: v, valor: Number(p_valor).toFixed(2) });
      salarios.sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
      return { ok: true };
    },
    salvar_pessoa: ({ p }) => {
      const q = p as Partial<Pessoa> & { id: string };
      texto(q.nome, 2, 120, 'nome');
      if (!q.atleta && !q.associado) falhar('invalido', 'atleta');
      if (menor(q.data_nascimento ?? null) && (!q.responsavel_nome || !q.responsavel_contato)) falhar('responsavel_obrigatorio');
      const atual = pessoas.find((x) => x.id === q.id);
      const novo: Pessoa = { ...(atual ?? { criado_em: agora(), desligado_em: null }), situacao: 'ativo', categoria_id: null, data_nascimento: null, email: null, telefone: null,
        responsavel_nome: null, responsavel_contato: null, responsavel_parentesco: null, observacao: null, atleta: false, associado: false,
        foto_caminho: null, apelido: null, numero_camisa: null, posicao: null, tamanho_uniforme: null, registro_federacao: null, na_associacao_desde: null,
        emergencia_nome: null, emergencia_telefone: null, ...q } as Pessoa;
      if (novo.situacao === 'desligado' && atual?.situacao !== 'desligado') {
        novo.desligado_em = hoje; novo.foto_caminho = null; novo.emergencia_nome = null; novo.emergencia_telefone = null;
        for (const m of mensalidades.filter((x) => x.pessoa_id === q.id && x.situacao === 'aberta' && x.vencimento > hoje)) m.situacao = 'cancelada';
      }
      upsert(pessoas, novo);
      return { ok: true, id: q.id };
    },
    gerar_mensalidades: ({ p_competencia }) => {
      let criadas = 0;
      const venc = (c: CategoriaSocio) => String(p_competencia).slice(0, 8) + String(c.dia_vencimento).padStart(2, '0');
      const anoComp = Number(String(p_competencia).slice(0, 4));
      const ativas = pessoas.filter((y) => y.situacao === 'ativo' && y.associado && y.categoria_id && !parcelas.some((u) => u.pessoa_id === y.id && u.ano === anoComp));
      if (ativas.some((x) => { const c = categorias.find((k) => k.id === x.categoria_id)!; return c.ativa && valorDaCategoria(c, salarios, venc(c)) == null; })) falhar('invalido', 'salario_minimo');
      for (const x of ativas) {
        if (mensalidades.some((m) => m.pessoa_id === x.id && m.competencia === p_competencia)) continue;
        const cat = categorias.find((c) => c.id === x.categoria_id)!;
        const valor = valorDaCategoria(cat, salarios, venc(cat));
        if (!cat.ativa || !valor || Number(valor) <= 0) continue;
        mensalidades.push({ id: uuid(), pessoa_id: x.id, competencia: String(p_competencia), valor,
          vencimento: venc(cat), situacao: 'aberta', txid: txid(), lancamento_id: null, pago_em: null, motivo: null });
        criadas++;
      }
      return { ok: true, criadas };
    },
    registrar_pagamento_mensalidade: ({ p_id, p_lancamento }) => {
      const m = mensalidades.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
      if (m.situacao === 'paga') falhar('ja_paga');
      const l = ctx.lancamentos.find((x) => x.id === p_lancamento && x.tipo === 'entrada' && x.situacao === 'realizada') ?? falhar('invalido', 'lancamento_id');
      Object.assign(m, { situacao: 'paga', lancamento_id: l.id, pago_em: l.data });
      return { ok: true };
    },
    receber_mensalidade: ({ p_id, p_lancamento, p_conta, p_data, p_forma, p_categoria }) => {
      const m = mensalidades.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
      if (m.lancamento_id === p_lancamento) return { ok: true, repetido: true };
      if (m.situacao === 'paga') falhar('ja_paga');
      if (String(p_data) > hojeSP()) falhar('invalido', 'data');
      const l = ctx.novo({ id: String(p_lancamento), tipo: 'entrada', valor: m.valor, data: String(p_data), descricao: `Mensalidade ${m.competencia.slice(5, 7)}/${m.competencia.slice(0, 4)}`,
        conta_id: String(p_conta), categoria_id: String(p_categoria), forma_pagamento: String(p_forma) as never, criado_por: eu });
      Object.assign(m, { situacao: 'paga', lancamento_id: l.id, pago_em: l.data });
      return { ok: true, lancamento_id: l.id };
    },
    receber_parcela_unica: ({ p_id, p_pessoa, p_ano, p_lancamento, p_conta, p_data, p_forma, p_categoria }) => {
      const ja = parcelas.find((u) => u.id === p_id);
      if (ja) return ja.lancamento_id === p_lancamento ? { ok: true, repetido: true } : falhar('conflito', 'id');
      const ano = Number(p_ano); const data = String(p_data);
      if (!(ano >= 2024 && ano <= Number(hoje.slice(0, 4)) + 1)) falhar('invalido', 'ano');
      if (data > hoje || data < `${ano - 1}-12-01` || data > fimFevereiro(ano)) falhar('invalido', 'data');
      const x = pessoas.find((y) => y.id === p_pessoa) ?? falhar('nao_encontrado');
      if (!x.associado || x.situacao !== 'ativo' || !x.categoria_id) falhar('invalido', 'pessoa_id');
      if (parcelas.some((u) => u.pessoa_id === x.id && u.ano === ano)
        || mensalidades.some((m) => m.pessoa_id === x.id && m.situacao === 'paga' && m.competencia.startsWith(String(ano)))) falhar('ja_paga');
      const cat = categorias.find((c) => c.id === x.categoria_id)!;
      const valor = valorParcelaUnica(cat, salarios, ano) ?? falhar('invalido', 'parcela_unica');
      const l = ctx.novo({ id: String(p_lancamento), tipo: 'entrada', valor, data, descricao: `Mensalidade parcela única ${ano}`,
        conta_id: String(p_conta), categoria_id: String(p_categoria), forma_pagamento: String(p_forma) as never, criado_por: eu });
      parcelas.push({ id: String(p_id), pessoa_id: x.id, ano, valor, pago_em: data, lancamento_id: l.id });
      for (const m of mensalidades.filter((y) => y.pessoa_id === x.id && y.situacao === 'aberta' && y.competencia.startsWith(String(ano)))) {
        Object.assign(m, { situacao: 'dispensada', motivo: `Paga na parcela única de ${ano}` });
      }
      return { ok: true, valor, lancamento_id: l.id };
    },
    mudar_mensalidade: ({ p_id, p_situacao, p_motivo }) => {
      const m = mensalidades.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
      if (p_situacao !== 'aberta') texto(p_motivo, 3, 300, 'motivo');
      Object.assign(m, { situacao: p_situacao, motivo: p_motivo ?? null, pago_em: null, lancamento_id: null });
      return { ok: true };
    },
    salvar_documento_pessoa: ({ p }) => {
      const q = p as Partial<DocumentoPessoa> & { id: string; arquivar?: boolean };
      pessoa(q.pessoa_id);
      const atual = docsPessoa.find((x) => x.id === q.id);
      upsert(docsPessoa, { descricao: null, validade: null, entregue_em: null, arquivo_caminho: null, arquivo_mime: null, ...(atual ?? {}), ...q,
        arquivado_em: q.arquivar ? agora() : null } as DocumentoPessoa);
      return { ok: true, id: q.id };
    },
    registrar_consentimento: ({ p }) => {
      const q = p as Consentimento;
      const x = pessoa(q.pessoa_id);
      if (menor(x.data_nascimento) && q.concedido_por !== 'responsavel') falhar('invalido', 'concedido_por');
      texto(q.nome_concedente, 2, 120, 'nome_concedente');
      if (consentAtivo(x.id, q.finalidade)) falhar('ja_existe', 'finalidade');
      consentimentos.unshift({ ...q, revogado_em: null });
      return { ok: true };
    },
    revogar_consentimento: ({ p_id }) => {
      const c = consentimentos.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
      c.revogado_em = agora();
      if (c.finalidade === 'imagem') pessoa(c.pessoa_id).foto_caminho = null;
      if (c.finalidade === 'saude' && c.base_legal === 'consentimento') {
        for (let i = saude.length - 1; i >= 0; i--) if (saude[i]!.pessoa_id === c.pessoa_id) saude.splice(i, 1);
        for (let i = docsSaude.length - 1; i >= 0; i--) if (docsSaude[i]!.pessoa_id === c.pessoa_id) docsSaude.splice(i, 1);
      }
      return { ok: true };
    },
    salvar_ficha_atleta: ({ p_pessoa, p }) => {
      const x = pessoa(String(p_pessoa));
      if (x.situacao === 'desligado') falhar('pessoa_desligada');
      const q = p as Partial<Pessoa>;
      if (q.numero_camisa != null && !(Number.isInteger(q.numero_camisa) && q.numero_camisa >= 0 && q.numero_camisa <= 99)) falhar('invalido', 'numero_camisa');
      if (q.emergencia_telefone && !/^\+?\d{10,13}$/.test(q.emergencia_telefone)) falhar('invalido', 'emergencia_telefone');
      Object.assign(x, q);
      return { ok: true };
    },
    remover_foto_pessoa: ({ p_pessoa }) => { const x = pessoa(String(p_pessoa)); if (!x.foto_caminho) return { ok: true, repetido: true }; x.foto_caminho = null; return { ok: true }; },
    salvar_saude: ({ p_pessoa, p }) => {
      if (!consentAtivo(String(p_pessoa), 'saude')) falhar('sem_consentimento');
      const q = p as Partial<SaudePessoa>;
      const i = saude.findIndex((x) => x.pessoa_id === p_pessoa);
      const novo: SaudePessoa = { pessoa_id: String(p_pessoa), deficiencia: q.deficiencia ?? null, classe_funcional: q.classe_funcional ?? null, observacoes: q.observacoes ?? null, atualizado_em: agora() };
      if (i >= 0) saude[i] = novo; else saude.push(novo);
      return { ok: true };
    },
    salvar_documento_saude: ({ p }) => {
      const q = p as Partial<DocumentoSaude> & { id: string; remover?: boolean };
      if (q.remover) { const i = docsSaude.findIndex((x) => x.id === q.id); if (i >= 0) docsSaude.splice(i, 1); return { ok: true }; }
      if (!consentAtivo(String(q.pessoa_id), 'saude')) falhar('sem_consentimento');
      upsert(docsSaude, { emitido_em: null, validade: null, arquivo_caminho: null, arquivo_mime: null, ...q } as DocumentoSaude);
      return { ok: true, id: q.id };
    },
    resumo_pessoas: (): ResumoPessoas & { ok: true } => {
      const atrasadas = mensalidades.filter((m) => m.situacao === 'aberta' && m.vencimento < hoje);
      const ativos = pessoas.filter((x) => x.situacao === 'ativo');
      return { ok: true, ativos: ativos.length, atletas: ativos.filter((x) => x.atleta).length, associados: ativos.filter((x) => x.associado).length,
        menores_sem_responsavel: pessoas.filter((x) => menor(x.data_nascimento) && !x.responsavel_nome).length,
        mensalidades_atrasadas: atrasadas.length, valor_atrasado: atrasadas.reduce((s, m) => s + Number(m.valor), 0).toFixed(2),
        documentos_vencendo: docsPessoa.filter((x) => !x.arquivado_em && x.validade && x.validade <= d(30))
          .map((x) => ({ id: x.id, pessoa_id: x.pessoa_id, pessoa: pessoa(x.pessoa_id).nome, tipo: x.tipo, validade: x.validade! })),
        saude_vencendo: docsSaude.filter((x) => x.validade && x.validade <= d(30)).length };
    },
    autorizar_documento: () => ({ ok: true }),

    salvar_bem: ({ p }) => {
      const q = p as Partial<Bem> & { id: string };
      const numero = texto(q.numero, 1, 20, 'numero').toUpperCase();
      if (!/^[A-Z0-9-]{1,20}$/.test(numero)) falhar('invalido', 'numero');
      texto(q.nome, 2, 120, 'nome');
      if (q.origem === 'projeto' && !q.projeto_id) falhar('invalido', 'projeto_id');
      if (bens.some((b) => b.numero === numero && b.id !== q.id)) falhar('duplicado', 'numero');
      const atual = bens.find((b) => b.id === q.id);
      if (atual?.situacao === 'baixado') falhar('bem_baixado');
      upsert(bens, { situacao: 'disponivel', baixa_motivo: null, lancamento_id: null, projeto_id: null, valor: null, data_aquisicao: null, observacao: null, criado_em: agora(), ...(atual ?? {}), ...q, numero } as Bem);
      return { ok: true, id: q.id };
    },
    baixar_bem: ({ p_id, p_motivo }) => {
      const b = bens.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
      texto(p_motivo, 3, 300, 'motivo');
      if (b.situacao === 'emprestado') falhar('bem_emprestado');
      Object.assign(b, { situacao: 'baixado', baixa_motivo: String(p_motivo).trim() });
      return { ok: true };
    },
    emprestar_bem: ({ p }) => {
      const q = p as Emprestimo;
      const b = bens.find((x) => x.id === q.bem_id) ?? falhar('invalido', 'bem_id');
      if (b.situacao !== 'disponivel') falhar('bem_indisponivel');
      const x = pessoa(q.pessoa_id);
      if (!/^v\d{1,3}$/.test(q.termo_versao)) falhar('invalido', 'termo_versao');
      if (menor(x.data_nascimento) && q.termo_aceito_por.trim().toLowerCase() !== (x.responsavel_nome ?? '').toLowerCase()) falhar('invalido', 'termo_aceito_por');
      emprestimos.unshift(Object.assign({ previsao_devolucao: null, observacao: null }, q, { devolvido_em: null }));
      b.situacao = 'emprestado';
      return { ok: true, id: q.id };
    },
    devolver_bem: ({ p_emprestimo, p_data, p_observacao }) => {
      const e = emprestimos.find((x) => x.id === p_emprestimo) ?? falhar('nao_encontrado');
      if (String(p_data) > hoje || String(p_data) < e.inicio) falhar('invalido', 'data');
      Object.assign(e, { devolvido_em: p_data, observacao: p_observacao ?? e.observacao });
      const b = bens.find((x) => x.id === e.bem_id); if (b?.situacao === 'emprestado') b.situacao = 'disponivel';
      return { ok: true };
    },
    registrar_manutencao: ({ p }) => {
      const q = p as Manutencao & { em_manutencao?: boolean };
      const b = bens.find((x) => x.id === q.bem_id) ?? falhar('invalido', 'bem_id');
      texto(q.descricao, 2, 300, 'descricao');
      if (q.proxima_em && q.proxima_em <= q.data) falhar('invalido', 'proxima_em');
      manutencoes.unshift({ id: q.id, bem_id: q.bem_id, data: q.data, descricao: q.descricao, custo: q.custo ?? null, proxima_em: q.proxima_em ?? null });
      if (q.em_manutencao !== undefined && b.situacao !== 'emprestado' && b.situacao !== 'baixado') b.situacao = q.em_manutencao ? 'manutencao' : 'disponivel';
      return { ok: true, id: q.id };
    },

    salvar_documento_institucional: ({ p }) => {
      const q = p as Partial<DocumentoInstitucional> & { id: string; arquivar?: boolean };
      texto(q.titulo, 2, 160, 'titulo');
      const atual = docsInst.find((x) => x.id === q.id);
      upsert(docsInst, { emitido_em: null, validade: null, observacao: null, arquivo_caminho: null, arquivo_mime: null, ...(atual ?? {}), ...q, arquivado_em: q.arquivar ? agora() : null } as DocumentoInstitucional);
      return { ok: true, id: q.id };
    },
    salvar_mandato: ({ p }) => {
      const q = p as Mandato;
      texto(q.nome, 2, 120, 'nome'); texto(q.cargo, 2, 60, 'cargo');
      if (!q.fim || q.fim <= q.inicio) falhar('invalido', 'fim');
      upsert(mandatos, Object.assign({ membro_id: null }, q));
      return { ok: true, id: q.id };
    },
    salvar_reuniao: ({ p }) => {
      const q = p as Partial<Reuniao> & { id: string };
      const atual = reunioes.find((r) => r.id === q.id);
      if (atual?.ata_aprovada_em) falhar('ata_aprovada');
      texto(q.titulo, 2, 160, 'titulo'); texto(q.pauta, 2, 4000, 'pauta');
      upsert(reunioes, { local: null, quorum_minimo: null, situacao: 'convocada', ata: null, ata_aprovada_em: null, ...(atual ?? {}), ...q } as Reuniao);
      return { ok: true, id: q.id };
    },
    salvar_presencas: ({ p_reuniao, p }) => {
      const r = reunioes.find((x) => x.id === p_reuniao) ?? falhar('nao_encontrado');
      if (r.ata_aprovada_em) falhar('ata_aprovada');
      const lista = p as { nome: string; membro_id?: string | null }[];
      if (!Array.isArray(lista) || lista.some((x) => (x.nome ?? '').trim().length < 2)) falhar('invalido', 'presencas');
      for (let i = presencas.length - 1; i >= 0; i--) if (presencas[i]!.reuniao_id === r.id) presencas.splice(i, 1);
      presencas.push(...lista.map((x) => ({ reuniao_id: r.id, nome: x.nome.trim(), membro_id: x.membro_id ?? null })));
      return { ok: true, presentes: lista.length, quorum_atingido: r.quorum_minimo === null || lista.length >= r.quorum_minimo };
    },
    salvar_deliberacao: ({ p_reuniao, p }) => {
      const r = reunioes.find((x) => x.id === p_reuniao) ?? falhar('nao_encontrado');
      if (r.ata_aprovada_em) falhar('ata_aprovada');
      const q = p as Deliberacao;
      texto(q.texto, 2, 1000, 'texto');
      const pres = presencas.filter((x) => x.reuniao_id === r.id).length;
      if (pres > 0 && Number(q.votos_favor) + Number(q.votos_contra) + Number(q.abstencoes) > pres) falhar('invalido', 'votos');
      if (deliberacoes.some((x) => x.reuniao_id === r.id && x.ordem === Number(q.ordem) && x.id !== q.id)) falhar('duplicado', 'ordem');
      upsert(deliberacoes, { ...q, reuniao_id: r.id, ordem: Number(q.ordem), votos_favor: Number(q.votos_favor), votos_contra: Number(q.votos_contra), abstencoes: Number(q.abstencoes) });
      return { ok: true, id: q.id };
    },
    salvar_ata: ({ p_reuniao, p_ata, p_aprovada_em }) => {
      const r = reunioes.find((x) => x.id === p_reuniao) ?? falhar('nao_encontrado');
      if (r.ata_aprovada_em) falhar('ata_aprovada');
      texto(p_ata, 2, 20000, 'ata');
      if (p_aprovada_em && r.situacao !== 'realizada') falhar('invalido', 'situacao');
      Object.assign(r, { ata: String(p_ata), ata_aprovada_em: p_aprovada_em ?? null });
      return { ok: true };
    },
    painel_governanca: (): PainelGovernanca & { ok: true } => ({
      ok: true,
      vencendo: docsInst.filter((x) => !x.arquivado_em && x.validade && x.validade <= d(45)).sort((a, b) => a.validade!.localeCompare(b.validade!))
        .map((x) => ({ id: x.id, titulo: x.titulo, tipo: x.tipo, validade: x.validade! })),
      mandatos_acabando: mandatos.filter((m) => m.fim >= hoje && m.fim <= d(120)).map((m) => ({ id: m.id, nome: m.nome, cargo: m.cargo, fim: m.fim })),
      proximas_reunioes: reunioes.filter((r) => r.situacao === 'convocada' && r.data >= agora()).length,
      atas_pendentes: reunioes.filter((r) => r.situacao === 'realizada' && !r.ata_aprovada_em).length,
    }),

    salvar_tipo_filiacao: ({ p }) => { const q = p as TipoFiliacao; texto(q.nome, 2, 60, 'nome'); upsert(tiposFiliacao, Object.assign({ ativo: true }, q)); return { ok: true }; },
    importar_tipos_filiacao: () => ({ ok: true, criados: 0 }),
    salvar_filiacao: ({ p }) => {
      const q = p as Partial<Filiacao> & { id: string };
      texto(q.entidade, 2, 160, 'entidade');
      const atual = filiacoes.find((x) => x.id === q.id);
      upsert(filiacoes, { categoria: null, situacao: 'preparacao', inicio: null, validade: null, renovacao: null, contribuicao_valor: null, contribuicao_periodicidade: null,
        recorrencia_id: null, beneficios: null, obrigacoes: null, responsavel: null, criado_por: eu, ...(atual ?? {}), ...q } as Filiacao);
      return { ok: true, id: q.id };
    },
    gerar_contribuicao: ({ p_filiacao, p_categoria }) => {
      const f = filiacoes.find((x) => x.id === p_filiacao) ?? falhar('nao_encontrado');
      if (!f.contribuicao_valor || !f.contribuicao_periodicidade) falhar('invalido', 'contribuicao_valor');
      if (f.contribuicao_periodicidade === 'mensal') { f.recorrencia_id = f.recorrencia_id ?? uuid(); return { ok: true, id: f.recorrencia_id }; }
      if (!f.renovacao || f.renovacao < hoje) falhar('invalido', 'renovacao');
      const desc = `Contribuição — ${f.entidade}`.slice(0, 200);
      const ja = ctx.lancamentos.find((l) => l.descricao === desc && l.data === f.renovacao);
      const l = ja ?? ctx.novo({ tipo: 'saida', situacao: 'prevista', valor: f.contribuicao_valor!, data: f.renovacao!, descricao: desc, categoria_id: String(p_categoria) });
      return { ok: true, id: l.id };
    },
    salvar_documento_filiacao: ({ p_filiacao, p }) => {
      const q = p as { id: string; nome?: string; documento_institucional_id?: string | null; entregue?: boolean };
      const atual = docsFiliacao.find((x) => x.id === q.id);
      if (!atual) {
        const nome = texto(q.nome, 2, 200, 'nome');
        if (docsFiliacao.some((x) => x.filiacao_id === p_filiacao && x.nome.toLowerCase() === nome.toLowerCase())) falhar('duplicado', 'nome');
        docsFiliacao.push({ id: q.id, filiacao_id: String(p_filiacao), nome, documento_institucional_id: q.documento_institucional_id ?? null, entregue_em: q.entregue ? hoje : null });
      } else {
        if ('documento_institucional_id' in q) atual.documento_institucional_id = q.documento_institucional_id ?? null;
        if (q.entregue !== undefined) atual.entregue_em = q.entregue ? atual.entregue_em ?? hoje : null;
      }
      return { ok: true, id: q.id };
    },
    definir_dependencia_verba: async ({ p_verba, p_filiacao }) => {
      const v = (await ctx.verbas()).find((x) => x.id === p_verba) ?? falhar('nao_encontrado');
      v.filiacao_id = (p_filiacao as string | null) ?? null;
      return { ok: true };
    },
    salvar_presenca_evento: ({ p_evento, p }) => {
      const lista = p as { pessoa_id: string; presente: boolean; justificativa?: string | null }[];
      if (!Array.isArray(lista) || lista.some((x) => !pessoas.some((y) => y.id === x.pessoa_id && y.atleta && y.situacao === 'ativo'))) falhar('invalido', 'presencas');
      for (let i = presencasEvento.length - 1; i >= 0; i--) if (presencasEvento[i]!.evento_id === p_evento) presencasEvento.splice(i, 1);
      presencasEvento.push(...lista.map((x) => ({ evento_id: String(p_evento), pessoa_id: x.pessoa_id, presente: x.presente, justificativa: x.justificativa ?? null })));
      return { ok: true, marcados: lista.length, presentes: lista.filter((x) => x.presente).length };
    },
    frequencia_atletas: () => {
      const m = new Map<string, { pessoa_id: string; presentes: number; marcados: number }>();
      for (const x of presencasEvento) {
        const f = m.get(x.pessoa_id) ?? { pessoa_id: x.pessoa_id, presentes: 0, marcados: 0 };
        f.marcados++; if (x.presente) f.presentes++; m.set(x.pessoa_id, f);
      }
      return { ok: true, atletas: [...m.values()] };
    },
    painel_filiacoes: async (): Promise<{ ok: true; filiacoes: SituacaoPainelFiliacao[] }> => {
      const verbas = await ctx.verbas();
      const finais = ['encerrado', 'negado', 'cancelado'];
      return { ok: true, filiacoes: filiacoes.map((f) => {
        const vencida = !!f.validade && f.validade < hoje;
        const irregular = ['pendente', 'suspensa', 'encerrada'].includes(f.situacao) || vencida;
        return { id: f.id, vencida, vence_em_breve: !!f.validade && f.validade >= hoje && f.validade <= d(45),
          documentos_pendentes: docsFiliacao.filter((x) => x.filiacao_id === f.id && (!x.entregue_em
            || (docsInst.find((i) => i.id === x.documento_institucional_id)?.validade ?? '9999') < hoje)).length,
          verbas_em_risco: irregular ? verbas.filter((v) => v.filiacao_id === f.id && !finais.includes(v.situacao)).map((v) => ({ id: v.id, titulo: v.titulo })) : [] };
      }) };
    },
  };

  function prazos(ini: string, fim: string): PrazoAgenda[] {
    const no = (x: string | null) => !!x && x >= ini && x <= fim;
    return [
      ...docsPessoa.filter((x) => !x.arquivado_em && no(x.validade)).map((x) => ({ tipo: 'documento' as const, titulo: `Vence documento de ${pessoa(x.pessoa_id).nome}`, data: x.validade!, ref: x.pessoa_id })),
      ...docsInst.filter((x) => !x.arquivado_em && no(x.validade)).map((x) => ({ tipo: 'governanca' as const, titulo: `Vence: ${x.titulo}`, data: x.validade!, ref: x.id })),
      ...mandatos.filter((m) => no(m.fim)).map((m) => ({ tipo: 'governanca' as const, titulo: `Fim do mandato: ${m.cargo} — ${m.nome}`, data: m.fim, ref: m.id })),
      ...reunioes.filter((r) => r.situacao !== 'cancelada' && no(hojeSP(new Date(r.data)))).map((r) => ({ tipo: 'reuniao' as const, titulo: r.titulo, data: hojeSP(new Date(r.data)), ref: r.id })),
      ...filiacoes.filter((f) => f.situacao !== 'encerrada' && no(f.validade)).map((f) => ({ tipo: 'filiacao' as const, titulo: `Vence a filiação: ${f.entidade}`, data: f.validade!, ref: f.id })),
      ...filiacoes.filter((f) => f.situacao !== 'encerrada' && no(f.renovacao)).map((f) => ({ tipo: 'filiacao' as const, titulo: `Renovar: ${f.entidade}`, data: f.renovacao!, ref: f.id })),
      ...manutencoes.filter((m) => no(m.proxima_em)).map((m) => { const b = bens.find((x) => x.id === m.bem_id)!; return { tipo: 'patrimonio' as const, titulo: `Manutenção: ${b.numero} — ${b.nome}`, data: m.proxima_em!, ref: b.id }; }),
    ];
  }

  function anexarFoto(id: string, arquivo: File) {
    const x = pessoa(id);
    if (!consentAtivo(id, 'imagem')) falhar('sem_consentimento');
    x.foto_caminho = URL.createObjectURL(arquivo);
    return { id };
  }
  function anexar(area: string, id: string, mime: string) {
    const lista: { id: string; arquivo_caminho: string | null; arquivo_mime: string | null }[] = area === 'pessoa' ? docsPessoa : area === 'saude' ? docsSaude : docsInst;
    const doc = lista.find((x) => x.id === id) ?? falhar('nao_encontrado');
    Object.assign(doc, { arquivo_caminho: `${id}/${uuid()}`, arquivo_mime: mime });
    return { id };
  }

  return {
    rpc,
    prazos,
    anexar,
    anexarFoto,
    bensDoProjeto: (projetoId: string) => bens.filter((b) => b.projeto_id === projetoId)
      .map((b) => ({ numero: b.numero, nome: b.nome, valor: b.valor, data_aquisicao: b.data_aquisicao, situacao: b.situacao })),
    leituras: {
      configPix: async () => pix,
      categoriasSocio: async () => [...categorias],
      salariosMinimos: async () => [...salarios],
      parcelasUnicas: async (id: string) => parcelas.filter((u) => u.pessoa_id === id).sort((a, b) => b.ano - a.ano),
      pessoas: async () => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)),
      mensalidades: async (id?: string) => mensalidades.filter((m) => !id || m.pessoa_id === id).sort((a, b) => b.competencia.localeCompare(a.competencia)),
      documentosPessoa: async (id: string) => docsPessoa.filter((x) => x.pessoa_id === id),
      consentimentos: async (id: string) => consentimentos.filter((x) => x.pessoa_id === id),
      saude: async (id: string) => saude.find((x) => x.pessoa_id === id) ?? null,
      documentosSaude: async (id: string) => docsSaude.filter((x) => x.pessoa_id === id),
      bens: async () => [...bens].sort((a, b) => a.numero.localeCompare(b.numero)),
      emprestimos: async () => [...emprestimos],
      manutencoes: async (id: string) => manutencoes.filter((m) => m.bem_id === id),
      documentosInstitucionais: async () => [...docsInst],
      mandatos: async () => [...mandatos],
      reunioes: async () => [...reunioes].sort((a, b) => b.data.localeCompare(a.data)),
      presencas: async (id: string) => presencas.filter((x) => x.reuniao_id === id),
      deliberacoes: async (id: string) => deliberacoes.filter((x) => x.reuniao_id === id).sort((a, b) => a.ordem - b.ordem),
      tiposFiliacao: async () => [...tiposFiliacao],
      filiacoes: async () => [...filiacoes],
      documentosFiliacao: async (id: string) => docsFiliacao.filter((x) => x.filiacao_id === id),
      presencasEvento: async (id: string) => presencasEvento.filter((x) => x.evento_id === id),
    },
  };
}
