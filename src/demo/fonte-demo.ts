// scripts/verificar-build.mjs reprova a build de produção que contiver este módulo.
import { ErroApp } from '@/lib/erros';
import { somar } from '@/lib/dinheiro';
import { hojeSP, somarDias } from '@/lib/datas';
import type { Fonte, EventoSessao } from '@/dados/fonte';
import { criarOrganizacaoDemo } from './organizacao-demo';
import { criarVerbasDemo } from './verbas-demo';
import { criarFase4Demo } from './fase4-demo';
import { criarFase5Demo } from './fase5-demo';
import { criarImportarDemo } from './importar-demo';
import type {
  ArquivoContador, Categoria, Comprovante, Conta, Convite, ItemAuditoria, ModeloPermissao, PedidoAcesso, Lancamento, Membro, Notificacao,
  Permissao, Reembolso, TipoGasto,
} from '@/dados/tipos';

export const MARCA_DEMO = 'ERP_MODO_DEMONSTRACAO';
const uuid = () => crypto.randomUUID();
const hoje = hojeSP();
const agoraIso = () => new Date().toISOString();

const EU = '00000000-0000-4000-8000-000000000001';
const membros: Membro[] = [
  { id: EU, nome: 'Lia Demonstração', email: 'presidencia@exemplo.test', cargo: 'presidente', ativo: true, acesso_expira_em: null },
  { id: uuid(), nome: 'Rafael Fictício', email: 'vice@exemplo.test', cargo: 'vice_presidente', ativo: true, acesso_expira_em: null },
  { id: uuid(), nome: 'Beatriz Fictícia', email: 'tesouraria@exemplo.test', cargo: 'tesoureiro', ativo: true, acesso_expira_em: null },
  { id: uuid(), nome: 'Carlos Exemplo', email: 'secretaria@exemplo.test', cargo: 'secretario', ativo: true, acesso_expira_em: null },
  { id: uuid(), nome: 'Júlia Exemplo', email: 'diretoria@exemplo.test', cargo: 'diretor', ativo: true, acesso_expira_em: null },
];
const todas = (m: string, acoes: string[]) => acoes.map((acao) => ({ modulo: m, acao, alcance: 'tudo' }) as Permissao);
const permissoesPres: Permissao[] = [
  ...todas('financeiro', ['ver', 'criar', 'editar', 'aprovar', 'exportar', 'administrar']),
  ...todas('contador', ['ver', 'criar', 'editar', 'exportar', 'administrar']),
  ...todas('relatorios', ['ver', 'exportar']),
  ...['verbas', 'projetos', 'captacao', 'agenda', 'tarefas', 'viagens', 'pessoas', 'patrimonio', 'filiacoes', 'documentos', 'avisos'].flatMap((m) => todas(m, ['ver', 'criar', 'editar'])),
];
const permissoes = new Map<string, Permissao[]>(membros.map((m) => [m.id, m.id === EU ? permissoesPres : todas('financeiro', ['ver', 'criar'])]));

const contas: Conta[] = [
  { id: uuid(), nome: 'Conta Movimento', banco: 'Banco Exemplo', agencia: '0001', numero: '12345-6', tipo: 'movimento', saldo_inicial: '8200.00', data_saldo_inicial: '2026-01-01', ativa: true },
  { id: uuid(), nome: 'Projeto Lei de Incentivo', banco: 'Banco Exemplo', agencia: '0001', numero: '98765-4', tipo: 'projeto', saldo_inicial: '0.00', data_saldo_inicial: '2026-01-01', ativa: true },
  { id: uuid(), nome: 'Caixinha', banco: null, agencia: null, numero: null, tipo: 'caixinha', saldo_inicial: '300.00', data_saldo_inicial: '2026-01-01', ativa: true },
];
const [cMov, cProj, cCaixa] = contas as [Conta, Conta, Conta];
const cat = (nome: string, tipo: 'entrada' | 'saida'): Categoria => ({ id: uuid(), nome, tipo, ativa: true });
const categorias: Categoria[] = [
  cat('Transporte', 'saida'), cat('Alimentação', 'saida'), cat('Arbitragem', 'saida'), cat('Material esportivo', 'saida'),
  cat('Tarifas bancárias', 'saida'), cat('Aluguel e infraestrutura', 'saida'), cat('Doações', 'entrada'), cat('Patrocínio', 'entrada'), cat('Rifas e eventos', 'entrada'),
  cat('Repasse de projeto', 'entrada'), cat('Mensalidades', 'entrada'),
];
const catNome = (n: string) => categorias.find((c) => c.nome === n)!;
const tiposGasto: TipoGasto[] = [
  { id: uuid(), nome: 'Combustível', ativo: true, modelo: 'combustivel', campos: [
    { chave: 'litros', rotulo: 'Litros', tipo: 'numero', obrigatorio: true }, { chave: 'posto', rotulo: 'Posto', tipo: 'texto', obrigatorio: false },
    { chave: 'km', rotulo: 'Quilometragem', tipo: 'inteiro', obrigatorio: false }] },
  { id: uuid(), nome: 'Alimentação', ativo: true, modelo: 'alimentacao', campos: [
    { chave: 'local', rotulo: 'Local', tipo: 'texto', obrigatorio: true }, { chave: 'pessoas', rotulo: 'Número de pessoas', tipo: 'inteiro', obrigatorio: true },
    { chave: 'motivo', rotulo: 'Motivo ou evento', tipo: 'texto', obrigatorio: false }] },
];

const lancamentos: Lancamento[] = [];
const comprovantes: Comprovante[] = [];
const reembolsos: Reembolso[] = [];
const fechamentos: { competencia: string; fechado_em: string }[] = [];
const auditoria: ItemAuditoria[] = [];
let idAud = 1;

