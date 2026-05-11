import { useState, useEffect, useRef, useMemo } from 'react'
import {
  getGames, getGameDates, getGameTeams, createGame, updateGame, deleteGame,
  syncGameResults, importGamesExcel, getCalendarCompetitions,
  getPersonnel, getGameAssignments, setGameAssignment, deleteGameAssignment,
  syncAssignmentsToNominations,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import CompetitionSearch from '../components/CompetitionSearch'

const PHASE_OPTIONS = ['Group Phase', 'Quarterfinals', 'Semifinals', 'Classification', 'Finals']
const ASSIGNMENT_TEMPLATES = new Set(['WCQ', 'BCLA', 'LSB'])

const EMPTY_FORM = {
  date: '', time: '', team_a: '', team_a_code: '', team_b: '', team_b_code: '',
  score_a: '', score_b: '', venue: '', city: '', phase: 'Group Phase',
  group_label: '', status: 'scheduled', sport: 'Basketball',
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
  const [personnel, setPersonnel] = useState([])
  const [assignments, setAssignments] = useState([]) // per-game TD/VGO assignments

  // Filters
  const [filterDate, setFilterDate] = useState('')
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
  const fileRef = useRef(null)
  const autoSyncDone = useRef(new Set()) // track which comps we've auto-synced

  const selectedComp = competitions.find(c => c.id === selectedCompId)
  const supportsAssignments = ASSIGNMENT_TEMPLATES.has((selectedComp?.template_key || '').toUpperCase())

  // Load competitions
  useEffect(() => {
    getCalendarCompetitions().then(c => {
      setCompetitions(c)
      if (c.length > 0) setSelectedCompId(c[0].id)
    }).catch(() => {})
  }, [])

  // Load games when competition changes
  useEffect(() => {
    if (!selectedCompId) return
    loadGamesAndAutoSync()
  }, [selectedCompId])

  async function loadGamesAndAutoSync() {
    setLoading(true)
    setFilterDate('')
    setFilterGroup('')
    try {
      const comp = competitions.find(c => c.id === selectedCompId)
      const supportsAsg = ASSIGNMENT_TEMPLATES.has((comp?.template_key || '').toUpperCase())
      const [g, d, te, ppl, asg] = await Promise.all([
        getGames(selectedCompId),
        getGameDates(selectedCompId),
        getGameTeams(selectedCompId),
        supportsAsg ? getPersonnel() : Promise.resolve([]),
        supportsAsg ? getGameAssignments(selectedCompId) : Promise.resolve([]),
      ])
      setGames(g)
      setGameDates(d)
      setTeams(te)
      setPersonnel(ppl)
      setAssignments(asg)

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
          setAssignments(asg2)
        } catch (err) {
          setSyncMsg(err.response?.data?.detail || 'Auto-sync failed')
        }
        setSyncing(false)
        setTimeout(() => setSyncMsg(''), 6000)
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

  async function handleAssign(gameId, personId, role) {
    try {
      await setGameAssignment(gameId, personId, role)
      await reloadAssignments()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error')
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

  // Filtered + grouped games
  const filtered = games.filter(g => {
    if (filterDate && g.date !== filterDate) return false
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

  const tdPersonnel = useMemo(() => personnel.filter(p => p.role === 'TD'), [personnel])
  const vgoPersonnel = useMemo(() => personnel.filter(p => p.role === 'VGO'), [personnel])
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
      team_b: game.team_b || '',
      team_b_code: game.team_b_code || '',
      score_a: game.score_a ?? '',
      score_b: game.score_b ?? '',
      venue: game.venue || '',
      city: game.city || '',
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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('games.title')}</h2>
        <div className="flex items-center gap-3">
          {selectedCompId && (
            <>
              {supportsAssignments && canEdit && (
                <button onClick={handleSyncNominations} disabled={syncingNoms || assignments.length === 0}
                  className="btn-fiba-ghost disabled:opacity-40"
                  title={t('games.syncNominationsHint')}>
                  {syncingNoms ? t('games.syncing') : t('games.syncNominations')}
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
          <select value={filterDate} onChange={e => setFilterDate(e.target.value)}
            className="fiba-select">
            <option value="">{t('games.allDates')}</option>
            {gameDates.map(d => (
              <option key={d} value={d}>{formatDate(d)}</option>
            ))}
          </select>
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
        <div className="flex gap-6 mb-6">
          <div className="fiba-stat flex-1">
            <div className="text-2xl font-bold text-ink-900 dark:text-white">{games.length}</div>
            <div className="text-xs text-fiba-muted">{t('games.totalGames')}</div>
          </div>
          <div className="fiba-stat flex-1">
            <div className="text-2xl font-bold text-ink-900 dark:text-white">{teams.length}</div>
            <div className="text-xs text-fiba-muted">{t('games.teams')}</div>
          </div>
          <div className="fiba-stat flex-1">
            <div className="text-2xl font-bold text-ink-900 dark:text-white">{gameDates.length}</div>
            <div className="text-xs text-fiba-muted">{t('games.gameDays')}</div>
          </div>
          <div className="fiba-stat flex-1">
            <div className="text-2xl font-bold text-emerald-400">{completedCount}</div>
            <div className="text-xs text-fiba-muted">{t('games.completed')}</div>
          </div>
          {supportsAssignments && (
            <div className="fiba-stat flex-1">
              <div className="text-2xl font-bold text-fiba-accent">{assignedCount}</div>
              <div className="text-xs text-fiba-muted">{t('games.assignedPeople')}</div>
            </div>
          )}
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
                <div className="space-y-2">
                  {dateGames.sort((a, b) => (a.time || '').localeCompare(b.time || '')).map(game => (
                    <GameCard key={game.id} game={game} canEdit={canEdit}
                      onEdit={() => openEdit(game)} onDelete={() => handleDelete(game)} t={t}
                      supportsAssignments={supportsAssignments}
                      assignment={assignmentsByGame[game.id] || {}}
                      tdPersonnel={tdPersonnel} vgoPersonnel={vgoPersonnel}
                      onAssign={handleAssign} onUnassign={handleUnassign} />
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

              <div className="grid grid-cols-3 gap-3">
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


// ── Game Card (FIBA-inspired) ──────────────────────────────────────────────

function GameCard({
  game, canEdit, onEdit, onDelete, t,
  supportsAssignments = false, assignment = {},
  tdPersonnel = [], vgoPersonnel = [],
  onAssign, onUnassign,
}) {
  const isCompleted = game.status === 'completed'
  const isLive = game.status === 'live'
  const scoreA = game.score_a ?? '-'
  const scoreB = game.score_b ?? '-'

  return (
    <div className={`bg-fiba-card rounded-lg border border-fiba-border overflow-hidden hover:shadow-sm transition-shadow ${
      isLive ? 'border-red-500/50 ring-1 ring-red-500/20' : ''
    }`}>
      <div className="flex items-center">
        {/* Group label */}
        {game.group_label && (
          <div className="w-10 bg-fiba-surface flex items-center justify-center border-r border-fiba-border self-stretch">
            <span className="text-xs font-bold text-fiba-muted/60 rotate-0">{game.group_label}</span>
          </div>
        )}

        {/* Game content */}
        <div className="flex-1 px-4 py-3">
          <div className="flex items-center gap-4">
            {/* Team A */}
            <div className="flex-1 text-right">
              <div className={`text-sm font-semibold ${isCompleted && game.score_a > game.score_b ? 'text-ink-900 dark:text-white' : 'text-ink-700 dark:text-gray-300'}`}>
                {game.team_a}
              </div>
              {game.team_a_code && (
                <div className="text-xs text-fiba-muted/60 font-medium">{game.team_a_code}</div>
              )}
            </div>

            {/* Score / Time */}
            <div className="flex-shrink-0 w-28 text-center">
              {isCompleted || isLive ? (
                <div className="flex items-center justify-center gap-2">
                  <span className={`text-xl font-bold min-w-[2rem] text-right ${
                    isCompleted && game.score_a > game.score_b ? 'text-ink-900 dark:text-white' : 'text-fiba-muted'
                  }`}>{scoreA}</span>
                  <span className="text-fiba-border text-sm">-</span>
                  <span className={`text-xl font-bold min-w-[2rem] text-left ${
                    isCompleted && game.score_b > game.score_a ? 'text-ink-900 dark:text-white' : 'text-fiba-muted'
                  }`}>{scoreB}</span>
                </div>
              ) : (
                <div className="text-sm font-semibold text-fiba-accent">
                  {game.time || '--:--'}
                </div>
              )}
              {isLive && (
                <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider mt-0.5">LIVE</div>
              )}
              {isCompleted && (
                <div className="text-[10px] text-fiba-muted/60 uppercase tracking-wider mt-0.5">Final</div>
              )}
            </div>

            {/* Team B */}
            <div className="flex-1">
              <div className={`text-sm font-semibold ${isCompleted && game.score_b > game.score_a ? 'text-ink-900 dark:text-white' : 'text-ink-700 dark:text-gray-300'}`}>
                {game.team_b}
              </div>
              {game.team_b_code && (
                <div className="text-xs text-fiba-muted/60 font-medium">{game.team_b_code}</div>
              )}
            </div>
          </div>

          {/* Venue + meta row */}
          {(game.venue || game.game_number) && (
            <div className="flex items-center justify-center gap-3 mt-1.5">
              {game.venue && (
                <span className="text-[11px] text-fiba-muted/60">{game.venue}</span>
              )}
              {game.game_number && (
                <span className="text-[11px] text-fiba-border">{game.game_number}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {canEdit && (
          <div className="flex items-center gap-1 pr-3">
            <button onClick={onEdit} className="p-1.5 text-fiba-muted hover:text-fiba-accent rounded transition-colors"
              title={t('games.editGame')}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button onClick={onDelete} className="p-1.5 text-fiba-muted hover:text-red-400 rounded transition-colors"
              title={t('games.delete')}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {supportsAssignments && (
        <div className="border-t border-fiba-border bg-fiba-surface/40 px-4 py-2 flex items-center gap-3">
          <AssignmentSlot role="TD" game={game} t={t} canEdit={canEdit}
            assignment={assignment.TD} options={tdPersonnel}
            onAssign={onAssign} onUnassign={onUnassign} />
          <AssignmentSlot role="VGO" game={game} t={t} canEdit={canEdit}
            assignment={assignment.VGO} options={vgoPersonnel}
            onAssign={onAssign} onUnassign={onUnassign} />
        </div>
      )}
    </div>
  )
}


// ── Per-game assignment slot (TD or VGO) ───────────────────────────────────

function AssignmentSlot({ role, game, assignment, options, canEdit, onAssign, onUnassign, t }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
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
  const roleLabel = role === 'TD' ? t('games.roleTD') : t('games.roleVGO')

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-fiba-muted/70 w-8">{role}</span>
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

      {open && canEdit && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-fiba-card border border-fiba-border rounded-lg shadow-lg max-h-64 overflow-hidden flex flex-col">
          <input
            type="text"
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('games.searchPerson')}
            className="fiba-input rounded-none border-0 border-b border-fiba-border text-xs"
          />
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-fiba-muted">{t('games.noResults')}</div>
            ) : (
              filtered.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onAssign(game.id, p.id, role)
                    setOpen(false)
                    setSearch('')
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-fiba-surface text-ink-900 dark:text-white"
                >
                  <div className="font-medium truncate">{p.name}</div>
                  {p.country && <div className="text-[10px] text-fiba-muted/60">{p.country}</div>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
