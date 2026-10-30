// Só monta a lista na tela; quem valida e grava é o banco.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Folha } from '@/components/app/folha';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { chaves, useModelosPermissao } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { ModeloPermissao, Permissao } from '@/dados/tipos';
import { NOME_CARGO, type Acao, type Cargo, type Modulo } from '@/lib/acesso';
import { ErroApp } from '@/lib/erros';

export const CARGOS = Object.entries(NOME_CARGO) as [Cargo, string][];
export const ACOES: { valor: Acao; rotulo: string }[] = [
  { valor: 'ver', rotulo: 'Ver' }, { valor: 'criar', rotulo: 'Criar' }, { valor: 'editar', rotulo: 'Editar' },
  { valor: 'aprovar', rotulo: 'Aprovar' }, { valor: 'exportar', rotulo: 'Exportar' }, { valor: 'administrar', rotulo: 'Administrar' },
];
export const MODULOS_PERM: { valor: Modulo; rotulo: string; sensivel?: boolean }[] = [
  { valor: 'financeiro', rotulo: 'Dinheiro' }, { valor: 'contador', rotulo: 'Arquivos do contador' }, { valor: 'relatorios', rotulo: 'Relatórios' },
  { valor: 'verbas', rotulo: 'Verbas previstas' }, { valor: 'projetos', rotulo: 'Projetos' }, { valor: 'captacao', rotulo: 'Captação' },
  { valor: 'agenda', rotulo: 'Agenda' }, { valor: 'tarefas', rotulo: 'Tarefas' }, { valor: 'viagens', rotulo: 'Viagens' },
  { valor: 'pessoas', rotulo: 'Pessoas' }, { valor: 'patrimonio', rotulo: 'Patrimônio' }, { valor: 'filiacoes', rotulo: 'Filiações' },
  { valor: 'documentos', rotulo: 'Documentos' }, { valor: 'avisos', rotulo: 'Avisos' },
  { valor: 'saude', rotulo: 'Dados de saúde dos atletas', sensivel: true },
];
export type Mapa = Record<string, 'tudo' | 'proprios'>;
export const paraMapa = (l: Permissao[]): Mapa => Object.fromEntries(l.map((p) => [`${p.modulo}:${p.acao}`, p.alcance]));
export const paraLista = (m: Mapa): Permissao[] => Object.entries(m).map(([k, alcance]) => { const [modulo, acao] = k.split(':'); return { modulo, acao, alcance } as Permissao; });
export const msgErro = (e: unknown) => (e instanceof ErroApp ? e.message : 'Não foi possível concluir.');

export function GradePermissoes({ mapa, aoMudar, prefixo = 'p' }: { mapa: Mapa; aoMudar: (f: (m: Mapa) => Mapa) => void; prefixo?: string }) {
  const alterna = (k: string, v: boolean) => aoMudar((x) => { const n = { ...x }; if (v) n[k] = n[k] ?? 'tudo'; else delete n[k]; return n; });
  const alternaModulo = (mod: Modulo, v: boolean) => aoMudar((x) => {
    const n = { ...x }; for (const a of ACOES) { const k = `${mod}:${a.valor}`; if (v) n[k] = n[k] ?? 'tudo'; else delete n[k]; } return n;
  });
  return MODULOS_PERM.map((mod) => {
    const marcadas = ACOES.filter((a) => `${mod.valor}:${a.valor}` in mapa).length;
    const id = (s: string) => `${prefixo}-${mod.valor}-${s}`;
    return (
      <fieldset key={mod.valor} className="px-4 py-3">
        <legend className="flex w-full items-center gap-2 text-[15px] font-semibold">
          <span className="min-w-0 flex-1">{mod.rotulo}</span>{mod.sensivel && <Badge variant="destructive">Dado sensível (LGPD)</Badge>}
          <label htmlFor={id('todas')} className="text-tint flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-[13px] font-normal">
            <Checkbox id={id('todas')} checked={marcadas === ACOES.length ? true : marcadas ? 'indeterminate' : false}
              aria-label={`Todas as permissões de ${mod.rotulo}`} onCheckedChange={(v) => alternaModulo(mod.valor, v === true)} />Todas
          </label>
        </legend>
        <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
          {ACOES.map((a) => {
            const k = `${mod.valor}:${a.valor}`;
            return (
              <label key={k} htmlFor={id(a.valor)} className="flex min-h-11 cursor-pointer items-center gap-2 text-[15px]">
                <Checkbox id={id(a.valor)} data-permissao={k} checked={k in mapa} onCheckedChange={(v) => alterna(k, v === true)} />{a.rotulo}
              </label>
            );
          })}
        </div>
        {`${mod.valor}:ver` in mapa && (
          <label htmlFor={id('proprios')} className="text-muted-foreground mt-1 flex min-h-11 cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox id={id('proprios')} checked={mapa[`${mod.valor}:ver`] === 'proprios'}
              onCheckedChange={(v) => aoMudar((x) => ({ ...x, [`${mod.valor}:ver`]: v === true ? 'proprios' : 'tudo' }))} />
            Ver só os próprios registros
          </label>
        )}
      </fieldset>
    );
  });
}