function novo(p: Partial<Lancamento> & Pick<Lancamento, 'tipo' | 'valor' | 'data' | 'descricao'>): Lancamento {
  const l: Lancamento = {
    id: uuid(), situacao: 'realizada', vencimento: null, data_documento: null, categoria_id: null, conta_id: cMov.id,
    forma_pagamento: 'pix', contraparte_id: null, tipo_gasto_id: null, detalhes: {}, recorrencia_id: null, estorno_de: null,
    motivo: null, sem_comprovante_motivo: null, criado_por: membros[2]!.id, criado_em: agoraIso(), ...p,
  };
  lancamentos.push(l);
  return l;
}
const d = (dias: number) => somarDias(hoje, -dias);
novo({ tipo: 'entrada', valor: '4500.00', data: d(80), descricao: 'Patrocínio Empresa Exemplo — 1ª parcela', categoria_id: catNome('Patrocínio').id, forma_pagamento: 'transferencia' });
novo({ tipo: 'entrada', valor: '12000.00', data: d(70), descricao: 'Repasse do projeto esportivo', categoria_id: catNome('Repasse de projeto').id, conta_id: cProj.id, forma_pagamento: 'transferencia' });
novo({ tipo: 'saida', valor: '1260.00', data: d(66), descricao: 'Ônibus adaptado para o Campeonato Paulista', categoria_id: catNome('Transporte').id, conta_id: cProj.id });
novo({ tipo: 'saida', valor: '342.50', data: d(65), descricao: 'Almoço da delegação na estrada', categoria_id: catNome('Alimentação').id, tipo_gasto_id: tiposGasto[1]!.id, detalhes: { local: 'Restaurante Exemplo', pessoas: '14' } });
novo({ tipo: 'entrada', valor: '2180.00', data: d(50), descricao: 'Rifa solidária — arrecadação', categoria_id: catNome('Rifas e eventos').id, forma_pagamento: 'pix' });
novo({ tipo: 'saida', valor: '480.00', data: d(45), descricao: 'Arbitragem — rodada da liga', categoria_id: catNome('Arbitragem').id });
novo({ tipo: 'saida', valor: '24.90', data: d(35), descricao: 'Tarifa da conta', categoria_id: catNome('Tarifas bancárias').id, forma_pagamento: 'debito_automatico', sem_comprovante_motivo: 'Débito automático do banco' });
novo({ tipo: 'saida', valor: '2350.00', data: d(30), descricao: 'Pneus para as cadeiras de jogo', categoria_id: catNome('Material esportivo').id, conta_id: cProj.id, forma_pagamento: 'boleto' });
novo({ tipo: 'entrada', valor: '650.00', data: d(20), descricao: 'Doações do mês', categoria_id: catNome('Doações').id });
novo({ tipo: 'saida', valor: '196.40', data: d(12), descricao: 'Abastecimento da van', categoria_id: catNome('Transporte').id, tipo_gasto_id: tiposGasto[0]!.id, detalhes: { litros: '32.5', posto: 'Posto Exemplo' } });
novo({ tipo: 'saida', valor: '58.00', data: d(6), descricao: 'Lanche no treino de sábado', categoria_id: catNome('Alimentação').id, conta_id: cCaixa.id, forma_pagamento: 'dinheiro' });
novo({ tipo: 'saida', valor: '89.90', data: d(3), descricao: 'Fita e luvas de treino', categoria_id: catNome('Material esportivo').id, forma_pagamento: 'cartao_debito' });
novo({ tipo: 'saida', situacao: 'prevista', conta_id: null, valor: '650.00', data: somarDias(hoje, 4), descricao: 'Aluguel da quadra', categoria_id: catNome('Aluguel e infraestrutura').id });
novo({ tipo: 'saida', situacao: 'prevista', conta_id: null, valor: '119.90', data: somarDias(hoje, 9), descricao: 'Internet da sede', categoria_id: catNome('Aluguel e infraestrutura').id });
novo({ tipo: 'entrada', situacao: 'prevista', conta_id: null, valor: '4500.00', data: somarDias(hoje, 12), descricao: 'Patrocínio Empresa Exemplo — 2ª parcela', categoria_id: catNome('Patrocínio').id });
const reemb = novo({ tipo: 'saida', situacao: 'prevista', conta_id: null, valor: '74.00', data: d(2), data_documento: d(2), descricao: 'Pedágio pago do próprio bolso', categoria_id: catNome('Transporte').id, criado_por: membros[4]!.id });
reembolsos.push({ lancamento_id: reemb.id, solicitante: membros[4]!.id, situacao: 'solicitado', motivo: null, criado_em: agoraIso() });
for (const l of lancamentos.filter((x) => x.situacao === 'realizada' && x.tipo === 'saida' && !x.sem_comprovante_motivo).slice(0, 5)) {
  comprovantes.push({ id: uuid(), lancamento_id: l.id, caminho: `${l.id}/demo.png`, mime: 'image/png', tamanho: 182_000, origem: 'camera', chave_acesso: null, codigo_barras: null, enviado_em: agoraIso() });
}
const arquivos: ArquivoContador[] = [
  { id: uuid(), competencia: somarDias(hoje, -40).slice(0, 8) + '01', tipo: 'balancete', descricao: 'Balancete mensal', nome_original: 'balancete.pdf', caminho: 'demo/1.pdf', mime: 'application/pdf', tamanho: 240_000, enviado_em: agoraIso() },
  { id: uuid(), competencia: somarDias(hoje, -40).slice(0, 8) + '01', tipo: 'obrigacoes', descricao: 'Prazos de obrigações acessórias', nome_original: 'prazos.csv', caminho: 'demo/2.csv', mime: 'text/csv', tamanho: 3_200, enviado_em: agoraIso() },
];
const convites: Convite[] = [];
const modelos: ModeloPermissao[] = [];
const pedidos: (PedidoAcesso & { situacao: 'pendente' | 'aprovado' | 'recusado' })[] = [
  { id: crypto.randomUUID(), nome: 'Gabriel Exemplo', email: 'gabriel@exemplo.test', criado_em: new Date(Date.now() - 86_400_000).toISOString(), situacao: 'pendente' },
];
const notificacoes: Notificacao[] = [{ id: uuid(), texto: 'Bem-vinda à demonstração do sistema da Associação Exemplo. Todos os dados são fictícios.', criada_em: agoraIso(), lida_em: null }];
function registrar(acao: string, tabela: string | null, registro: string | null, depois: unknown) {
  auditoria.unshift({ id: idAud++, em: agoraIso(), membro_id: EU, acao, tabela, registro_id: registro, antes: null, depois, autor: 'Lia Demonstração' });
}
registrar('inserir', 'contas_bancarias', cMov.id, { nome: cMov.nome });

