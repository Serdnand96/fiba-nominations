import { useEffect, useMemo, useState } from 'react'
import {
  getCalendarCompetitions, getEvaluationCriteria, getEvaluationNominees,
  createEvaluation, updateEvaluation, deleteEvaluation, getPersonnelEvaluations,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { roleLabel, roleBadgeClass } from '../lib/roles'
import { readLastSearch, writeLastSearch } from '../lib/lastSearch'
import CompetitionSearch from '../components/CompetitionSearch'
import { Icon } from '../lib/icons'

const LAST_SEARCH_KEY = 'fiba_evaluations_last_search'

const EMPTY_FORM = {
  evaluator_role: 'competition_lead',
  scores: {},
  strengths: '',
  improvements: '',
  comments: '',
  status: 'draft',
}

// Green at the top, red at the bottom — the same scale the badges use.
function avgClass(avg) {
  if (avg == null) return 'text-fiba-muted'
  if (avg >= 4.5) return 'text-emerald-400'
  if (avg >= 3.5) return 'text-lime-400'
  if (avg >= 2.5) return 'text-amber-500'
  return 'text-red-400'
}

function fmtAvg(avg) {
  return avg == null ? '—' : Number(avg).toFixed(2)
}

/** 1-5 selector. Clicking the star already selected clears the rating. */
function StarRating({ value, max, disabled, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => {
        const Filled = n <= (value || 0) ? Icon.StarFilled : Icon.Star
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value === n ? null : n)}
            className={`p-0.5 ${disabled ? 'cursor-default' : 'cursor-pointer hover:scale-110 transition-transform'} ${
              n <= (value || 0) ? 'text-basketball-500' : 'text-fiba-muted/40'
            }`}
            aria-label={String(n)}
          >
            <Filled className="w-5 h-5" />
          </button>
        )
      })}
      <span className="ml-2 text-xs text-fiba-muted tabular-nums w-6">{value || '—'}</span>
    </div>
  )
}

