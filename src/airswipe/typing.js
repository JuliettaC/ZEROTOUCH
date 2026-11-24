// Texto del teclado por permanencia: qué efectos enviar al motor por cada tecla y cómo queda el texto
// visible. Puro (sin React ni Tauri).
//
// El texto visible es SOLO lo que este teclado escribió desde que se abrió (o desde la última búsqueda):
// vive en memoria de la ventana overlay, nunca se guarda (regla del proyecto: no se guarda texto escrito).
// Por eso «Limpiar» y «Borrar palabra» borran como mucho lo que se escribió aquí: no pueden saber qué
// había antes en el campo del navegador.
export const MAX_BUFFER = 120

const backspaces = (n) => Array.from({ length: n }, () => ({ type: 'key', key: 'backspace' }))

/** Palabra que se está escribiendo (lo que va tras el último espacio). */
export const currentWord = (text) => {
  const at = text.lastIndexOf(' ')
  return at === -1 ? text : text.slice(at + 1)
}

/**
 * Plan para una tecla del teclado por permanencia.
 * @param {string} text texto visible actual
 * @param {{kind:string, value?:string}} key tecla (letra, acción o sugerencia con `value` = término)
 * @returns {{effects:Array, text:string, notice?:string, searched?:string}}
 */
export function planKey(text, key) {
  if (key.kind === 'letter') {
    if (text.length >= MAX_BUFFER) return { effects: [], text, notice: 'Texto demasiado largo: busca o limpia.' }
    return { effects: [{ type: 'text', text: key.value }], text: text + key.value }
  }
  if (key.kind === 'suggestion') return planSuggestion(text, key.value)
  switch (key.value) {
    case 'space':
      // Sin dobles espacios ni espacio inicial: mantener la mano en «Espacio» nunca los acumula.
      if (text === '' || text.endsWith(' ')) return { effects: [], text }
      return { effects: [{ type: 'key', key: 'space' }], text: `${text} ` }
    case 'backspace':
      // Se envía aunque no quede texto propio: puede haber texto anterior en el campo que corregir.
      return { effects: backspaces(1), text: text.slice(0, -1) }
    case 'word': {
      const kept = text.replace(/\S*\s*$/, '')
      const n = text.length - kept.length
      if (n === 0) return { effects: [], text, notice: 'No hay ninguna palabra escrita aquí para borrar.' }
      return { effects: backspaces(n), text: kept }
    }
    case 'clear':
      if (text === '') return { effects: [], text, notice: 'No hay nada escrito aquí para limpiar.' }
      return { effects: backspaces(text.length), text: '' }
    case 'enter':
      return { effects: [{ type: 'key', key: 'enter' }], text: '', searched: text.trim() }
    default:
      return { effects: [], text }
  }
}

/**
 * Completa la palabra actual con un término (que puede tener varias palabras: «receta de»). Solo borra
 * lo que difiere: «lasa» + «lasaña» escribe «ña »; «cancion» + «canción» borra 2 y escribe «ón ».
 */
export function planSuggestion(text, term) {
  if (!term) return { effects: [], text }
  const word = currentWord(text)
  let common = 0
  while (common < word.length && common < term.length && word[common] === term[common]) common += 1
  const remove = word.length - common
  const insert = `${term.slice(common)} `
  const next = `${text.slice(0, text.length - word.length)}${term} `
  if (next.length > MAX_BUFFER) return { effects: [], text, notice: 'Texto demasiado largo: busca o limpia.' }
  return { effects: [...backspaces(remove), { type: 'text', text: insert }], text: next }
}

// ── Sugerencias ───────────────────────────────────────────────────────────────────────────────────
/** Minúsculas y sin tildes ni diéresis para comparar prefijos («cancion» encuentra «canción»). */
export const fold = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/**
 * Prepara el sugeridor: términos de recetas (primero, en su orden) y el léxico general por peso.
 * @param {{terminos:string[]}} terms
 * @param {{palabras:string[], pesos:number[]}} lexicon
 */
export function buildSuggester(terms, lexicon) {
  const words = lexicon?.palabras || []
  const weights = lexicon?.pesos || []
  const general = words
    .map((word, i) => ({ word, weight: weights[i] ?? 1 }))
    .filter((entry) => entry.word.length >= 3)
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => ({ word: entry.word, folded: fold(entry.word) }))
  const own = (terms?.terminos || []).map((word) => ({ word, folded: fold(word) }))
  return { own, general }
}

/**
 * Hasta `max` sugerencias para la palabra que se está escribiendo (sin repetir ni la palabra ya completa).
 * Sin ninguna letra escrita no se sugiere nada (23-11-2026, pedido: con el teclado recién abierto parecía un
 * teclado solo para recetas); en cuanto hay una letra, primero los términos de recetas y luego el léxico.
 */
export function suggest(suggester, text, max = 4) {
  if (!suggester) return []
  const word = currentWord(text)
  if (word === '') return []
  const prefix = fold(word)
  const out = []
  const seen = new Set()
  const add = (candidate) => {
    const key = fold(candidate)
    if (seen.has(key) || key === prefix || out.length >= max) return
    seen.add(key)
    out.push(candidate)
  }
  for (const entry of suggester.own) if (entry.folded.startsWith(prefix)) add(entry.word)
  for (const entry of suggester.general) {
    if (out.length >= max) break
    if (entry.folded.startsWith(prefix)) add(entry.word)
  }
  return out
}