const nomeCat = (id: string | null) => categorias.find((c) => c.id === id)?.nome ?? null;
const nomeConta = (id: string | null) => contas.find((c) => c.id === id)?.nome ?? null;
const estornados = () => new Set(lancamentos.map((l) => l.estorno_de).filter(Boolean));
function enriquecer(l: Lancamento): Lancamento {
  return { ...l, categoria: nomeCat(l.categoria_id), conta: nomeConta(l.conta_id), autor: membros.find((m) => m.id === l.criado_por)?.nome ?? null,
    comprovantes: comprovantes.filter((c) => c.lancamento_id === l.id).length, estornado: estornados().has(l.id) };
}
function saldo(conta: Conta) {
  const movs = lancamentos.filter((l) => l.situacao === 'realizada' && l.conta_id === conta.id).map((l) => (l.tipo === 'entrada' ? l.valor : '-' + l.valor));
  return somar([conta.saldo_inicial, ...movs]);
}
const mesFechado = (data: string) => fechamentos.some((f) => f.competencia === data.slice(0, 8) + '01');
const semComprovante = (ini: string, fim: string) => lancamentos.filter((l) => l.tipo === 'saida' && l.situacao === 'realizada' && !l.estorno_de
  && l.data >= ini && l.data <= fim && !l.sem_comprovante_motivo && !comprovantes.some((c) => c.lancamento_id === l.id) && !estornados().has(l.id));
const fimDoMes = (comp: string) => somarDias(somarDias(comp, 32).slice(0, 8) + '01', -1);
const falhar = (erro: string, campo?: string): never => { throw new ErroApp({ erro, campo }); };
const espera = () => new Promise((r) => setTimeout(r, 180 + Math.random() * 220));

