import { useCallback, useEffect, useSyncExternalStore } from "react"

export type Tema = "system" | "light" | "dark"
const CHAVE = "erp.tema"
const ouvintes = new Set<() => void>()

function lerTema(): Tema {
  try {
    const v = localStorage.getItem(CHAVE)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

function sistemaEscuro() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function aplicarTema(tema: Tema = lerTema()) {
  const escuro = tema === "dark" || (tema === "system" && sistemaEscuro())
  document.documentElement.classList.toggle("dark", escuro)
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", escuro ? "#000000" : "#f2f2f7")
}

function assinar(cb: () => void) {
  ouvintes.add(cb)
  const mq = window.matchMedia("(prefers-color-scheme: dark)")
  const aoMudar = () => { aplicarTema(); cb() }
  mq.addEventListener("change", aoMudar)
  return () => { ouvintes.delete(cb); mq.removeEventListener("change", aoMudar) }
}

export function useTheme() {
  const theme = useSyncExternalStore(assinar, lerTema, () => "system" as Tema)
  useEffect(() => { aplicarTema(theme) }, [theme])
  const setTheme = useCallback((t: Tema) => {
    try { localStorage.setItem(CHAVE, t) } catch { /* modo privado: vale só nesta visita */ }
    aplicarTema(t)
    ouvintes.forEach((o) => o())
  }, [])
  return { theme, setTheme }
}
