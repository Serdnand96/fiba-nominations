import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  getGames, getGameDates, getGameTeams, createGame, updateGame, deleteGame,
  syncGameResults, importGamesExcel, getCalendarCompetitions,
  getPersonnel, getGameAssignments, setGameAssignment, deleteGameAssignment,
  syncAssignmentsToNominations, generateAssignmentPDFs, updateCompetition,
  setTeamCountries,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import CompetitionSearch from '../components/CompetitionSearch'
import { COUNTRIES, countryName } from '../lib/countries'
import { findRefereeGameConflict } from '../lib/refereeNeutrality'

const PHASE_OPTIONS = ['Group Phase', 'Quarterfinals', 'Semifinals', 'Classification', 'Finals']
const ASSIGNMENT_TEMPLATES = new Set(['WCQ', 'BCLA', 'LSB'])
// Referee crew slots (neutrality-checked): Crew Chief + Umpires.
const REF_SLOTS = ['CC', 'U1', 'U2']
const REF_SLOT_SET = new Set(REF_SLOTS)
// Instructor + Video Operator: nominated per game, no neutrality check.
const CREW_SLOTS = ['INSTR', 'VO']

const EMPTY_FORM = {
  date: '', time: '', team_a: '', team_a_code: '', team_a_country: '',
  team_b: '', team_b_code: '', team_b_country: '',
  score_a: '', score_b: '', venue: '', city: '', country: '', phase: 'Group Phase',
  group_label: '', status: 'scheduled', sport: 'Basketball',
}

// Last Games search (competition + filters), persisted so returning to the
// page restores it instead of forcing the user to rebuild the same search.
const LAST_SEARCH_KEY = 'fiba_games_last_search'

function loadLastSearch() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_SEARCH_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      compId: typeof parsed.compId === 'string' ? parsed.compId : '',
      dates: Array.isArray(parsed.dates) ? parsed.dates.filter(d => typeof d === 'string') : [],
      group: typeof parsed.group === 'string' ? parsed.group : '',
    }
  } catch {
    return null
  }
}

