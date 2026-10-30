// Imitação do api.js do Turnstile, só para teste: emite tokens numerados quando liberado.
(function () {
  let n = 0, cbs = {}, liberado = false, pend = [];
  const emitir = (id) => { const f = () => cbs[id] && cbs[id].callback && cbs[id].callback('TOKEN-' + (++n)); liberado ? setTimeout(f, 30) : pend.push(f); };
  window.__liberar = () => { liberado = true; pend.splice(0).forEach((f) => setTimeout(f, 30)); };
  window.__resets = 0;
  window.turnstile = {
    render(el, opts) { (window.__acoes = window.__acoes || []).push(opts.action || null); const id = 'w' + Object.keys(cbs).length; cbs[id] = opts; emitir(id); return id; },
    reset(id) { window.__resets++; emitir(id ?? Object.keys(cbs)[0]); },
    remove(id) { delete cbs[id]; }, getResponse() { return undefined; }, isExpired() { return false; },
    execute(id) { emitir(id); }, ready(cb) { cb(); },
  };
  const onload = new URL(document.currentScript.src).searchParams.get('onload');
  if (onload && typeof window[onload] === 'function') window[onload]();
})();
