// Cada exportação fica registrada na auditoria pelo servidor.
import { CalendarRange, FileDown, FileSpreadsheet, FolderKanban, Globe, LineChart, Target, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Valor } from '@/components/app/valor';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { usePerfil } from '@/app/sessao';
import { pode } from '@/lib/acesso';
import { fonte } from '@/dados/fonte';
import type { LinhaRelatorio } from '@/dados/tipos';
import { hojeSP } from '@/lib/datas';
import { ErroApp } from '@/lib/erros';
import { contar } from '@/lib/texto';
import { exportarCsv, exportarPdf, totais } from '@/lib/exportar';

export function Relatorios() {
  const perfil = usePerfil();
  const hoje = hojeSP();
  const [inicio, setInicio] = useState(hoje.slice(0, 5) + '01-01');
  const [fim, setFim] = useState(hoje);
  const [ocupado, setOcupado] = useState<null | 'pdf' | 'csv' | 'ver'>(null);
  const [resumo, setResumo] = useState<ReturnType<typeof totais> & { n: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function dados() {
    const r = await fonte().rpc<{ lancamentos: LinhaRelatorio[] }>('dados_relatorio', { p_inicio: inicio, p_fim: fim });
    return r.lancamentos;
  }
  async function rodar(tipo: 'pdf' | 'csv' | 'ver') {
    if (ocupado) return;
    if (!inicio || !fim || inicio > fim) { setErro('A data inicial precisa ser antes da final.'); return; }
    setErro(null); setOcupado(tipo);
    try {
      const linhas = await dados();
      setResumo({ ...totais(linhas), n: linhas.length });
      if (tipo === 'csv') exportarCsv(linhas, inicio, fim);
      if (tipo === 'pdf') await exportarPdf(linhas, inicio, fim, perfil.membro.nome);
      if (tipo !== 'ver') toast.success(`Relatório ${tipo.toUpperCase()} gerado`);
    } catch (e) { setErro(e instanceof ErroApp ? e.message : 'Não foi possível gerar o relatório.'); }
    finally { setOcupado(null); }
  }
  return (
    <Pagina titulo="Relatórios">
      <section className="bg-card rounded-[20px] p-5">
        <FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <Field><FieldLabel htmlFor="r-ini">De</FieldLabel><Input name="r-ini" id="r-ini" type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="r-fim">Até</FieldLabel><Input name="r-fim" id="r-fim" type="date" value={fim} min={inicio} max={hoje} onChange={(e) => setFim(e.target.value)} /></Field>
          </div>
          <FieldDescription>Período de até 5 anos. Inclui entradas, saídas, previstos e estornos.</FieldDescription>
          {erro && <FieldError role="alert">{erro}</FieldError>}
          <div className="grid gap-2.5 sm:grid-cols-3">
            <Button variant="secondary" disabled={!!ocupado} onClick={() => void rodar('ver')}>{ocupado === 'ver' ? <Spinner data-icon="inline-start" /> : <LineChart data-icon="inline-start" aria-hidden="true" />}Ver resumo</Button>
            <Button disabled={!!ocupado} onClick={() => void rodar('pdf')}>{ocupado === 'pdf' ? <Spinner data-icon="inline-start" /> : <FileDown data-icon="inline-start" aria-hidden="true" />}Baixar PDF</Button>
            <Button variant="secondary" disabled={!!ocupado} onClick={() => void rodar('csv')}>{ocupado === 'csv' ? <Spinner data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" aria-hidden="true" />}Baixar CSV</Button>
          </div>
        </FieldGroup>
      </section>
      {resumo && (
        <Grupo titulo="Resumo do período" rodape={`${contar(resumo.n, 'lançamento', 'lançamentos')}. Só os realizados entram nos totais.`}>
          <Linha titulo="Entradas" valor={<Valor valor={resumo.entradas} tipo="entrada" />} />
          <Linha titulo="Saídas" valor={<Valor valor={resumo.saidas} tipo="saida" />} />
          <Linha titulo="Resultado" valor={<Valor valor={resumo.resultado} className="text-foreground font-semibold" />} />
        </Grupo>
      )}
      <Grupo titulo="Outros relatórios" rodape="Cada um abre na tela certa, com o período e o botão de baixar.">
        <Linha icone={CalendarRange} cor="azul" titulo="Relatório do mês, do trimestre ou do ano" descricao="Uma página em PDF para a diretoria, o conselho fiscal ou a assembleia." para="/analises" />
        <Linha icone={TrendingUp} cor="verde" titulo="Previsão de caixa e cenários “e se…?”" descricao="Para onde o saldo vai nos próximos meses." para="/analises" />
        <Linha icone={Target} cor="laranja" titulo="Orçamento do ano" descricao="Previsto × realizado por categoria." para="/dinheiro/orcamento" />
        {pode(perfil, 'projetos', 'ver') && <Linha icone={FolderKanban} cor="roxo" titulo="Prestação de contas de projeto" descricao="PDF ou CSV por rubrica, dentro de cada projeto." para="/projetos" />}
        <Linha icone={Globe} cor="cinza" titulo="Transparência pública" descricao="Números agregados publicados para qualquer pessoa ver." para="/transparencia/gestao" />
      </Grupo>
    </Pagina>
  );
}
