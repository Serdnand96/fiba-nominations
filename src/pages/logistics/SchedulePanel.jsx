import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import {
  getLogisticsSchedules, previewLogisticsSchedule, commitLogisticsSchedule,
  createLogisticsSchedule, updateLogisticsSchedule, deleteLogisticsSchedule,
  createLogisticsScheduleRow, updateLogisticsScheduleRow, deleteLogisticsScheduleRow,
  downloadLogisticsScheduleFile,
} from '../../api/client'
import { AUDIENCE_KEYS, audienceLabel } from './audiences'
import { ScheduleDay, SECTION_COLUMNS, groupByDay, cellValue, longDate, hhmm } from './ScheduleDay'

// Cronogramas de logística: el de transporte (PICK UP HOTEL / RETURN HOTEL) y
// el de comidas (ALMUERZO / MERIENDA / CENA). Son los documentos que logística
// arma en Excel y manda a los equipos, a los árbitros y al hotel.
//
// Un documento por competencia + sección + audiencia. El Excel se importa en
// dos pasos (preview → confirmar), igual que el manifest y la rooming list, y
// el original queda guardado para bajarlo. Reimportar reemplaza el documento:
// el archivo es la autoridad.

const EMPTY_ROW = {
  date: '', kind: 'training', start_time: '', end_time: '', team: '', team_b: '',
  pickup_time: '', return_time: '', lunch: '', snack: '', dinner: '', notes: '',
}

