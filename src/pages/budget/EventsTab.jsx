/**
 * Eventos presupuestarios (migración 039, fase 8).
 *
 * Gasto que no es una competencia del calendario ni el overhead anual del
 * departamento. Una sola tabla para dos usos:
 *
 *   - **Sin competencias colgadas** es una bolsa suelta: el Draw de AmeriCup,
 *     un workshop de TDs. Hoy vivirían en "General", que los vuelve invisibles.
 *   - **Con competencias colgadas** (`kind = 'season'`) es una temporada. El
 *     Excel presupuesta la temporada entera de Liga Sudamericana; el calendario
 *     tiene sus 6 fases sueltas. LAS TEMPORADAS PRESUPUESTAN, LAS FASES
 *     EJECUTAN: el presupuesto se carga arriba, el gasto real se imputa a la
 *     fase donde ocurrió y el reporte suma hacia arriba.
 *
 * Ver BUDGET_MODULE.md §14.2 (decisiones 8 y 9) y §14.3.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  getBudgetEvents, createBudgetEvent, updateBudgetEvent,
  setBudgetEventCompetitions, deleteBudgetEvent, getBudgetEventCost,
} from '../../api/client'
import { Icon } from '../../lib/icons'
import { Drawer, Field } from './shared'
import EventCostPanel from './EventCostPanel'

const KINDS = ['season', 'draw', 'workshop', 'other']

const KIND_BADGE = {
  season:   'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  draw:     'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-500',
  workshop: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  other:    'bg-ink-100 text-ink-700 dark:bg-navy-800 dark:text-ink-300',
}

function dateRange(ev) {
  if (!ev.start_date && !ev.end_date) return '—'
  if (ev.start_date && ev.end_date) return `${ev.start_date} → ${ev.end_date}`
  return ev.start_date || ev.end_date
}

export default function EventsTab({
  t, push, canEdit, departments, competitions, reloadBudgetEvents,
}) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState('')
  const [department, setDepartment] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)   // evento cuyo costo se muestra
  const [cost, setCost] = useState(null)
  const [costLoading, setCostLoading] = useState(false)
  // Cambiar las fases de una temporada cambia su costo, y el evento elegido
  // sigue siendo el mismo: sin esto el panel quedaría mostrando la cifra vieja.
  const [costNonce, setCostNonce] = useState(0)

  const yearOptions = useMemo(() => Array.from({ length: 7 }, (_, i) => thisYear + 3 - i), [thisYear])

  async function load() {
    setLoading(true)
    try {
      const params = {}
      if (year) params.year = Number(year)
      if (department) params.department = department
      if (includeInactive) params.include_inactive = true
      setRows(await getBudgetEvents(params))
    } catch (e) {
      console.error(e)
      push({ type: 'error', title: t('common.error') })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [year, department, includeInactive])

  // El costo se recarga solo cuando cambia el evento elegido; el resto de los
  // filtros no lo toca.
  useEffect(() => {
    if (!selected) { setCost(null); return }
    let alive = true
    setCostLoading(true)
    getBudgetEventCost(selected.id)
      .then(c => { if (alive) setCost(c) })
      .catch(e => {
        console.error(e)
        if (alive) { setCost(null); push({ type: 'error', title: t('common.error') }) }
      })
      .finally(() => { if (alive) setCostLoading(false) })
    return () => { alive = false }
  }, [selected?.id, costNonce])

  async function afterChange() {
    await load()
    setCostNonce(n => n + 1)
    reloadBudgetEvents()
  }

  async function handleDelete(row) {
    if (!window.confirm(t('budget.confirmDeleteEvent'))) return
    try {
      const res = await deleteBudgetEvent(row.id)
      push({ type: 'success', title: res.deactivated ? t('budget.eventDeactivated') : t('budget.deleted') })
      if (selected?.id === row.id) setSelected(null)
      afterChange()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
  }

  // Qué competencia ya cuelga de otro evento — para avisarlo en el picker de
  // fases en vez de que la temporada se robe la fase de otra sin decir nada.
  // Sale de los eventos listados: con un filtro puesto, uno de otro año o de
  // otro departamento no aparece acá y el aviso no sale (el backend igual
  // desvincula, porque un PUT reemplaza el conjunto entero).
  const claimedBy = useMemo(() => {
    const map = new Map()
    for (const ev of rows) {
      for (const c of ev.competitions || []) map.set(c.id, ev)
    }
    return map
  }, [rows])

  return (
    <div>
      <p className="text-xs text-fiba-muted mb-4 flex items-start gap-1.5">
        <Icon.Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {t('budget.eventsHint')}
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select value={year} onChange={e => setYear(e.target.value)}
          className="fiba-select !w-auto min-w-[120px]">
          <option value="">{t('budget.allYears')}</option>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)}
          className="fiba-select !w-auto min-w-[200px]">
          <option value="">{t('budget.allDepartments')}</option>
          {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-fiba-muted cursor-pointer">
          <input type="checkbox" checked={includeInactive} onChange={() => setIncludeInactive(v => !v)}
            className="rounded border-fiba-border" />
          {t('budget.showInactive')}
        </label>
        {canEdit && (
          <button onClick={() => setEditing({})} className="btn-fiba ml-auto">{t('budget.newEvent')}</button>
        )}
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-fiba-surface/60 border-b border-fiba-border">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                <th className="px-4 py-2.5">{t('budget.eventName')}</th>
                <th className="px-4 py-2.5">{t('budget.eventKind')}</th>
                <th className="px-4 py-2.5">{t('budget.year')}</th>
                <th className="px-4 py-2.5">{t('budget.department')}</th>
                <th className="px-4 py-2.5">{t('budget.dates')}</th>
                <th className="px-4 py-2.5">{t('budget.phases')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center">
                  <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noEvents')}</p>
                  <p className="text-fiba-muted text-sm mt-1 max-w-lg mx-auto">{t('budget.noEventsBody')}</p>
                </td></tr>
              ) : rows.map(ev => (
                <tr key={ev.id}
                  onClick={() => setSelected(s => (s?.id === ev.id ? null : ev))}
                  className={`cursor-pointer transition-colors ${
                    selected?.id === ev.id ? 'bg-fiba-surface/60' : 'hover:bg-fiba-surface/40'
                  }`}>
                  <td className="px-4 py-3 text-ink-900 dark:text-white">
                    {ev.name}
                    {!ev.active && (
                      <span className="ml-2 text-2xs text-fiba-muted italic">{t('budget.inactive')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${KIND_BADGE[ev.kind] || KIND_BADGE.other}`}>
                      {t(`budget.kind_${ev.kind}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fiba-muted tabular-nums">{ev.year}</td>
                  <td className="px-4 py-3 text-fiba-muted">
                    {departments.find(d => d.code === ev.department_code)?.label || ev.department_code}
                  </td>
                  <td className="px-4 py-3 text-fiba-muted whitespace-nowrap text-xs">{dateRange(ev)}</td>
                  <td className="px-4 py-3 text-fiba-muted">
                    {ev.competitions?.length
                      ? `${ev.competitions.length} ${t('budget.phases').toLowerCase()}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit && (
                      <div className="inline-flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditing(ev)} title={t('budget.editEvent')}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                          <Icon.Doc className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(ev)} title={t('common.delete')}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-red-500">
                          <Icon.X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="rounded-xl border border-fiba-border p-5 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h3 className="font-semibold text-ink-900 dark:text-white">
              {t('budget.eventCost')} — {selected.name}
            </h3>
            <button onClick={() => setSelected(null)} className="btn-fiba-ghost">{t('budget.close')}</button>
          </div>
          <p className="text-xs text-fiba-muted mb-4">{t('budget.eventCostHint')}</p>
          {costLoading
            ? <div className="text-fiba-muted text-sm py-8 text-center">{t('common.loading')}</div>
            : <EventCostPanel cost={cost} t={t} />}
        </div>
      )}

      {editing && (
        <EventEditor
          event={editing} defaultDepartment={department} defaultYear={year || thisYear}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            if (selected?.id === saved?.id) setSelected(saved)
            afterChange()
          }}
          {...{ t, push, canEdit, departments, competitions, claimedBy }}
        />
      )}
    </div>
  )
}

/**
 * Alta y edición de un evento presupuestario, con el panel de fases adentro.
 *
 * Las fases se guardan con el mismo botón que el resto: son un PUT aparte
 * (`/events/{id}/competitions`, que reemplaza el conjunto entero), pero pedirle
 * al usuario dos guardados para una sola pantalla es cómo se pierden cambios.
 * En un alta se crea primero el evento y recién ahí se cuelgan las fases, que
 * necesitan el id.
 */
