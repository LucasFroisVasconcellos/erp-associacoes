export async function cupomDeExemplo(hoje: string) {
  const c = document.createElement('canvas'); c.width = 360; c.height = 480;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 360, 480); g.fillStyle = '#111'; g.font = 'bold 20px monospace';
  const [a, m, d] = hoje.split('-');
  ['MERCADO EXEMPLO LTDA', 'CNPJ 00.000.000/0001-00', '', 'AGUA MINERAL 12UN   24,90', 'BANANA KG           12,50', 'PAO FRANCES         50,00', '',
    'TOTAL R$            87,40', `${d}/${m}/${a}  10:32`, '', '*** CUPOM FICTICIO ***'].forEach((t, i) => g.fillText(t, 16, 40 + i * 36, 328));
  const blob = await new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('sem imagem'))), 'image/png'));
  return { arquivo: new File([blob], 'cupom-exemplo.png', { type: 'image/png' }), valor: '87,40', descricao: 'Compra — Mercado Exemplo', data: hoje };
}
