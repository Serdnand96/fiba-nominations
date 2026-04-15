import { useState, useEffect, useRef } from 'react'
import {
  getGames, getGameDates, getGameTeams, createGame, updateGame, deleteGame,
  syncGameResults, importGamesExcel, getCalendarCompetitions
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const STATUS_COLORS = {
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  live: 'bg-red-50 text-red-700 border-red-200',
  postponed: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
}

const PHASE_OPTIONS = ['Group Phase', 'Quarterfinals', 'Semifinals', 'Classification', 'Finals']

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
  const fileRef = useRef(null)

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
    loadGames()
  }, [selectedCompId])

  async function loadGames() {
    setLoading(true)
    try {
      const [g, d, te] = await Promise.all([
        getGames(selectedCompId),
        getGameDates(selectedCompId),
        getGameTeams(selectedCompId),
      ])
      setGames(g)
      setGameDates(d)
      setTeams(te)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  // Filtered + grouped games
  const filtered = games.filter(g => {
    if (filterDate && g.date !== filterDate) return false
    if (filterGroup && g.group_label !== filterGroup) return false
    return true
  })

  const groups = [...new Set(games.map(g => g.group_label).filter(Boolean))].sort()
  const phases = [...new Set(games.map(g => g.phase).filter(Boolean))]

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
  const scheduledCount = games.filter(g => g.status === 'scheduled').length

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

  if (!selectedCompId && competitions.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400 text-sm">
        {t('games.selectCompetition')}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{t('games.title')}</h2>
        <div className="flex items-center gap-3">
          {canEdit && selectedCompId && (
            <>
              <button onClick={() => setShowImport(true)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                {t('games.importExcel')}
              </button>
              <button onClick={handleSync} disabled={syncing}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {syncing ? t('games.syncing') : t('games.syncResults')}
              </button>
              <button onClick={openCreate}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                {t('games.addGame')}
              </button>
            </>
          )}
        </div>
      </div>

      {syncMsg && (
        <div className="mb-4 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm">{syncMsg}</div>
      )}

      {/* Competition selector + filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select value={selectedCompId} onChange={e => { setSelectedCompId(e.target.value); setFilterDate(''); setFilterGroup('') }}
          className="px-3 py-2 border rounded-lg text-sm bg-white min-w-[220px]">
          {competitions.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {gameDates.length > 0 && (
          <select value={filterDate} onChange={e => setFilterDate(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-white">
            <option value="">{t('games.allDates')}</option>
            {gameDates.map(d => (
              <option key={d} value={d}>{formatDate(d)}</option>
            ))}
          </select>
        )}

        {groups.length > 0 && (
          <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-white">
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
          <div className="bg-white rounded-lg border px-4 py-3 flex-1">
            <div className="text-2xl font-bold text-gray-900">{games.length}</div>
            <div className="text-xs text-gray-500">{t('games.totalGames')}</div>
          </div>
          <div className="bg-white rounded-lg border px-4 py-3 flex-1">
            <div className="text-2xl font-bold text-gray-900">{teams.length}</div>
            <div className="text-xs text-gray-500">{t('games.teams')}</div>
          </div>
          <div className="bg-white rounded-lg border px-4 py-3 flex-1">
            <div className="text-2xl font-bold text-gray-900">{gameDates.length}</div>
            <div className="text-xs text-gray-500">{t('games.gameDays')}</div>
          </div>
          <div className="bg-white rounded-lg border px-4 py-3 flex-1">
            <div className="text-2xl font-bold text-green-600">{completedCount}</div>
            <div className="text-xs text-gray-500">{t('games.completed')}</div>
          </div>
        </div>
      )}

      {/* Game cards - FIBA style */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">{t('games.noGames')}</div>
      ) : (
        Object.entries(gamesByPhase).map(([phase, dateGroups]) => (
          <div key={phase} className="mb-8">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 px-1">{phase}</h3>
            {Object.entries(dateGroups).sort(([a], [b]) => a.localeCompare(b)).map(([date, dateGames]) => (
              <div key={date} className="mb-6">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-2 px-1">{formatDate(date)}</div>
                <div className="space-y-2">
                  {dateGames.sort((a, b) => (a.time || '').localeCompare(b.time || '')).map(game => (
                    <GameCard key={game.id} game={game} canEdit={canEdit}
                      onEdit={() => openEdit(game)} onDelete={() => handleDelete(game)} t={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">{editing ? t('games.editGame') : t('games.newGame')}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.date')}</label>
                  <input type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.time')}</label>
                  <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.teamA')}</label>
                  <input required placeholder="e.g. Argentina" value={form.team_a}
                    onChange={e => setForm(f => ({ ...f, team_a: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.teamB')}</label>
                  <input required placeholder="e.g. Brazil" value={form.team_b}
                    onChange={e => setForm(f => ({ ...f, team_b: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.codeA')}</label>
                  <input placeholder="ARG" value={form.team_a_code}
                    onChange={e => setForm(f => ({ ...f, team_a_code: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" maxLength={3} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.codeB')}</label>
                  <input placeholder="BRA" value={form.team_b_code}
                    onChange={e => setForm(f => ({ ...f, team_b_code: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" maxLength={3} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.scoreA')}</label>
                  <input type="number" placeholder="-" value={form.score_a}
                    onChange={e => setForm(f => ({ ...f, score_a: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.scoreB')}</label>
                  <input type="number" placeholder="-" value={form.score_b}
                    onChange={e => setForm(f => ({ ...f, score_b: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.venue')}</label>
                  <input value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.city')}</label>
                  <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.phase')}</label>
                  <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    {PHASE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.group')}</label>
                  <input placeholder="A" value={form.group_label}
                    onChange={e => setForm(f => ({ ...f, group_label: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('games.status')}</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="scheduled">{t('games.scheduled')}</option>
                    <option value="completed">{t('games.completed')}</option>
                    <option value="live">{t('games.live')}</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                  {t('games.cancel')}
                </button>
                <button type="submit"
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                  {editing ? t('games.save') : t('games.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">{t('games.importExcel')}</h3>

            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) setImportFile(e.dataTransfer.files[0]) }}
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
            >
              {importFile ? (
                <p className="text-sm font-medium text-gray-700">{importFile.name}</p>
              ) : (
                <p className="text-sm text-gray-400">{t('games.dragOrClick')}</p>
              )}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { if (e.target.files[0]) setImportFile(e.target.files[0]) }} />
            </div>

            <div className="mt-3 text-xs text-gray-400">
              <p>Columns: Date | Time | Team A | Team B | Venue | Phase | Group</p>
            </div>

            {importMsg && (
              <div className="mt-3 px-3 py-2 bg-blue-50 text-blue-700 rounded text-sm">{importMsg}</div>
            )}

            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setShowImport(false); setImportFile(null); setImportMsg('') }}
                className="px-4 py-2 text-sm text-gray-600">{t('games.cancel')}</button>
              <button onClick={handleImport} disabled={!importFile || importing}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
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

function GameCard({ game, canEdit, onEdit, onDelete, t }) {
  const isCompleted = game.status === 'completed'
  const isLive = game.status === 'live'
  const scoreA = game.score_a ?? '-'
  const scoreB = game.score_b ?? '-'

  return (
    <div className={`bg-white rounded-lg border overflow-hidden hover:shadow-sm transition-shadow ${
      isLive ? 'border-red-300 ring-1 ring-red-100' : ''
    }`}>
      <div className="flex items-center">
        {/* Group label */}
        {game.group_label && (
          <div className="w-10 bg-gray-50 flex items-center justify-center border-r self-stretch">
            <span className="text-xs font-bold text-gray-400 rotate-0">{game.group_label}</span>
          </div>
        )}

        {/* Game content */}
        <div className="flex-1 px-4 py-3">
          <div className="flex items-center gap-4">
            {/* Team A */}
            <div className="flex-1 text-right">
              <div className={`text-sm font-semibold ${isCompleted && game.score_a > game.score_b ? 'text-gray-900' : 'text-gray-700'}`}>
                {game.team_a}
              </div>
              {game.team_a_code && (
                <div className="text-xs text-gray-400 font-medium">{game.team_a_code}</div>
              )}
            </div>

            {/* Score / Time */}
            <div className="flex-shrink-0 w-28 text-center">
              {isCompleted || isLive ? (
                <div className="flex items-center justify-center gap-2">
                  <span className={`text-xl font-bold min-w-[2rem] text-right ${
                    isCompleted && game.score_a > game.score_b ? 'text-gray-900' : 'text-gray-500'
                  }`}>{scoreA}</span>
                  <span className="text-gray-300 text-sm">-</span>
                  <span className={`text-xl font-bold min-w-[2rem] text-left ${
                    isCompleted && game.score_b > game.score_a ? 'text-gray-900' : 'text-gray-500'
                  }`}>{scoreB}</span>
                </div>
              ) : (
                <div className="text-sm font-semibold text-blue-600">
                  {game.time || '--:--'}
                </div>
              )}
              {isLive && (
                <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider mt-0.5">LIVE</div>
              )}
              {isCompleted && (
                <div className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">Final</div>
              )}
            </div>

            {/* Team B */}
            <div className="flex-1">
              <div className={`text-sm font-semibold ${isCompleted && game.score_b > game.score_a ? 'text-gray-900' : 'text-gray-700'}`}>
                {game.team_b}
              </div>
              {game.team_b_code && (
                <div className="text-xs text-gray-400 font-medium">{game.team_b_code}</div>
              )}
            </div>
          </div>

          {/* Venue + meta row */}
          {(game.venue || game.game_number) && (
            <div className="flex items-center justify-center gap-3 mt-1.5">
              {game.venue && (
                <span className="text-[11px] text-gray-400">{game.venue}</span>
              )}
              {game.game_number && (
                <span className="text-[11px] text-gray-300">{game.game_number}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {canEdit && (
          <div className="flex items-center gap-1 pr-3">
            <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-600 rounded transition-colors"
              title={t('games.editGame')}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-600 rounded transition-colors"
              title={t('games.delete')}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