export function SeletorPerfil({ id, aoAplicar }: { id: string; aoAplicar: (calcular: (atual: Mapa) => Promise<Mapa>) => void }) {
  const modelos = useModelosPermissao();
  const comNome = (modelos.data ?? []).filter((m) => !m.cargo);
  function escolher(v: string) {
    aoAplicar(async (atual) => {
      if (v.startsWith('modelo:')) {
        const m = modelos.data?.find((x) => x.id === v.slice(7));
        return m ? paraMapa(m.permissoes) : atual;
      }
      if (v.startsWith('cargo:')) return paraMapa((await fonte().rpc<{ permissoes: Permissao[] }>('modelo_permissoes', { p_cargo: v.slice(6) })).permissoes);
      // saúde nunca entra em lote (LGPD: só de propósito)
      const acoes = v === 'consulta' ? ACOES.filter((a) => a.valor === 'ver') : v === 'tudo' ? ACOES : [];
      const n: Mapa = {};
      for (const [k, x] of Object.entries(atual)) if (k.startsWith('saude:')) n[k] = x;
      for (const mod of MODULOS_PERM.filter((x) => !x.sensivel)) for (const a of acoes) n[`${mod.valor}:${a.valor}`] = 'tudo';
      return n;
    });
  }
  return (
    <Select value="" onValueChange={escolher}>
      <SelectTrigger id={id}><SelectValue placeholder="Escolha para marcar de uma vez…" /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="tudo">Tudo (menos saúde)</SelectItem>
          <SelectItem value="consulta">Só consulta: ver tudo, sem mexer (menos saúde)</SelectItem>
          <SelectItem value="limpar">Desmarcar tudo</SelectItem>
        </SelectGroup>
        {comNome.length > 0 && <SelectGroup><SelectLabel>Modelos cadastrados</SelectLabel>{comNome.map((m) => <SelectItem key={m.id} value={`modelo:${m.id}`}>{m.nome}</SelectItem>)}</SelectGroup>}
        <SelectGroup><SelectLabel>Modelo do cargo</SelectLabel>{CARGOS.map(([v, r]) => <SelectItem key={v} value={`cargo:${v}`}>{r}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function FolhaModelo({ modelo, inicial, cargoInicial, nomeInicial, aoFechar }: { modelo?: ModeloPermissao; inicial?: Mapa; cargoInicial?: Cargo; nomeInicial?: string; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [id] = useState(() => modelo?.id ?? crypto.randomUUID());
  const [nome, setNome] = useState(modelo?.nome ?? nomeInicial ?? '');
  const [cargo, setCargo] = useState<string>(modelo?.cargo ?? cargoInicial ?? 'nenhum');
  const [mapa, setMapa] = useState<Mapa>(() => (modelo ? paraMapa(modelo.permissoes) : inicial ?? {}));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const invalidar = () => { for (const k of [chaves.modelosPermissao, chaves.auditoria]) void qc.invalidateQueries({ queryKey: k }); };
  async function salvar() {
    setOcupado(true); setErro(null);
    try {
      await fonte().rpc('salvar_modelo_permissao', { p: { id, nome: nome.trim(), cargo: cargo === 'nenhum' ? null : cargo, permissoes: paraLista(mapa) } });
      toast.success('Modelo salvo'); invalidar(); aoFechar();
    } catch (e) { setErro(msgErro(e)); } finally { setOcupado(false); }
  }
  async function apagar() {
    setOcupado(true);
    try { await fonte().rpc('apagar_modelo_permissao', { p_id: id }); toast.success(modelo?.cargo ? 'Modelo apagado. O cargo volta ao padrão de fábrica.' : 'Modelo apagado'); invalidar(); aoFechar(); }
    catch (e) { toast.error(msgErro(e)); } finally { setOcupado(false); }
  }
  return (
    <Folha aberta larga aoMudar={(v) => !v && !ocupado && aoFechar()} titulo={modelo || cargoInicial ? 'Editar modelo' : 'Novo modelo de permissão'}
      descricao="Um conjunto de permissões com nome, para aplicar de uma vez. Quem já tem acesso não muda sozinho."
      rodape={<div className="flex w-full gap-2.5">
        {modelo && <Button size="lg" variant="secondary" disabled={ocupado} onClick={() => void apagar()} aria-label="Apagar modelo"><Trash2 aria-hidden="true" /></Button>}
        <Button size="lg" className="flex-1" disabled={ocupado || nome.trim().length < 2} onClick={() => void salvar()}>{ocupado && <Spinner data-icon="inline-start" />}Salvar modelo</Button>
      </div>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="mp-nome">Nome do modelo</FieldLabel>
          <Input id="mp-nome" name="mp-nome" maxLength={60} autoComplete="off" placeholder="Ex.: Comissão técnica, Conselho fiscal" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="mp-cargo">Padrão de um cargo?</FieldLabel>
          <Select value={cargo} onValueChange={setCargo}>
            <SelectTrigger id="mp-cargo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="nenhum">Não, só um modelo com nome</SelectItem>{CARGOS.map(([v, r]) => <SelectItem key={v} value={v}>Sim, padrão de {r}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <FieldDescription>Padrão de um cargo: é o que o convite desse cargo já traz marcado.</FieldDescription></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
      <div className="bg-card -mx-1 rounded-[16px]"><GradePermissoes mapa={mapa} aoMudar={setMapa} prefixo="mp" /></div>
    </Folha>
  );
}

export function FolhaPadraoCargo({ cargo, aoFechar }: { cargo: Cargo; aoFechar: () => void }) {
  const padrao = useQuery({ queryKey: ['modelo-cargo', cargo], queryFn: () => fonte().rpc<{ permissoes: Permissao[] }>('modelo_permissoes', { p_cargo: cargo }) });
  const falhou = padrao.isError;
  useEffect(() => { if (falhou) { toast.error(msgErro(padrao.error)); aoFechar(); } }, [falhou]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!padrao.data) return null;
  return <FolhaModelo inicial={paraMapa(padrao.data.permissoes)} cargoInicial={cargo} nomeInicial={`Padrão de ${NOME_CARGO[cargo]}`} aoFechar={aoFechar} />;
}
