const key = value => String(value).trim().normalize('NFC').toLowerCase()
const truncate = (value, length) => value.slice(0, length).replace(/[\uD800-\uDBFF]$/, '')

export function uniqueName(name, taken) {
  const used = new Set(taken.map(key))
  const base = truncate(String(name).trim().normalize('NFC'), 60)
  let candidate = base
  for (let index = 2; used.has(key(candidate)); index += 1) {
    const suffix = ` (${index})`
    candidate = `${truncate(base, 60 - suffix.length).trimEnd()}${suffix}`
  }
  return candidate
}
