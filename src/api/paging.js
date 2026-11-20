// Recorre un listado paginado de la API (limite 100) hasta agotarlo, con un tope de seguridad.
export async function allPages(read, { pageSize = 100, maxPages = 10 } = {}) {
  const rows = []
  for (let page = 0; page < maxPages; page += 1) {
    const result = await read(page * pageSize)
    const data = Array.isArray(result?.data) ? result.data : []
    rows.push(...data)
    if (data.length < pageSize) return rows
  }
  throw { code: 'RESPONSE_LIMIT', message: 'La lista supera el límite esperado. Vuelve a cargar la aplicación.' }
}
