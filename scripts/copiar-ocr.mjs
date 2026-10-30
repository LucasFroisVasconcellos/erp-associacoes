// Copia o OCR para public/ocr: o site serve tudo do próprio domínio, sem CDN. É gerado a cada build.
import { copyFileSync, mkdirSync } from 'node:fs';

const destino = 'public/ocr/';
mkdirSync(destino, { recursive: true });
const arquivos = {
  'node_modules/tesseract.js/dist/worker.min.js': 'worker.min.js',
  'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js': 'tesseract-core-lstm.wasm.js',
  'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js': 'tesseract-core-simd-lstm.wasm.js',
  'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract-core-relaxedsimd-lstm.wasm.js',
  'node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz': 'por.traineddata.gz',
};
for (const [de, para] of Object.entries(arquivos)) copyFileSync(de, destino + para);
console.log(`OCR: ${Object.keys(arquivos).length} arquivos em ${destino}`);
