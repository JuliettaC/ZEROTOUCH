import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildIndex, decode, idealPath, withExtras } from '../../src/airswipe/decoder.js'

const read = name => JSON.parse(readFileSync(new URL(`../../src/airswipe/${name}`, import.meta.url), 'utf8'))
const base = read('lexico-es.json')
const extra = read('lexico-extra-es.json')
const merged = withExtras(base, extra)
// El teclado no distingue tildes al trazar: una palabra sin tilde queda cubierta por su forma acentuada.
const strip = word => [...word].map(c => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' })[c] || c).join('')
const covered = lexicon => new Set(lexicon.palabras.flatMap(word => [word, strip(word)]))

// Palabras de uso común usadas para medir la cobertura (12-11-2026): la lista base omitía 42 de estas 429.
const COMMON = [
  'hola', 'gracias', 'adiós', 'adios', 'buenos', 'buenas', 'días', 'dias', 'tardes', 'noches', 'favor', 'por',
  'perdón', 'perdon', 'disculpa', 'sí', 'si', 'no', 'claro', 'vale', 'bien', 'mal', 'mejor', 'peor',
  'muy', 'mucho', 'mucha', 'muchos', 'muchas', 'poco', 'poca', 'pocos', 'más', 'menos', 'tan', 'tanto',
  'también', 'tampoco', 'ahora', 'luego', 'después', 'antes', 'hoy', 'mañana', 'ayer', 'siempre', 'nunca', 'todavía',
  'ya', 'aquí', 'ahí', 'allí', 'donde', 'dónde', 'cuándo', 'cuando', 'cómo', 'como', 'qué', 'que',
  'quién', 'quien', 'cuál', 'cual', 'porque', 'para', 'con', 'sin', 'sobre', 'entre', 'hasta', 'desde',
  'hacia', 'según', 'durante', 'mediante', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'yo', 'tú', 'tu', 'él', 'ella', 'nosotros', 'ellos', 'ellas', 'usted', 'ustedes', 'me', 'te',
  'se', 'nos', 'les', 'lo', 'le', 'mi', 'mis', 'tus', 'su', 'sus', 'nuestro', 'este',
  'esta', 'esto', 'ese', 'esa', 'eso', 'aquel', 'y', 'o', 'pero', 'sino', 'aunque', 'ser',
  'estar', 'haber', 'tener', 'hacer', 'poder', 'decir', 'ir', 'ver', 'dar', 'saber', 'querer', 'llegar',
  'pasar', 'deber', 'poner', 'parecer', 'quedar', 'creer', 'hablar', 'llevar', 'dejar', 'seguir', 'encontrar', 'llamar',
  'venir', 'pensar', 'salir', 'volver', 'tomar', 'conocer', 'vivir', 'sentir', 'tratar', 'mirar', 'contar', 'empezar',
  'esperar', 'buscar', 'existir', 'entrar', 'trabajar', 'escribir', 'perder', 'producir', 'ocurrir', 'entender', 'pedir', 'recibir',
  'recordar', 'terminar', 'permitir', 'aparecer', 'conseguir', 'comenzar', 'servir', 'sacar', 'necesitar', 'mantener', 'resultar', 'leer',
  'caer', 'cambiar', 'presentar', 'crear', 'abrir', 'considerar', 'oír', 'acabar', 'convertir', 'ganar', 'formar', 'traer',
  'partir', 'morir', 'aceptar', 'realizar', 'suponer', 'comprender', 'lograr', 'explicar', 'preguntar', 'tocar', 'reconocer', 'estudiar',
  'alcanzar', 'nacer', 'dirigir', 'correr', 'utilizar', 'pagar', 'ayudar', 'gustar', 'jugar', 'escuchar', 'cumplir', 'ofrecer',
  'descubrir', 'levantar', 'intentar', 'casa', 'cosa', 'tiempo', 'año', 'años', 'día', 'vez', 'vida', 'mundo',
  'país', 'hombre', 'mujer', 'niño', 'niña', 'trabajo', 'familia', 'amigo', 'amiga', 'persona', 'gente', 'ciudad',
  'calle', 'agua', 'comida', 'cocina', 'receta', 'masa', 'galletas', 'pausa', 'pausar', 'reanudar', 'teclado', 'ratón',
  'pantalla', 'cámara', 'mano', 'manos', 'dedo', 'dedos', 'temporizador', 'minutos', 'minuto', 'segundos', 'segundo', 'hora',
  'horas', 'música', 'canción', 'video', 'vídeo', 'foto', 'fotos', 'mensaje', 'correo', 'teléfono', 'llamada', 'reunión',
  'documento', 'archivo', 'carpeta', 'ventana', 'página', 'programa', 'aplicación', 'internet', 'guardar', 'cerrar', 'enviar', 'copiar',
  'pegar', 'borrar', 'deshacer', 'imprimir', 'subir', 'bajar', 'siguiente', 'anterior', 'inicio', 'fin', 'lunes', 'martes',
  'miércoles', 'jueves', 'viernes', 'sábado', 'domingo', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
  'ocho', 'nueve', 'diez', 'cien', 'mil', 'primero', 'tercero', 'feliz', 'triste', 'cansado', 'contento', 'bueno',
  'malo', 'grande', 'pequeño', 'nuevo', 'viejo', 'joven', 'largo', 'corto', 'alto', 'bajo', 'fácil', 'difícil',
  'importante', 'necesario', 'posible', 'listo', 'ocupado', 'libre', 'solo', 'solos', 'junto', 'juntos', 'todo', 'todos',
  'toda', 'todas', 'nada', 'nadie', 'alguien', 'algo', 'algún', 'alguna', 'otro', 'otra', 'otros', 'mismo',
  'misma', 'cada', 'tal', 'quizás', 'quizá', 'además', 'entonces', 'así', 'pues', 'nombre', 'apellido', 'dirección',
  'número', 'sitio', 'lugar', 'parte', 'forma', 'manera', 'modo', 'caso', 'momento', 'punto', 'problema', 'pregunta',
  'respuesta', 'idea', 'razón', 'verdad', 'historia', 'noticia', 'ejemplo', 'cuenta', 'mesa', 'silla', 'puerta', 'cama',
  'libro', 'papel', 'lápiz', 'coche', 'tren', 'avión', 'bicicleta', 'escuela', 'colegio', 'oficina', 'tienda', 'mercado',
  'hospital', 'médico', 'doctor', 'salud', 'dinero', 'precio', 'compra', 'venta', 'banco',
]

test('el léxico combinado cubre todas las palabras de uso común del sondeo', () => {
  assert.equal(COMMON.length, new Set(COMMON).size)
  const known = covered(merged)
  const missing = COMMON.filter(word => !known.has(word))
  assert.deepEqual(missing, [], `faltan: ${missing.join(' ')}`)
  const baseKnown = covered(base)
  const baseMissing = COMMON.filter(word => !baseKnown.has(word))
  assert.ok(baseMissing.length > 0 && baseMissing.length <= 45, 'la lista base sigue omitiendo palabras: por eso existe la complementaria')
})

test('cada grupo del índice se ordena por frecuencia: lo que deje fuera un tope es lo menos frecuente', () => {
  const index = buildIndex(merged)
  for (const [first, entries] of index.index) {
    for (let i = 1; i < entries.length; i += 1) assert.ok(entries[i - 1].weight >= entries[i].weight, `grupo «${first}» sin ordenar en ${i}`)
  }
})

test('withExtras no duplica, conserva el mayor peso y no modifica los originales', () => {
  const sizeBefore = base.palabras.length
  assert.equal(merged.palabras.length, new Set(merged.palabras).size, 'sin palabras repetidas')
  assert.equal(merged.palabras.length, merged.pesos.length)
  assert.equal(base.palabras.length, sizeBefore, 'el léxico base no se altera')
  const tiny = withExtras({ palabras: ['hola'], pesos: [10] }, { palabras: ['hola', 'adiós'], pesos: [200, 5] })
  assert.deepEqual(tiny, { palabras: ['hola', 'adiós'], pesos: [200, 5] })
  assert.deepEqual(withExtras({ palabras: ['a'], pesos: [1] }, undefined), { palabras: ['a'], pesos: [1] })
})

test('las palabras complementarias solo usan letras del teclado y se proponen al trazarlas', () => {
  assert.ok(extra.palabras.every(word => /^[a-záéíóúüñ]+$/.test(word)))
  assert.equal(extra.palabras.length, extra.pesos.length)
  assert.ok(extra.pesos.every(weight => Number.isInteger(weight) && weight >= 1 && weight <= 255))
  const index = buildIndex(merged)
  for (const word of ['gracias', 'buenos', 'días', 'años', 'temporizador', 'galletas']) {
    const points = []
    let k = 0
    for (const point of idealPath(word)) for (let i = 0; i < 4; i += 1) { k += 1; points.push({ x: point.x + Math.sin(k) * 0.1, y: point.y + Math.cos(k * 1.3) * 0.1 }) }
    const top = decode(points, index).map(candidate => candidate.word)
    assert.ok(top.slice(0, 3).includes(word), `${word}: ${top.join(', ')}`)
  }
})
