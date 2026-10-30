import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Folha } from '@/components/app/folha';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { fonte } from '@/dados/fonte';
import { lerValorBRL, mascararValor, paraCampo } from '@/lib/dinheiro';
import { ErroApp } from '@/lib/erros';
import { SeletorPessoa, erroMsg } from '@/telas/organizacao/comum';

type Base = { nome: string; rotulo: string; ajuda?: ReactNode; obrigatorio?: boolean; meia?: boolean };
export type Campo = Base & (
  | { tipo: 'texto' | 'textarea' | 'data' | 'numero' | 'valor'; max?: number; placeholder?: string; min?: string }
  | { tipo: 'escolha'; opcoes: { valor: string; rotulo: string }[]; nenhum?: string }
  | { tipo: 'sim_nao' }
  | { tipo: 'membro' }
);
export type Valores = Record<string, string | boolean>;

export function converter(campos: Campo[], v: Valores): { dados: Record<string, unknown> } | { erro: string } {
  const dados: Record<string, unknown> = {};
  for (const c of campos) {
    const bruto = v[c.nome];
    if (c.tipo === 'sim_nao') { dados[c.nome] = bruto === true; continue; }
    const t = typeof bruto === 'string' ? bruto.trim() : '';
    if (!t) { if (c.obrigatorio) return { erro: c.nome }; dados[c.nome] = null; continue; }
    if (c.tipo === 'valor') { const x = lerValorBRL(t); if (!x) return { erro: c.nome }; dados[c.nome] = x; continue; }
    if (c.tipo === 'numero') { const n = Number(t); if (!Number.isInteger(n)) return { erro: c.nome }; dados[c.nome] = n; continue; }
    dados[c.nome] = t;
  }
  return { dados };
}

export function paraTela(campos: Campo[], atual: Record<string, unknown> | null | undefined): Valores {
  const v: Valores = {};
  for (const c of campos) {
    const x = atual?.[c.nome];
    v[c.nome] = c.tipo === 'sim_nao' ? x === true : x === null || x === undefined ? '' : c.tipo === 'valor' ? paraCampo(String(x)) : String(x);
  }
  return v;
}

export function FormularioRpc({ titulo, descricao, campos, inicial, rpc, montar, botao = 'Salvar', aoSalvar, aoFechar, sucesso = 'Salvo', larga, extra }: {
  titulo: string; descricao?: string; campos: Campo[]; inicial?: Record<string, unknown> | null;
  rpc: string; montar: (dados: Record<string, unknown>, idNovo: string) => Record<string, unknown>;
  botao?: string; sucesso?: string; larga?: boolean; extra?: ReactNode;
  aoSalvar?: (r: Record<string, unknown>) => void; aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState<Valores>(() => paraTela(campos, inicial));
  // um id por abertura do formulário: repetir o envio (duplo toque, rede caiu) não duplica no servidor
  const [idNovo] = useState(() => crypto.randomUUID());
  const [erro, setErro] = useState<{ campo?: string; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const muda = (nome: string, x: string | boolean) => setV((a) => ({ ...a, [nome]: x }));
  async function enviar() {
    if (enviando) return;
    setErro(null);
    const r = converter(campos, v);
    if ('erro' in r) {
      const c = campos.find((x) => x.nome === r.erro);
      return setErro({ campo: r.erro, texto: `Confira: ${c?.rotulo.toLowerCase() ?? 'o campo'}.` });
    }
    setEnviando(true);
    try {
      const res = await fonte().rpc<Record<string, unknown>>(rpc, montar(r.dados, idNovo));
      void qc.invalidateQueries();
      toast.success(sucesso);
      aoSalvar?.(res);
      aoFechar();
    } catch (e) {
      setErro({ campo: e instanceof ErroApp ? e.detalhe.campo : undefined, texto: erroMsg(e) });
    } finally { setEnviando(false); }
  }
  const faltando = campos.some((c) => c.obrigatorio && c.tipo !== 'sim_nao' && !String(v[c.nome] ?? '').trim());
  return (
    <Folha aberta aoMudar={(x) => !x && !enviando && aoFechar()} titulo={titulo} descricao={descricao} larga={larga}
      rodape={<Button size="lg" className="w-full" disabled={faltando || enviando} onClick={() => void enviar()}>{enviando && <Spinner data-icon="inline-start" />}{botao}</Button>}>
      <form className="pb-2" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <FieldGroup className="grid grid-cols-2 gap-x-3 gap-y-5">
          {campos.map((c) => {
            const id = `f-${c.nome}`;
            const invalido = erro?.campo === c.nome || undefined;
            const largura = c.meia ? 'col-span-2 sm:col-span-1' : 'col-span-2';
            if (c.tipo === 'membro') {
              return <div key={c.nome} className={largura}><SeletorPessoa id={id} rotulo={c.rotulo} valor={String(v[c.nome] ?? '')} aoMudar={(x) => muda(c.nome, x)} opcional={!c.obrigatorio} /></div>;
            }
            if (c.tipo === 'sim_nao') {
              return <label key={c.nome} className={`${largura} flex items-center gap-2 text-[17px]`}><Checkbox checked={v[c.nome] === true} onCheckedChange={(x) => muda(c.nome, x === true)} />{c.rotulo}</label>;
            }
            return (
              <Field key={c.nome} className={largura} data-invalid={invalido}>
                <FieldLabel htmlFor={id}>{c.rotulo}{!c.obrigatorio && <span className="text-muted-foreground font-normal"> (opcional)</span>}</FieldLabel>
                {c.tipo === 'escolha' ? (
                  <Select value={String(v[c.nome] || (c.nenhum ? '__nenhum' : ''))} onValueChange={(x) => muda(c.nome, x === '__nenhum' ? '' : x)}>
                    <SelectTrigger id={id} aria-invalid={invalido}><SelectValue placeholder="Escolha" /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {c.nenhum && <SelectItem value="__nenhum">{c.nenhum}</SelectItem>}
                      {c.opcoes.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                ) : c.tipo === 'textarea' ? (
                  <Textarea id={id} name={id} rows={3} maxLength={c.max ?? 1000} value={String(v[c.nome] ?? '')} aria-invalid={invalido} onChange={(e) => muda(c.nome, e.target.value)} />
                ) : (
                  <Input id={id} name={id} autoComplete="off" aria-invalid={invalido} value={String(v[c.nome] ?? '')} placeholder={c.placeholder ?? (c.tipo === 'valor' ? '0,00' : undefined)}
                    type={c.tipo === 'data' ? 'date' : c.tipo === 'numero' ? 'number' : 'text'} min={c.min}
                    inputMode={c.tipo === 'valor' || c.tipo === 'numero' ? 'numeric' : undefined} maxLength={c.tipo === 'texto' ? c.max ?? 160 : undefined}
                    onChange={(e) => muda(c.nome, c.tipo === 'valor' ? mascararValor(e.target.value) : e.target.value)} />
                )}
                {c.ajuda && <FieldDescription>{c.ajuda}</FieldDescription>}
              </Field>
            );
          })}
          {extra && <div className="col-span-2">{extra}</div>}
          {erro && <FieldError role="alert" className="col-span-2">{erro.texto}</FieldError>}
        </FieldGroup>
      </form>
    </Folha>
  );
}
