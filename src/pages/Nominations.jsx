import { useState, useEffect, useMemo } from 'react'
import {
  getNominations, getPersonnel, getCompetitions,
  createNomination, generateNomination, getDownloadUrl,
} from '../api/client'

const BCLA_ROUNDS = ['Semifinals', '3rd Place', 'Final']

export default function Nominations() {
  const [nominations, setNominations] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)

  // Form state
  const [form, setForm] = useState({
    personnel_id: '',
    competition_id: '',
    letter_date: '',
    location: '',
    venue: '',
    arrival_date: '',
    departure_date: '',
    game_dates: [],
    window_fee: '',
    incidentals: '',
    confirmation_deadline: '',
  })

  useEffect(() => { load() }, [])

  async function load() {
    const [n, p, c] = await Promise.all([getNominations(), getPersonnel(), getCompetitions()])
    setNominations(n)
    setPersonnel(p)
    setCompetitions(c)
  }

  const selectedComp = competitions.find(c => c.id === form.competition_id)
  const templateKey = selectedComp?.template_key || ''
  const showLocationFields = ['BCLA', 'LSB'].includes(templateKey)
  const showDeadline = ['WCQ', 'GENERIC'].includes(templateKey)

  const total = useMemo(() => {
    const w = parseFloat(form.window_fee) || 0
    const i = parseFloat(form.incidentals) || 0
    return (w + i).toFixed(2)
  }, [form.window_fee, form.incidentals])

  const stats = useMemo(() => {
    const generated = nominations.filter(n => n.status === 'generated').length
    const draft = nominations.filter(n => n.status === 'draft').length
    const comps = new Set(nominations.map(n => n.competition_id)).size
    return { total: nominations.length, generated, draft, comps }
  }, [nominations])

  const filtered = useMemo(() => {
    if (!search) return nominations
    const q = search.toLowerCase()
    return nominations.filter(n =>
      n.personnel?.name?.toLowerCase().includes(q) ||
      n.competitions?.name?.toLowerCase().includes(q)
    )
  }, [nominations, search])

  function handleCompChange(competition_id) {
    const comp = competitions.find(c => c.id === competition_id)
    const tk = comp?.template_key || ''
    let gameDates = []
    if (tk === 'BCLA') {
      gameDates = BCLA_ROUNDS.map(label => ({ label, date: '' }))
    }
    setForm(f => ({ ...f, competition_id, game_dates: gameDates }))
  }

  function addGameDate() {
    setForm(f => {
      const idx = f.game_dates.length + 1
      const label = templateKey === 'LSB' ? `Gameday ${idx}` : ''
      return { ...f, game_dates: [...f.game_dates, { label, date: '' }] }
    })
  }

  function removeGameDate(idx) {
    setForm(f => ({ ...f, game_dates: f.game_dates.filter((_, i) => i !== idx) }))
  }

  function updateGameDate(idx, field, value) {
    setForm(f => {
      const gd = [...f.game_dates]
      gd[idx] = { ...gd[idx], [field]: value }
      return { ...f, game_dates: gd }
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        ...form,
        window_fee: parseFloat(form.window_fee) || 0,
        incidentals: parseFloat(form.incidentals) || 0,
      }
      if (!showLocationFields) {
        delete payload.location
        delete payload.venue
        delete payload.arrival_date
        delete payload.departure_date
      }
      if (!showDeadline) {
        delete payload.confirmation_deadline
      }
      await createNomination(payload)
      setShowForm(false)
      setForm({
        personnel_id: '', competition_id: '', letter_date: '', location: '',
        venue: '', arrival_date: '', departure_date: '', game_dates: [],
        window_fee: '', incidentals: '', confirmation_deadline: '',
      })
      await load()
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate(id) {
    setLoading(true)
    try {
      const result = await generateNomination(id)
      console.log('Generate result:', JSON.stringify(result))

      if (result.error || result.status === 'error') {
        alert(`Error generando documento:\n${result.error}\n\n${result.traceback || ''}`)
        return
      }

      await load()

      // Show conversion info
      if (result.conversion_error) {
        alert(`Nota: No se pudo convertir a PDF (se generó .docx).\nError: ${result.conversion_error}`)
      } else if (result.format === 'pdf') {
        alert('PDF generado exitosamente!')
      }

      // Auto-download the generated file
      if (result.pdf_path) {
        const link = document.createElement('a')
        link.href = result.pdf_path.startsWith('http')
          ? result.pdf_path
          : getDownloadUrl(id)
        link.target = '_blank'
        link.click()
      }
    } catch (err) {
      alert(`Error: ${err.message}\n\nRevisa la consola para más detalles.`)
      console.error('Generate error:', err)
    } finally {
      setLoading(false)
    }
  }

  // Searchable personnel dropdown filter
  const [personSearch, setPersonSearch] = useState('')
  const filteredPersonnel = personnel.filter(p =>
    p.name.toLowerCase().includes(personSearch.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Nominaciones</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Nueva nominaci&oacute;n
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: stats.total },
          { label: 'Generadas', value: stats.generated },
          { label: 'Borrador', value: stats.draft },
          { label: 'Competencias', value: stats.comps },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Buscar nominaciones..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full md:w-80 mb-4 px-4 py-2 border rounded-lg text-sm"
      />

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Nombre</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Cargo</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Competencia</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Fecha carta</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Estado</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Acci&oacute;n</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(n => (
              <tr key={n.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{n.personnel?.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    n.personnel?.role === 'VGO' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {n.personnel?.role}
                  </span>
                </td>
                <td className="px-4 py-3">{n.competitions?.name}</td>
                <td className="px-4 py-3">{n.letter_date || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    n.status === 'generated' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {n.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {n.status === 'generated' ? (
                    <div className="flex gap-2">
                      <a
                        href={n.pdf_path?.startsWith('http') ? n.pdf_path : getDownloadUrl(n.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Descargar
                      </a>
                      <button
                        onClick={() => handleGenerate(n.id)}
                        disabled={loading}
                        className="text-gray-400 hover:text-blue-600 hover:underline text-sm"
                      >
                        Regenerar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleGenerate(n.id)}
                      disabled={loading}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      Generar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No hay nominaciones</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Creation Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center pt-16 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Nueva Nominaci&oacute;n</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Person select */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Persona</label>
                <input
                  type="text"
                  placeholder="Buscar persona..."
                  value={personSearch}
                  onChange={e => setPersonSearch(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm mb-1"
                />
                <select
                  required
                  value={form.personnel_id}
                  onChange={e => setForm(f => ({ ...f, personnel_id: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">Seleccionar...</option>
                  {filteredPersonnel.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
                  ))}
                </select>
              </div>

              {/* Competition select */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Competencia</label>
                <select
                  required
                  value={form.competition_id}
                  onChange={e => handleCompChange(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">Seleccionar...</option>
                  {competitions.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.template_key})</option>
                  ))}
                </select>
              </div>

              {/* Letter date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de carta</label>
                <input
                  type="date"
                  value={form.letter_date}
                  onChange={e => setForm(f => ({ ...f, letter_date: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>

              {/* Location & Venue (BCLA/LSB only) */}
              {showLocationFields && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                      <input
                        type="text"
                        value={form.location}
                        onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Venue</label>
                      <input
                        type="text"
                        value={form.venue}
                        onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Arrival Date</label>
                      <input
                        type="date"
                        value={form.arrival_date}
                        onChange={e => setForm(f => ({ ...f, arrival_date: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Departure Date</label>
                      <input
                        type="date"
                        value={form.departure_date}
                        onChange={e => setForm(f => ({ ...f, departure_date: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Game Dates */}
              {templateKey && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Game Dates</label>
                  {form.game_dates.map((gd, idx) => (
                    <div key={idx} className="flex gap-2 mb-2 items-center">
                      {templateKey === 'BCLA' ? (
                        <span className="text-sm text-gray-600 w-28">{gd.label}</span>
                      ) : (
                        <input
                          type="text"
                          value={gd.label}
                          onChange={e => updateGameDate(idx, 'label', e.target.value)}
                          placeholder="Label"
                          className="w-32 px-2 py-1.5 border rounded text-sm"
                          readOnly={templateKey === 'LSB'}
                        />
                      )}
                      <input
                        type="date"
                        value={gd.date}
                        onChange={e => updateGameDate(idx, 'date', e.target.value)}
                        className="flex-1 px-2 py-1.5 border rounded text-sm"
                      />
                      {templateKey !== 'BCLA' && (
                        <button type="button" onClick={() => removeGameDate(idx)} className="text-red-400 hover:text-red-600 text-lg">&times;</button>
                      )}
                    </div>
                  ))}
                  {templateKey !== 'BCLA' && (
                    <button
                      type="button"
                      onClick={addGameDate}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      + Agregar fecha
                    </button>
                  )}
                </div>
              )}

              {/* Confirmation Deadline (WCQ/GENERIC only) */}
              {showDeadline && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirmation Deadline</label>
                  <input
                    type="date"
                    value={form.confirmation_deadline}
                    onChange={e => setForm(f => ({ ...f, confirmation_deadline: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              )}

              {/* Fees */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {showDeadline ? 'Per Game Fee' : 'Window Fee'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.window_fee}
                    onChange={e => setForm(f => ({ ...f, window_fee: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Incidentals</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.incidentals}
                    onChange={e => setForm(f => ({ ...f, incidentals: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total</label>
                  <input
                    type="text"
                    value={total}
                    readOnly
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {loading ? 'Guardando...' : 'Crear Nominaci\u00f3n'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
