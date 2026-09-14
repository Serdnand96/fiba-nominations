import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getNominations, getPersonnel, getCompetitions,
  generateNomination, deleteNomination, bulkDeleteNominations,
  downloadNominationBlob, downloadNominationsZip, previewNomination,
  updateNominationConfirmation, updateNominationApproval,
} from '../api/client'
import { roleLabel, roleBadgeClass } from '../lib/roles'

const CONFIRMATION_BADGES = {
  pending: 'bg-gray-500/20 text-ink-700 dark:text-gray-300 border border-gray-500/40',
  nominated: 'bg-fiba-accent/20 text-fiba-accent border border-fiba-accent/40',
  confirmed: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
  declined: 'bg-orange-500/20 text-orange-400 border border-orange-500/40',
}
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/ui/Toast'
import { InfoHint } from '../components/ui/Tooltip'
import NominationsMatrix from '../components/NominationsMatrix'
import PersonProfilePanel from '../components/PersonProfilePanel'
import NominationFormModal, { NominationPreviewModal, describeNominationError } from '../components/NominationFormModal'

function compareValues(a, b, dir) {
  const av = (a ?? '').toString().toLowerCase()
  const bv = (b ?? '').toString().toLowerCase()
  const cmp = av.localeCompare(bv, undefined, { numeric: true })
  return dir === 'asc' ? cmp : -cmp
}

function triggerBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export default function Nominations() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const { push } = useToast()
  const canEdit = hasEdit('nominations')
  const [searchParams, setSearchParams] = useSearchParams()
  const [nominations, setNominations] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [search, setSearch] = useState('')
  const [confirmationFilter, setConfirmationFilter] = useState('')
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const [profilePerson, setProfilePerson] = useState(null)
  const [view, setView] = useState('table') // 'table' | 'matrix'
  const [loading, setLoading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)

  // { mode: 'create', competitionId } | { mode: 'edit', nomination } | null
  const [formState, setFormState] = useState(null)
  // { kind: 'existing', id, title } | null — row-level "Ver carta"
  const [previewFor, setPreviewFor] = useState(null)

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [preselectedHandled, setPreselectedHandled] = useState(false)

  useEffect(() => { load() }, [])

  // Auto-open form when arriving from calendar with ?competition=ID
  useEffect(() => {
    const compId = searchParams.get('competition')
    if (compId && competitions.length > 0 && !preselectedHandled) {
      const comp = competitions.find(c => c.id === compId)
      if (comp) setFormState({ mode: 'create', competitionId: compId })
      setPreselectedHandled(true)
      setSearchParams({}, { replace: true })
    }
  }, [competitions, searchParams])

  async function load() {
    setLoading(true)
    try {
      const [n, p, c] = await Promise.all([getNominations(), getPersonnel(), getCompetitions()])
      setNominations(n)
      setPersonnel(p)
      setCompetitions(c)
      return n
    } catch (err) {
      console.error('Load error:', err)
      push({ type: 'error', title: t('nominations.errorLoading') })
      return nominations
    } finally {
      setLoading(false)
    }
  }

  const stats = useMemo(() => {
    const generated = nominations.filter(n => n.status === 'generated').length
    const draft = nominations.filter(n => n.status === 'draft').length
    const comps = new Set(nominations.map(n => n.competition_id)).size
    return { total: nominations.length, generated, draft, comps }
  }, [nominations])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const rows = nominations.filter(n => {
      if (confirmationFilter && (n.confirmation_status || 'pending') !== confirmationFilter) return false
      if (!q) return true
      return (
        n.personnel?.name?.toLowerCase().includes(q) ||
        n.competitions?.name?.toLowerCase().includes(q)
      )
    })
    if (!sort.key) return rows
    const accessors = {
      name: n => n.personnel?.name,
      role: n => n.personnel?.role,
      competition: n => n.competitions?.name,
      letter_date: n => n.letter_date,
      status: n => n.status,
      cm_approved: n => n.cm_approved ? 1 : 0,
    }
    const get = accessors[sort.key]
    return [...rows].sort((a, b) => compareValues(get(a), get(b), sort.dir))
  }, [nominations, search, confirmationFilter, sort])

  function toggleSort(key) {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' })
  }

  async function handleConfirmationChange(nom, newStatus) {
    if (newStatus === (nom.confirmation_status || 'pending')) return
    try {
      const updated = await updateNominationConfirmation(nom.id, newStatus)
      setNominations(prev => prev.map(n => n.id === nom.id ? { ...n, ...updated } : n))
    } catch (err) {
      push({ type: 'error', title: t('nominations.errorUpdatingConfirmation'), body: err.response?.data?.detail || err.message })
    }
  }

  async function handleApprovalChange(nom, approved) {
    if (approved === !!nom.cm_approved) return
    const previous = nom.cm_approved
    // Optimistic update so the checkbox reacts immediately; reverted below on error.
    setNominations(prev => prev.map(n => n.id === nom.id ? { ...n, cm_approved: approved } : n))
    try {
      const updated = await updateNominationApproval(nom.id, approved)
      setNominations(prev => prev.map(n => n.id === nom.id ? { ...n, ...updated } : n))
    } catch (err) {
      setNominations(prev => prev.map(n => n.id === nom.id ? { ...n, cm_approved: previous } : n))
      push({ type: 'error', title: t('nominations.errorUpdatingApproval'), body: err.response?.data?.detail || err.message })
    }
  }

  // Generates every id in sequence (progress bar), then delivers the result:
  // exactly one PDF downloads directly, more than one comes back as a single
  // ZIP — replaces the old "download one, sleep 500ms, repeat" loop.
  async function generateAndDeliver(ids, freshList) {
    const nameOf = (id) => freshList.find(n => n.id === id)?.personnel?.name || id
    let successCount = 0
    const generatedIds = []
    const failed = []
    setBulkProgress({ total: ids.length, done: 0 })

    for (let i = 0; i < ids.length; i++) {
      setBulkProgress({ total: ids.length, done: i, current: `${i + 1} / ${ids.length}` })
      try {
        const result = await generateNomination(ids[i])
        if (result.status === 'generated') {
          successCount++
          generatedIds.push(ids[i])
        } else {
          failed.push({ name: nameOf(ids[i]), message: describeNominationError({ response: { data: { detail: result } } }, t) })
        }
      } catch (err) {
        failed.push({ name: nameOf(ids[i]), message: describeNominationError(err, t) })
      }
    }
    setBulkProgress(null)

    const finalList = await load()

    if (generatedIds.length === 1) {
      const nom = finalList.find(n => n.id === generatedIds[0])
      await downloadFile(generatedIds[0], `${nom?.personnel?.name || 'Nomination'} ${nom?.competitions?.name || ''}.pdf`.trim())
    } else if (generatedIds.length > 1) {
      try {
        const { blob, skipped } = await downloadNominationsZip(generatedIds)
        triggerBlobDownload(blob, `nominations-${Date.now()}.zip`)
        if (skipped > 0) push({ type: 'info', title: t('nominations.zipSkipped', { count: skipped }) })
      } catch (err) {
        push({ type: 'error', title: describeNominationError(err, t) })
      }
    }

    if (failed.length === 0) {
      push({ type: 'success', title: t('nominations.generatedCount', { success: successCount, total: ids.length }) })
    } else {
      push({
        type: 'error',
        title: t('nominations.generatedCount', { success: successCount, total: ids.length }),
        body: failed.map(f => `${f.name}: ${f.message}`).join(' · '),
      })
    }
  }

  async function handleCreated(createdIds) {
    setFormState(null)
    const fresh = await load()
    if (createdIds.length === 0) return
    setLoading(true)
    try {
      await generateAndDeliver(createdIds, fresh)
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate(id) {
    setLoading(true)
    try {
      const result = await generateNomination(id)
      if (result.error || result.status === 'error') {
        push({ type: 'error', title: describeNominationError({ response: { data: { detail: result } } }, t) })
        return
      }
      await load()
      if (result.conversion_error) {
        push({ type: 'info', title: t('nominations.conversionNote'), body: result.conversion_error })
      } else {
        push({ type: 'success', title: t('nominations.generatedCount', { success: 1, total: 1 }) })
      }
      if (result.pdf_path) {
        downloadFile(id, result.filename)
      }
    } catch (err) {
      push({ type: 'error', title: describeNominationError(err, t) })
    } finally {
      setLoading(false)
    }
  }

  async function handleBulkGenerate() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setLoading(true)
    try {
      await generateAndDeliver(ids, nominations)
      setSelectedIds(new Set())
    } finally {
      setLoading(false)
    }
  }

  async function handleDownloadSelectedZip() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    try {
      const { blob, skipped } = await downloadNominationsZip(ids)
      triggerBlobDownload(blob, `nominations-${Date.now()}.zip`)
      if (skipped > 0) push({ type: 'info', title: t('nominations.zipSkipped', { count: skipped }) })
    } catch (err) {
      push({ type: 'error', title: describeNominationError(err, t) })
    }
  }

  // record_no of the payment attached to a nomination (PostgREST may embed
  // the one-to-one payments relation as an object or a single-element array).
  function paymentRecordOf(n) {
    const p = n.payments
    if (!p) return null
    return Array.isArray(p) ? (p[0]?.record_no || null) : (p.record_no || null)
  }

  async function handleDeleteNomination(nom) {
    const record = paymentRecordOf(nom)
    if (record) {
      push({ type: 'error', title: t('nominations.deleteBlockedPayment', { record }) })
      return
    }
    if (!confirm(t('nominations.confirmDelete', { name: nom.personnel?.name }))) return
    try {
      await deleteNomination(nom.id)
      await load()
    } catch (err) {
      push({ type: 'error', title: t('nominations.errorDeleting'), body: err.response?.data?.detail || err.message })
    }
  }

  async function handleBulkDelete() {
    const rows = nominations.filter(n => selectedIds.has(n.id))
    if (rows.length === 0) return
    const withPayment = rows.filter(n => paymentRecordOf(n))
    const deletable = rows.filter(n => !paymentRecordOf(n))
    if (deletable.length === 0) {
      push({ type: 'error', title: t('nominations.bulkAllHavePayments', { count: withPayment.length }) })
      return
    }
    const msg = withPayment.length > 0
      ? t('nominations.confirmBulkDeleteWithPayments', {
          count: deletable.length,
          blocked: withPayment.length,
          records: withPayment.map(paymentRecordOf).join(', '),
        })
      : t('nominations.confirmBulkDelete', { count: deletable.length })
    if (!confirm(msg)) return
    try {
      const res = await bulkDeleteNominations(deletable.map(n => n.id))
      setSelectedIds(new Set())
      await load()
      // Payments attached between page load and delete (another user/tab):
      // the API refuses those rows even though the pre-check let them through.
      if (res?.blocked?.length > 0) {
        push({ type: 'error', title: t('nominations.bulkDeleteBlockedAfter', {
          count: res.blocked.length,
          records: res.blocked.map(b => b.record_no).join(', '),
        }) })
      } else {
        push({ type: 'success', title: t('nominations.deleteCount', { count: deletable.length }) })
      }
    } catch (err) {
      push({ type: 'error', title: t('nominations.errorDeletingBulk'), body: err.response?.data?.detail || err.message })
    }
  }

  async function downloadFile(id, filename) {
    const defaultName = filename || 'nomination.pdf'
    try {
      const blob = await downloadNominationBlob(id, defaultName)
      triggerBlobDownload(blob, defaultName)
    } catch (err) {
      push({ type: 'error', title: t('nominations.errorGenerating'), body: err.response?.status || err.message })
    }
  }

  function toggleTableSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(n => n.id)))
    }
  }

  function SortHeader({ label, sortKey }) {
    const active = sort.key === sortKey
    return (
      <th onClick={() => toggleSort(sortKey)}
        className="cursor-pointer select-none hover:text-ink-900 dark:hover:text-white"
        title={t('common.sort') || 'Sort'}>
        <span className="inline-flex items-center gap-1">
          {label}
          <span className={`text-fiba-accent transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}>
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        </span>
      </th>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('nominations.title')}</h2>
          <div className="inline-flex rounded-lg border border-fiba-border overflow-hidden">
            {[
              { key: 'table', label: t('nominations.viewTable') },
              { key: 'matrix', label: t('nominations.viewMatrix') },
            ].map(o => (
              <button key={o.key} onClick={() => setView(o.key)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === o.key
                    ? 'bg-basketball-700 text-white'
                    : 'text-fiba-muted hover:text-ink-900 dark:hover:text-white'
                }`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {canEdit && view === 'table' && (
          <div className="flex flex-wrap gap-2">
            {selectedIds.size > 0 && (
              <>
                <button onClick={handleBulkDelete} disabled={loading}
                  className="btn-fiba-danger disabled:opacity-50">
                  {t('nominations.deleteCount', { count: selectedIds.size })}
                </button>
                <button onClick={handleDownloadSelectedZip} disabled={loading}
                  className="btn-fiba-ghost disabled:opacity-50">
                  {t('nominations.downloadZipCount', { count: selectedIds.size })}
                </button>
                <button onClick={handleBulkGenerate} disabled={loading}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {loading && bulkProgress
                    ? t('nominations.generatingProgress', { current: bulkProgress.current })
                    : t('nominations.generateCount', { count: selectedIds.size })}
                </button>
              </>
            )}
            <button onClick={() => setFormState({ mode: 'create', competitionId: '' })}
              className="btn-fiba">
              {t('nominations.newNomination')}
            </button>
          </div>
        )}
      </div>

      {view === 'matrix' && (
        <NominationsMatrix nominations={nominations} personnel={personnel} />
      )}

      {view === 'table' && (<>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: t('nominations.total'), value: stats.total },
          { label: t('nominations.generated'), value: stats.generated },
          { label: t('nominations.draft'), value: stats.draft },
          { label: t('nominations.competitions'), value: stats.comps },
        ].map(s => (
          <div key={s.label} className="fiba-stat">
            <p className="text-xs text-fiba-muted">{s.label}</p>
            <p className="text-2xl font-bold text-ink-900 dark:text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="text" placeholder={t('nominations.searchNominations')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-80" />
        <div className="flex items-center gap-1.5">
          <select value={confirmationFilter} onChange={e => setConfirmationFilter(e.target.value)}
            className="fiba-select !w-auto min-w-[180px] flex-shrink-0">
            <option value="">{t('nominations.allConfirmations')}</option>
            <option value="pending">{t('nominations.confPending')}</option>
            <option value="nominated">{t('nominations.confNominated')}</option>
            <option value="confirmed">{t('nominations.confConfirmed')}</option>
            <option value="declined">{t('nominations.confDeclined')}</option>
          </select>
          <InfoHint label={t('nominations.pendingHint')} />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <th className="px-4 py-3 w-10">
                <input type="checkbox" checked={filtered.length > 0 && selectedIds.size === filtered.length}
                  onChange={toggleSelectAll} className="rounded" />
              </th>
              <SortHeader label={t('nominations.name')} sortKey="name" />
              <SortHeader label={t('nominations.role')} sortKey="role" />
              <SortHeader label={t('nominations.competition')} sortKey="competition" />
              <SortHeader label={t('nominations.letterDate')} sortKey="letter_date" />
              <SortHeader label={t('nominations.status')} sortKey="status" />
              <th>
                <span className="inline-flex items-center gap-1.5">
                  {t('nominations.confirmation')}
                  <InfoHint label={t('nominations.pendingHint')} position="bottom" />
                </span>
              </th>
              <SortHeader label={t('nominations.cmApproval')} sortKey="cm_approved" />
              <th>{t('nominations.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(n => (
              <tr key={n.id} className={
                selectedIds.has(n.id)
                  ? 'bg-fiba-accent/10'
                  : n.cm_approved ? 'bg-success-50 dark:bg-success-500/10' : ''
              }>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selectedIds.has(n.id)} onChange={() => toggleTableSelect(n.id)} className="rounded" />
                </td>
                <td className="px-4 py-3">
                  {n.personnel_id ? (
                    <button onClick={() => setProfilePerson({ id: n.personnel_id, ...n.personnel })}
                      className="text-left text-fiba-accent hover:underline font-medium">
                      {n.personnel?.name}
                    </button>
                  ) : n.personnel?.name}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(n.personnel?.role)}`}>
                    {roleLabel(n.personnel?.role)}
                  </span>
                </td>
                <td className="px-4 py-3">{n.competitions?.name}</td>
                <td className="px-4 py-3">{n.letter_date || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${n.status === 'generated' ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                    {n.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const cs = n.confirmation_status || 'pending'
                    const labelKey = `conf${cs.charAt(0).toUpperCase()}${cs.slice(1)}`
                    const titleParts = []
                    if (cs === 'pending') titleParts.push(t('nominations.pendingHint'))
                    if (n.confirmation_updated_at) titleParts.push(`${t('nominations.confirmationUpdatedAt')}: ${new Date(n.confirmation_updated_at).toLocaleString()}`)
                    const titleText = titleParts.join(' · ') || undefined
                    if (canEdit) {
                      return (
                        <select
                          value={cs}
                          onChange={e => handleConfirmationChange(n, e.target.value)}
                          title={titleText}
                          className={`text-xs font-medium rounded px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-fiba-accent/40 ${CONFIRMATION_BADGES[cs]}`}
                        >
                          <option value="pending">{t('nominations.confPending')}</option>
                          <option value="nominated">{t('nominations.confNominated')}</option>
                          <option value="confirmed">{t('nominations.confConfirmed')}</option>
                          <option value="declined">{t('nominations.confDeclined')}</option>
                        </select>
                      )
                    }
                    return (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CONFIRMATION_BADGES[cs]}`}
                        title={titleText}>
                        {t(`nominations.${labelKey}`)}
                      </span>
                    )
                  })()}
                </td>
                <td className="px-4 py-3 text-center"
                  title={n.cm_approved_at ? t('nominations.cmApprovedOn', { date: new Date(n.cm_approved_at).toLocaleString() }) : ''}>
                  <input
                    type="checkbox"
                    checked={!!n.cm_approved}
                    disabled={!canEdit}
                    onChange={e => handleApprovalChange(n, e.target.checked)}
                    className="rounded border-ink-300 text-success-600 focus:ring-success-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setPreviewFor({ id: n.id, title: t('nominations.previewTitle', { name: n.personnel?.name || '' }) })}
                      className="text-fiba-accent hover:underline text-sm">
                      {t('nominations.viewLetter')}
                    </button>
                    {n.status === 'generated' && (
                      <button
                        onClick={() => downloadFile(n.id, `${n.personnel?.name || 'Nomination'} ${n.competitions?.name || ''}.pdf`.trim())}
                        className="text-fiba-accent hover:underline text-sm">
                        {t('nominations.download')}
                      </button>
                    )}
                    {canEdit && (
                      <>
                        <button onClick={() => setFormState({ mode: 'edit', nomination: n })}
                          className="text-fiba-muted hover:text-fiba-accent hover:underline text-sm">
                          {t('nominations.edit')}
                        </button>
                        {n.status === 'generated' ? (
                          <button onClick={() => handleGenerate(n.id)} disabled={loading}
                            className="text-fiba-muted hover:text-fiba-accent hover:underline text-sm">
                            {t('nominations.regenerate')}
                          </button>
                        ) : (
                          <button onClick={() => handleGenerate(n.id)} disabled={loading}
                            className="text-fiba-accent hover:underline text-sm">
                            {t('nominations.generate')}
                          </button>
                        )}
                        <button onClick={() => handleDeleteNomination(n)} className="text-red-400 hover:underline text-sm">
                          {t('nominations.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-fiba-muted/60">{t('nominations.noNominations')}</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      </>)}

      {/* Create / edit modal */}
      {formState && (
        <NominationFormModal
          mode={formState.mode}
          nomination={formState.nomination}
          initialCompetitionId={formState.competitionId}
          competitions={competitions}
          personnel={personnel}
          onClose={() => setFormState(null)}
          onCreated={handleCreated}
          onUpdated={load}
        />
      )}

      {/* Row-level "Ver carta" preview */}
      {previewFor && (
        <NominationPreviewModal
          title={previewFor.title}
          fetcher={() => previewNomination(previewFor.id)}
          onClose={() => setPreviewFor(null)}
        />
      )}

      {/* Person profile panel */}
      {profilePerson && (
        <PersonProfilePanel
          person={profilePerson}
          onClose={() => setProfilePerson(null)}
          onUpdated={load}
          canEdit={hasEdit('personnel')}
          canEditAvail={hasEdit('availability')}
        />
      )}
    </div>
  )
}