export default function Games() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('games')

  // Data
  const [competitions, setCompetitions] = useState([])
  const [selectedCompId, setSelectedCompId] = useState('')
  const [games, setGames] = useState([])
  const [gameDates, setGameDates] = useState([])
  const [teams, setTeams] = useState([])
  const [assignments, setAssignments] = useState([]) // per-game TD/VGO assignments

  // Filters
  const [filterDates, setFilterDates] = useState([]) // empty = all dates
  const [filterGroup, setFilterGroup] = useState('')

  // UI state
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [syncingNoms, setSyncingNoms] = useState(false)
  const [nomMsg, setNomMsg] = useState('')
  const [generatingPdfs, setGeneratingPdfs] = useState(false)
  const [showDefaults, setShowDefaults] = useState(false)
  const [defaults, setDefaults] = useState({})
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [defaultsMsg, setDefaultsMsg] = useState('')
  // Club country mapping panel (club competitions only)
  const [showTeamCountries, setShowTeamCountries] = useState(false)
  const [teamCountryDraft, setTeamCountryDraft] = useState({}) // team name → code
  const [savingTeamCountries, setSavingTeamCountries] = useState(false)
  const [teamCountriesMsg, setTeamCountriesMsg] = useState('')
  const fileRef = useRef(null)
  const autoSyncDone = useRef(new Set()) // track which comps we've auto-synced
  const lastSearchRef = useRef(loadLastSearch()) // pending restore, consumed once
  // Blocking pop-up when a referee with a country conflict is selected
  const [refConflict, setRefConflict] = useState(null)

  const selectedComp = competitions.find(c => c.id === selectedCompId)
  const supportsAssignments = ASSIGNMENT_TEMPLATES.has((selectedComp?.template_key || '').toUpperCase())
  const isNationalTeam = !!selectedComp?.is_national_team
  // Referee crew slots on every assignment-capable competition. The
  // neutrality rule differs: selections → country + group; clubs → only
  // games where a club from the referee's country plays.
  const supportsRefSlots = supportsAssignments
  // Club comps need the per-team country mapping for the referee checks.
  const isClubComp = !!selectedCompId && !isNationalTeam

  // Pull defaults from the selected competition into the editable form state
  // whenever the comp changes.
  useEffect(() => {
    if (!selectedComp) {
      setDefaults({})
      return
    }
    setDefaults({
      default_letter_date: selectedComp.default_letter_date || '',
      default_location: selectedComp.default_location || '',
      default_venue: selectedComp.default_venue || '',
      default_arrival_date: selectedComp.default_arrival_date || '',
      default_departure_date: selectedComp.default_departure_date || '',
      default_confirmation_deadline: selectedComp.default_confirmation_deadline || '',
      td_window_fee: selectedComp.td_window_fee ?? '',
      td_incidentals: selectedComp.td_incidentals ?? '',
      vgo_window_fee: selectedComp.vgo_window_fee ?? '',
      vgo_incidentals: selectedComp.vgo_incidentals ?? '',
      ref_window_fee: selectedComp.ref_window_fee ?? '',
      ref_incidentals: selectedComp.ref_incidentals ?? '',
      ref_instructor_window_fee: selectedComp.ref_instructor_window_fee ?? '',
      ref_instructor_incidentals: selectedComp.ref_instructor_incidentals ?? '',
      video_operator_window_fee: selectedComp.video_operator_window_fee ?? '',
      video_operator_incidentals: selectedComp.video_operator_incidentals ?? '',
    })
  }, [selectedCompId, selectedComp?.default_letter_date]) // re-pull when comp data changes

  // Load competitions — reopen the last searched one if it still exists
  useEffect(() => {
    getCalendarCompetitions().then(c => {
      setCompetitions(c)
      const saved = lastSearchRef.current
      if (saved?.compId && c.some(x => x.id === saved.compId)) {
        setSelectedCompId(saved.compId)
      } else {
        lastSearchRef.current = null // saved comp is gone → nothing to restore
        if (c.length > 0) setSelectedCompId(c[0].id)
      }
    }).catch(() => {})
  }, [])

  // Persist the current search as the user changes it. Paused while a restore
  // is pending so the initial empty filters don't clobber the saved ones.
  useEffect(() => {
    if (!selectedCompId || lastSearchRef.current) return
    try {
      localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({
        compId: selectedCompId,
        dates: filterDates,
        group: filterGroup,
      }))
    } catch {}
  }, [selectedCompId, filterDates, filterGroup])

  // Load games when competition changes
  useEffect(() => {
    if (!selectedCompId) return
    loadGamesAndAutoSync()
  }, [selectedCompId])

  async function loadGamesAndAutoSync() {
    setLoading(true)
    setFilterDates([])
    setFilterGroup('')
    try {
      const comp = competitions.find(c => c.id === selectedCompId)
      const supportsAsg = ASSIGNMENT_TEMPLATES.has((comp?.template_key || '').toUpperCase())
      const [g, d, te, asg] = await Promise.all([
        getGames(selectedCompId),
        getGameDates(selectedCompId),
        getGameTeams(selectedCompId),
        supportsAsg ? getGameAssignments(selectedCompId) : Promise.resolve([]),
      ])
      setGames(g)
      setGameDates(d)
      setTeams(te)
      setAssignments(asg)
      let finalGames = g
      let finalDates = d

      // Auto-sync from FIBA if competition has URL and no games yet
      if (g.length === 0 && comp?.fiba_games_url && !autoSyncDone.current.has(selectedCompId)) {
        autoSyncDone.current.add(selectedCompId)
        setSyncing(true)
        setSyncMsg(t('games.syncing'))
        try {
          const result = await syncGameResults(selectedCompId)
          setSyncMsg(t('games.syncSuccess', {
            synced: result.synced,
            created: result.created,
            total: result.total_from_fiba,
          }))
          // Reload after sync
          const [g2, d2, te2, asg2] = await Promise.all([
            getGames(selectedCompId),
            getGameDates(selectedCompId),
            getGameTeams(selectedCompId),
            supportsAsg ? getGameAssignments(selectedCompId) : Promise.resolve([]),
          ])
          setGames(g2)
          setGameDates(d2)
          setTeams(te2)
          setAssignments(asg2 || [])
          finalGames = g2
          finalDates = d2
        } catch (err) {
          setSyncMsg(err.response?.data?.detail || 'Auto-sync failed')
        }
        setSyncing(false)
        setTimeout(() => setSyncMsg(''), 6000)
      }

      // One-shot restore of the persisted last search. Only applies to the
      // competition it was saved for; values that no longer exist in the
      // loaded data (stale dates/groups) are dropped silently.
      const saved = lastSearchRef.current
      lastSearchRef.current = null
      if (saved && saved.compId === selectedCompId) {
        const validDates = saved.dates.filter(x => finalDates.includes(x))
        if (validDates.length > 0) setFilterDates(validDates)
        const groupSet = new Set(finalGames.map(gm => gm.group_label).filter(Boolean))
        if (saved.group && groupSet.has(saved.group)) setFilterGroup(saved.group)
      }
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function loadGames() {
    try {
      const [g, d, te, asg] = await Promise.all([
        getGames(selectedCompId),
        getGameDates(selectedCompId),
        getGameTeams(selectedCompId),
        supportsAssignments ? getGameAssignments(selectedCompId) : Promise.resolve([]),
      ])
      setGames(g)
      setGameDates(d)
      setTeams(te)
      setAssignments(asg)
    } catch (e) {
      console.error(e)
    }
  }

  async function reloadAssignments() {
    if (!supportsAssignments) return
    try {
      const asg = await getGameAssignments(selectedCompId)
      setAssignments(asg)
    } catch (e) {
      console.error(e)
    }
  }

  // Conflict check used both before assigning (pop-up) and to mark
  // non-eligible referees inside the picker dropdown.
  function refConflictFor(game, person) {
    return findRefereeGameConflict(person, game, games, isNationalTeam)
  }

  async function handleAssign(gameId, person, role) {
    // Referee neutrality: hard block with pop-up before touching the API
    if (REF_SLOT_SET.has(role)) {
      const game = games.find(g => g.id === gameId)
      const conflict = refConflictFor(game, person)
      if (conflict) {
        setRefConflict({ ...conflict, person, game })
        return
      }
    }
    try {
      await setGameAssignment(gameId, person.id, role)
      await reloadAssignments()
    } catch (err) {
      const detail = err.response?.data?.detail
      // Backend enforces the same rule — surface its 409 with the same pop-up
      if (detail && detail.code === 'referee_neutrality') {
        setRefConflict({
          reason: detail.reason,
          countryCode: detail.country_code,
          group: detail.group,
          team: detail.team,
          origin: detail.origin,
          person,
          game: games.find(g => g.id === gameId),
        })
        return
      }
      alert(typeof detail === 'string' ? detail : 'Error')
    }
  }

  async function handleUnassign(assignmentId) {
    try {
      await deleteGameAssignment(assignmentId)
      await reloadAssignments()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error')
    }
  }

  async function handleSyncNominations() {
    setSyncingNoms(true)
    setNomMsg('')
    try {
      const r = await syncAssignmentsToNominations(selectedCompId)
      setNomMsg(t('games.nominationsSynced', { created: r.created, updated: r.updated, people: r.people }))
    } catch (err) {
      setNomMsg(err.response?.data?.detail || 'Error')
    }
    setSyncingNoms(false)
    setTimeout(() => setNomMsg(''), 6000)
  }

  async function handleGeneratePdfs() {
    setGeneratingPdfs(true)
    setNomMsg('')
    try {
      // Sync first so any new assignments / default changes are picked up
      await syncAssignmentsToNominations(selectedCompId)
      const r = await generateAssignmentPDFs(selectedCompId)
      const errCount = (r.errors || []).length
      let msg = t('games.pdfsGenerated', { count: r.generated, total: r.total })
      if (errCount > 0) msg += ` · ${t('games.pdfsErrors', { count: errCount })}`
      setNomMsg(msg)
    } catch (err) {
      setNomMsg(err.response?.data?.detail || 'Error')
    }
    setGeneratingPdfs(false)
    setTimeout(() => setNomMsg(''), 8000)
  }

  async function handleSaveDefaults() {
    setSavingDefaults(true)
    setDefaultsMsg('')
    try {
      // Convert empty strings on numeric fields → null; dates already pass as ''
      const payload = {}
      for (const [k, v] of Object.entries(defaults)) {
        if (k.endsWith('_fee') || k.endsWith('_incidentals')) {
          payload[k] = v === '' || v === null ? null : Number(v)
        } else {
          payload[k] = v === '' ? '' : v
        }
      }
      const updated = await updateCompetition(selectedCompId, payload)
      // Reflect back into the competitions list so subsequent reads are fresh
      setCompetitions(cs => cs.map(c => (c.id === selectedCompId ? { ...c, ...updated } : c)))
      setDefaultsMsg(t('games.defaultsSaved'))
    } catch (err) {
      setDefaultsMsg(err.response?.data?.detail || 'Error')
    }
    setSavingDefaults(false)
    setTimeout(() => setDefaultsMsg(''), 5000)
  }

  function setDefaultField(field, value) {
    setDefaults(d => ({ ...d, [field]: value }))
  }

  // Unique clubs of a club competition with their current country (from the
  // games rows). Drives the "team countries" panel.
  const clubTeams = useMemo(() => {
    if (!isClubComp) return []
    const map = new Map()
    for (const g of games) {
      if (g.team_a && !map.has(g.team_a)) map.set(g.team_a, g.team_a_country || '')
      if (g.team_b && !map.has(g.team_b)) map.set(g.team_b, g.team_b_country || '')
    }
    return [...map.entries()]
      .map(([name, country]) => ({ name, country }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [games, isClubComp])

  const missingClubCountries = useMemo(
    () => clubTeams.filter(tm => !(teamCountryDraft[tm.name] ?? tm.country)).length,
    [clubTeams, teamCountryDraft],
  )

  // Reset the draft whenever the competition (or its games) changes
  useEffect(() => { setTeamCountryDraft({}) }, [selectedCompId])

  async function handleSaveTeamCountries() {
    setSavingTeamCountries(true)
    setTeamCountriesMsg('')
    try {
      const payload = {}
      for (const tm of clubTeams) {
        payload[tm.name] = teamCountryDraft[tm.name] ?? tm.country ?? ''
      }
      await setTeamCountries(selectedCompId, payload)
      setTeamCountriesMsg(t('games.teamCountriesSaved'))
      await loadGames()
      setTeamCountryDraft({})
    } catch (err) {
      const detail = err.response?.data?.detail
      setTeamCountriesMsg(typeof detail === 'string' ? detail : 'Error')
    }
    setSavingTeamCountries(false)
    setTimeout(() => setTeamCountriesMsg(''), 5000)
  }

  // Filtered + grouped games
  const filtered = games.filter(g => {
    if (filterDates.length > 0 && !filterDates.includes(g.date)) return false
    if (filterGroup && g.group_label !== filterGroup) return false
    return true
  })

  const groups = [...new Set(games.map(g => g.group_label).filter(Boolean))].sort()

  // Group games by phase, then by date
  const gamesByPhase = {}
  for (const g of filtered) {
    const phase = g.phase || 'Other'
    if (!gamesByPhase[phase]) gamesByPhase[phase] = {}
    if (!gamesByPhase[phase][g.date]) gamesByPhase[phase][g.date] = []
    gamesByPhase[phase][g.date].push(g)
  }

  // Stats
  const completedCount = games.filter(g => g.status === 'completed').length

  // Build lookup: game_id → { TD: assignment, VGO: assignment }
  const assignmentsByGame = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      if (!map[a.game_id]) map[a.game_id] = {}
      map[a.game_id][a.role] = a
    }
    return map
  }, [assignments])

  const assignedCount = useMemo(() => {
    const people = new Set()
    for (const a of assignments) people.add(a.personnel_id)
    return people.size
  }, [assignments])

  // Handlers
  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setShowModal(true)
  }

  function openEdit(game) {
    setEditing(game)
    setForm({
      date: game.date || '',
      time: game.time || '',
      team_a: game.team_a || '',
      team_a_code: game.team_a_code || '',
      team_a_country: game.team_a_country || '',
      team_b: game.team_b || '',
      team_b_code: game.team_b_code || '',
      team_b_country: game.team_b_country || '',
      score_a: game.score_a ?? '',
      score_b: game.score_b ?? '',
      venue: game.venue || '',
      city: game.city || '',
      country: game.country || '',
      phase: game.phase || 'Group Phase',
      group_label: game.group_label || '',
      status: game.status || 'scheduled',
      sport: game.sport || 'Basketball',
    })
    setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      ...form,
      score_a: form.score_a !== '' ? parseInt(form.score_a) : null,
      score_b: form.score_b !== '' ? parseInt(form.score_b) : null,
    }
    try {
      if (editing) {
        await updateGame(editing.id, payload)
      } else {
        await createGame({ ...payload, competition_id: selectedCompId })
      }
      setShowModal(false)
      await loadGames()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error')
    }
  }

  async function handleDelete(game) {
    if (!confirm(t('games.confirmDelete'))) return
    try {
      await deleteGame(game.id)
      await loadGames()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error')
    }
  }

  async function handleSync() {
    const comp = competitions.find(c => c.id === selectedCompId)
    if (!comp?.fiba_games_url) {
      setSyncMsg(t('games.syncNoUrl'))
      setTimeout(() => setSyncMsg(''), 4000)
      return
    }
    setSyncing(true)
    setSyncMsg('')
    try {
      const result = await syncGameResults(selectedCompId)
      setSyncMsg(t('games.syncSuccess', {
        synced: result.synced,
        created: result.created,
        total: result.total_from_fiba,
      }))
      await loadGames()
    } catch (err) {
      setSyncMsg(err.response?.data?.detail || 'Sync failed')
    }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 6000)
  }

  async function handleImport() {
    if (!importFile) return
    setImporting(true)
    setImportMsg('')
    try {
      const result = await importGamesExcel(importFile, selectedCompId)
      setImportMsg(t('games.imported', { count: result.imported }))
      setImportFile(null)
      await loadGames()
      setTimeout(() => { setShowImport(false); setImportMsg('') }, 3000)
    } catch (err) {
      setImportMsg(err.response?.data?.detail || t('games.errorImporting'))
    }
    setImporting(false)
  }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('games.title')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {selectedCompId && (
            <>
              {supportsAssignments && canEdit && (
                <>
                  <button onClick={() => setShowDefaults(s => !s)}
                    className="btn-fiba-ghost"
                    title={t('games.editDefaultsHint')}>
                    {t('games.editDefaults')}
                  </button>
                  <button onClick={handleSyncNominations} disabled={syncingNoms || assignments.length === 0}
                    className="btn-fiba-ghost disabled:opacity-40"
                    title={t('games.syncNominationsHint')}>
                    {syncingNoms ? t('games.syncing') : t('games.syncNominations')}
                  </button>
                  <button onClick={handleGeneratePdfs} disabled={generatingPdfs || assignments.length === 0}
                    className="btn-fiba disabled:opacity-40"
                    title={t('games.generatePdfsHint')}>
                    {generatingPdfs ? t('games.generating') : t('games.generatePdfs')}
                  </button>
                </>
              )}
              {isClubComp && canEdit && games.length > 0 && (
                <button onClick={() => setShowTeamCountries(s => !s)}
                  className="btn-fiba-ghost relative"
                  title={t('games.teamCountriesHint')}>
                  {t('games.teamCountries')}
                  {missingClubCountries > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-bold">
                      {missingClubCountries}
                    </span>
                  )}
                </button>
              )}
              <button onClick={() => setShowImport(true)}
                className="btn-fiba-ghost">
                {t('games.importExcel')}
              </button>
              <button onClick={handleSync} disabled={syncing}
                className="btn-fiba-ghost disabled:opacity-50">
                {syncing ? t('games.syncing') : t('games.syncResults')}
              </button>
              <button onClick={openCreate}
                className="btn-fiba">
                {t('games.addGame')}
              </button>
            </>
          )}
        </div>
      </div>

      {syncMsg && (
        <div className="mb-4 px-4 py-2 bg-blue-500/10 text-blue-400 rounded-lg text-sm">{syncMsg}</div>
      )}
      {nomMsg && (
        <div className="mb-4 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">{nomMsg}</div>
      )}

      {/* Competition selector + filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-start">
        <CompetitionSearch
          competitions={competitions}
          value={selectedCompId}
          onChange={setSelectedCompId}
          placeholder={t('games.selectCompetition')}
        />

        {gameDates.length > 0 && (
          <DateMultiFilter
            dates={gameDates}
            selected={filterDates}
            onChange={setFilterDates}
            formatDate={formatDate}
            t={t}
          />
        )}

        {groups.length > 0 && (
          <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
            className="fiba-select">
            <option value="">{t('games.allGroups')}</option>
            {groups.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
      </div>

      {/* Stats row */}
      {games.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-6 mb-6">
          <div className="fiba-stat">
            <div className="text-2xl font-bold text-ink-900 dark:text-white">{games.length}</div>
            <div className="text-xs text-fiba-muted">{t('games.totalGames')}</div>
          </div>
          <div className="fiba-stat">
            <div className="text-2xl font-bold text-ink-900 dark:text-white">{teams.length}</div>
            <div className="text-xs text-fiba-muted">{t('games.teams')}</div>
          </div>
          <div className="fiba-stat">
            <div className="text-2xl font-bold text-ink-900 dark:text-white">{gameDates.length}</div>
            <div className="text-xs text-fiba-muted">{t('games.gameDays')}</div>
          </div>
          <div className="fiba-stat">
            <div className="text-2xl font-bold text-emerald-400">{completedCount}</div>
            <div className="text-xs text-fiba-muted">{t('games.completed')}</div>
          </div>
          {supportsAssignments && (
            <div className="fiba-stat">
              <div className="text-2xl font-bold text-fiba-accent">{assignedCount}</div>
              <div className="text-xs text-fiba-muted">{t('games.assignedPeople')}</div>
            </div>
          )}
        </div>
      )}

      {/* Defaults panel — common nomination values for this competition */}
      {supportsAssignments && showDefaults && (
        <div className="mb-6 bg-fiba-card border border-fiba-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-ink-900 dark:text-white">{t('games.defaultsTitle')}</h3>
              <p className="text-xs text-fiba-muted mt-0.5">{t('games.defaultsSubtitle')}</p>
            </div>
            <button onClick={() => setShowDefaults(false)}
              className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xs">×</button>
          </div>

          <div className="text-[10px] font-bold uppercase tracking-wider text-fiba-muted/70 mb-2">
            {t('games.defaultsShared')}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
            <div>
              <label className="fiba-label">{t('games.letterDate')}</label>
              <input type="date" value={defaults.default_letter_date || ''}
                onChange={e => setDefaultField('default_letter_date', e.target.value)}
                className="fiba-input" />
            </div>
            <div>
              <label className="fiba-label">{t('games.location')}</label>
              <input value={defaults.default_location || ''}
                onChange={e => setDefaultField('default_location', e.target.value)}
                className="fiba-input" />
            </div>
            <div>
              <label className="fiba-label">{t('games.venue')}</label>
              <input value={defaults.default_venue || ''}
                onChange={e => setDefaultField('default_venue', e.target.value)}
                className="fiba-input" />
            </div>
            <div>
              <label className="fiba-label">{t('games.arrivalDate')}</label>
              <input type="date" value={defaults.default_arrival_date || ''}
                onChange={e => setDefaultField('default_arrival_date', e.target.value)}
                className="fiba-input" />
            </div>
            <div>
              <label className="fiba-label">{t('games.departureDate')}</label>
              <input type="date" value={defaults.default_departure_date || ''}
                onChange={e => setDefaultField('default_departure_date', e.target.value)}
                className="fiba-input" />
            </div>
            <div>
              <label className="fiba-label">{t('games.confirmationDeadline')}</label>
              <input type="date" value={defaults.default_confirmation_deadline || ''}
                onChange={e => setDefaultField('default_confirmation_deadline', e.target.value)}
                className="fiba-input" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {[
              { prefix: 'td', label: t('games.defaultsTD') },
              { prefix: 'vgo', label: t('games.defaultsVGO') },
              { prefix: 'ref', label: t('games.defaultsREF') },
              { prefix: 'ref_instructor', label: t('games.defaultsINSTR') },
              { prefix: 'video_operator', label: t('games.defaultsVO') },
            ].map(({ prefix, label }) => (
              <div key={prefix}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-fiba-accent mb-2">
                  {label}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="fiba-label">{t('games.windowFee')}</label>
                    <input type="number" step="0.01" value={defaults[`${prefix}_window_fee`] ?? ''}
                      onChange={e => setDefaultField(`${prefix}_window_fee`, e.target.value)}
                      className="fiba-input" />
                  </div>
                  <div>
                    <label className="fiba-label">{t('games.incidentals')}</label>
                    <input type="number" step="0.01" value={defaults[`${prefix}_incidentals`] ?? ''}
                      onChange={e => setDefaultField(`${prefix}_incidentals`, e.target.value)}
                      className="fiba-input" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-5">
            <span className="text-xs text-fiba-muted/70">
              {defaultsMsg || t('games.defaultsApplyHint')}
            </span>
            <button onClick={handleSaveDefaults} disabled={savingDefaults}
              className="btn-fiba disabled:opacity-50">
              {savingDefaults ? t('games.saving') : t('games.saveDefaults')}
            </button>
          </div>
        </div>
      )}

      {/* Club country mapping — feeds the referee neutrality check */}
      {isClubComp && showTeamCountries && (
        <div className="mb-6 bg-fiba-card border border-fiba-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-ink-900 dark:text-white">{t('games.teamCountriesTitle')}</h3>
              <p className="text-xs text-fiba-muted mt-0.5">{t('games.teamCountriesSubtitle')}</p>
            </div>
            <button onClick={() => setShowTeamCountries(false)}
              className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xs">×</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2.5">
            {clubTeams.map(tm => {
              const value = teamCountryDraft[tm.name] ?? tm.country ?? ''
              return (
                <div key={tm.name} className="flex items-center gap-2 min-w-0">
                  <span className="flex-1 text-xs text-ink-900 dark:text-white truncate" title={tm.name}>
                    {tm.name}
                  </span>
                  <select
                    value={value}
                    onChange={e => setTeamCountryDraft(d => ({ ...d, [tm.name]: e.target.value }))}
                    disabled={!canEdit}
                    className={`fiba-select !w-auto text-xs ${!value ? 'border-amber-500/50' : ''}`}
                  >
                    <option value="">—</option>
                    {COUNTRIES.map(c => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-5">
            <span className="text-xs text-fiba-muted/70">
              {teamCountriesMsg || (missingClubCountries > 0
                ? t('games.teamCountriesMissing', { count: missingClubCountries })
                : t('games.teamCountriesComplete'))}
            </span>
            {canEdit && (
              <button onClick={handleSaveTeamCountries} disabled={savingTeamCountries}
                className="btn-fiba disabled:opacity-50">
                {savingTeamCountries ? t('games.saving') : t('games.saveDefaults')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Game cards - FIBA style */}
      {loading || syncing ? (
        <div className="text-center py-12 text-fiba-muted text-sm">{syncing ? t('games.syncing') : t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-fiba-muted text-sm">{t('games.noGames')}</div>
      ) : (
        Object.entries(gamesByPhase).map(([phase, dateGroups]) => (
          <div key={phase} className="mb-8">
            <h3 className="text-sm font-bold text-fiba-muted uppercase tracking-wider mb-4 px-1">{phase}</h3>
            {Object.entries(dateGroups).sort(([a], [b]) => a.localeCompare(b)).map(([date, dateGames]) => (
              <div key={date} className="mb-6">
                <div className="text-xs font-semibold text-fiba-muted/60 uppercase mb-2 px-1">{formatDate(date)}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {dateGames.sort((a, b) => (a.time || '').localeCompare(b.time || '')).map(game => (
                    <GameCard key={game.id} game={game} canEdit={canEdit}
                      onEdit={() => openEdit(game)} onDelete={() => handleDelete(game)} t={t}
                      supportsAssignments={supportsAssignments}
                      supportsRefSlots={supportsRefSlots}
                      templateKey={(selectedComp?.template_key || '').toUpperCase()}
                      assignment={assignmentsByGame[game.id] || {}}
                      onAssign={handleAssign} onUnassign={handleUnassign}
                      refConflictFor={refConflictFor} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{editing ? t('games.editGame') : t('games.newGame')}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="fiba-label">{t('games.date')}</label>
                  <input type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('games.time')}</label>
                  <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                    className="fiba-input" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="fiba-label">{t('games.teamA')}</label>
                  <input required placeholder="e.g. Argentina" value={form.team_a}
                    onChange={e => setForm(f => ({ ...f, team_a: e.target.value }))}
                    className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('games.teamB')}</label>
                  <input required placeholder="e.g. Brazil" value={form.team_b}
                    onChange={e => setForm(f => ({ ...f, team_b: e.target.value }))}
                    className="fiba-input" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="fiba-label">{t('games.codeA')}</label>
                  <input placeholder="ARG" value={form.team_a_code}
                    onChange={e => setForm(f => ({ ...f, team_a_code: e.target.value.toUpperCase() }))}
                    className="fiba-input" maxLength={3} />
                </div>
                <div>
                  <label className="fiba-label">{t('games.codeB')}</label>
                  <input placeholder="BRA" value={form.team_b_code}
                    onChange={e => setForm(f => ({ ...f, team_b_code: e.target.value.toUpperCase() }))}
                    className="fiba-input" maxLength={3} />
                </div>
              </div>

              {/* Club countries — referee neutrality on club competitions */}
              {isClubComp && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="fiba-label">{t('games.clubCountryA')}</label>
                    <select value={form.team_a_country}
                      onChange={e => setForm(f => ({ ...f, team_a_country: e.target.value }))}
                      className="fiba-select">
                      <option value="">—</option>
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="fiba-label">{t('games.clubCountryB')}</label>
                    <select value={form.team_b_country}
                      onChange={e => setForm(f => ({ ...f, team_b_country: e.target.value }))}
                      className="fiba-select">
                      <option value="">—</option>
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="fiba-label">{t('games.scoreA')}</label>
                  <input type="number" placeholder="-" value={form.score_a}
                    onChange={e => setForm(f => ({ ...f, score_a: e.target.value }))}
                    className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('games.scoreB')}</label>
                  <input type="number" placeholder="-" value={form.score_b}
                    onChange={e => setForm(f => ({ ...f, score_b: e.target.value }))}
                    className="fiba-input" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="fiba-label">{t('games.venue')}</label>
                  <input value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                    className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('games.city')}</label>
                  <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    className="fiba-input" />
                </div>
              </div>

              <div>
                <label className="fiba-label">{t('games.country')}</label>
                <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                  className="fiba-input" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="fiba-label">{t('games.phase')}</label>
                  <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
                    className="fiba-select">
                    {PHASE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="fiba-label">{t('games.group')}</label>
                  <input placeholder="A" value={form.group_label}
                    onChange={e => setForm(f => ({ ...f, group_label: e.target.value }))}
                    className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('games.status')}</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="fiba-select">
                    <option value="scheduled">{t('games.scheduled')}</option>
                    <option value="completed">{t('games.completed')}</option>
                    <option value="live">{t('games.live')}</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-fiba-muted hover:text-ink-900 dark:text-white">
                  {t('games.cancel')}
                </button>
                <button type="submit"
                  className="btn-fiba">
                  {editing ? t('games.save') : t('games.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Referee neutrality conflict — blocking pop-up */}
      {refConflict && (
        <div className="fiba-modal-overlay" onClick={() => setRefConflict(null)}>
          <div className="fiba-modal max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-ink-900 dark:text-white">
                  {t('games.refConflictTitle')}
                </h3>
                <p className="text-sm text-ink-700 dark:text-gray-300 mt-2">
                  {refConflict.reason === 'special_pair'
                    ? t('games.refConflictSpecialPair', {
                        name: refConflict.person?.name || '',
                        origin: countryName(refConflict.origin),
                        blocked: countryName(refConflict.countryCode),
                        target: refConflict.team || countryName(refConflict.countryCode),
                      })
                    : refConflict.reason === 'own_club'
                      ? t('games.refConflictOwnClub', {
                          name: refConflict.person?.name || '',
                          country: countryName(refConflict.countryCode),
                          team: refConflict.team || '',
                        })
                      : refConflict.reason === 'own_country'
                        ? t('games.refConflictOwnCountry', {
                            name: refConflict.person?.name || '',
                            country: countryName(refConflict.countryCode),
                            teams: `${refConflict.game?.team_a || ''} vs ${refConflict.game?.team_b || ''}`,
                          })
                        : t('games.refConflictOwnGroup', {
                            name: refConflict.person?.name || '',
                            country: countryName(refConflict.countryCode),
                            group: refConflict.group || refConflict.game?.group_label || '',
                          })}
                </p>
                <p className="text-xs text-fiba-muted mt-2">
                  {refConflict.reason === 'special_pair'
                    ? t('games.refConflictRuleSpecial')
                    : refConflict.reason === 'own_club'
                      ? t('games.refConflictRuleClub')
                      : t('games.refConflictRule')}
                </p>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setRefConflict(null)} className="btn-fiba">
                {t('games.refConflictOk')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{t('games.importExcel')}</h3>

            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) setImportFile(e.dataTransfer.files[0]) }}
              className="border-2 border-dashed border-fiba-border rounded-lg p-8 text-center cursor-pointer hover:border-fiba-muted transition-colors"
            >
              {importFile ? (
                <p className="text-sm font-medium text-ink-700 dark:text-gray-300">{importFile.name}</p>
              ) : (
                <p className="text-sm text-fiba-muted">{t('games.dragOrClick')}</p>
              )}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { if (e.target.files[0]) setImportFile(e.target.files[0]) }} />
            </div>

            <div className="mt-3 text-xs text-fiba-muted/60">
              <p>Columns: Date | Time | Team A | Team B | Venue | Phase | Group</p>
            </div>

            {importMsg && (
              <div className="mt-3 px-3 py-2 bg-blue-500/10 text-blue-400 rounded text-sm">{importMsg}</div>
            )}

            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setShowImport(false); setImportFile(null); setImportMsg('') }}
                className="px-4 py-2 text-sm text-fiba-muted">{t('games.cancel')}</button>
              <button onClick={handleImport} disabled={!importFile || importing}
                className="btn-fiba disabled:opacity-50">
                {importing ? t('games.importing') : t('games.importExcel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Multi-select date filter ───────────────────────────────────────────────

function DateMultiFilter({ dates, selected, onChange, formatDate, t }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function toggle(date) {
    onChange(selected.includes(date) ? selected.filter(d => d !== date) : [...selected, date])
  }

  const label = selected.length === 0
    ? t('games.allDates')
    : selected.length === 1
      ? formatDate(selected[0])
      : t('games.datesSelected', { count: selected.length })

  return (
    <div className="relative" ref={wrapperRef}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`fiba-select flex items-center gap-2 ${selected.length > 0 ? 'text-fiba-accent' : ''}`}>
        <span>{label}</span>
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-40 mt-1 min-w-[13rem] bg-fiba-card border border-fiba-border rounded-lg shadow-lg flex flex-col">
          <div className="overflow-y-auto py-1" style={{ maxHeight: 280 }}>
            {dates.map(d => (
              <label key={d}
                className="flex items-center gap-2.5 px-3 py-1.5 text-xs cursor-pointer hover:bg-fiba-surface text-ink-900 dark:text-white">
                <input type="checkbox" checked={selected.includes(d)} onChange={() => toggle(d)}
                  className="accent-fiba-accent" />
                <span>{formatDate(d)}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-fiba-border px-3 py-1.5 flex justify-between items-center">
              <span className="text-[10px] text-fiba-muted/70">
                {t('games.datesSelected', { count: selected.length })}
              </span>
              <button type="button" onClick={() => onChange([])}
                className="text-[11px] text-fiba-muted hover:text-fiba-accent">
                {t('games.clearDates')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── Game Card (FIBA-inspired) ──────────────────────────────────────────────

function GameCard({
  game, canEdit, onEdit, onDelete, t,
  supportsAssignments = false, supportsRefSlots = false, templateKey = '', assignment = {},
  onAssign, onUnassign, refConflictFor,
}) {
  const displayCountry = game.country || (templateKey === 'WCQ' ? game.team_a : '') || ''
  const isCompleted = game.status === 'completed'
  const isLive = game.status === 'live'
  const scoreA = game.score_a ?? '-'
  const scoreB = game.score_b ?? '-'
  const locationLine = [game.venue, [game.city, displayCountry].filter(Boolean).join(', ')]
    .filter(Boolean).join(' · ')

  return (
    <div className={`bg-fiba-card rounded-lg border border-fiba-border p-3 flex flex-col hover:shadow-sm transition-shadow ${
      isLive ? 'border-red-500/50 ring-1 ring-red-500/20' : ''
    }`}>
      {/* Header: group + status + actions */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-fiba-muted/60">
          {game.group_label ? `${t('games.group')} ${game.group_label}` : (game.phase || '')}
        </span>
        <div className="flex items-center gap-1">
          {isLive && (
            <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">LIVE</span>
          )}
          {isCompleted && !isLive && (
            <span className="text-[10px] text-fiba-muted/60 uppercase tracking-wider">Final</span>
          )}
          {canEdit && (
            <>
              <button onClick={onEdit} className="p-1 text-fiba-muted hover:text-fiba-accent rounded transition-colors"
                title={t('games.editGame')}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button onClick={onDelete} className="p-1 text-fiba-muted hover:text-red-400 rounded transition-colors"
                title={t('games.delete')}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Teams + score/time */}
      <div className="flex items-baseline gap-1.5 min-w-0" title={`${game.team_a} vs ${game.team_b}`}>
        <span className={`text-sm font-bold truncate ${isCompleted && game.score_a > game.score_b ? 'text-ink-900 dark:text-white' : 'text-ink-700 dark:text-gray-300'}`}>
          {game.team_a_code || game.team_a}
        </span>
        <span className="text-xs text-fiba-muted/60 flex-shrink-0">vs</span>
        <span className={`text-sm font-bold truncate ${isCompleted && game.score_b > game.score_a ? 'text-ink-900 dark:text-white' : 'text-ink-700 dark:text-gray-300'}`}>
          {game.team_b_code || game.team_b}
        </span>
        <span className="ml-auto flex-shrink-0 text-sm font-bold">
          {isCompleted || isLive ? (
            <span className="text-ink-900 dark:text-white">{scoreA}<span className="text-fiba-border font-normal mx-1">-</span>{scoreB}</span>
          ) : (
            <span className="text-fiba-accent">{game.time || '--:--'}</span>
          )}
        </span>
      </div>

      {/* Location line */}
      {(locationLine || game.game_number) && (
        <div className="flex items-center gap-2 mt-0.5 min-w-0">
          {locationLine && (
            <span className="text-[11px] text-fiba-muted/60 truncate" title={locationLine}>{locationLine}</span>
          )}
          {game.game_number && (
            <span className="text-[11px] text-fiba-border flex-shrink-0 ml-auto">{game.game_number}</span>
          )}
        </div>
      )}

      {supportsAssignments && (
        <div className="border-t border-fiba-border mt-2 pt-2 flex flex-col gap-1.5">
          <AssignmentSlot role="TD" game={game} t={t} canEdit={canEdit}
            assignment={assignment.TD}
            onAssign={onAssign} onUnassign={onUnassign} />
          <AssignmentSlot role="VGO" game={game} t={t} canEdit={canEdit}
            assignment={assignment.VGO}
            onAssign={onAssign} onUnassign={onUnassign} />
          {supportsRefSlots && REF_SLOTS.map(slot => (
            <AssignmentSlot key={slot} role={slot} game={game} t={t} canEdit={canEdit}
              assignment={assignment[slot]}
              onAssign={onAssign} onUnassign={onUnassign}
              refConflictFor={refConflictFor} />
          ))}
          {supportsRefSlots && CREW_SLOTS.map(slot => (
            <AssignmentSlot key={slot} role={slot} game={game} t={t} canEdit={canEdit}
              assignment={assignment[slot]}
              onAssign={onAssign} onUnassign={onUnassign} />
          ))}
        </div>
      )}
    </div>
  )
}


// ── Per-game assignment slot (TD / VGO / referee crew) ─────────────────────

// Assignment slot → personnel role to list in the picker. The referee crew
// slots (CC/U1/U2) all draw from REF personnel.
const SLOT_PERSONNEL_ROLE = {
  TD: 'TD', VGO: 'VGO',
  CC: 'REF', U1: 'REF', U2: 'REF',
  INSTR: 'REF_INSTRUCTOR', VO: 'VIDEO_OPERATOR',
}

function AssignmentSlot({ role, game, assignment, canEdit, onAssign, onUnassign, refConflictFor, t }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [coords, setCoords] = useState(null)
  const [options, setOptions] = useState([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const triggerRef = useRef(null)
  const dropdownRef = useRef(null)
  const personnelRole = SLOT_PERSONNEL_ROLE[role] || role

  // Lazy-fetch personnel filtered by this slot's role the first time the
  // picker opens. Keeps assignment slots self-contained instead of relying on
  // a page-level prefetch that can race with the competition selector.
  useEffect(() => {
    if (!open || options.length > 0 || loadingOptions) return
    let cancelled = false
    setLoadingOptions(true)
    getPersonnel({ role: personnelRole }).then(data => {
      if (!cancelled) setOptions(data || [])
    }).catch(() => {
      if (!cancelled) setOptions([])
    }).finally(() => {
      if (!cancelled) setLoadingOptions(false)
    })
    return () => { cancelled = true }
  }, [open, personnelRole])

  // The compact card is narrow and sits inside a grid, so an in-tree dropdown
  // would be cramped or clipped by neighbors. We render into document.body via
  // a portal with fixed positioning so the picker is always visible.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    function updatePosition() {
      const rect = triggerRef.current.getBoundingClientRect()
      const width = Math.max(rect.width, 240)
      const viewportWidth = window.innerWidth
      // Keep the panel inside the viewport horizontally
      const left = Math.min(rect.left, viewportWidth - width - 8)
      setCoords({ top: rect.bottom + 4, left: Math.max(8, left), width })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    function handleClickOutside(e) {
      const inTrigger = triggerRef.current && triggerRef.current.contains(e.target)
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target)
      if (!inTrigger && !inDropdown) {
        setOpen(false)
        setSearch('')
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const filtered = options.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) || p.country?.toLowerCase().includes(q)
  })

  const name = assignment?.personnel?.name
  const roleLabel = t(`games.role${role}`)

  return (
    <div className="flex-1 min-w-0" ref={triggerRef}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-fiba-muted/70 w-10">{role}</span>
        {name ? (
          <div className="flex-1 flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => canEdit && setOpen(o => !o)}
              disabled={!canEdit}
              className="flex-1 text-left text-xs font-medium text-ink-900 dark:text-white truncate hover:text-fiba-accent disabled:cursor-default disabled:hover:text-ink-900"
              title={name}
            >
              {name}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => onUnassign(assignment.id)}
                className="text-fiba-muted/60 hover:text-red-400 text-xs leading-none"
                title={t('games.unassign')}
              >
                ×
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => canEdit && setOpen(o => !o)}
            disabled={!canEdit}
            className="flex-1 text-left text-xs text-fiba-muted/60 hover:text-fiba-accent disabled:cursor-default disabled:hover:text-fiba-muted/60 italic"
          >
            {canEdit ? t('games.assignRole', { role: roleLabel }) : t('games.unassigned')}
          </button>
        )}
      </div>

      {open && canEdit && coords && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, zIndex: 60 }}
          className="bg-fiba-card border border-fiba-border rounded-lg shadow-lg flex flex-col"
        >
          <input
            type="text"
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('games.searchPerson')}
            className="fiba-input rounded-none border-0 border-b border-fiba-border text-xs"
          />
          <div className="overflow-y-auto" style={{ maxHeight: 240, minHeight: 40 }}>
            {loadingOptions ? (
              <div className="px-3 py-3 text-xs text-fiba-muted">{t('common.loading')}</div>
            ) : options.length === 0 ? (
              <div className="px-3 py-3 text-xs text-fiba-muted">
                {t('games.noPersonnelForRole', { role: personnelRole })}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-fiba-muted">{t('games.noResults')}</div>
            ) : (
              filtered.map(p => {
                const conflict = refConflictFor ? refConflictFor(game, p) : null
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onAssign(game.id, p, role)
                      setOpen(false)
                      setSearch('')
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-fiba-surface ${
                      conflict ? 'opacity-75' : ''
                    } text-ink-900 dark:text-white`}
                  >
                    <div className={`font-medium truncate ${conflict ? 'line-through decoration-red-400/70' : ''}`}>
                      {p.name}
                    </div>
                    {conflict ? (
                      <div className="text-[10px] text-red-400">
                        {t('games.refNotEligible', {
                          detail: conflict.reason === 'own_group'
                            ? `${t('games.group')} ${conflict.group}`
                            : conflict.reason === 'own_club' || conflict.reason === 'special_pair'
                              ? (conflict.team || conflict.countryCode)
                              : `${game.team_a_code || game.team_a} vs ${game.team_b_code || game.team_b}`,
                        })}
                      </div>
                    ) : (
                      p.country && <div className="text-[10px] text-fiba-muted/60">{p.country}</div>
                    )}
                  </button>
                )
              })
            )}
          </div>
          <div className="border-t border-fiba-border px-3 py-1 text-[10px] text-fiba-muted/70 flex justify-between">
            <span>{t('games.optionsCount', { count: options.length })}</span>
            {search && <span>{filtered.length} match</span>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