type Args = Record<string, unknown>;
const RPC: Record<string, (a: Args) => unknown> = {
  meu_perfil: () => ({ ok: true, membro: { ...membros[0]!, admin: true }, permissoes: permissoesPres, avisos_nao_lidos: notificacoes.filter((n) => !n.lida_em).length }),
  aceitar_convite: () => ({ ok: true, ja_membro: true }),
  decidir_pedido_acesso: ({ p_id, p_decisao }) => {
    const x = pedidos.find((y) => y.id === p_id) ?? falhar('nao_encontrado');
    if (x.situacao !== 'pendente') return { ok: x.situacao === p_decisao, repetido: true };
    if (p_decisao === 'aprovado' && !convites.some((c) => c.email === x.email && !c.cancelado_em)) falhar('sem_convite');
    x.situacao = p_decisao as 'aprovado' | 'recusado';
    return { ok: true };
  },
  marcar_avisos_lidos: () => { notificacoes.forEach((n) => { n.lida_em ??= agoraIso(); }); return { ok: true }; },
  painel_inicial: () => {
    const sald = contas.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, saldo: saldo(c) }));
    const total = somar(sald.map((s) => s.saldo));
    const proj = somar(sald.filter((s) => s.tipo === 'projeto').map((s) => s.saldo));
    const ini = hoje.slice(0, 8) + '01';
    const doMes = lancamentos.filter((l) => l.situacao === 'realizada' && l.data >= ini);
    const prox = (tipo: string) => lancamentos.filter((l) => l.situacao === 'prevista' && l.tipo === tipo && l.data <= somarDias(hoje, 15) && !reembolsos.some((r) => r.lancamento_id === l.id))
      .sort((a, b) => a.data.localeCompare(b.data)).map((l) => ({ id: l.id, descricao: l.descricao, valor: l.valor, data: l.data, tipo: l.tipo }));
    return { ok: true, hoje, saldo_total: total, saldo_projetos: proj, saldo_livre: somar([total, '-' + proj]), contas: sald,
      a_pagar: prox('saida'), a_receber: prox('entrada'),
      mes: { entradas: somar(doMes.filter((l) => l.tipo === 'entrada').map((l) => l.valor)), saidas: somar(doMes.filter((l) => l.tipo === 'saida').map((l) => l.valor)) },
      alertas: { sem_comprovante: semComprovante('2020-01-01', hoje).length, vencidas: lancamentos.filter((l) => l.situacao === 'prevista' && l.data < hoje && !reembolsos.some((r) => r.lancamento_id === l.id)).length,
        reembolsos_pendentes: reembolsos.filter((r) => r.situacao === 'solicitado').length, mes_anterior_aberto: Number(hoje.slice(8)) > 10 } };
  },
  criar_lancamento: ({ p }) => {
    const x = p as Partial<Lancamento> & { reembolso?: boolean };
    if (lancamentos.some((l) => l.id === x.id)) return { ok: true, id: x.id, repetido: true };
    const valor = typeof x.valor === 'string' && /^\d{1,8}(\.\d{1,2})?$/.test(x.valor) && Number(x.valor) > 0 ? x.valor : falhar('invalido', 'valor');
    if (!x.descricao || x.descricao.trim().length < 2) falhar('invalido', 'descricao');
    if (!x.categoria_id) falhar('invalido', 'categoria_id');
    const situacao = x.reembolso ? 'prevista' : x.situacao ?? 'realizada';
    if (situacao === 'realizada' && !x.conta_id) falhar('invalido', 'conta_id');
    if (situacao === 'realizada' && x.data! > hoje) falhar('invalido', 'data');
    if (situacao === 'realizada' && mesFechado(x.data!)) falhar('mes_fechado');
    const l = novo({ ...(x as Lancamento), valor, situacao, conta_id: x.reembolso ? null : x.conta_id ?? null, criado_por: EU, data_documento: x.reembolso ? x.data! : null });
    delete (l as { reembolso?: boolean }).reembolso;
    if (x.reembolso) reembolsos.unshift({ lancamento_id: l.id, solicitante: EU, situacao: 'solicitado', motivo: null, criado_em: agoraIso() });
    registrar('inserir', 'lancamentos', l.id, { descricao: l.descricao, valor: l.valor });
    return { ok: true, id: l.id };
  },
  editar_lancamento: ({ p_id, p }) => {
    const l = lancamentos.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
    if (l.situacao === 'realizada' && mesFechado(l.data)) falhar('mes_fechado');
    Object.assign(l, p);
    registrar('alterar', 'lancamentos', l.id, p);
    return { ok: true };
  },
  estornar_lancamento: ({ p_id, p_motivo }) => {
    const l = lancamentos.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
    if (estornados().has(l.id)) falhar('ja_estornado');
    if (!p_motivo || String(p_motivo).trim().length < 3) falhar('invalido', 'motivo');
    const e = novo({ tipo: l.tipo === 'entrada' ? 'saida' : 'entrada', valor: l.valor, data: hoje, descricao: `Estorno: ${l.descricao}`.slice(0, 200), conta_id: l.conta_id, categoria_id: l.categoria_id, estorno_de: l.id, motivo: String(p_motivo), criado_por: EU, sem_comprovante_motivo: 'Estorno' });
    registrar('inserir', 'lancamentos', e.id, { estorno_de: l.id });
    return { ok: true, estorno_id: e.id };
  },
  realizar_lancamento: ({ p_id, p_data, p_conta_id }) => {
    const l = lancamentos.find((x) => x.id === p_id) ?? falhar('nao_encontrado');
    if (l.situacao !== 'prevista') falhar('invalido');
    Object.assign(l, { situacao: 'realizada', vencimento: l.data, data: p_data, conta_id: p_conta_id });
    return { ok: true };
  },
  cancelar_lancamento: ({ p_id, p_motivo }) => { const l = lancamentos.find((x) => x.id === p_id) ?? falhar('nao_encontrado'); Object.assign(l, { situacao: 'cancelada', motivo: p_motivo }); return { ok: true }; },
  decidir_reembolso: ({ p_id, p_aprovar, p_conta_id, p_motivo }) => {
    const r = reembolsos.find((x) => x.lancamento_id === p_id) ?? falhar('nao_encontrado');
    if (r.solicitante === EU) falhar('proprio_reembolso');
    const l = lancamentos.find((x) => x.id === p_id)!;
    if (p_aprovar) { Object.assign(l, { situacao: 'realizada', data: hoje, conta_id: p_conta_id }); r.situacao = 'pago'; }
    else { Object.assign(l, { situacao: 'cancelada', motivo: p_motivo }); r.situacao = 'negado'; r.motivo = String(p_motivo ?? ''); }
    return { ok: true };
  },
  justificar_sem_comprovante: ({ p_id, p_motivo }) => { const l = lancamentos.find((x) => x.id === p_id) ?? falhar('nao_encontrado'); l.sem_comprovante_motivo = String(p_motivo); return { ok: true }; },
  checklist_fechamento: ({ p_competencia }) => {
    const comp = String(p_competencia); const fim = fimDoMes(comp);
    const sem = semComprovante(comp, fim).length;
    const prev = lancamentos.filter((l) => l.situacao === 'prevista' && l.data >= comp && l.data <= fim).length;
    const reem = reembolsos.filter((r) => r.situacao === 'solicitado').length;
    return { ok: true, competencia: comp, ja_fechado: mesFechado(comp), mes_encerrado: fim < hoje, pode_fechar: sem === 0 && fim < hoje && !mesFechado(comp), itens: [
      { chave: 'comprovantes', titulo: 'Toda saída tem comprovante ou justificativa', pendentes: sem, bloqueia: true },
      { chave: 'previstas_vencidas', titulo: 'Contas vencidas no mês foram pagas ou recebidas', pendentes: prev, bloqueia: false },
      { chave: 'reembolsos', titulo: 'Pedidos de reembolso do mês foram decididos', pendentes: reem, bloqueia: false },
      { chave: 'extrato', titulo: 'Extrato do banco conferido com os lançamentos', pendentes: null, bloqueia: true, manual: true }] };
  },
  fechar_mes: ({ p_competencia, p_confirmacoes }) => {
    const ck = RPC.checklist_fechamento!({ p_competencia }) as { pode_fechar: boolean; ja_fechado: boolean };
    if (ck.ja_fechado) falhar('ja_fechado');
    if (!(p_confirmacoes as { extrato_conferido?: boolean })?.extrato_conferido) falhar('invalido', 'extrato_conferido');
    if (!ck.pode_fechar) falhar('pendencias');
    fechamentos.unshift({ competencia: String(p_competencia), fechado_em: agoraIso() });
    registrar('inserir', 'fechamentos', String(p_competencia), null);
    return { ok: true };
  },
  dados_relatorio: ({ p_inicio, p_fim }) => {
    registrar('exportar', 'lancamentos', null, { inicio: p_inicio, fim: p_fim });
    return { ok: true, lancamentos: lancamentos.filter((l) => l.data >= String(p_inicio) && l.data <= String(p_fim)).sort((a, b) => a.data.localeCompare(b.data)).map((l) => ({
      id: l.id, data: l.data, tipo: l.tipo, situacao: l.situacao, valor: l.valor, descricao: l.descricao, categoria: nomeCat(l.categoria_id), conta: nomeConta(l.conta_id),
      forma_pagamento: l.forma_pagamento, contraparte: null, estorno_de: l.estorno_de, tem_comprovante: comprovantes.some((c) => c.lancamento_id === l.id),
      sem_comprovante_motivo: l.sem_comprovante_motivo, criado_por: membros.find((m) => m.id === l.criado_por)?.nome ?? null })) };
  },
  exportar_auditoria: ({ p_inicio, p_fim, p_membro }) => {
    if (!p_inicio || !p_fim || String(p_inicio) > String(p_fim)) falhar('invalido', 'periodo');
    const dentro = (iso: string) => { const d = hojeSP(new Date(iso)); return d >= String(p_inicio) && d <= String(p_fim); };
    const linhas = auditoria.filter((a) => dentro(a.em) && (!p_membro || a.membro_id === p_membro || a.registro_id === p_membro))
      .sort((a, b) => a.id - b.id).map(({ autor, ...a }) => ({ ...a, autor: autor ?? null }));
    registrar('exportar', 'auditoria', null, { inicio: p_inicio, fim: p_fim, membro: p_membro ?? null, linhas: linhas.length });
    return { ok: true, linhas, truncado: false };
  },
  modelo_permissoes: ({ p_cargo }) => ({ ok: true, permissoes: modelos.find((m) => m.cargo === p_cargo)?.permissoes
    ?? (p_cargo === 'conselho_fiscal' ? ['financeiro', 'contador', 'relatorios', 'verbas', 'projetos'].flatMap((m) => todas(m, ['ver', 'exportar']))
      .concat(['patrimonio', 'documentos', 'viagens', 'captacao', 'filiacoes', 'avisos', 'agenda'].flatMap((m) => todas(m, ['ver'])))
    : p_cargo === 'dev' ? ['financeiro', 'contador', 'relatorios', 'verbas', 'projetos', 'captacao', 'agenda', 'tarefas', 'viagens', 'pessoas', 'patrimonio', 'filiacoes', 'documentos', 'avisos', 'saude']
      .flatMap((m) => todas(m, ['ver', 'criar', 'editar', 'aprovar', 'exportar', 'administrar'])) : todas('financeiro', ['ver', 'criar']))  }),
  salvar_modelo_permissao: ({ p }) => {
    const q = p as Omit<ModeloPermissao, 'atualizado_em'>;
    if (!q.nome || q.nome.trim().length < 2) falhar('invalido', 'nome');
    if (modelos.some((m) => m.id !== q.id && m.nome.toLowerCase() === q.nome.trim().toLowerCase())) falhar('conflito', 'nome');
    if (q.cargo && modelos.some((m) => m.id !== q.id && m.cargo === q.cargo)) falhar('conflito', 'cargo');
    const novo = { ...q, nome: q.nome.trim(), cargo: q.cargo ?? null, atualizado_em: agoraIso() };
    const i = modelos.findIndex((m) => m.id === q.id); if (i >= 0) modelos[i] = novo; else modelos.push(novo);
    return { ok: true, id: q.id };
  },
  apagar_modelo_permissao: ({ p_id }) => { const i = modelos.findIndex((m) => m.id === p_id); if (i < 0) return { ok: true, repetido: true }; modelos.splice(i, 1); return { ok: true }; },
  definir_permissoes: ({ p_membro, p_permissoes }) => { if (p_membro === EU) falhar('proprio_acesso'); permissoes.set(String(p_membro), p_permissoes as Permissao[]); registrar('alterar', 'permissoes', String(p_membro), p_permissoes); return { ok: true }; },
  alterar_membro: ({ p_membro, p_cargo, p_ativo, p_acesso_expira_em }) => {
    if (p_membro === EU) falhar('proprio_acesso');
    const m = membros.find((x) => x.id === p_membro) ?? falhar('nao_encontrado');
    Object.assign(m, { cargo: p_cargo, ativo: p_ativo, acesso_expira_em: p_acesso_expira_em });
    return { ok: true };
  },
  apagar_membro: ({ p_membro }) => {
    if (p_membro === EU) falhar('proprio_acesso');
    const i = membros.findIndex((x) => x.id === p_membro); if (i < 0) falhar('nao_encontrado');
    membros.splice(i, 1); permissoes.delete(String(p_membro)); registrar('remover', 'membros', String(p_membro), null);
    return { ok: true };
  },
  registrar_convite: () => ({ ok: true }),
  cancelar_convite: ({ p_convite }) => { const c = convites.find((x) => x.id === p_convite); if (c) c.cancelado_em = agoraIso(); return { ok: true }; },
  salvar_conta: ({ p }) => { upsert(contas, p as Conta); return { ok: true }; },
  salvar_categoria: ({ p }) => { upsert(categorias, Object.assign({ ativa: true }, p) as Categoria); return { ok: true }; },
  salvar_tipo_gasto: ({ p }) => { upsert(tiposGasto, Object.assign({ ativo: true, modelo: null }, p) as TipoGasto); return { ok: true }; },
  importar_modelos_tipos_gasto: () => ({ ok: true, importados: 0 }),
  gerar_previstos: () => ({ ok: true, criados: 0 }),
  verificar_duplicidade: () => ({ ok: true, lancamentos: [] }),
};
const org = criarOrganizacaoDemo(EU, membros.slice(1).map((m) => m.id));
Object.assign(RPC, org.rpc);
const f3 = criarVerbasDemo(EU, membros.slice(1).map((m) => m.id), {
  lancamentos, contas, novo, catSaida: (n) => catNome(n).id, catEntrada: (n) => catNome(n).id,
});
Object.assign(RPC, f3.rpc);
permissoesPres.push(...todas('verbas', ['aprovar', 'exportar', 'administrar']), ...todas('projetos', ['aprovar', 'exportar', 'administrar']));
const f4 = criarFase4Demo(EU, {
  lancamentos, novo, verbas: f3.leituras.verbas, projetoId: async () => (await f3.leituras.projetos())[0]?.id ?? null,
});
Object.assign(RPC, f4.rpc);
const agendaBase = RPC.agenda_periodo!;
RPC.agenda_periodo = (a) => {
  const r = agendaBase(a) as { prazos: ReturnType<typeof f4.prazos> };
  r.prazos.push(...f4.prazos(String(a.p_inicio), String(a.p_fim)));
  return r;
};
const f5 = criarFase5Demo(EU, {
  lancamentos, contaMovimento: cMov.id, verbas: f3.leituras.verbas,
  atletas: async () => (await f4.leituras.pessoas()).filter((x) => x.atleta && x.situacao === 'ativo'),
});
Object.assign(RPC, f5.rpc);
Object.assign(RPC, criarImportarDemo(EU, { categorias, contas, lancamentos, plano: f5.tabelas.plano_contas, extrato: f5.extrato, novo }).rpc);
const agendaF4 = RPC.agenda_periodo!;
RPC.agenda_periodo = (a) => {
  const r = agendaF4(a) as { prazos: ReturnType<typeof f5.prazos> };
  r.prazos.push(...f5.prazos(String(a.p_inicio), String(a.p_fim)));
  return r;
};
const prestacaoBase = RPC.dados_prestacao!;
RPC.dados_prestacao = (a) => ({ ...(prestacaoBase(a) as object), bens: f4.bensDoProjeto(String(a.p_id)) });
// Na demonstração a presidência vê a área de saúde para conhecer a tela;
// na produção ninguém tem o módulo "saude" por padrão.
permissoesPres.push(...todas('saude', ['ver', 'editar']), ...todas('documentos', ['ver', 'criar', 'editar']));
permissoesPres.push(...todas('agenda', ['administrar']), ...todas('tarefas', ['administrar']), ...todas('avisos', ['administrar']));

