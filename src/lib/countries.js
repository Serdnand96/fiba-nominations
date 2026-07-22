// FIBA Americas countries — single source of truth for the personnel country
// selector and the referee-neutrality check.
//
// Codes are the official FIBA country codes (they match what the FIBA GDAP
// API returns in team_a_code / team_b_code). Kept in sync with the Python
// mirror in api/_lib/countries.py and the backfill mapping in
// supabase/migrations/014_referee_neutrality.sql.

export const COUNTRIES = [
  { code: 'ARG', en: 'Argentina', es: 'Argentina' },
  { code: 'ARU', en: 'Aruba', es: 'Aruba' },
  { code: 'BAH', en: 'Bahamas', es: 'Bahamas' },
  { code: 'BAR', en: 'Barbados', es: 'Barbados' },
  { code: 'BIZ', en: 'Belize', es: 'Belice' },
  { code: 'BER', en: 'Bermuda', es: 'Bermudas' },
  { code: 'BOL', en: 'Bolivia', es: 'Bolivia' },
  { code: 'BRA', en: 'Brazil', es: 'Brasil' },
  { code: 'IVB', en: 'British Virgin Islands', es: 'Islas Vírgenes Británicas' },
  { code: 'CAN', en: 'Canada', es: 'Canadá' },
  { code: 'CAY', en: 'Cayman Islands', es: 'Islas Caimán' },
  { code: 'CHI', en: 'Chile', es: 'Chile' },
  { code: 'COL', en: 'Colombia', es: 'Colombia' },
  { code: 'CRC', en: 'Costa Rica', es: 'Costa Rica' },
  { code: 'CUB', en: 'Cuba', es: 'Cuba' },
  { code: 'DMA', en: 'Dominica', es: 'Dominica' },
  { code: 'DOM', en: 'Dominican Republic', es: 'República Dominicana' },
  { code: 'ECU', en: 'Ecuador', es: 'Ecuador' },
  { code: 'ESA', en: 'El Salvador', es: 'El Salvador' },
  { code: 'GRN', en: 'Grenada', es: 'Granada' },
  { code: 'GUA', en: 'Guatemala', es: 'Guatemala' },
  { code: 'GUY', en: 'Guyana', es: 'Guyana' },
  { code: 'HAI', en: 'Haiti', es: 'Haití' },
  { code: 'HON', en: 'Honduras', es: 'Honduras' },
  { code: 'JAM', en: 'Jamaica', es: 'Jamaica' },
  { code: 'MEX', en: 'Mexico', es: 'México' },
  { code: 'NCA', en: 'Nicaragua', es: 'Nicaragua' },
  { code: 'PAN', en: 'Panama', es: 'Panamá' },
  { code: 'PAR', en: 'Paraguay', es: 'Paraguay' },
  { code: 'PER', en: 'Peru', es: 'Perú' },
  { code: 'PUR', en: 'Puerto Rico', es: 'Puerto Rico' },
  { code: 'SKN', en: 'Saint Kitts and Nevis', es: 'San Cristóbal y Nieves' },
  { code: 'LCA', en: 'Saint Lucia', es: 'Santa Lucía' },
  { code: 'VIN', en: 'Saint Vincent and the Grenadines', es: 'San Vicente y las Granadinas' },
  { code: 'SUR', en: 'Suriname', es: 'Surinam' },
  { code: 'TTO', en: 'Trinidad and Tobago', es: 'Trinidad y Tobago' },
  { code: 'TCA', en: 'Turks and Caicos Islands', es: 'Islas Turcas y Caicos' },
  { code: 'USA', en: 'United States', es: 'Estados Unidos' },
  { code: 'ISV', en: 'US Virgin Islands', es: 'Islas Vírgenes de EE. UU.' },
  { code: 'URU', en: 'Uruguay', es: 'Uruguay' },
  { code: 'VEN', en: 'Venezuela', es: 'Venezuela' },
]

const _BY_CODE = Object.fromEntries(COUNTRIES.map(c => [c.code, c]))

export function normalizeCountryName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

const _NAME_TO_CODE = {}
for (const c of COUNTRIES) {
  _NAME_TO_CODE[normalizeCountryName(c.en)] = c.code
  _NAME_TO_CODE[normalizeCountryName(c.es)] = c.code
}

export function countryName(code, lang = 'es') {
  const c = _BY_CODE[code]
  if (!c) return code || ''
  return lang === 'en' ? c.en : c.es
}

// Free text ("Brasil", "brazil ", "COL") → FIBA code, or null if unrecognized.
export function countryNameToCode(name) {
  if (!name) return null
  const upper = name.trim().toUpperCase()
  if (_BY_CODE[upper]) return upper
  return _NAME_TO_CODE[normalizeCountryName(name)] || null
}

// Best-effort country code for a person: explicit code first, then the
// legacy free-text country field.
export function personCountryCode(person) {
  if (!person) return null
  return person.country_code || countryNameToCode(person.country)
}

// All nationalities of a person (Set of FIBA codes): primary country plus
// the `nationalities` array. Referees with several nationalities are
// restricted by all of them.
export function personCountryCodes(person) {
  const codes = new Set()
  const primary = personCountryCode(person)
  if (primary) codes.add(primary)
  for (const nat of person?.nationalities || []) {
    const c = (nat || '').trim().toUpperCase()
    if (c) codes.add(c)
  }
  return codes
}

// Special neutrality pairs: referees from `origin` also cannot work games
// where `blocked` plays — but blocked's GROUP stays allowed. Confirmed by
// FIBA Americas for PUR → USA (2026-07). Mirrors api/_lib/countries.py.
export const SPECIAL_DIRECT_BLOCKS = { PUR: ['USA'] }

// Extra game-level-only blocked countries derived from the special pairs.
export function specialBlockedCodes(personCodes) {
  const blocked = new Set()
  for (const origin of personCodes) {
    for (const b of SPECIAL_DIRECT_BLOCKS[origin] || []) blocked.add(b)
  }
  for (const own of personCodes) blocked.delete(own)
  return blocked
}

// Which of the person's nationalities triggers the special pair for a
// blocked country (e.g. matched USA → origin PUR).
export function specialPairOrigin(personCodes, blockedCode) {
  for (const origin of personCodes) {
    if ((SPECIAL_DIRECT_BLOCKS[origin] || []).includes(blockedCode)) return origin
  }
  return null
}

// Country keys (codes) present in one game: team codes when available,
// otherwise mapped from the team names.
export function gameCountryCodes(game) {
  const codes = new Set()
  for (const [code, name] of [
    [game.team_a_code, game.team_a],
    [game.team_b_code, game.team_b],
  ]) {
    const c = (code && code.toUpperCase()) || countryNameToCode(name)
    if (c) codes.add(c)
  }
  return codes
}
