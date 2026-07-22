// Referee neutrality rules.
//
// - National-team competitions (competition.is_national_team): a referee
//   cannot work a game any of their countries plays, nor any game of the
//   group where one of their countries plays.
// - Club competitions: a referee only cannot work games where a club from
//   one of their countries plays (game.team_a_country / team_b_country).
//   There is no group restriction.
// - Special pairs (SPECIAL_DIRECT_BLOCKS, e.g. PUR → USA): referees from the
//   origin country also cannot work games where the blocked country (or its
//   clubs) plays — but the blocked country's GROUP stays allowed.
// - Referees with several nationalities are restricted by all of them.
//
// Mirrors the backend check in api/_lib/routers/games.py (_referee_conflict)
// so the UI can block with a pop-up before hitting the API.

import {
  personCountryCodes, specialBlockedCodes, specialPairOrigin, gameCountryCodes,
} from './countries.js'

const intersect = (a, b) => [...a].filter(x => b.has(x)).sort()

// Conflict for assigning `person` to `game` within `allGames` (same
// competition). Returns null when allowed, or:
//   { reason: 'own_country' | 'own_group' | 'own_club' | 'special_pair',
//     countryCode, group?, team?, origin? }
// countryCode is the MATCHED country (for multi-nationality referees, the
// nationality — or special-blocked country — that triggered the conflict).
export function findRefereeGameConflict(person, game, allGames, isNationalTeam) {
  const codes = personCountryCodes(person)
  if (codes.size === 0 || !game) return null
  const special = specialBlockedCodes(codes)

  if (!isNationalTeam) {
    for (const [country, name] of [
      [game.team_a_country, game.team_a],
      [game.team_b_country, game.team_b],
    ]) {
      const c = (country || '').trim().toUpperCase()
      if (!c) continue
      if (codes.has(c)) return { reason: 'own_club', countryCode: c, team: name }
      if (special.has(c)) {
        return { reason: 'special_pair', countryCode: c, team: name, origin: specialPairOrigin(codes, c) }
      }
    }
    return null
  }

  const gameCodes = gameCountryCodes(game)
  const ownDirect = intersect(gameCodes, codes)
  if (ownDirect.length > 0) return { reason: 'own_country', countryCode: ownDirect[0] }
  const specialDirect = intersect(gameCodes, special)
  if (specialDirect.length > 0) {
    return {
      reason: 'special_pair',
      countryCode: specialDirect[0],
      origin: specialPairOrigin(codes, specialDirect[0]),
    }
  }

  if (game.group_label) {
    const groupGames = (allGames || []).filter(g => g.group_label === game.group_label)
    for (const g of groupGames) {
      const matched = intersect(gameCountryCodes(g), codes)
      if (matched.length > 0) {
        return { reason: 'own_group', countryCode: matched[0], group: game.group_label }
      }
    }
  }
  return null
}

// Competition-level view for the informative (non-blocking) notice when
// nominating a referee to a whole tournament:
// - national teams → groups off-limits (per nationality) + special-pair
//   countries present in the tournament,
// - clubs → clubs from their countries (or special-pair countries).
export function refereeCompetitionConflicts(person, games, isNationalTeam) {
  const codes = personCountryCodes(person)
  if (codes.size === 0) return null
  const special = specialBlockedCodes(codes)

  if (!isNationalTeam) {
    const clubs = new Set()
    for (const g of games || []) {
      for (const [country, name] of [[g.team_a_country, g.team_a], [g.team_b_country, g.team_b]]) {
        const c = (country || '').trim().toUpperCase()
        if (c && (codes.has(c) || special.has(c)) && name) clubs.add(name)
      }
    }
    if (clubs.size === 0) return null
    return { countryCode: [...codes][0], clubs: [...clubs].sort() }
  }

  const groups = new Set()
  const specialPresent = new Set()
  let playsInTournament = false
  for (const g of games || []) {
    const gameCodes = gameCountryCodes(g)
    if (intersect(gameCodes, codes).length > 0) {
      playsInTournament = true
      if (g.group_label) groups.add(g.group_label)
    }
    for (const c of intersect(gameCodes, special)) specialPresent.add(c)
  }
  if (!playsInTournament && specialPresent.size === 0) return null
  return {
    countryCode: [...codes][0],
    groups: playsInTournament ? [...groups].sort() : [],
    playsInTournament,
    specialBlocked: [...specialPresent].sort(),
  }
}