RPC.dados_analise = () => {
  const ini = somarDias(hoje.slice(0, 8) + '01', -365).slice(0, 8) + '01';
  const reais = lancamentos.filter((l) => l.situacao === 'realizada' && !l.estorno_de && !estornados().has(l.id) && l.data >= ini && l.data <= hoje);
  const em = (dias: number) => somarDias(hoje, dias);
  return {
    ok: true, hoje, inicio: ini, saldo: somar(contas.map(saldo)),
    previstas: lancamentos.filter((l) => l.situacao === 'prevista').map((l) => ({ data: l.data, tipo: l.tipo, valor: l.valor, categoria: nomeCat(l.categoria_id) ?? '' })),
    recorrencias: [{ tipo: 'saida', valor: '650.00', dia: 10, inicio: '2026-01-01', fim: null, descricao: 'Aluguel da quadra' },
      { tipo: 'saida', valor: '89.90', dia: 5, inicio: '2026-01-01', fim: null, descricao: 'Internet da sede' }],
    parcelas: [{ data: em(40), valor: '4500.00', situacao: 'formalizado', verba: 'Patrocínio Empresa Exemplo' },
      { data: em(100), valor: '15000.00', situacao: 'em_analise', verba: 'Edital municipal de esporte' },
      { data: em(160), valor: '4500.00', situacao: 'formalizado', verba: 'Patrocínio Empresa Exemplo' }],
    mensalidades: { abertas_futuras: Array.from({ length: 6 }, (_, i) => ({ data: em(20 + i * 30), valor: '250.00' })), pagas_12m: 46,
      vencidas_abertas: [{ dias: 12, valor: '50.00' }, { dias: 41, valor: '50.00' }, { dias: 95, valor: '50.00' }] },
    realizados: reais.map((l) => ({ id: l.id, data: l.data, tipo: l.tipo, valor: l.valor, categoria: nomeCat(l.categoria_id) ?? '', fonte: nomeCat(l.categoria_id) ?? '',
      contraparte_id: l.contraparte_id, descricao: l.descricao.slice(0, 80), comprovante: !!l.sem_comprovante_motivo || comprovantes.some((c) => c.lancamento_id === l.id),
      atraso_dias: Math.max(0, Math.round((Date.parse(l.criado_em) - Date.parse(l.data)) / 86_400_000)) })),
    captacao: { prospeccao: { n: 1, valor: '0' }, contato: { n: 2, valor: '11000.00' }, proposta: { n: 1, valor: '12000.00' }, fechado: { n: 1, valor: '500.00' } },
    verbas: [{ situacao: 'formalizado', pedido: '18000.00', aprovado: '18000.00', recebido: '4500.00' }, { situacao: 'em_analise', pedido: '15000.00', aprovado: '0', recebido: '0' },
      { situacao: 'negado', pedido: '8000.00', aprovado: '0', recebido: '0' }],
    atletas_ativos: 5, treinos: { n: 38, presencas: 152 },
    viagens: [{ titulo: 'Campeonato Brasileiro', km: 980, atletas: 8, custo: '6200.00' }],
    tarefas: membros.slice(0, 4).map((m, i) => ({ nome: m.nome, abertas: 3 - (i % 3), atrasadas: i === 0 ? 1 : 0, feitas_no_prazo: 6 - i, feitas_atrasadas: i % 2 })),
  };
};

