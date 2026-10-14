import { useEffect, useMemo, useState } from 'react'
import {
  getHeadcount, putHeadcount, getAssumptions, putAssumptions, generateTravelLines,
} from '../../api/client'
import { competitionLabel, competitionYear, sortCompetitions } from '../../lib/competitions'
import { Icon } from '../../lib/icons'
import { money, AccountOptions } from './shared'

/* ──────────────────────── Headcount y supuestos ────────────────────────
 *
 * El insumo de las líneas de travel de Competitions: personas por evento y rol
 * × costo promedio de vuelo del año (BUDGET_MODULE.md §11). Lo monta PlanTab,
 * solo para quien puede editar Competitions: el backend exige
 * `_assert_can_edit("competitions")` en PUT /headcount, PUT /assumptions y en
 * /headcount/generate.
 *
 * PUT /headcount no reemplaza el año entero: hace upsert por
 * (año, competencia, rol) y borra la fila que llega en 0. Por eso quitar una
 * fila, o cambiarle el rol o el evento, se manda como su clave vieja en 0.
 *
 * ⚠️ Doble conteo: las líneas de travel importadas del Excel YA SON
 * headcount × vuelo. Generar saltea los pares (cuenta, competencia) que tienen
 * una línea manual y los devuelve en `skipped_conflicts`; `replace_manual`
 * los borra y los reemplaza.
 */

const DEPARTMENT = 'competitions'

let seq = 0
const uid = () => `hc-${++seq}`

// Misma clave que usa el backend para el upsert: (competencia, rol), con el rol
// tal cual (sensible a mayúsculas, como el `.eq("role_label")` de put_headcount).
const rowKey = (r) => `${r.competition_id || ''}|${(r.role_label || '').trim()}`

function toRow(h) {
  return {
    uid: uid(),
    competition_id: h.competition_id || '',
    role_label: h.role_label || '',
    headcount: h.headcount ?? '',
    account_code: h.account_code || '',
  }
}

// Forma comparable para saber si hay cambios sin guardar.
const normalize = (rows) => JSON.stringify(rows.map(r => [
  r.competition_id || '', (r.role_label || '').trim(), Number(r.headcount || 0), r.account_code || '',
]))

