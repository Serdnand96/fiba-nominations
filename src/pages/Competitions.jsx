import { useState, useEffect } from 'react'
import { getCompetitions, createCompetition, getNominations } from '../api/client'

const TEMPLATE_BADGES = {
  WCQ: 'bg-red-100 text-red-700',
  BCLA: 'bg-blue-100 text-blue-700',
  LSB: 'bg-amber-100 text-amber-700',
  GENERIC: 'bg-gray-100 text-gray-700',
}

export default function Competitions() {
  const [competitions, setCompetitions] = useState([])
  const [nominations, setNominations] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', template_key: 'WCQ', year: new Date().getFullYear() })

  useEffect(() => {
    Promise.all([getCompetitions(), getNominations()]).then(([c, n]) => {
      setCompetitions(c)
      setNominations(n)
    })
  }, [])

  function nomCount(compId) {
    return nominations.filter(n => n.competition_id === compId).length
  }

  async function handleSubmit(e) {
    e.preventDefault()
    await createCompetition({ ...form, year: parseInt(form.year) })
    setShowModal(false)
    setForm({ name: '', template_key: 'WCQ', year: new Date().getFullYear() })
    const c = await getCompetitions()
    setCompetitions(c)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Competencias</h2>
        <button onClick={() => setShowModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          + Nueva competencia
        </button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Nombre</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Template</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">A&ntilde;o</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Nominaciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {competitions.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TEMPLATE_BADGES[c.template_key] || ''}`}>
                    {c.template_key}
                  </span>
                </td>
                <td className="px-4 py-3">{c.year || '—'}</td>
                <td className="px-4 py-3">{nomCount(c.id)}</td>
              </tr>
            ))}
            {competitions.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No hay competencias</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">Nueva Competencia</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required placeholder="Nombre" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <select value={form.template_key} onChange={e => setForm(f => ({ ...f, template_key: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="WCQ">WCQ</option>
                <option value="BCLA">BCLA</option>
                <option value="LSB">LSB</option>
                <option value="GENERIC">GENERIC</option>
              </select>
              <input type="number" placeholder="A&ntilde;o" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
                <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Crear</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