const montarTransp = (ini: string, fim: string) => {
  const mov = lancamentos.filter((l) => l.situacao === 'realizada' && !l.estorno_de && !estornados().has(l.id) && l.data >= ini && l.data <= fim);
  const soma = (xs: Lancamento[]) => somar(['0', ...xs.map((l) => l.valor)]);
  const porGrupo = (tipo: string) => [...new Set(mov.filter((l) => l.tipo === tipo).map((l) => nomeCat(l.categoria_id) ?? 'Outros'))]
    .map((g) => ({ grupo: g, valor: soma(mov.filter((l) => l.tipo === tipo && (nomeCat(l.categoria_id) ?? 'Outros') === g)) })).sort((a, b) => Number(b.valor) - Number(a.valor));
  const meses = [...new Set(mov.map((l) => l.data.slice(0, 7)))].sort();
  return {
    entradas: soma(mov.filter((l) => l.tipo === 'entrada')), saidas: soma(mov.filter((l) => l.tipo === 'saida')),
    por_mes: meses.map((m) => ({ mes: m, entradas: soma(mov.filter((l) => l.tipo === 'entrada' && l.data.startsWith(m))), saidas: soma(mov.filter((l) => l.tipo === 'saida' && l.data.startsWith(m))) })),
    receitas: porGrupo('entrada'), despesas: porGrupo('saida'),
    verbas_publicas: [{ titulo: 'Projeto esportivo — Lei de Incentivo (exemplo)', origem: 'Secretaria Estadual de Esportes (exemplo)', situacao: 'em_execucao', aprovado: '36000.00', recebido_no_periodo: '12000.00' }],
    projetos: [{ nome: 'Projeto Lei de Incentivo', fonte: 'Lei de Incentivo ao Esporte', aprovado: '36000.00', executado_no_periodo: soma(mov.filter((l) => l.conta_id === cProj.id && l.tipo === 'saida')), vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31' }],
    filiacoes: [{ entidade: 'Confederação Brasileira (exemplo)', situacao: 'ativa' }, { entidade: 'Federação Paulista (exemplo)', situacao: 'ativa' }],
    entidade: { nome: 'Associação Exemplo', cnpj: '11222333000181' },
  };
};
const publicacoes = f5.tabelas.transparencia_publicacoes;
{
  const ini = somarDias(hoje.slice(0, 8) + '01', -62).slice(0, 8) + '01'; const fim = somarDias(hoje.slice(0, 8) + '01', -1);
  publicacoes.push({ id: uuid(), titulo: 'Prestação de contas — últimos meses (exemplo)', periodo_inicio: ini, periodo_fim: fim, observacao: 'Exemplo com dados fictícios.',
    publicado_em: agoraIso(), publicado_por: EU, retirado_em: null, motivo_retirada: null, dados: montarTransp(ini, fim) });
}
RPC.previa_transparencia = ({ p_inicio, p_fim }) => (String(p_fim) < String(p_inicio) ? falhar('invalido', 'periodo') : { ok: true, dados: montarTransp(String(p_inicio), String(p_fim)) });
RPC.publicar_transparencia = ({ p_id, p_titulo, p_inicio, p_fim, p_observacao }) => {
  if (publicacoes.some((x) => x.id === p_id)) return { ok: true, repetido: true };
  publicacoes.push({ id: String(p_id), titulo: String(p_titulo), periodo_inicio: String(p_inicio), periodo_fim: String(p_fim), observacao: (p_observacao as string | null) || null,
    publicado_em: agoraIso(), publicado_por: EU, retirado_em: null, motivo_retirada: null, dados: montarTransp(String(p_inicio), String(p_fim)) });
  return { ok: true, id: p_id, repetido: false };
};
RPC.retirar_transparencia = ({ p_id, p_motivo }) => { const x = publicacoes.find((y) => y.id === p_id) ?? falhar('nao_encontrado'); Object.assign(x, { retirado_em: agoraIso(), motivo_retirada: String(p_motivo) }); return { ok: true }; };
RPC.transparencia_publica = () => ({ ok: true, publicacoes: publicacoes.filter((x) => !x.retirado_em).sort((a, b) => String(b.periodo_fim).localeCompare(String(a.periodo_fim)))
  .map(({ id, titulo, periodo_inicio, periodo_fim, publicado_em, observacao, dados }) => ({ id, titulo, periodo_inicio, periodo_fim, publicado_em, observacao, dados })) });

RPC.busca_global = async ({ p_termo }) => {
  const t = String(p_termo ?? '').trim().toLowerCase();
  if (t.length < 2 || t.length > 60) return falhar('invalido', 'termo');
  const tem = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const pessoas = await f4.leituras.pessoas();
  return { ok: true, resultados: [
    ...lancamentos.filter((l) => tem(l.descricao)).slice(0, 8).map((l) => ({ tipo: 'lancamento', id: l.id, titulo: l.descricao, detalhe: `${l.tipo}|${l.valor}`, data: l.data })),
    ...pessoas.filter((p) => tem(p.nome) && p.situacao !== 'desligado').slice(0, 8).map((p) => ({ tipo: 'pessoa', id: p.id, titulo: p.nome, detalhe: p.atleta ? 'atleta' : 'associado', data: null })),
  ] };
};

function upsert<T extends { id: string }>(lista: T[], item: T) {
  const i = lista.findIndex((x) => x.id === item.id);
  if (i >= 0) lista[i] = { ...lista[i]!, ...item }; else lista.push(item);
}

export function criarFonteDemo(): Fonte {
  let logado = false; let aal: 'aal1' | 'aal2' = 'aal1';
  const ouvintes = new Set<(e: EventoSessao) => void>();
  const avisar = (e: EventoSessao) => ouvintes.forEach((o) => o(e));
  const fator = { id: 'fator-demo', status: 'verified' as const };
  return {
    demo: true,
    captcha: null,
    async sessao() { return logado ? { usuarioId: EU, email: membros[0]!.email, aal, proximoAal: 'aal2' } : null; },
    aoMudarSessao(cb) { ouvintes.add(cb); return () => ouvintes.delete(cb); },
    lembrado: () => false,
    async entrar(email, senha) { await espera(); if (!email.includes('@') || senha.length < 4) falhar('credenciais'); logado = true; aal = 'aal1'; avisar('entrou'); },
    async sair(_todos) { logado = false; aal = 'aal1'; avisar('saiu'); },
    async pedirRecuperacao() { await espera(); },
    async confirmarLink() { await espera(); logado = true; avisar('entrou'); },
    async sessaoDoLink() { await espera(); logado = true; avisar('entrou'); },
    async definirSenha() { await espera(); },
    async fatores() { return [fator]; },
    async cadastrarFator() { return { id: fator.id, qr: '', segredo: 'DEMO DEMO DEMO DEMO' }; },
    async confirmarCodigo(_id, codigo) { await espera(); if (codigo !== '123456') falhar('codigo'); aal = 'aal2'; avisar('atualizou'); },
    async rpc<T>(nome: string, args?: Args) {
      await espera();
      const fn = RPC[nome] ?? falhar('falha_interna');
      return fn(args ?? {}) as T;
    },
    async convidar(dados) {
      await espera();
      convites.unshift({ id: uuid(), email: dados.email, nome: dados.nome, cargo: dados.cargo as never, criado_em: agoraIso(), expira_em: somarDias(hoje, 7), usado_em: null, cancelado_em: null });
      return {};
    },
    async enviarArquivo(form) {
      await espera();
      const destino = form.get('destino');
      if (destino === 'documento' && form.get('area') === 'foto_pessoa') return f4.anexarFoto(String(form.get('documento_id')), form.get('arquivo') as File);
      if (destino === 'documento' && form.get('area') === 'contrapartida') return f5.anexar(String(form.get('documento_id')), (form.get('arquivo') as File).type || 'image/jpeg');
      if (destino === 'documento') return f4.anexar(String(form.get('area')), String(form.get('documento_id')), (form.get('arquivo') as File).type || 'application/pdf');
      if (destino === 'comprovante') {
        const lid = String(form.get('lancamento_id'));
        const c = { id: uuid(), lancamento_id: lid, caminho: `${lid}/${uuid()}`, mime: 'image/jpeg', tamanho: 150_000, origem: String(form.get('origem') ?? 'outro') as never, chave_acesso: null, codigo_barras: null, enviado_em: agoraIso() };
        comprovantes.push(c);
        return { id: c.id, duplicado: false };
      }
      const a = { id: uuid(), competencia: String(form.get('competencia')), tipo: String(form.get('tipo')), descricao: null, nome_original: (form.get('arquivo') as File).name, caminho: 'demo/x', mime: 'application/pdf', tamanho: (form.get('arquivo') as File).size, enviado_em: agoraIso() };
      arquivos.unshift(a);
      return { id: a.id };
    },
    async urlArquivo(_b, caminho) { return caminho.startsWith('blob:') ? caminho : 'about:blank'; },
    async contas() { await espera(); return [...contas]; },
    async categorias() { return [...categorias]; },
    async tiposGasto() { return [...tiposGasto]; },
    async contrapartes() { return []; },
    async recorrencias() { return []; },
    async lancamentos(f) {
      await espera();
      let r = lancamentos.map(enriquecer);
      if (f.situacao && f.situacao !== 'todas') r = r.filter((l) => l.situacao === f.situacao);
      if (f.tipo) r = r.filter((l) => l.tipo === f.tipo);
      if (f.inicio) r = r.filter((l) => l.data >= f.inicio!);
      if (f.fim) r = r.filter((l) => l.data <= f.fim!);
      if (f.busca) r = r.filter((l) => l.descricao.toLowerCase().includes(f.busca!.toLowerCase()));
      r.sort((a, b) => b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em));
      if (f.antesDe) r = r.filter((l) => l.data < f.antesDe!.data || (l.data === f.antesDe!.data && l.criado_em < f.antesDe!.criado_em));
      return r.slice(0, f.limite ?? 50);
    },
    async lancamento(id) { await espera(); const l = lancamentos.find((x) => x.id === id); return l ? enriquecer(l) : null; },
    async comprovantes(id) { return comprovantes.filter((c) => c.lancamento_id === id); },
    async reembolsos() { return reembolsos.map((r) => ({ ...r, lancamento: enriquecer(lancamentos.find((l) => l.id === r.lancamento_id)!), nome_solicitante: membros.find((m) => m.id === r.solicitante)?.nome })); },
    async membros() { await espera(); return [...membros]; },
    async permissoesDe(id) { return permissoes.get(id) ?? []; },
    async convites() { return [...convites]; },
    async modelosPermissao() { return [...modelos].sort((a, b) => a.nome.localeCompare(b.nome)); },
    async pedidosAcesso() { return pedidos.filter((p) => p.situacao === 'pendente'); },
    async pedirAcesso(dados) {
      await espera();
      const email = dados.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) falhar('invalido', 'email');
      if (!pedidos.some((p) => p.email === email && p.situacao === 'pendente')) {
        pedidos.push({ id: uuid(), nome: dados.nome.trim(), email, criado_em: agoraIso(), situacao: 'pendente' });
      }
    },
    async auditoria() { return [...auditoria]; },
    async arquivosContador() { await espera(); return [...arquivos]; },
    async notificacoes() { return [...notificacoes]; },
    async fechamentos() { return [...fechamentos]; },
    ...org.leituras,
    ...f3.leituras,
    ...f4.leituras,
    lista: f5.lista,
  };
}

