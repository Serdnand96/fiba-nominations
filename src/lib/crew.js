// Sede de los oficiales del torneo. Espejo de la regla del backend (api/_lib/crew.py):
// sin ciudades cubre toda la competencia; con ciudades, solo los partidos de
// esas sedes. La comparación ignora tildes, mayúsculas y espacios.

export function cityKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function memberCities(member) {
  const list = Array.isArray(member?.cities) ? member.cities : []
  return list.map(c => String(c ?? '').trim()).filter(Boolean)
}

export function coversGame(member, game) {
  const cities = memberCities(member)
  if (cities.length === 0) return true
  const key = cityKey(game?.city)
  return cities.some(c => cityKey(c) === key)
}