// HTML imprimible con el aspecto de la planilla (azul, naranja y la franja
// amarilla de PARTIDOS). Todo texto pasa por esc(): son campos libres y la
// ventana que se abre comparte origen con la sesión.
function printableHtml(schedule, section, lang, competitionName, audienceText) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
  const t = (es, en) => (lang === 'es' ? es : en)
  const cols = SECTION_COLUMNS[section]
  const span = cols.length + 3
  const head = cols.map(c => `<th class="own">${esc(t(c.es, c.en))}</th>`).join('')
  const own = (row) => cols.map(c => `<td class="b">${esc(cellValue(row, c))}</td>`).join('')

  let body = ''
  for (const day of groupByDay(schedule)) {
    body += `<table><thead>
      <tr class="day"><th colspan="${span}">${esc(longDate(day.date, lang))}${day.label ? ` — ${esc(day.label)}` : ''}</th></tr>
      <tr class="cols">${head}<th>${t('Comienzo', 'Start')}</th><th>${t('Final', 'End')}</th><th>${t('Equipo', 'Team')}</th></tr>
    </thead><tbody>`
    for (const row of day.trainings) {
      body += `<tr>${own(row)}<td>${esc(hhmm(row.start_time))}</td><td>${esc(hhmm(row.end_time))}</td><td>${esc(row.team)}</td></tr>`
    }
    if (day.games.length) body += `<tr class="games"><td colspan="${span}">${t('PARTIDOS', 'GAMES')}</td></tr>`
    for (const row of day.games) {
      body += `<tr>${own(row)}<td class="b" colspan="2">${esc(hhmm(row.start_time))}</td><td class="b">${esc(row.team || '?')} vs ${esc(row.team_b || '?')}</td></tr>`
    }
    body += '</tbody></table>'
    if (day.notes) body += `<p class="notes">${esc(day.notes)}</p>`
  }

  const sectionTitle = section === 'transport' ? t('Cronograma de transporte', 'Transport schedule') : t('Cronograma de comidas', 'Meals schedule')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(sectionTitle)} - ${esc(competitionName || '')}</title><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 18px; }
    header { background: #081335; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
    header h1 { font-size: 18px; font-weight: 700; }
    header div { text-align: right; font-size: 11px; font-weight: 700; }
    .sub { margin: 6px 0 10px; color: #555; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: avoid; }
    th, td { border: 1px solid #111; padding: 3px 6px; text-align: center; }
    tr.day th { background: #f56a00; color: #fff; font-size: 12px; }
    tr.cols th { background: #081335; color: #fff; }
    tr.cols th.own { background: #c5d9a4; color: #1f3a12; }
    tr.games td { background: #ffd200; font-weight: 700; }
    td.b { font-weight: 700; }
    .notes { font-style: italic; margin: 3px 0 0; }
    @media print { body { padding: 0; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>
    <header><h1>${esc(schedule.title || competitionName || '')}</h1><div>${esc(schedule.subtitle || '')}</div></header>
    <p class="sub">${esc(sectionTitle)} · ${esc(audienceText)}${competitionName ? ` · ${esc(competitionName)}` : ''}</p>
    ${body}
  </body></html>`
}

function ScheduleDoc({ competitionId, competitionName, section, audience, schedule, canEdit, reload }) {
  const { lang } = useLanguage()
  const { push } = useToast()
  const t = (es, en) => (lang === 'es' ? es : en)
  const inputRef = useRef(null)
  const cols = SECTION_COLUMNS[section]

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const [rowTarget, setRowTarget] = useState(null)   // { row } al editar, {} al crear
  const [rowForm, setRowForm] = useState(EMPTY_ROW)
  const [headForm, setHeadForm] = useState(null)     // { title, subtitle, days }
  const [saving, setSaving] = useState(false)        // evita el doble envío de los modales

  const days = useMemo(() => (schedule ? groupByDay(schedule) : []), [schedule])
  const fail = (err, fallback) => push({ type: 'error', title: err.response?.data?.detail || fallback || 'Error' })

  function resetImport() {
    setFile(null); setPreview(null); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleFile(e) {
    const picked = e.target.files?.[0]
    if (!picked) return
    setFile(picked); setError(null); setBusy(true)
    try {
      setPreview(await previewLogisticsSchedule(competitionId, section, audience, picked))
    } catch (err) {
      setError(err.response?.data?.detail || t('No se pudo leer el archivo.', 'Could not read the file.'))
      setPreview(null)
    } finally { setBusy(false) }
  }

  async function handleConfirm() {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const res = await commitLogisticsSchedule(competitionId, section, audience, file)
      push({ type: 'success', title: t(`Cronograma importado: ${res.rows} filas.`, `Schedule imported: ${res.rows} rows.`) })
      resetImport(); await reload()
    } catch (err) {
      setError(err.response?.data?.detail || t('No se pudo importar.', 'Import failed.'))
    } finally { setBusy(false) }
  }

  async function handleCreateEmpty() {
    try { await createLogisticsSchedule({ competition_id: competitionId, section, audience }); await reload() }
    catch (err) { fail(err) }
  }

  async function handleDeleteDoc() {
    if (!confirm(t('¿Eliminar este cronograma? Se borran sus filas y el Excel guardado.',
                   'Delete this schedule? Its rows and the stored Excel file are removed.'))) return
    try { await deleteLogisticsSchedule(schedule.id); await reload() } catch (err) { fail(err) }
  }

  function openRow(row) {
    setRowTarget({ row: row || null })
    setRowForm(row ? {
      date: row.date, kind: row.kind, start_time: hhmm(row.start_time), end_time: hhmm(row.end_time),
      team: row.team || '', team_b: row.team_b || '',
      pickup_time: hhmm(row.pickup_time), return_time: hhmm(row.return_time),
      lunch: row.lunch || '', snack: row.snack || '', dinner: row.dinner || '', notes: row.notes || '',
    } : { ...EMPTY_ROW, date: days[0]?.date || '' })
  }

  async function handleRowSubmit(e) {
    e.preventDefault()
    // Solo viajan los campos de esta sección: el formulario de comidas no debe
    // pisar con vacío un pick-up que no muestra, ni al revés.
    const keys = ['date', 'kind', 'start_time', 'end_time', 'team', 'team_b', 'notes', ...cols.map(c => c.key)]
    const payload = Object.fromEntries(keys.map(k => [k, rowForm[k] === '' ? null : rowForm[k]]))
    if (payload.kind === 'training') { payload.team_b = null }
    else { payload.end_time = null }
    if (saving) return
    setSaving(true)
    try {
      if (rowTarget.row) await updateLogisticsScheduleRow(rowTarget.row.id, payload)
      else await createLogisticsScheduleRow(schedule.id, payload)
      setRowTarget(null); await reload()
    } catch (err) { fail(err) }
    finally { setSaving(false) }
  }

  async function handleDeleteRow(row) {
    const what = row.kind === 'game' ? `${row.team || '?'} vs ${row.team_b || '?'}` : (row.team || t('la fila', 'the row'))
    if (!confirm(t(`¿Quitar ${what} del cronograma?`, `Remove ${what} from the schedule?`))) return
    try { await deleteLogisticsScheduleRow(row.id); await reload() } catch (err) { fail(err) }
  }

  function openHead() {
    setHeadForm({
      title: schedule.title || '', subtitle: schedule.subtitle || '',
      days: days.map(d => ({ date: d.date, label: d.label, notes: d.notes })),
    })
  }

  async function handleHeadSubmit(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try { await updateLogisticsSchedule(schedule.id, headForm); setHeadForm(null); await reload() }
    catch (err) { fail(err) }
    finally { setSaving(false) }
  }

  function handlePrint() {
    const html = printableHtml(schedule, section, lang, competitionName, audienceLabel(audience, lang))
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const win = window.open(url, '_blank')
    if (!win) {
      URL.revokeObjectURL(url)
      push({ type: 'error', title: t('El navegador bloqueó la ventana emergente. Habilita los popups para imprimir.',
                                     'The browser blocked the popup window. Enable popups to print.') })
      return
    }
    setTimeout(() => { win.print(); URL.revokeObjectURL(url) }, 600)
  }

  const setRow = (key) => (e) => setRowForm(f => ({ ...f, [key]: e.target.value }))
  const previewDays = preview ? groupByDay({ days: preview.days, rows: preview.rows }) : []

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-ink-900 dark:text-white">
            {audienceLabel(audience, lang)}
            {schedule?.title && <span className="font-normal text-fiba-muted"> · {schedule.title}</span>}
          </h4>
          {schedule?.subtitle && <p className="text-xs text-fiba-muted">{schedule.subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {schedule?.has_file && (
            <button onClick={() => downloadLogisticsScheduleFile(schedule).catch(err => fail(err, t('No se pudo bajar el archivo.', 'Could not download the file.')))}
              className="btn-fiba-ghost text-xs px-3 py-1.5" title={schedule.file_name || ''}>
              {t('Excel original', 'Original Excel')}
            </button>
          )}
          {schedule && schedule.rows.length > 0 && (
            <button onClick={handlePrint} className="btn-fiba-ghost text-xs px-3 py-1.5">{t('Imprimir / PDF', 'Print / PDF')}</button>
          )}
          {canEdit && schedule && (
            <>
              <button onClick={openHead} className="btn-fiba-ghost text-xs px-3 py-1.5">{t('Encabezado y notas', 'Heading & notes')}</button>
              <button onClick={() => openRow(null)} className="btn-fiba text-xs px-3 py-1.5">+ {t('Fila', 'Row')}</button>
            </>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="rounded-xl border border-fiba-border bg-fiba-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-fiba-muted">
              {schedule
                ? t('Subir una versión nueva reemplaza este cronograma, incluidas las ediciones hechas a mano.',
                    'Uploading a new version replaces this schedule, manual edits included.')
                : t('Sube el Excel del cronograma. Se muestra un resumen antes de guardar nada.',
                    'Upload the schedule Excel. You get a summary before anything is saved.')}
            </div>
            <div className="flex items-center gap-2">
              <input ref={inputRef} type="file" accept=".xlsx,.xlsm" onChange={handleFile} disabled={busy}
                aria-label={t('Archivo Excel del cronograma', 'Schedule Excel file')}
                className="text-xs text-fiba-muted file:mr-2 file:rounded-md file:border-0 file:bg-fiba-surface file:px-3 file:py-1.5 file:text-xs file:text-ink-700 dark:file:text-ink-200" />
              {(preview || error) && (
                <button onClick={resetImport} className="text-xs text-fiba-muted hover:underline">{t('Limpiar', 'Clear')}</button>
              )}
            </div>
          </div>

          {busy && <div className="mt-3 text-xs text-fiba-muted">{t('Procesando...', 'Processing...')}</div>}
          {error && (
            <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">{error}</div>
          )}

          {preview && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fiba-muted">
                <span>{t('Días', 'Days')}: <strong className="text-ink-700 dark:text-ink-200">{preview.days.length}</strong></span>
                <span>{t('Entrenamientos', 'Practices')}: <strong className="text-ink-700 dark:text-ink-200">{preview.trainings}</strong></span>
                <span>{t('Partidos', 'Games')}: <strong className="text-ink-700 dark:text-ink-200">{preview.games}</strong></span>
                {preview.replaces > 0 && (
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-500">
                    {t(`Reemplaza las ${preview.replaces} filas actuales`, `Replaces the current ${preview.replaces} rows`)}
                  </span>
                )}
              </div>

              {preview.skipped?.length > 0 && (
                <div className="rounded-lg bg-fiba-surface border border-fiba-border px-3 py-2">
                  <div className="text-xs font-medium text-ink-700 dark:text-ink-200 mb-1">
                    {t(`${preview.skipped.length} fila(s) tachadas u ocultas en la planilla — no se importan`,
                       `${preview.skipped.length} row(s) blacked out or hidden in the sheet — not imported`)}
                  </div>
                  <ul className="space-y-0.5 text-[11px] text-fiba-muted">
                    {preview.skipped.map((s, i) => (
                      <li key={i}>{t('Fila', 'Row')} {s.row}: {s.label || '—'} ({s.date})</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.warnings?.length > 0 && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                  <div className="text-xs font-medium text-amber-500 mb-1">
                    {t(`${preview.warnings.length} cosa(s) que conviene mirar`, `${preview.warnings.length} thing(s) worth checking`)}
                  </div>
                  <ul className="space-y-0.5 text-[11px] text-amber-500/90">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w.row ? `${t('Fila', 'Row')} ${w.row}: ` : ''}{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="max-h-96 overflow-auto space-y-3">
                {previewDays.map(day => <ScheduleDay key={day.date} day={day} section={section} lang={lang} />)}
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={resetImport} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
                <button onClick={handleConfirm} disabled={busy} className="btn-fiba disabled:opacity-50">
                  {t('Confirmar importación', 'Confirm import')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!schedule ? (
        <div className="fiba-card p-6 text-center text-fiba-muted">
          <p className="text-sm">{t('Todavía no hay cronograma cargado para este grupo.', 'No schedule loaded for this group yet.')}</p>
          {canEdit && (
            <button onClick={handleCreateEmpty} className="text-xs text-fiba-accent hover:underline mt-2">
              {t('Cargarlo a mano, sin Excel', 'Enter it manually, without Excel')}
            </button>
          )}
        </div>
      ) : days.length === 0 ? (
        <div className="fiba-card p-6 text-center text-fiba-muted text-sm">
          {t('El cronograma está vacío. Agrega filas o sube el Excel.', 'The schedule is empty. Add rows or upload the Excel file.')}
        </div>
      ) : (
        <div className="space-y-3">
          {days.map(day => (
            <ScheduleDay key={day.date} day={day} section={section} lang={lang}
              onEdit={canEdit ? openRow : undefined} onDelete={canEdit ? handleDeleteRow : undefined} />
          ))}
        </div>
      )}

      {canEdit && schedule && (
        <div className="text-right">
          <button onClick={handleDeleteDoc} className="text-xs text-red-400 hover:underline">
            {t('Eliminar cronograma', 'Delete schedule')}
          </button>
        </div>
      )}

      {/* ── Modal de fila ───────────────────────────────────── */}
      {rowTarget && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-lg p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">
              {rowTarget.row ? t('Editar fila', 'Edit row') : t('Nueva fila', 'New row')}
            </h3>
            <form onSubmit={handleRowSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{t('Fecha', 'Date')} *</label>
                  <input type="date" required value={rowForm.date} onChange={setRow('date')} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Tipo', 'Type')}</label>
                  <select value={rowForm.kind} onChange={setRow('kind')} className="fiba-select">
                    <option value="training">{t('Entrenamiento', 'Practice')}</option>
                    <option value="game">{t('Partido', 'Game')}</option>
                  </select>
                </div>
              </div>
              {rowForm.kind === 'training' ? (
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="fiba-label">{t('Equipo', 'Team')}</label>
                    <input value={rowForm.team} onChange={setRow('team')} className="fiba-input" /></div>
                  <div><label className="fiba-label">{t('Comienzo', 'Start')}</label>
                    <input type="time" value={rowForm.start_time} onChange={setRow('start_time')} className="fiba-input" /></div>
                  <div><label className="fiba-label">{t('Final', 'End')}</label>
                    <input type="time" value={rowForm.end_time} onChange={setRow('end_time')} className="fiba-input" /></div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="fiba-label">{t('Equipo A', 'Team A')}</label>
                    <input value={rowForm.team} onChange={setRow('team')} className="fiba-input" /></div>
                  <div><label className="fiba-label">{t('Equipo B', 'Team B')}</label>
                    <input value={rowForm.team_b} onChange={setRow('team_b')} className="fiba-input" /></div>
                  <div><label className="fiba-label">{t('Hora del partido', 'Tip-off')}</label>
                    <input type="time" value={rowForm.start_time} onChange={setRow('start_time')} className="fiba-input" /></div>
                </div>
              )}
              <div className={`grid gap-3 ${cols.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {cols.map(c => (
                  <div key={c.key}><label className="fiba-label">{t(c.es, c.en)}</label>
                    {c.time
                      ? <input type="time" value={rowForm[c.key]} onChange={setRow(c.key)} className="fiba-input" />
                      : <input value={rowForm[c.key]} onChange={setRow(c.key)} placeholder="12:00 · TAKE AWAY" className="fiba-input" />}
                  </div>
                ))}
              </div>
              <div><label className="fiba-label">{t('Notas', 'Notes')}</label>
                <input value={rowForm.notes} onChange={setRow('notes')} className="fiba-input" /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setRowTarget(null)} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
                <button type="submit" disabled={saving} className="btn-fiba disabled:opacity-50">{t('Guardar', 'Save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal de encabezado y notas por día ─────────────── */}
      {headForm && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-2xl p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{t('Encabezado y notas', 'Heading & notes')}</h3>
            <form onSubmit={handleHeadSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{t('Título', 'Title')}</label>
                  <input value={headForm.title} placeholder="GRUPO F (QF)"
                    onChange={e => setHeadForm(f => ({ ...f, title: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Sede y fechas', 'Venue & dates')}</label>
                  <input value={headForm.subtitle} placeholder="Medellin, COL · 13 - 15 de noviembre"
                    onChange={e => setHeadForm(f => ({ ...f, subtitle: e.target.value }))} className="fiba-input" /></div>
              </div>
              {headForm.days.map((d, i) => (
                <div key={d.date} className="grid grid-cols-[7rem_1fr_2fr] gap-3 items-end">
                  <div className="text-xs text-fiba-muted pb-2">{longDate(d.date, lang)}</div>
                  <div><label className="fiba-label">{t('Rótulo del día', 'Day label')}</label>
                    <input value={d.label || ''} placeholder="DÍA DE PARTIDO 1"
                      onChange={e => setHeadForm(f => ({ ...f, days: f.days.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
                      className="fiba-input" /></div>
                  <div><label className="fiba-label">{t('Comentarios / notas', 'Comments / notes')}</label>
                    <input value={d.notes || ''}
                      onChange={e => setHeadForm(f => ({ ...f, days: f.days.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)) }))}
                      className="fiba-input" /></div>
                </div>
              ))}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setHeadForm(null)} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
                <button type="submit" disabled={saving} className="btn-fiba disabled:opacity-50">{t('Guardar', 'Save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

// Panel de una sección. Con una audiencia elegida muestra su documento; en
// "Todos" muestra los tres, uno debajo del otro.
export default function SchedulePanel({ competitionId, competitionName, section, audience, canEdit }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  // Solo la respuesta del pedido más reciente puede escribir el estado: al
  // cambiar de competencia, una respuesta vieja que llega tarde no debe dejar
  // cronogramas ajenos (y editables) en pantalla.
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!competitionId) return
    const request = ++requestRef.current
    try {
      const data = await getLogisticsSchedules(competitionId, section)
      if (request === requestRef.current) { setSchedules(data); setFailed(false) }
    } catch (err) {
      console.error('Schedule load error:', err)
      if (request === requestRef.current) { setSchedules([]); setFailed(true) }
    }
  }, [competitionId, section])

  useEffect(() => {
    setSchedules([]); setFailed(false); setLoading(true)
    const request = requestRef.current + 1
    load().finally(() => { if (request === requestRef.current) setLoading(false) })
  }, [load])

  if (loading) {
    return <div className="text-center py-8 text-fiba-muted text-sm">{t('Cargando...', 'Loading...')}</div>
  }
  if (failed) {
    return (
      <div className="fiba-card p-6 text-center text-sm text-red-400">
        {t('No se pudieron cargar los cronogramas.', 'Could not load the schedules.')}{' '}
        <button onClick={load} className="underline">{t('Reintentar', 'Retry')}</button>
      </div>
    )
  }

  const audiences = audience ? [audience] : AUDIENCE_KEYS
  return (
    <div className="space-y-8">
      {audiences.map(key => (
        <ScheduleDoc key={`${competitionId}-${section}-${key}`}
          competitionId={competitionId} competitionName={competitionName}
          section={section} audience={key} canEdit={canEdit}
          schedule={schedules.find(s => s.audience === key) || null} reload={load} />
      ))}
    </div>
  )
}
