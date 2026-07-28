import { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  getLogisticsHotels, createLogisticsHotel, updateLogisticsHotel, deleteLogisticsHotel,
  getLogisticsRooming, createLogisticsStay, updateLogisticsStay, deleteLogisticsStay,
  getLogisticsMeals, createLogisticsMeal, deleteLogisticsMeal,
  getLogisticsParticipants, downloadLogisticsXlsx,
} from '../../api/client'
import SheetImport from './SheetImport'

// Sección Hospedaje: hoteles, rooming list y plan de comidas.
//
// La grilla de noches reproduce la planilla que recibe el hotel — una columna
// por noche, 1 mientras duerme y OUT el día que se va — pero no se guarda así:
// sale de check_in / check_out. El total es de *habitaciones*, no de personas,
// porque es lo que se factura: quien comparte cuarto no suma una segunda vez.

const ROOM_TYPES = ['Single', 'Double', 'Twin', 'Triple', 'Suite']

const MEAL_LABELS = {
  es: { breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena', snack: 'Refrigerio' },
  en: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' },
}

const EMPTY_ROOMING = { dates: [], rows: [], total_nights: 0, person_nights: 0, hotels: [] }

function shortDate(iso, lang) {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { day: 'numeric', month: 'short' })
}

export default function HousingTab({ competitionId, canEdit }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [hotels, setHotels] = useState([])
  const [rooming, setRooming] = useState(EMPTY_ROOMING)
  const [meals, setMeals] = useState([])
  const [participants, setParticipants] = useState([])
  const [loading, setLoading] = useState(false)

  const [showHotelModal, setShowHotelModal] = useState(false)
  const [editingHotel, setEditingHotel] = useState(null)
  const [hotelForm, setHotelForm] = useState({ name: '', address: '', phone: '', email: '', check_in_time: '', check_out_time: '', map_url: '', notes: '', is_primary: false })

  const [showStayModal, setShowStayModal] = useState(false)
  const [editingStay, setEditingStay] = useState(null)
  const [stayForm, setStayForm] = useState({ participant_id: '', hotel_id: '', room_type: 'Single', room_number: '', check_in: '', check_out: '', share_with_id: '', comments: '' })

  const [showMealModal, setShowMealModal] = useState(false)
  const [mealForm, setMealForm] = useState({ meal: 'breakfast', date: '', start_time: '', end_time: '', location: '', hotel_id: '', notes: '' })

  const load = useCallback(async () => {
    if (!competitionId) return
    setLoading(true)
    try {
      const [h, r, m, p] = await Promise.all([
        getLogisticsHotels(competitionId),
        getLogisticsRooming(competitionId),
        getLogisticsMeals(competitionId),
        getLogisticsParticipants(competitionId),
      ])
      setHotels(h); setRooming(r); setMeals(m); setParticipants(p)
    } catch (err) { console.error('Housing load error:', err) }
    finally { setLoading(false) }
  }, [competitionId])

  useEffect(() => { load() }, [load])

  function openCreateHotel() {
    setEditingHotel(null)
    setHotelForm({ name: '', address: '', phone: '', email: '', check_in_time: '', check_out_time: '', map_url: '', notes: '', is_primary: hotels.length === 0 })
    setShowHotelModal(true)
  }

  function openEditHotel(h) {
    setEditingHotel(h)
    setHotelForm({
      name: h.name || '', address: h.address || '', phone: h.phone || '', email: h.email || '',
      check_in_time: (h.check_in_time || '').slice(0, 5), check_out_time: (h.check_out_time || '').slice(0, 5),
      map_url: h.map_url || '', notes: h.notes || '', is_primary: !!h.is_primary,
    })
    setShowHotelModal(true)
  }

  async function handleHotelSubmit(e) {
    e.preventDefault()
    // Los campos vacíos van como null: '' no es una hora ni una URL válida.
    const payload = Object.fromEntries(
      Object.entries(hotelForm).map(([k, v]) => [k, v === '' ? null : v])
    )
    try {
      if (editingHotel) await updateLogisticsHotel(editingHotel.id, payload)
      else await createLogisticsHotel({ ...payload, competition_id: competitionId })
      setShowHotelModal(false); await load()
    } catch (err) { alert(err.response?.data?.detail || 'Error') }
  }

  async function handleDeleteHotel(h) {
    if (!confirm(t(`¿Eliminar ${h.name}?`, `Delete ${h.name}?`))) return
    await deleteLogisticsHotel(h.id); await load()
  }

  function openCreateStay() {
    setEditingStay(null)
    setStayForm({
      participant_id: '', hotel_id: hotels.find(h => h.is_primary)?.id || hotels[0]?.id || '',
      room_type: 'Single', room_number: '', check_in: '', check_out: '', share_with_id: '', comments: '',
    })
    setShowStayModal(true)
  }

  function openEditStay(row) {
    setEditingStay(row)
    setStayForm({
      participant_id: row.participant_id, hotel_id: row.hotel_id || '',
      room_type: row.room_type || 'Single', room_number: row.room_number || '',
      check_in: row.check_in || '', check_out: row.check_out || '',
      // Sin esto, abrir y guardar la estadía de alguien que comparte cuarto lo
      // dejaría sin compañero: el formulario mandaría share_with_id en null.
      share_with_id: row.share_with_id || '', comments: row.comments || '',
    })
    setShowStayModal(true)
  }

  async function handleStaySubmit(e) {
    e.preventDefault()
    const payload = Object.fromEntries(
      Object.entries(stayForm).map(([k, v]) => [k, v === '' ? null : v])
    )
    try {
      if (editingStay) {
        const { participant_id, ...updates } = payload
        await updateLogisticsStay(editingStay.stay_id, updates)
      } else {
        await createLogisticsStay(payload)
      }
      setShowStayModal(false); await load()
    } catch (err) { alert(err.response?.data?.detail || 'Error') }
  }

  async function handleDeleteStay(row) {
    if (!confirm(t(`¿Quitar la estadía de ${row.name}?`, `Remove ${row.name}'s stay?`))) return
    await deleteLogisticsStay(row.stay_id); await load()
  }

  async function handleMealSubmit(e) {
    e.preventDefault()
    const payload = Object.fromEntries(
      Object.entries(mealForm).map(([k, v]) => [k, v === '' ? null : v])
    )
    try {
      await createLogisticsMeal({ ...payload, meal: mealForm.meal, competition_id: competitionId })
      setShowMealModal(false)
      setMealForm({ meal: 'breakfast', date: '', start_time: '', end_time: '', location: '', hotel_id: '', notes: '' })
      await load()
    } catch (err) { alert(err.response?.data?.detail || 'Error') }
  }

  async function handleDeleteMeal(m) {
    await deleteLogisticsMeal(m.id); await load()
  }

  // Quien todavía no tiene estadía cargada: es la lista del selector, para no
  // ofrecer gente que ya está en la grilla.
  const withoutStay = participants.filter(p => !rooming.rows.some(r => r.participant_id === p.id))

  return (
    <div className="space-y-8">
      {/* ── Hoteles ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-ink-900 dark:text-white">{t('Hoteles', 'Hotels')}</h3>
          {canEdit && <button onClick={openCreateHotel} className="btn-fiba text-xs px-3 py-1.5">+ {t('Agregar', 'Add')}</button>}
        </div>
        {hotels.length === 0 ? (
          <div className="fiba-card p-6 text-center text-fiba-muted text-sm">
            {t('Todavía no hay hoteles cargados para esta competencia.', 'No hotels loaded for this competition yet.')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {hotels.map(h => (
              <div key={h.id} className="bg-fiba-card rounded-xl border border-fiba-border p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="font-semibold text-ink-900 dark:text-white flex items-center gap-2">
                      {h.name}
                      {h.is_primary && <span className="bg-fiba-accent/20 text-fiba-accent px-1.5 py-0.5 rounded text-[10px] font-medium">{t('Principal', 'Primary')}</span>}
                    </div>
                    {h.address && <div className="text-xs text-fiba-muted mt-0.5">{h.address}</div>}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => openEditHotel(h)} className="text-fiba-accent hover:underline text-xs">{t('Editar', 'Edit')}</button>
                      <button onClick={() => handleDeleteHotel(h)} className="text-red-400 hover:underline text-xs">{t('Eliminar', 'Delete')}</button>
                    </div>
                  )}
                </div>
                <dl className="text-xs text-fiba-muted space-y-0.5">
                  {h.phone && <div>{t('Teléfono', 'Phone')}: {h.phone}</div>}
                  {(h.check_in_time || h.check_out_time) && (
                    <div>Check-in {(h.check_in_time || '—').slice(0, 5)} · Check-out {(h.check_out_time || '—').slice(0, 5)}</div>
                  )}
                  {h.notes && <div className="text-ink-600 dark:text-ink-300">{h.notes}</div>}
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Rooming list ────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-baseline gap-3">
            <h3 className="text-lg font-semibold text-ink-900 dark:text-white">Rooming list</h3>
            {rooming.rows.length > 0 && (
              <span className="text-xs text-fiba-muted">
                {rooming.rows.length} {t('personas', 'people')} · <strong className="text-ink-700 dark:text-ink-200">{rooming.total_nights}</strong> {t('noches de habitación', 'room nights')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadLogisticsXlsx('rooming', competitionId)} className="btn-fiba-ghost text-xs px-3 py-1.5">
              {t('Exportar Excel', 'Export Excel')}
            </button>
            {canEdit && <button onClick={openCreateStay} disabled={withoutStay.length === 0} className="btn-fiba text-xs px-3 py-1.5 disabled:opacity-50">+ {t('Estadía', 'Stay')}</button>}
          </div>
        </div>

        {canEdit && (
          <SheetImport kind="rooming" competitionId={competitionId} onDone={load} />
        )}

        {loading ? (
          <div className="text-center py-8 text-fiba-muted text-sm">{t('Cargando...', 'Loading...')}</div>
        ) : rooming.rows.length === 0 ? (
          <div className="fiba-card p-6 text-center text-fiba-muted text-sm">
            {t('Todavía no hay estadías cargadas. Importa la rooming list o agrega una a mano.',
               'No stays loaded yet. Import the rooming list or add one manually.')}
          </div>
        ) : (
          <div className="rounded-xl border border-fiba-border overflow-x-auto">
            <table className="fiba-table">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-fiba-surface z-10">{t('Nombre', 'Name')}</th>
                  <th>{t('Rol', 'Role')}</th>
                  <th>{t('Habitación', 'Room')}</th>
                  <th>{t('Comparte con', 'Shares with')}</th>
                  <th>{t('Dieta', 'Diet')}</th>
                  {rooming.dates.map(d => (
                    <th key={d} className="text-center whitespace-nowrap px-1.5">{shortDate(d, lang)}</th>
                  ))}
                  <th className="text-center">{t('Noches', 'Nights')}</th>
                  {canEdit && <th className="w-20"></th>}
                </tr>
              </thead>
              <tbody>
                {rooming.rows.map(row => (
                  <tr key={row.participant_id}>
                    <td className="px-4 py-2 font-medium sticky left-0 bg-fiba-card z-10 whitespace-nowrap">{row.name}</td>
                    <td className="px-4 py-2 text-fiba-muted text-xs whitespace-nowrap">{row.role || '—'}</td>
                    <td className="px-4 py-2 text-xs">
                      {row.room_type || '—'}{row.room_number ? ` · ${row.room_number}` : ''}
                    </td>
                    <td className="px-4 py-2 text-xs text-fiba-muted whitespace-nowrap">{row.share_with || '—'}</td>
                    <td className="px-4 py-2 text-xs text-fiba-muted">{row.dietary_restrictions || '—'}</td>
                    {rooming.dates.map(d => {
                      const cell = row.grid[d]
                      return (
                        <td key={d} className={`px-1.5 py-2 text-center text-[10px] font-medium ${
                          cell === '1' ? 'bg-emerald-500/15 text-emerald-500'
                          : cell === 'OUT' ? 'bg-fiba-surface text-fiba-muted' : ''
                        }`}>
                          {cell || ''}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-center font-medium">
                      {row.nights}
                      {!row.is_room_holder && row.nights > 0 && (
                        <span className="block text-[10px] font-normal text-fiba-muted" title={t('Comparte habitación: las noches ya se cuentan en la fila de su compañero.', 'Shares a room: the nights are already counted on their roommate row.')}>
                          {t('compartida', 'shared')}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-2">
                        <div className="flex gap-2">
                          <button onClick={() => openEditStay(row)} className="text-fiba-accent hover:underline text-xs">{t('Editar', 'Edit')}</button>
                          <button onClick={() => handleDeleteStay(row)} className="text-red-400 hover:underline text-xs">{t('Quitar', 'Remove')}</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Alimentación ────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-ink-900 dark:text-white">{t('Alimentación', 'Meals')}</h3>
          {canEdit && <button onClick={() => setShowMealModal(true)} className="btn-fiba text-xs px-3 py-1.5">+ {t('Agregar', 'Add')}</button>}
        </div>
        {meals.length === 0 ? (
          <div className="fiba-card p-6 text-center text-fiba-muted text-sm">
            {t('Sin comidas cargadas. Una comida sin fecha aplica a todos los días de la competencia.',
               'No meals loaded. A meal with no date applies to every day of the competition.')}
          </div>
        ) : (
          <div className="rounded-xl border border-fiba-border overflow-x-auto">
            <table className="fiba-table">
              <thead>
                <tr>
                  <th>{t('Comida', 'Meal')}</th>
                  <th>{t('Fecha', 'Date')}</th>
                  <th>{t('Horario', 'Time')}</th>
                  <th>{t('Lugar', 'Location')}</th>
                  <th>{t('Notas', 'Notes')}</th>
                  {canEdit && <th className="w-16"></th>}
                </tr>
              </thead>
              <tbody>
                {meals.map(m => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 font-medium">{MEAL_LABELS[lang]?.[m.meal] || m.meal}</td>
                    <td className="px-4 py-2 text-fiba-muted text-xs">
                      {m.date ? shortDate(m.date, lang) : t('Todos los días', 'Every day')}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {[(m.start_time || '').slice(0, 5), (m.end_time || '').slice(0, 5)].filter(Boolean).join(' – ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">{m.location || (hotels.find(h => h.id === m.hotel_id)?.name) || '—'}</td>
                    <td className="px-4 py-2 text-xs text-fiba-muted">{m.notes || '—'}</td>
                    {canEdit && <td className="px-4 py-2"><button onClick={() => handleDeleteMeal(m)} className="text-red-400 hover:underline text-xs">{t('Eliminar', 'Delete')}</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Modales ─────────────────────────────────────────── */}
      {showHotelModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-lg p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">
              {editingHotel ? t('Editar hotel', 'Edit hotel') : t('Nuevo hotel', 'New hotel')}
            </h3>
            <form onSubmit={handleHotelSubmit} className="space-y-3">
              <div><label className="fiba-label">{t('Nombre', 'Name')}</label>
                <input required value={hotelForm.name} onChange={e => setHotelForm(f => ({ ...f, name: e.target.value }))} className="fiba-input" /></div>
              <div><label className="fiba-label">{t('Dirección', 'Address')}</label>
                <input value={hotelForm.address} onChange={e => setHotelForm(f => ({ ...f, address: e.target.value }))} className="fiba-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{t('Teléfono', 'Phone')}</label>
                  <input value={hotelForm.phone} onChange={e => setHotelForm(f => ({ ...f, phone: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">Email</label>
                  <input type="email" value={hotelForm.email} onChange={e => setHotelForm(f => ({ ...f, email: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">Check-in</label>
                  <input type="time" value={hotelForm.check_in_time} onChange={e => setHotelForm(f => ({ ...f, check_in_time: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">Check-out</label>
                  <input type="time" value={hotelForm.check_out_time} onChange={e => setHotelForm(f => ({ ...f, check_out_time: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div><label className="fiba-label">{t('Link del mapa', 'Map link')}</label>
                <input type="url" value={hotelForm.map_url} onChange={e => setHotelForm(f => ({ ...f, map_url: e.target.value }))} className="fiba-input" /></div>
              <div><label className="fiba-label">{t('Notas', 'Notes')}</label>
                <textarea rows={2} value={hotelForm.notes} onChange={e => setHotelForm(f => ({ ...f, notes: e.target.value }))} className="fiba-input" /></div>
              <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
                <input type="checkbox" checked={hotelForm.is_primary} onChange={e => setHotelForm(f => ({ ...f, is_primary: e.target.checked }))} />
                {t('Hotel principal (al que se asignan las estadías importadas)', 'Primary hotel (imported stays are assigned here)')}
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowHotelModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
                <button type="submit" className="btn-fiba">{editingHotel ? t('Guardar', 'Save') : t('Crear', 'Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStayModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-lg p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">
              {editingStay ? t('Editar estadía', 'Edit stay') : t('Nueva estadía', 'New stay')}
            </h3>
            <form onSubmit={handleStaySubmit} className="space-y-3">
              {!editingStay && (
                <div><label className="fiba-label">{t('Persona', 'Person')}</label>
                  <select required value={stayForm.participant_id} onChange={e => setStayForm(f => ({ ...f, participant_id: e.target.value }))} className="fiba-select">
                    <option value="">{t('Seleccionar...', 'Select...')}</option>
                    {withoutStay.map(p => (
                      <option key={p.id} value={p.id}>{[p.first_name, p.last_name].filter(Boolean).join(' ')}{p.role ? ` — ${p.role}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">Hotel</label>
                  <select value={stayForm.hotel_id} onChange={e => setStayForm(f => ({ ...f, hotel_id: e.target.value }))} className="fiba-select">
                    <option value="">—</option>
                    {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
                <div><label className="fiba-label">{t('Tipo de habitación', 'Room type')}</label>
                  <input list="room-types" value={stayForm.room_type} onChange={e => setStayForm(f => ({ ...f, room_type: e.target.value }))} className="fiba-input" />
                  <datalist id="room-types">{ROOM_TYPES.map(r => <option key={r} value={r} />)}</datalist>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="fiba-label">{t('N° habitación', 'Room #')}</label>
                  <input value={stayForm.room_number} onChange={e => setStayForm(f => ({ ...f, room_number: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">Check-in</label>
                  <input type="date" value={stayForm.check_in} onChange={e => setStayForm(f => ({ ...f, check_in: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">Check-out</label>
                  <input type="date" value={stayForm.check_out} onChange={e => setStayForm(f => ({ ...f, check_out: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div><label className="fiba-label">{t('Comparte habitación con', 'Shares room with')}</label>
                <select value={stayForm.share_with_id} onChange={e => setStayForm(f => ({ ...f, share_with_id: e.target.value }))} className="fiba-select">
                  <option value="">{t('Nadie', 'Nobody')}</option>
                  {participants.filter(p => p.id !== stayForm.participant_id).map(p => (
                    <option key={p.id} value={p.id}>{[p.first_name, p.last_name].filter(Boolean).join(' ')}</option>
                  ))}
                </select>
              </div>
              <div><label className="fiba-label">{t('Comentarios', 'Comments')}</label>
                <textarea rows={2} value={stayForm.comments} onChange={e => setStayForm(f => ({ ...f, comments: e.target.value }))} className="fiba-input" /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowStayModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
                <button type="submit" className="btn-fiba">{editingStay ? t('Guardar', 'Save') : t('Crear', 'Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMealModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{t('Nueva comida', 'New meal')}</h3>
            <form onSubmit={handleMealSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{t('Comida', 'Meal')}</label>
                  <select value={mealForm.meal} onChange={e => setMealForm(f => ({ ...f, meal: e.target.value }))} className="fiba-select">
                    {Object.entries(MEAL_LABELS[lang] || MEAL_LABELS.en).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div><label className="fiba-label">{t('Fecha (vacío = todos los días)', 'Date (blank = every day)')}</label>
                  <input type="date" value={mealForm.date} onChange={e => setMealForm(f => ({ ...f, date: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{t('Desde', 'From')}</label>
                  <input type="time" value={mealForm.start_time} onChange={e => setMealForm(f => ({ ...f, start_time: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Hasta', 'To')}</label>
                  <input type="time" value={mealForm.end_time} onChange={e => setMealForm(f => ({ ...f, end_time: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div><label className="fiba-label">Hotel</label>
                <select value={mealForm.hotel_id} onChange={e => setMealForm(f => ({ ...f, hotel_id: e.target.value }))} className="fiba-select">
                  <option value="">—</option>
                  {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div><label className="fiba-label">{t('Lugar', 'Location')}</label>
                <input placeholder={t('Ej: Salón Principal', 'e.g. Main Hall')} value={mealForm.location} onChange={e => setMealForm(f => ({ ...f, location: e.target.value }))} className="fiba-input" /></div>
              <div><label className="fiba-label">{t('Notas', 'Notes')}</label>
                <textarea rows={2} value={mealForm.notes} onChange={e => setMealForm(f => ({ ...f, notes: e.target.value }))} className="fiba-input" /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowMealModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
                <button type="submit" className="btn-fiba">{t('Crear', 'Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
