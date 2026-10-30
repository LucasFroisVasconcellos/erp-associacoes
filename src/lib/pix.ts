// Pix copia e cola (BR Code estático), gerado no aparelho. Só leva dados públicos do recebedor e um txid aleatório.

export interface DadosPix {
  chave: string;
  /** nome do recebedor, sem acento, até 25 caracteres */
  nome: string;
  /** cidade do recebedor, sem acento, até 15 caracteres */
  cidade: string;
  /** "30.00"; vazio = a pessoa digita o valor no banco */
  valor?: string | null;
  /** identificador da cobrança: letras e números, até 25 */
  txid?: string | null;
}

export function asciiPix(texto: string, max: number): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max).toUpperCase();
}

function campo(id: string, valor: string): string {
  if (valor.length > 99) throw new Error(`campo ${id} grande demais`);
  return id + String(valor.length).padStart(2, '0') + valor;
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), o exigido no campo 63 do BR Code. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function brCodePix(d: DadosPix): string {
  const chave = d.chave.trim();
  if (!chave) throw new Error('chave Pix vazia');
  const nome = asciiPix(d.nome, 25), cidade = asciiPix(d.cidade, 15);
  if (nome.length < 3 || cidade.length < 2) throw new Error('nome ou cidade do recebedor inválidos');
  const txid = (d.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const valor = d.valor && Number(d.valor) > 0 ? Number(d.valor).toFixed(2) : null;
  const corpo = campo('00', '01')
    + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave))
    + campo('52', '0000')
    + campo('53', '986')
    + (valor ? campo('54', valor) : '')
    + campo('58', 'BR')
    + campo('59', nome)
    + campo('60', cidade)
    + campo('62', campo('05', txid))
    + '6304';
  return corpo + crc16(corpo);
}

export function brCodeValido(codigo: string): boolean {
  if (!/^000201/.test(codigo) || codigo.length < 30) return false;
  return crc16(codigo.slice(0, -4)) === codigo.slice(-4).toUpperCase();
}
