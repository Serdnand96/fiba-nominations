// Referee neutrality rule for national-team competitions.
//
// A referee cannot work a game their own country plays, nor any game of the
// group their country plays in. Mirrors the backend check in
// api/_lib/routers/games.py (_referee_conflict) so the UI can block with a
// pop-up before hitting the API.

import { personCountryCode, gameCountryCodes } from './countries.js'

// Conflict for assigning `person` to `game` within `allGames` (same
// competition). Returns { reason: 'own_country' | 'own_group', countryCode,
// group? } or null when the assignment is allowed.
export function findRefereeGameConflict(person, game, allGames) {
  const code = personCountryCode(person)
  if (!code || !game) return null

  if (gameCountryCodes(game).has(code)) {
    return { reason: 'own_country', countryCode: code }
  }
  if (game.group_label) {
    const groupGames = (allGames || []).filter(g => g.group_label === game.group_label)
    if (groupGames.some(g => gameCountryCodes(g).has(code))) {
      return { reason: 'own_group', countryCode: code, group: game.group_label }
    }
  }
  return null
}

// Competition-level view for the informative (non-blocking) notice when
// nominating a referee to a whole tournament: which groups are off-limits
// because their country plays there.
export function refereeCompetitionConflicts(person, games) {
  const code = personCountryCode(person)
  if (!code) return null

  const groups = new Set()
  let playsInTournament = false
  for (const g of games || []) {
    if (gameCountryCodes(g).has(code)) {
      playsInTournament = true
      if (g.group_label) groups.add(g.group_label)
    }
  }
  if (!playsInTournament) return null
  return { countryCode: code, groups: [...groups].sort() }
}
