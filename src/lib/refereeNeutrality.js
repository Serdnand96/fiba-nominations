// Referee neutrality rules.
//
// - National-team competitions (competition.is_national_team): a referee
//   cannot work a game their own country plays, nor any game of the group
//   their country plays in.
// - Club competitions: a referee only cannot work games where a club from
//   their country plays (game.team_a_country / team_b_country). There is no
//   group restriction.
//
// Mirrors the backend check in api/_lib/routers/games.py (_referee_conflict)
// so the UI can block with a pop-up before hitting the API.

import { personCountryCode, gameCountryCodes } from './countries.js'

// Conflict for assigning `person` to `game` within `allGames` (same
// competition). Returns { reason: 'own_country' | 'own_group' | 'own_club',
// countryCode, group?, team? } or null when the assignment is allowed.
export function findRefereeGameConflict(person, game, allGames, isNationalTeam) {
  const code = personCountryCode(person)
  if (!code || !game) return null

  if (!isNationalTeam) {
    // Club rule: block only when a club from the referee's country plays.
    // Games whose club countries haven't been filled in never block.
    for (const [country, name] of [
      [game.team_a_country, game.team_a],
      [game.team_b_country, game.team_b],
    ]) {
      if (country && country.toUpperCase() === code) {
        return { reason: 'own_club', countryCode: code, team: name }
      }
    }
    return null
  }

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
// nominating a referee to a whole tournament:
// - national teams → which groups are off-limits,
// - clubs → which clubs from their country play in the tournament.
export function refereeCompetitionConflicts(person, games, isNationalTeam) {
  const code = personCountryCode(person)
  if (!code) return null

  if (!isNationalTeam) {
    const clubs = new Set()
    for (const g of games || []) {
      if ((g.team_a_country || '').toUpperCase() === code && g.team_a) clubs.add(g.team_a)
      if ((g.team_b_country || '').toUpperCase() === code && g.team_b) clubs.add(g.team_b)
    }
    if (clubs.size === 0) return null
    return { countryCode: code, clubs: [...clubs].sort() }
  }

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
