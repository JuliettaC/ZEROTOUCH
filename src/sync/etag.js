// ETag de borrado condicional, calculado con lo que la interfaz CONOCÍA al decidir borrar.
// Mismo algoritmo que backend/src/domain/etag.js; ambos se contrastan con contracts/etag-vectores.json.
//  - Modo: identidad + versión (la versión del modo cubre también sus asignaciones).
//  - Perfil: agregado = identidad + versión del perfil + (id, versión) de TODOS sus modos conocidos.
// El servidor lo recalcula dentro de la transacción que borra: si algo cambió en otro equipo (el perfil,
// un modo, sus asignaciones, o si se añadió o quitó un modo), responde 412 y no borra nada.
async function encode(text) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32)
}

export const modeEtag = async (id, version) => `"${await encode(`modo:${id}|v${version}`)}"`

/** @param {{id:string, version:number}[]} modes modos del perfil conocidos (con versión); el orden no importa */
export async function profileEtag(id, version, modes) {
  const children = modes.map(mode => `${mode.id}:${mode.version}`).sort().join(';')
  return `"${await encode(`perfil:${id}|v${version}|${children}`)}"`
}