export default function HeadcountPanel({ t, push, year, competitions, expenseAccounts, onGenerated }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [original, setOriginal] = useState([])
  const [flight, setFlight] = useState('')
  const [assumptions, setAssumptions] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savingFlight, setSavingFlight] = useState(false)
  const [replaceManual, setReplaceManual] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [hc, asm] = await Promise.all([getHeadcount(year), getAssumptions(year)])
      const loaded = hc.map(toRow)
      setRows(loaded)
      setOriginal(loaded)
      setAssumptions(asm)
      setFlight(asm?.avg_flight_cost != null ? String(asm.avg_flight_cost) : '')
    } catch (e) {
      console.error(e)
      push({ type: 'error', title: t('common.error') })
    }
    setLoading(false)
  }

  // Se carga recién al abrir, y de nuevo si cambia el año con el panel abierto.
  useEffect(() => {
    if (!open) return
    setResult(null)
    load()
  }, [open, year])

  const compsById = useMemo(() => Object.fromEntries(competitions.map(c => [c.id, c])), [competitions])

  // Solo las competencias del año, más las que ya figuran en una fila (por si
  // una quedó con fecha de otro año).
  const compOptions = useMemo(() => {
    const used = new Set(rows.map(r => r.competition_id).filter(Boolean))
    return sortCompetitions(competitions.filter(c => competitionYear(c) === year || used.has(c.id)))
  }, [competitions, rows, year])

  const dirty = normalize(rows) !== normalize(original)
  const flightDirty = assumptions != null && Number(flight || 0) !== Number(assumptions.avg_flight_cost || 0)
  const flightCost = Number(flight || 0)

  const totals = useMemo(() => {
    let people = 0, billable = 0
    for (const r of rows) {
      const n = Number(r.headcount || 0)
      people += n
      if (r.account_code) billable += n
    }
    return { people, billable, estimate: billable * flightCost }
  }, [rows, flightCost])

  const missingAccount = rows.some(r => Number(r.headcount || 0) > 0 && !r.account_code)

  function setCell(id, field, value) {
    setRows(rs => rs.map(r => (r.uid === id ? { ...r, [field]: value } : r)))
  }

  function addRow() {
    setRows(rs => [...rs, toRow({ headcount: 1 })])
  }

  function removeRow(id) {
    setRows(rs => rs.filter(r => r.uid !== id))
  }

  async function handleSave() {
    const live = rows.filter(r => Number(r.headcount || 0) > 0 || (r.role_label || '').trim())
    if (live.some(r => !(r.role_label || '').trim())) {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    const keys = live.map(rowKey)
    if (new Set(keys).size !== keys.length) {
      push({ type: 'error', title: t('budget.headcountDuplicate') })
      return
    }

    const items = live.map(r => ({
      competition_id: r.competition_id || null,
      role_label: r.role_label.trim(),
      headcount: Math.max(0, Math.round(Number(r.headcount || 0))),
      account_code: r.account_code || null,
    }))
    // Lo que estaba guardado y ya no figura (fila quitada, o con rol/evento
    // cambiado) se manda en 0: así lo borra el backend.
    const current = new Set(keys)
    for (const o of original) {
      if (!current.has(rowKey(o))) {
        items.push({
          competition_id: o.competition_id || null,
          role_label: o.role_label.trim(),
          headcount: 0,
          account_code: null,
        })
      }
    }

    setSaving(true)
    try {
      await putHeadcount({ year, items })
      push({ type: 'success', title: t('budget.saved') })
      await load()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  async function handleSaveFlight() {
    if (flight === '' || flightCost < 0) {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSavingFlight(true)
    try {
      const saved = await putAssumptions(year, { avg_flight_cost: flightCost, notes: assumptions?.notes ?? null })
      setAssumptions(saved)
      setFlight(String(saved.avg_flight_cost))
      push({ type: 'success', title: t('budget.saved') })
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
    setSavingFlight(false)
  }

  async function handleGenerate() {
    if (replaceManual && !window.confirm(t('budget.headcountReplaceManualConfirm'))) return
    setGenerating(true)
    try {
      const res = await generateTravelLines({ year, department: DEPARTMENT, replace_manual: replaceManual })
      setResult(res)
      push({ type: 'success', title: `${res.created} ${t('budget.headcountCreated').toLowerCase()}` })
      onGenerated?.()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
    setGenerating(false)
  }

  const canGenerate = !dirty && !flightDirty && !loading && rows.length > 0

  return (
    <div className="rounded-xl border border-fiba-border mb-6">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 sm:px-5 py-3 text-left hover:bg-fiba-surface/40 transition-colors rounded-xl">
        {open ? <Icon.ChevronDown className="w-4 h-4 text-fiba-muted" /> : <Icon.Chevron className="w-4 h-4 text-fiba-muted" />}
        <Icon.Plane className="w-4 h-4 text-fiba-muted" />
        <span className="font-semibold text-ink-900 dark:text-white">{t('budget.headcountTitle')}</span>
        <span className="text-xs text-fiba-muted ml-1">{year}</span>
        {open && (dirty || flightDirty) && (
          <span className="ml-auto text-xs text-amber-500">{t('budget.headcountUnsaved')}</span>
        )}
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-5 border-t border-fiba-border pt-4">
          <p className="text-xs text-fiba-muted mb-4">{t('budget.headcountHint')}</p>

          {loading ? (
            <div className="text-fiba-muted text-sm py-6 text-center">{t('common.loading')}</div>
          ) : (
            <>
              {/* Supuesto del año */}
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <label className="block">
                  <span className="block text-[13px] font-medium text-ink-700 dark:text-ink-200 mb-1.5">
                    {t('budget.headcountFlightCost')} ({year})
                  </span>
                  <input type="number" min="0" step="1" value={flight}
                    onChange={e => setFlight(e.target.value)}
                    className="fiba-input !w-40 text-right" />
                </label>
                {flightDirty && (
                  <button onClick={handleSaveFlight} disabled={savingFlight} className="btn-fiba-ghost">
                    {savingFlight ? t('common.loading') : t('budget.headcountFlightSave')}
                  </button>
                )}
                <div className="flex gap-6 ml-auto text-sm">
                  <div>
                    <p className="text-xs text-fiba-muted">{t('budget.headcountTotalPeople')}</p>
                    <p className="font-semibold text-ink-900 dark:text-white tabular-nums">{totals.people}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fiba-muted">{t('budget.headcountEstimate')}</p>
                    <p className="font-semibold text-ink-900 dark:text-white tabular-nums">${money(totals.estimate)}</p>
                  </div>
                </div>
              </div>

              {/* Grilla */}
              <div className="rounded-lg border border-fiba-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-fiba-surface/60 border-b border-fiba-border">
                      <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                        <th className="px-3 py-2 min-w-[220px]">{t('budget.competition')}</th>
                        <th className="px-3 py-2 min-w-[180px]">{t('budget.headcountRole')}</th>
                        <th className="px-3 py-2 text-right w-28">{t('budget.headcountCount')}</th>
                        <th className="px-3 py-2 min-w-[240px]">{t('budget.headcountTravelAccount')}</th>
                        <th className="px-3 py-2 text-right w-32">{t('budget.headcountEstimate')}</th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-fiba-border">
                      {rows.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-fiba-muted">
                          {t('budget.headcountEmpty', { year })}
                        </td></tr>
                      ) : rows.map(r => (
                        <tr key={r.uid}>
                          <td className="px-3 py-1.5">
                            <select value={r.competition_id} onChange={e => setCell(r.uid, 'competition_id', e.target.value)}
                              className="fiba-select !h-8 text-sm">
                              <option value="">{t('budget.general')}</option>
                              {r.competition_id && !compsById[r.competition_id] && (
                                <option value={r.competition_id}>{r.competition_id}</option>
                              )}
                              {compOptions.map(c => (
                                <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5">
                            <input value={r.role_label} onChange={e => setCell(r.uid, 'role_label', e.target.value)}
                              className="fiba-input !h-8 text-sm" />
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" min="0" step="1" value={r.headcount}
                              onChange={e => setCell(r.uid, 'headcount', e.target.value)}
                              className="fiba-input !h-8 text-sm text-right" />
                          </td>
                          <td className="px-3 py-1.5">
                            <select value={r.account_code} onChange={e => setCell(r.uid, 'account_code', e.target.value)}
                              className={`fiba-select !h-8 text-sm ${!r.account_code && Number(r.headcount || 0) > 0 ? '!border-amber-500/60' : ''}`}>
                              <option value="">—</option>
                              <AccountOptions accounts={expenseAccounts} department={DEPARTMENT} t={t} />
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-fiba-muted whitespace-nowrap">
                            {r.account_code ? `$${money(Number(r.headcount || 0) * flightCost)}` : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <button onClick={() => removeRow(r.uid)} aria-label={t('budget.headcountRemoveRow')}
                              title={t('budget.headcountRemoveRow')}
                              className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-red-500">
                              <Icon.X className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {missingAccount && (
                <p className="text-xs text-amber-500 mt-2 flex items-center gap-1.5">
                  <Icon.Alert className="w-3.5 h-3.5 flex-shrink-0" /> {t('budget.headcountNoAccount')}
                </p>
              )}

              <div className="flex flex-wrap gap-3 mt-3">
                <button onClick={addRow} className="btn-fiba-ghost">
                  <Icon.Plus className="w-4 h-4 inline mr-1.5" />{t('budget.headcountAddRow')}
                </button>
                {dirty && (
                  <button onClick={handleSave} disabled={saving} className="btn-fiba-ghost">
                    {saving ? t('common.loading') : t('budget.headcountSave')}
                  </button>
                )}
              </div>

              {/* Generar */}
              <div className="mt-5 pt-4 border-t border-fiba-border">
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 mb-3 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
                  <Icon.Alert className="w-4 h-4 flex-shrink-0" />
                  <span>{t('budget.headcountDoubleCount')}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-fiba-muted cursor-pointer">
                    <input type="checkbox" checked={replaceManual} onChange={() => setReplaceManual(v => !v)}
                      className="rounded border-fiba-border" />
                    {t('budget.headcountReplaceManual')}
                  </label>
                  <button onClick={handleGenerate} disabled={!canGenerate || generating}
                    title={dirty || flightDirty ? t('budget.headcountGenerateDisabled') : undefined}
                    className={replaceManual ? 'btn-fiba-danger sm:ml-auto' : 'btn-fiba-ghost sm:ml-auto'}>
                    {generating ? t('common.loading') : t('budget.headcountGenerate')}
                  </button>
                </div>
                {(dirty || flightDirty) && (
                  <p className="text-xs text-fiba-muted mt-2">{t('budget.headcountGenerateDisabled')}</p>
                )}
              </div>

              {result && <GenerateResult result={result} compsById={compsById} t={t} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function GenerateResult({ result, compsById, t }) {
  const conflicts = result.skipped_conflicts || []
  return (
    <div className="mt-4 rounded-lg border border-fiba-border p-4 bg-fiba-surface/40">
      <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-3">{t('budget.headcountResult')}</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-sm">
        <div>
          <p className="text-xs text-fiba-muted">{t('budget.headcountCreated')}</p>
          <p className="font-semibold text-emerald-500 tabular-nums">{result.created}</p>
        </div>
        <div>
          <p className="text-xs text-fiba-muted">{t('budget.headcountReplaced')}</p>
          <p className="font-semibold text-ink-900 dark:text-white tabular-nums">{result.replaced ?? 0}</p>
        </div>
        <div>
          <p className="text-xs text-fiba-muted">{t('budget.headcountConflicts')}</p>
          <p className={`font-semibold tabular-nums ${conflicts.length ? 'text-amber-500' : 'text-ink-900 dark:text-white'}`}>
            {conflicts.length}
          </p>
        </div>
        <div>
          <p className="text-xs text-fiba-muted">{t('budget.total')}</p>
          <p className="font-semibold text-ink-900 dark:text-white tabular-nums">${money(result.total)}</p>
        </div>
      </div>

      {conflicts.length > 0 && (
        <>
          <p className="text-xs text-fiba-muted mb-2">{t('budget.headcountConflictsHint')}</p>
          <div className="overflow-x-auto max-h-72 overflow-y-auto rounded border border-fiba-border">
            <table className="min-w-full text-xs">
              <thead className="bg-fiba-surface/60 sticky top-0">
                <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                  <th className="px-3 py-2">{t('budget.account')}</th>
                  <th className="px-3 py-2">{t('budget.competition')}</th>
                  <th className="px-3 py-2">{t('budget.headcountRole')}</th>
                  <th className="px-3 py-2 text-right">{t('budget.headcountCount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fiba-border">
                {conflicts.map((c, i) => (
                  <tr key={`${c.account_code}|${c.competition_id}|${c.role_label}|${i}`}>
                    <td className="px-3 py-1.5 font-mono text-ink-900 dark:text-white">{c.account_code}</td>
                    <td className="px-3 py-1.5 text-fiba-muted">
                      {c.competition_id
                        ? (compsById[c.competition_id] ? competitionLabel(compsById[c.competition_id], t('months.short')) : c.competition_id)
                        : <span className="italic">{t('budget.general')}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-fiba-muted">{c.role_label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-fiba-muted">{c.headcount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