export default function Evaluations() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('evaluations')

  const restored = useMemo(() => readLastSearch(LAST_SEARCH_KEY), [])

  const [competitions, setCompetitions] = useState([])
  const [meta, setMeta] = useState({ criteria: [], min: 1, max: 5, evaluator_roles: [] })
  const [selectedCompId, setSelectedCompId] = useState(
    typeof restored?.competition === 'string' ? restored.competition : ''
  )
  const [nominees, setNominees] = useState([])
  const [loading, setLoading] = useState(false)

  // Editor panel
  const [target, setTarget] = useState(null)         // the nominee row being evaluated
  const [evaluation, setEvaluation] = useState(null) // my existing evaluation, or null
  const [form, setForm] = useState(EMPTY_FORM)
  const [history, setHistory] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([getCalendarCompetitions(), getEvaluationCriteria()])
      .then(([comps, m]) => { setCompetitions(comps); setMeta(m) })
      .catch(e => console.error(e))
  }, [])

  useEffect(() => {
    writeLastSearch(LAST_SEARCH_KEY, { competition: selectedCompId })
  }, [selectedCompId])

  async function load() {
    if (!selectedCompId) { setNominees([]); return }
    setLoading(true)
    try {
      setNominees(await getEvaluationNominees(selectedCompId))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [selectedCompId])

  const selectedComp = competitions.find(c => c.id === selectedCompId)

  const stats = useMemo(() => {
    const evaluated = nominees.filter(n => (n.evaluations || []).length > 0)
    const rated = nominees.flatMap(n => (n.evaluations || []).filter(e => e.average != null))
    const avg = rated.length
      ? rated.reduce((sum, e) => sum + Number(e.average), 0) / rated.length
      : null
    return { evaluated: evaluated.length, pending: nominees.length - evaluated.length, average: avg }
  }, [nominees])

  function criterionLabel(code) {
    const key = `evaluations.criteria.${code}`
    const translated = t(key)
    return translated === key ? code.replace(/_/g, ' ') : translated
  }

  function openEditor(nominee) {
    setTarget(nominee)
    const mine = nominee.my_evaluation
    setEvaluation(mine || null)
    setForm(mine ? {
      evaluator_role: mine.evaluator_role || 'competition_lead',
      scores: mine.scores || {},
      strengths: mine.strengths || '',
      improvements: mine.improvements || '',
      comments: mine.comments || '',
      status: mine.status || 'draft',
    } : { ...EMPTY_FORM, scores: {} })
    setHistory(null)
    getPersonnelEvaluations(nominee.personnel_id).then(setHistory).catch(() => setHistory(null))
  }

  function closeEditor() {
    setTarget(null)
    setEvaluation(null)
    setForm(EMPTY_FORM)
    setHistory(null)
  }

  function setScore(criterion, value) {
    setForm(f => {
      const scores = { ...f.scores }
      if (value == null) delete scores[criterion]
      else scores[criterion] = value
      return { ...f, scores }
    })
  }

  const formAverage = useMemo(() => {
    const values = Object.values(form.scores || {}).filter(v => v != null)
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  }, [form.scores])

  async function handleSave(e, status) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form, status: status || form.status }
      if (evaluation) {
        await updateEvaluation(evaluation.id, payload)
      } else {
        const created = await createEvaluation({
          ...payload,
          competition_id: selectedCompId,
          personnel_id: target.personnel_id,
        })
        setEvaluation(created)
      }
      setForm(f => ({ ...f, status: status || f.status }))
      await load()
      getPersonnelEvaluations(target.personnel_id).then(setHistory).catch(() => {})
    } catch (err) {
      alert(err.response?.data?.detail || t('evaluations.errorSaving'))
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!evaluation || !confirm(t('evaluations.confirmDelete'))) return
    try {
      await deleteEvaluation(evaluation.id)
      closeEditor()
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || t('evaluations.errorSaving'))
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-900 dark:text-white">{t('evaluations.title')}</h1>
        <p className="text-sm text-fiba-muted mt-1">{t('evaluations.subtitle')}</p>
      </div>

      <div className="mb-6 max-w-md">
        <CompetitionSearch
          competitions={competitions}
          value={selectedCompId}
          onChange={setSelectedCompId}
          placeholder={t('evaluations.selectEvent')}
        />
      </div>

      {!selectedCompId ? (
        <div className="text-center py-20 text-fiba-muted/60">{t('evaluations.pickEventHint')}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: t('evaluations.person'), value: nominees.length },
              { label: t('evaluations.evaluated'), value: stats.evaluated },
              { label: t('evaluations.pending'), value: stats.pending },
              { label: t('evaluations.eventAverage'), value: fmtAvg(stats.average) },
            ].map(s => (
              <div key={s.label} className="fiba-stat">
                <p className="text-xs text-fiba-muted">{s.label}</p>
                <p className="text-2xl font-bold text-ink-900 dark:text-white">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-fiba-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="fiba-table">
                <thead>
                  <tr>
                    <th>{t('evaluations.person')}</th>
                    <th>{t('personnel.role')}</th>
                    <th>{t('personnel.country')}</th>
                    <th className="text-right">{t('evaluations.evaluations')}</th>
                    <th className="text-right">{t('evaluations.average')}</th>
                    <th>{t('evaluations.myEvaluation')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted/60">{t('app.loading')}</td></tr>
                  )}
                  {!loading && nominees.map(n => {
                    const evals = n.evaluations || []
                    const rated = evals.filter(e => e.average != null)
                    const avg = rated.length
                      ? rated.reduce((sum, e) => sum + Number(e.average), 0) / rated.length
                      : null
                    return (
                      <tr key={n.personnel_id}>
                        <td className="px-4 py-3 font-medium">{n.personnel_name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(n.personnel_role)}`}>
                            {roleLabel(n.personnel_role)}
                          </span>
                        </td>
                        <td className="px-4 py-3">{n.personnel_country || '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{evals.length}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-semibold ${avgClass(avg)}`}>{fmtAvg(avg)}</td>
                        <td className="px-4 py-3">
                          {n.my_evaluation
                            ? <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">
                                {t(`evaluations.statusLabel.${n.my_evaluation.status}`)}
                              </span>
                            : <span className="text-xs text-fiba-muted/60">{t('evaluations.noEvaluation')}</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => openEditor(n)} className="text-fiba-accent hover:underline text-sm">
                            {n.my_evaluation ? t('evaluations.edit') : (canEdit ? t('evaluations.evaluate') : t('evaluations.view'))}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!loading && nominees.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted/60">{t('evaluations.noNominees')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Evaluation panel */}
      {target && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeEditor} />
          <div className="fixed top-0 right-0 h-full w-full max-w-xl bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between p-6 border-b border-fiba-border">
              <div>
                <h3 className="text-lg font-bold text-ink-900 dark:text-white">{target.personnel_name}</h3>
                <p className="text-sm text-fiba-muted">{selectedComp?.name}</p>
              </div>
              <button onClick={closeEditor} className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <form onSubmit={e => handleSave(e)} className="space-y-5">
                <div>
                  <label className="block text-xs text-fiba-muted mb-1">{t('evaluations.evaluatorRole')}</label>
                  <select value={form.evaluator_role} disabled={!canEdit}
                    onChange={e => setForm(f => ({ ...f, evaluator_role: e.target.value }))} className="fiba-select w-full">
                    {(meta.evaluator_roles || []).map(r => (
                      <option key={r} value={r}>{t(`evaluations.roleLabel.${r}`)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-baseline justify-between mb-2">
                    <h4 className="text-sm font-semibold text-ink-900 dark:text-white">{t('evaluations.scores')}</h4>
                    <span className={`text-sm font-bold tabular-nums ${avgClass(formAverage)}`}>{fmtAvg(formAverage)}</span>
                  </div>
                  <p className="text-[11px] text-fiba-muted/70 mb-3">{t('evaluations.scoreHint')}</p>
                  <div className="space-y-2">
                    {(meta.criteria || []).map(c => (
                      <div key={c} className="flex items-center justify-between gap-3 py-1">
                        <span className="text-sm text-ink-700 dark:text-gray-300">{criterionLabel(c)}</span>
                        <StarRating
                          value={form.scores?.[c] || null}
                          max={meta.max || 5}
                          disabled={!canEdit}
                          onChange={v => setScore(c, v)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-fiba-muted mb-1">{t('evaluations.strengths')}</label>
                  <textarea rows={2} value={form.strengths} disabled={!canEdit}
                    onChange={e => setForm(f => ({ ...f, strengths: e.target.value }))} className="fiba-input w-full" />
                </div>
                <div>
                  <label className="block text-xs text-fiba-muted mb-1">{t('evaluations.improvements')}</label>
                  <textarea rows={2} value={form.improvements} disabled={!canEdit}
                    onChange={e => setForm(f => ({ ...f, improvements: e.target.value }))} className="fiba-input w-full" />
                </div>
                <div>
                  <label className="block text-xs text-fiba-muted mb-1">{t('evaluations.comments')}</label>
                  <textarea rows={3} value={form.comments} disabled={!canEdit}
                    onChange={e => setForm(f => ({ ...f, comments: e.target.value }))} className="fiba-input w-full" />
                </div>

                {canEdit && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" disabled={saving} className="btn-fiba">
                      {saving ? t('app.loading') : t('evaluations.save')}
                    </button>
                    <button type="button" disabled={saving} onClick={e => handleSave(e, 'submitted')}
                      className="px-4 py-2 text-sm rounded-lg border border-fiba-border hover:bg-fiba-surface">
                      {t('evaluations.submit')}
                    </button>
                    {evaluation && (
                      <button type="button" onClick={handleDelete} className="px-4 py-2 text-sm text-red-400 hover:underline">
                        {t('evaluations.delete')}
                      </button>
                    )}
                  </div>
                )}
              </form>

              {/* Everything ever written about this person */}
              <div className="pt-4 border-t border-fiba-border">
                <div className="flex items-baseline justify-between mb-3">
                  <h4 className="text-sm font-semibold text-ink-900 dark:text-white">{t('evaluations.history')}</h4>
                  {history?.average != null && (
                    <span className="text-xs text-fiba-muted">
                      {t('evaluations.overallAverage')}:{' '}
                      <span className={`font-bold tabular-nums ${avgClass(history.average)}`}>{fmtAvg(history.average)}</span>{' '}
                      {t('evaluations.acrossEvents', { count: history.count })}
                    </span>
                  )}
                </div>

                {history && Object.keys(history.per_criterion || {}).length > 0 && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-4">
                    {Object.entries(history.per_criterion).map(([c, v]) => (
                      <div key={c} className="flex items-center justify-between text-xs">
                        <span className="text-fiba-muted truncate">{criterionLabel(c)}</span>
                        <span className={`tabular-nums font-semibold ${avgClass(v)}`}>{fmtAvg(v)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  {(history?.evaluations || []).map(ev => (
                    <div key={ev.id} className="rounded-lg border border-fiba-border p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-ink-900 dark:text-white truncate">
                          {ev.competition_name || '—'}
                        </span>
                        <span className={`text-sm font-bold tabular-nums ${avgClass(ev.average)}`}>{fmtAvg(ev.average)}</span>
                      </div>
                      <p className="text-[11px] text-fiba-muted mt-0.5">
                        {t(`evaluations.roleLabel.${ev.evaluator_role}`)} · {t(`evaluations.statusLabel.${ev.status}`)}
                      </p>
                      {ev.strengths && <p className="text-xs text-ink-700 dark:text-gray-300 mt-2"><span className="text-fiba-muted">{t('evaluations.strengths')}: </span>{ev.strengths}</p>}
                      {ev.improvements && <p className="text-xs text-ink-700 dark:text-gray-300 mt-1"><span className="text-fiba-muted">{t('evaluations.improvements')}: </span>{ev.improvements}</p>}
                      {ev.comments && <p className="text-xs text-ink-700 dark:text-gray-300 mt-1">{ev.comments}</p>}
                    </div>
                  ))}
                  {history && history.evaluations.length === 0 && (
                    <p className="text-xs text-fiba-muted/60">{t('evaluations.historyEmpty')}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