function EventEditor({
  event, defaultDepartment, defaultYear, onClose, onSaved,
  t, push, canEdit, departments, competitions, claimedBy,
}) {
  const isNew = !event.id
  const [form, setForm] = useState({
    name: event.name || '',
    year: event.year ?? (Number(defaultYear) || new Date().getFullYear()),
    department_code: event.department_code || defaultDepartment || departments[0]?.code || '',
    kind: event.kind || 'season',
    start_date: event.start_date || '',
    end_date: event.end_date || '',
    active: event.active ?? true,
    notes: event.notes || '',
  })
  const [phases, setPhases] = useState(() => (event.competitions || []).map(c => c.id))
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const attached = (event.competitions || []).map(c => c.id)
  // El panel se muestra para las temporadas y también si el evento YA tiene
  // fases colgadas: cambiarle el tipo no las desvincula solo, y esconderlas
  // dejaría plata sumando hacia arriba sin que se vea desde dónde.
  const showPhases = form.kind === 'season' || attached.length > 0

  async function handleSave() {
    if (!form.name.trim() || !form.department_code || !form.year) {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        year: Number(form.year),
        department_code: form.department_code,
        kind: form.kind,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notes: form.notes || null,
      }
      let saved
      if (isNew) {
        saved = await createBudgetEvent(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      } else {
        // En edición se manda el null explícito: el PATCH usa exclude_unset y
        // es lo único que vacía una fecha ya cargada.
        saved = await updateBudgetEvent(event.id, { ...body, active: form.active })
      }

      const changed = phases.length !== attached.length || phases.some(id => !attached.includes(id))
      if (showPhases && changed) {
        // El PUT de fases va aparte y puede fallar solo. Si el evento ya se
        // guardó, el panel se cierra igual: dejarlo abierto haría creer que no
        // se guardó nada y el próximo intento crearía un duplicado.
        try {
          await setBudgetEventCompetitions(saved.id, phases)
        } catch (err) {
          push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
          onSaved(saved)
          setSaving(false)
          return
        }
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved(saved)
    } catch (err) {
      const detail = err?.response?.status === 409
        ? t('budget.eventDuplicate')
        : err?.response?.data?.detail || t('common.error')
      push({ type: 'error', title: detail })
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={isNew ? t('budget.newEvent') : t('budget.editEvent')}
      subtitle={isNew ? undefined : `${form.year} · ${t(`budget.kind_${form.kind}`)}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving || !canEdit} className="btn-fiba">
            {saving ? t('common.loading') : t('budget.save')}
          </button>
        </>
      }
    >
      <Field label={t('budget.eventName')}>
        <input className="fiba-input" value={form.name} onChange={e => set('name', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.eventKind')}>
          <select className="fiba-select" value={form.kind} onChange={e => set('kind', e.target.value)}>
            {KINDS.map(k => <option key={k} value={k}>{t(`budget.kind_${k}`)}</option>)}
          </select>
        </Field>
        <Field label={t('budget.year')}>
          <input type="number" min="2020" max="2100" className="fiba-input" value={form.year}
            onChange={e => set('year', e.target.value)} />
        </Field>
      </div>

      <Field label={t('budget.department')}>
        <select className="fiba-select" value={form.department_code} onChange={e => set('department_code', e.target.value)}>
          {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.startDate')}>
          <input type="date" className="fiba-input" value={form.start_date}
            onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label={t('budget.endDate')}>
          <input type="date" className="fiba-input" value={form.end_date}
            onChange={e => set('end_date', e.target.value)} />
        </Field>
      </div>

      <Field label={t('budget.notes')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.notes}
          onChange={e => set('notes', e.target.value)} />
      </Field>

      {!isNew && (
        <label className="flex items-center gap-2 text-sm text-fiba-muted cursor-pointer">
          <input type="checkbox" checked={form.active} onChange={() => set('active', !form.active)}
            className="rounded border-fiba-border" />
          {t('budget.eventActive')}
        </label>
      )}

      {showPhases && (
        <div className="pt-3 border-t border-fiba-border">
          <p className="text-[13px] font-medium text-ink-700 dark:text-ink-200">{t('budget.phases')}</p>
          <p className="text-xs text-fiba-muted mt-0.5 mb-3">{t('budget.phasesHint')}</p>
          <PhasesPicker
            competitions={competitions} value={phases} onChange={setPhases}
            claimedBy={claimedBy} currentId={event.id} t={t}
          />
        </div>
      )}
    </Drawer>
  )
}

/**
 * Multi-selección de competencias del calendario.
 *
 * `CompetitionSearch` es de selección única (y trae los pins, que acá no
 * significan nada), así que la temporada usa una lista con búsqueda y casillas:
 * lo elegido queda arriba, siempre visible, y no hace falta hacer ctrl+clic como
 * en un `<select multiple>`.
 */
function PhasesPicker({ competitions, value, onChange, claimedBy, currentId, t }) {
  const [search, setSearch] = useState('')

  const selectedSet = useMemo(() => new Set(value), [value])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = competitions.filter(c => !q
      || (c.name || '').toLowerCase().includes(q)
      || String(c.year || '').includes(q))
    // Lo elegido primero: con 80 competencias en el calendario, tener que
    // buscar de nuevo lo que ya se marcó para poder desmarcarlo es una trampa.
    return [...matches].sort((a, b) => {
      const as = selectedSet.has(a.id) ? 0 : 1
      const bs = selectedSet.has(b.id) ? 0 : 1
      if (as !== bs) return as - bs
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [competitions, search, selectedSet])

  function toggle(id) {
    onChange(selectedSet.has(id) ? value.filter(x => x !== id) : [...value, id])
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <input className="fiba-input flex-1" placeholder={t('budget.searchCompetition')}
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="text-xs text-fiba-muted whitespace-nowrap">
          {value.length} {t('budget.selected')}
        </span>
      </div>

      <div className="rounded-lg border border-fiba-border max-h-64 overflow-y-auto divide-y divide-fiba-border">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-sm text-fiba-muted text-center">{t('budget.noCompetitions')}</p>
        ) : visible.map(c => {
          const owner = claimedBy?.get(c.id)
          const takenByOther = owner && owner.id !== currentId
          return (
            <label key={c.id}
              className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-fiba-surface/50 transition-colors">
              <input type="checkbox" checked={selectedSet.has(c.id)} onChange={() => toggle(c.id)}
                className="mt-0.5 rounded border-fiba-border" />
              <span className="min-w-0">
                <span className="block text-sm text-ink-900 dark:text-white truncate">{c.name}</span>
                <span className="block text-2xs text-fiba-muted">
                  {c.year}
                  {takenByOther && (
                    <span className="text-amber-500 ml-1.5">
                      · {t('budget.phaseTakenBy')} {owner.name}
                    </span>
                  )}
                </span>
              </span>
            </label>
          )
        })}
      </div>
      <p className="text-2xs text-fiba-muted mt-2">{t('budget.phasesReplaceHint')}</p>
    </div>
  )
}
