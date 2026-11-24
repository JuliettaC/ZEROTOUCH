import { useLayoutEffect, useRef, useState } from 'react'
import { Icon, NavLink } from '../components/UI'

const ASSETS = '/ZEROTOUCH/assets/'

export default function GestureKeyboardPage({ navigate }) {
  const [text, setText] = useState('Preparar masa de galletas y pausar receta')
  const [suggestion, setSuggestion] = useState('Galletas')
  const [paused, setPaused] = useState(false)
  const [uppercase, setUppercase] = useState(true)
  const editor = useRef(null)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  useLayoutEffect(() => {
    const resize = () => {
      const input = editor.current
      if (!input || !input.clientWidth) return
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight}px`
    }
    resize()
    window.addEventListener('resize', resize)
    document.fonts.ready.then(resize)
    return () => window.removeEventListener('resize', resize)
  }, [text])
  const suggestions = ['Galletas', 'Gatos', 'Ganar', 'Garganta']
  const write = letter => { if (!paused) setText(value => value + (uppercase ? letter : letter.toLowerCase())) }
  // Fixed demonstration choices insert at the caret; they never replace unrelated words.
  const choose = word => {
    if (paused) return
    const { start, end } = selection
    const before = text.slice(0, start), after = text.slice(end)
    const insertion = `${before && !/\s$/.test(before) ? ' ' : ''}${word.toLowerCase()}${after && !/^\s/.test(after) ? ' ' : ''}`
    setSuggestion(word)
    setText(before + insertion + after)
    setSelection({ start: start + insertion.length, end: start + insertion.length })
  }
  const shortcuts = [['Pausar simulación', 'Cerrar puño', () => setPaused(value => !value)], ['Espacio continuo', 'Sostener índice', () => write(' ')], ['Limpiar sugerencia', 'Palma abierta', () => setSuggestion('')], ['Borrar palabra', 'Barrido izquierdo', () => { if (!paused) setText(value => value.trimEnd().replace(/\S+$/, '')) }], ['Salto de línea / Enter', 'Dos dedos abajo', () => write('\n')], ['Cambiar sugerencia', 'Giro de muñeca', () => choose(suggestions[(suggestions.indexOf(suggestion) + 1) % suggestions.length])]]
  return <main className="keyboard-page"><div className="desktop-only desktop-keyboard"><div className="keyboard-grid"><div className="keyboard-left"><section className="document-panel"><div className="section-line"><strong>Ejemplo editable: Recetas_Semana.docx</strong><span>Sin autocorrección</span></div><textarea ref={editor} onSelect={event => setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} aria-label="Documento activo" value={text} onChange={event => setText(event.target.value)} spellCheck={false} /></section><div className={`air-keyboard ${paused ? 'paused' : ''}`}><img className="air-photo" src={`${ASSETS}keyboard-imgFirstPersonPerspectiveViewOfHandsTypingInTheAirSoftBlurredLivingRoomBackgroundFutur.png`} alt="Manos escribiendo en el aire" /><div className="suggestions"><small className="suggestion-demo-label">Palabras de ejemplo · Se insertan en el cursor</small>{suggestions.map(word => <button key={word} className={word === suggestion ? 'selected' : ''} onClick={() => choose(word)} disabled={paused}>{word}</button>)}</div><div className="key-layout">{['QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM'].map((row, index) => <div className="key-row" key={row}>{index === 2 && <button aria-label="Mayúsculas" aria-pressed={uppercase} className="special-key" onClick={() => setUppercase(value => !value)}><Icon name="keyboard-imgImg1" /></button>}{[...row].map(letter => <button className={['A', 'G', 'L', 'M', 'E'].includes(letter) ? 'highlight-key' : ''} key={letter} disabled={paused} onClick={() => write(letter)}>{uppercase ? letter : letter.toLowerCase()}</button>)}{index === 2 && <button className="special-key" aria-label="Borrar carácter" disabled={paused} onClick={() => setText(value => value.slice(0, -1))}><Icon name="keyboard-imgImg2" /></button>}</div>)}</div><div className="air-path"><Icon name="keyboard-imgSvg" /></div>{paused && <span className="paused-label">Simulación en pausa</span>}</div></div><aside className="keyboard-aside">{['Atajos de Texto Rápido', 'Gestos de Edición'].map((heading, group) => <section className="panel" key={heading}><h2>{heading}</h2>{group === 1 && <p className="keyboard-mode-note">En Air-Swipe: palma limpia la selección de ejemplo, dos dedos abajo insertan un salto y barrido izquierdo borra una palabra.</p>}{shortcuts.slice(group * 3, group * 3 + 3).map(([title, subtitle, action], index) => <button key={title} className="keyboard-shortcut" onClick={() => action()}><Icon name={`keyboard-imgBackground${group * 3 + index || ''}`} /><span><strong>{title === 'Pausar simulación' && paused ? 'Reanudar simulación' : title}</strong><small>{subtitle}</small></span></button>)}</section>)}</aside></div><nav className="page-actions"><NavLink to="/" navigate={navigate} className="button secondary"><Icon name="back" />Volver al Panel Principal</NavLink></nav></div><div className="mobile-only unavailable"><h1>Air-Swipe</h1><p>El teclado gestual está disponible en escritorio.</p><NavLink to="/calibracion" navigate={navigate} className="button primary">Volver a Calibración</NavLink></div></main>
}
