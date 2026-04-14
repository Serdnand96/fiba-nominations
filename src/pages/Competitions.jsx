import { useState, useEffect } from 'react'
import { getCompetitions, createCompetition, updateCompetition, deleteCompetition, getNominations } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const TEMPLATE_BADGES = {
  WCQ: 'bg-red-100 text-red-700',
  BCLA_F4: 'bg-blue-100 text-blue-700',
  BCLA_RS: 'bg-blue-100 text-blue-700',
  LSB: 'bg-amber-100 text-amber-700',
  GENERIC: 'bg-gray-100 text-gray-700',
}

export default function Competitions() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('competitions')
  const [competitions, setCompetitions] = useState([])
  const [nominations, setNominations] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', template_key: 'WCQ', year: new Date().getFullYear() })

  useEffect(() => { load() }, [])

  async function load() {
    const [c, n] = await Promise.all([getCompetitions(), getNominations()])
    setCompetitions(c)
    setNominations(n)
  }

  function nomCount(compId) {
    return nominations.filter(n => n.competition_id === compId).length
  }

  function openCreate() {
    setEditing(null)
    setForm({ name: '', template_key: 'WCQ', year: new Date().getFullYear() })
    setShowModal(true)
  }

  function openEdit(comp) {
    setEditing(comp)
    setForm({ name: comp.name, template_key: comp.template_key, year: comp.year || new Date().getFullYear() })
    setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (editing) {
      await updateCompetition(editing.id, { ...form, year: parseInt(form.year) })
    } else {
      await createCompetition({ ...form, year: parseInt(form.year) })
    }
    setShowModal(false)
    await load()
  }

  async function handleDelete(comp) {
    if (!confirm(t('competitions.confirmDelete', { name: comp.name }))) return
    try {
      await deleteCompetition(comp.id)
      await load()
    } catch (err) {
      if (err.response?.status === 409) {
        if (confirm(t('competitions.confirmForceDelete', { detail: err.response.data.detail }))) {
          await deleteCompetition(comp.id, true)
          await load()
        }
      } else {
        alert(err.response?.data?.detail || t('competitions.errorDeleting'))
      }
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{t('competitions.title')}</h2>
        {canEdit && (
          <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            {t('competitions.newCompetition')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('competitions.name')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('competitions.template')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('competitions.year')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('competitions.nominations')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"></th>
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
                <td className="px-4 py-3">
                  {canEdit && (
                    <div className="flex gap-3">
                      <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline text-sm">{t('competitions.edit')}</button>
                      <button onClick={() => handleDelete(c)} className="text-red-600 hover:underline text-sm">{t('competitions.delete')}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {competitions.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">{t('competitions.noCompetitions')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">{editing ? t('competitions.editCompetition') : t('competitions.newCompetitionTitle')}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required placeholder={t('competitions.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <select value={form.template_key} onChange={e => setForm(f => ({ ...f, template_key: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="WCQ">WCQ</option>
                <option value="BCLA_F4">BCLA Final 4</option>
                <option value="BCLA_RS">BCLA Regular Season</option>
                <option value="LSB">LSB</option>
                <option value="GENERIC">GENERIC</option>
              </select>
              <input type="number" placeholder={t('competitions.year')} value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600">{t('competitions.cancel')}</button>
                <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                  {editing ? t('competitions.save') : t('competitions.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
