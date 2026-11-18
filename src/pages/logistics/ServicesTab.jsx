import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import { Button, IconButton } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table } from '../../components/ui/Table'
import { Card } from '../../components/ui/Card'
import { Empty } from '../../components/ui/Empty'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../lib/icons'
import {
  getLogisticsContacts, createLogisticsContact, updateLogisticsContact, deleteLogisticsContact,
  getLogisticsRooms, createLogisticsRoom, updateLogisticsRoom, deleteLogisticsRoom,
  getLogisticsHotels,
} from '../../api/client'
import { audienceLabel } from './audiences'
import { AudienceBadge, TextArea, audienceOptions, errorMessage, hhmm, nullify, shortDate } from './opsShared'

// Sección Servicios: a quién se le llama y dónde se reúne la gente.
//
//  - Contactos y proveedores: el directorio de la competencia (transporte, hotel,
//    hielo, lavandería, hidratación, VIP y autoridades). Con horarios de retiro y
//    entrega, que es lo que logística tiene que tener a mano.
//  - Salones: Media Day, charla técnica, PIC y reuniones.
//
// Con una audiencia elegida, el backend devuelve la suya más lo compartido
// (audience null). Llegan a los equipos por el PDF de delegaciones, no por el
// link público.

const CONTACT_KINDS = ['transport', 'hotel', 'ice', 'laundry', 'hydration', 'vip', 'other']
const CONTACT_LABELS = {
  es: { transport: 'Transporte', hotel: 'Hoteles', ice: 'Hielo', laundry: 'Lavandería', hydration: 'Hidratación', vip: 'VIP y autoridades', other: 'Otros' },
  en: { transport: 'Transport', hotel: 'Hotels', ice: 'Ice', laundry: 'Laundry', hydration: 'Hydration', vip: 'VIP & authorities', other: 'Other' },
}

const ROOM_PURPOSES = ['media_day', 'technical_meeting', 'pic', 'meeting', 'other']
const ROOM_LABELS = {
  es: { media_day: 'Media Day', technical_meeting: 'Charla técnica', pic: 'PIC', meeting: 'Reunión', other: 'Otro' },
  en: { media_day: 'Media Day', technical_meeting: 'Technical meeting', pic: 'PIC', meeting: 'Meeting', other: 'Other' },
}

const EMPTY_CONTACT = {
  kind: 'transport', audience: '', hotel_id: '', name: '', company: '', role: '',
  phone: '', email: '', pickup_hours: '', delivery_hours: '', notes: '',
}
const EMPTY_ROOM = {
  name: '', purpose: 'meeting', audience: '', hotel_id: '', date: '', start_time: '', end_time: '',
  location: '', capacity: '', notes: '',
}

const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`

// Un registro de la base → el estado del formulario (null/undefined → '').
const toForm = (empty, row) => Object.fromEntries(
  Object.keys(empty).map(k => [k, row[k] == null ? '' : (k.endsWith('_time') ? hhmm(row[k]) : row[k])]),
)

function ContactModal({ initial, hotels, onClose, onSave }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)
  const formId = useId()
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setVal = (k) => (v) => setForm(f => ({ ...f, [k]: v }))
  const editing = !!initial.id

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    const { id: _id, ...fields } = form   // el id viaja en la URL, no en el body
    try { await onSave(nullify(fields)) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} closeDisabled={saving} closeLabel={t('Cerrar', 'Close')} size="lg"
      title={editing ? t('Editar contacto', 'Edit contact') : t('Nuevo contacto', 'New contact')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('Cancelar', 'Cancel')}</Button>
          <Button type="submit" form={formId} disabled={saving}>{editing ? t('Guardar', 'Save') : t('Crear', 'Create')}</Button>
        </>
      )}>
      <form id={formId} onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label={t('Tipo', 'Type')} value={form.kind} onChange={setVal('kind')}
            options={CONTACT_KINDS.map(k => ({ value: k, label: CONTACT_LABELS[lang][k] }))} />
          <Select label={t('Grupo', 'Group')} value={form.audience} onChange={setVal('audience')}
            options={audienceOptions(lang)} />
        </div>
        <Input label={`${t('Nombre', 'Name')} *`} required value={form.name} onChange={set('name')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label={t('Empresa', 'Company')} value={form.company} onChange={set('company')} />
          <Input label={t('Cargo / rol', 'Role')} value={form.role} onChange={set('role')} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label={t('Teléfono', 'Phone')} value={form.phone} onChange={set('phone')} />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label={t('Horario de recogida', 'Pick-up hours')} placeholder="08:00-10:00"
            value={form.pickup_hours} onChange={set('pickup_hours')} />
          <Input label={t('Horario de entrega', 'Delivery hours')} placeholder="18:00-20:00"
            value={form.delivery_hours} onChange={set('delivery_hours')} />
        </div>
        <Select label={t('Hotel (opcional)', 'Hotel (optional)')} value={form.hotel_id} onChange={setVal('hotel_id')}
          options={[{ value: '', label: '-' }, ...hotels.map(h => ({ value: h.id, label: h.name }))]} />
        <TextArea label={t('Notas', 'Notes')} value={form.notes} onChange={set('notes')} />
      </form>
    </Modal>
  )
}

function RoomModal({ initial, hotels, onClose, onSave }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)
  const formId = useId()
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setVal = (k) => (v) => setForm(f => ({ ...f, [k]: v }))
  const editing = !!initial.id

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    const { id: _id, ...fields } = form
    const payload = nullify(fields)
    payload.capacity = form.capacity === '' ? null : Number(form.capacity)
    setSaving(true)
    try { await onSave(payload) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} closeDisabled={saving} closeLabel={t('Cerrar', 'Close')} size="lg"
      title={editing ? t('Editar salón', 'Edit room') : t('Nuevo salón', 'New room')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('Cancelar', 'Cancel')}</Button>
          <Button type="submit" form={formId} disabled={saving}>{editing ? t('Guardar', 'Save') : t('Crear', 'Create')}</Button>
        </>
      )}>
      <form id={formId} onSubmit={submit} className="space-y-3">
        <Input label={`${t('Nombre', 'Name')} *`} required value={form.name} onChange={set('name')}
          placeholder={t('Ej.: Salón Colombia', 'e.g. Colombia Hall')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label={t('Para', 'Purpose')} value={form.purpose} onChange={setVal('purpose')}
            options={ROOM_PURPOSES.map(k => ({ value: k, label: ROOM_LABELS[lang][k] }))} />
          <Select label={t('Grupo', 'Group')} value={form.audience} onChange={setVal('audience')}
            options={audienceOptions(lang)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Hotel" value={form.hotel_id} onChange={setVal('hotel_id')}
            options={[{ value: '', label: '-' }, ...hotels.map(h => ({ value: h.id, label: h.name }))]} />
          <Input label={t('Lugar (si no es un hotel)', 'Location (if not a hotel)')} value={form.location} onChange={set('location')} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label={t('Fecha', 'Date')} type="date" value={form.date} onChange={set('date')} />
          <Input label={t('Desde', 'From')} type="time" value={form.start_time} onChange={set('start_time')} />
          <Input label={t('Hasta', 'To')} type="time" value={form.end_time} onChange={set('end_time')} />
        </div>
        <Input label={t('Capacidad', 'Capacity')} type="number" min={0} value={form.capacity} onChange={set('capacity')} />
        <TextArea label={t('Notas', 'Notes')} value={form.notes} onChange={set('notes')} />
      </form>
    </Modal>
  )
}

function RowActions({ onEdit, onDelete }) {
  const { lang } = useLanguage()
  return (
    <div className="flex justify-end gap-1">
      <IconButton size="sm" icon={<Icon.Pencil />} label={lang === 'es' ? 'Editar' : 'Edit'} onClick={onEdit} />
      <IconButton size="sm" icon={<Icon.Trash />} label={lang === 'es' ? 'Eliminar' : 'Delete'} onClick={onDelete}
        className="hover:!text-danger-600" />
    </div>
  )
}

export default function ServicesTab({ competitionId, canEdit, audience }) {
  const { lang } = useLanguage()
  const { push } = useToast()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [contacts, setContacts] = useState([])
  const [rooms, setRooms] = useState([])
  const [hotels, setHotels] = useState([])
  const [loading, setLoading] = useState(false)
  const [contactTarget, setContactTarget] = useState(null)   // fila al editar, EMPTY_CONTACT al crear
  const [roomTarget, setRoomTarget] = useState(null)
  // Solo el pedido más reciente escribe el estado (cambio de competencia o audiencia).
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!competitionId) return
    const request = ++requestRef.current
    // Cada bloque falla por separado: si no cargan los salones, el directorio se ve igual.
    const [c, r, h] = await Promise.allSettled([
      getLogisticsContacts(competitionId, audience),
      getLogisticsRooms(competitionId, audience),
      getLogisticsHotels(competitionId),
    ])
    if (request !== requestRef.current) return
    setContacts(c.status === 'fulfilled' ? c.value : [])
    setRooms(r.status === 'fulfilled' ? r.value : [])
    setHotels(h.status === 'fulfilled' ? h.value : [])
    if (c.status === 'rejected') push({ type: 'error', title: errorMessage(c.reason, t('No se pudieron cargar los contactos.', 'Could not load the contacts.')) })
    if (r.status === 'rejected') push({ type: 'error', title: errorMessage(r.reason, t('No se pudieron cargar los salones.', 'Could not load the rooms.')) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, audience])

  useEffect(() => {
    setContacts([]); setRooms([]); setLoading(true)
    const request = requestRef.current + 1
    refresh().finally(() => { if (request === requestRef.current) setLoading(false) })
  }, [refresh])

  const hotelName = useCallback((id) => hotels.find(h => h.id === id)?.name || '', [hotels])

  const grouped = useMemo(() => CONTACT_KINDS
    .map(kind => ({ kind, items: contacts.filter(c => c.kind === kind) }))
    .filter(g => g.items.length > 0), [contacts])

  const sortedRooms = useMemo(() => [...rooms].sort((a, b) => (
    `${a.date || '9999'}${a.start_time || ''}`.localeCompare(`${b.date || '9999'}${b.start_time || ''}`)
  )), [rooms])

  async function saveContact(payload) {
    try {
      if (contactTarget.id) await updateLogisticsContact(contactTarget.id, payload)
      else await createLogisticsContact({ ...payload, competition_id: competitionId })
      setContactTarget(null); await refresh()
    } catch (err) { push({ type: 'error', title: errorMessage(err, t('No se pudo guardar el contacto.', 'Could not save the contact.')) }) }
  }

  async function removeContact(c) {
    if (!confirm(t(`¿Eliminar a ${c.name}?`, `Delete ${c.name}?`))) return
    try { await deleteLogisticsContact(c.id); await refresh() }
    catch (err) { push({ type: 'error', title: errorMessage(err, t('No se pudo eliminar el contacto.', 'Could not delete the contact.')) }) }
  }

  async function saveRoom(payload) {
    try {
      if (roomTarget.id) await updateLogisticsRoom(roomTarget.id, payload)
      else await createLogisticsRoom({ ...payload, competition_id: competitionId })
      setRoomTarget(null); await refresh()
    } catch (err) { push({ type: 'error', title: errorMessage(err, t('No se pudo guardar el salón.', 'Could not save the room.')) }) }
  }

  async function removeRoom(r) {
    if (!confirm(t(`¿Eliminar ${r.name}?`, `Delete ${r.name}?`))) return
    try { await deleteLogisticsRoom(r.id); await refresh() }
    catch (err) { push({ type: 'error', title: errorMessage(err, t('No se pudo eliminar el salón.', 'Could not delete the room.')) }) }
  }

  const newContact = () => setContactTarget({ ...EMPTY_CONTACT, audience: audience || '' })
  const newRoom = () => setRoomTarget({ ...EMPTY_ROOM, audience: audience || '' })

  const contactColumns = [
    {
      key: 'name', label: t('Nombre', 'Name'),
      render: c => (
        <div className="min-w-[10rem]">
          <div className="font-medium text-ink-900 dark:text-white">{c.name}</div>
          {(c.company || c.role) && (
            <div className="text-xs text-fiba-muted">{[c.company, c.role].filter(Boolean).join(' · ')}</div>
          )}
          {c.hotel_id && hotelName(c.hotel_id) && (
            <div className="text-xs text-fiba-muted">{hotelName(c.hotel_id)}</div>
          )}
        </div>
      ),
    },
    {
      key: 'contact', label: t('Contacto', 'Contact'),
      render: c => (
        <div className="text-xs space-y-0.5">
          {c.phone ? <a href={telHref(c.phone)} className="block text-navy-700 dark:text-navy-300 hover:underline whitespace-nowrap">{c.phone}</a> : null}
          {c.email ? <a href={`mailto:${c.email}`} className="block text-navy-700 dark:text-navy-300 hover:underline break-all">{c.email}</a> : null}
          {!c.phone && !c.email && <span className="text-fiba-muted">-</span>}
        </div>
      ),
    },
    {
      key: 'hours', label: t('Horarios', 'Hours'),
      render: c => (c.pickup_hours || c.delivery_hours ? (
        <div className="text-xs space-y-0.5 whitespace-nowrap">
          {c.pickup_hours && <div><span className="text-fiba-muted">{t('Recogida', 'Pick-up')}:</span> {c.pickup_hours}</div>}
          {c.delivery_hours && <div><span className="text-fiba-muted">{t('Entrega', 'Delivery')}:</span> {c.delivery_hours}</div>}
        </div>
      ) : <span className="text-fiba-muted text-xs">-</span>),
    },
    { key: 'audience', label: t('Grupo', 'Group'), render: c => <AudienceBadge audience={c.audience} /> },
    {
      key: 'notes', label: t('Notas', 'Notes'),
      render: c => <span className="text-xs text-fiba-muted">{c.notes || '-'}</span>,
    },
    ...(canEdit ? [{
      key: 'actions', label: '', className: 'w-20',
      render: c => <RowActions onEdit={() => setContactTarget({ ...toForm(EMPTY_CONTACT, c), id: c.id })} onDelete={() => removeContact(c)} />,
    }] : []),
  ]

  const roomColumns = [
    {
      key: 'name', label: t('Salón', 'Room'),
      render: r => (
        <div className="min-w-[8rem]">
          <div className="font-medium text-ink-900 dark:text-white">{r.name}</div>
          {r.notes && <div className="text-xs text-fiba-muted">{r.notes}</div>}
        </div>
      ),
    },
    {
      key: 'purpose', label: t('Para', 'Purpose'),
      render: r => <Badge tone="navy" size="sm">{ROOM_LABELS[lang][r.purpose] || r.purpose}</Badge>,
    },
    {
      key: 'place', label: t('Lugar', 'Place'),
      render: r => {
        const place = [hotelName(r.hotel_id), r.location].filter(Boolean).join(' · ')
        return <span className="text-xs">{place || '-'}</span>
      },
    },
    {
      key: 'when', label: t('Fecha y horario', 'Date & time'),
      render: r => {
        const hours = [hhmm(r.start_time), hhmm(r.end_time)].filter(Boolean).join('-')
        if (!r.date && !hours) return <span className="text-fiba-muted text-xs">-</span>
        return (
          <div className="text-xs whitespace-nowrap">
            {r.date && <div>{shortDate(r.date, lang)}</div>}
            {hours && <div className="font-mono text-fiba-muted">{hours}</div>}
          </div>
        )
      },
    },
    {
      key: 'capacity', label: t('Capacidad', 'Capacity'),
      render: r => <span className="text-xs">{r.capacity ?? '-'}</span>,
    },
    { key: 'audience', label: t('Grupo', 'Group'), render: r => <AudienceBadge audience={r.audience} /> },
    ...(canEdit ? [{
      key: 'actions', label: '', className: 'w-20',
      render: r => <RowActions onEdit={() => setRoomTarget({ ...toForm(EMPTY_ROOM, r), id: r.id })} onDelete={() => removeRoom(r)} />,
    }] : []),
  ]

  const audienceNote = audience ? ` · ${audienceLabel(audience, lang)}` : ''

  if (loading) {
    return <div className="text-center py-8 text-fiba-muted text-sm">{t('Cargando...', 'Loading...')}</div>
  }

  return (
    <div className="space-y-8">
      {/* ── Contactos y proveedores ─────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h3 className="text-lg font-semibold text-ink-900 dark:text-white">
            {t('Contactos y proveedores', 'Contacts & vendors')}{audienceNote}
          </h3>
          {canEdit && <Button size="sm" icon={<Icon.Plus />} onClick={newContact}>{t('Contacto', 'Contact')}</Button>}
        </div>
        <p className="text-xs text-fiba-muted mb-3">
          {t('No se muestran en el enlace público.', 'Not shown on the public link.')}
        </p>

        {grouped.length === 0 ? (
          <Card padding="p-0">
            <Empty icon={<Icon.Users />}
              title={t('Todavía no hay contactos cargados', 'No contacts loaded yet')}
              body={t('Agrega proveedores y contactos de la competencia.',
                      "Add the competition's vendors and contacts.")}
              action={canEdit ? <Button size="sm" icon={<Icon.Plus />} onClick={newContact}>{t('Agregar contacto', 'Add contact')}</Button> : null} />
          </Card>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ kind, items }) => (
              <div key={kind}>
                <h4 className="text-sm font-semibold text-ink-700 dark:text-ink-200 mb-2">
                  {CONTACT_LABELS[lang][kind]} <span className="font-normal text-fiba-muted">({items.length})</span>
                </h4>
                <Card padding="p-0" className="overflow-hidden">
                  <Table columns={contactColumns} rows={items} dense />
                </Card>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Salones ─────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h3 className="text-lg font-semibold text-ink-900 dark:text-white">{t('Salones', 'Rooms')}{audienceNote}</h3>
          {canEdit && <Button size="sm" icon={<Icon.Plus />} onClick={newRoom}>{t('Salón', 'Room')}</Button>}
        </div>
        <p className="text-xs text-fiba-muted mb-3">
          {t('Salones reservados para Media Day, charla técnica, PIC y reuniones.',
             'Rooms booked for Media Day, technical meeting, PIC and meetings.')}
        </p>

        {sortedRooms.length === 0 ? (
          <Card padding="p-0">
            <Empty icon={<Icon.Calendar />}
              title={t('Todavía no hay salones cargados', 'No rooms loaded yet')}
              body={t('Carga los salones reservados.', 'Add the booked rooms.')}
              action={canEdit ? <Button size="sm" icon={<Icon.Plus />} onClick={newRoom}>{t('Agregar salón', 'Add room')}</Button> : null} />
          </Card>
        ) : (
          <Card padding="p-0" className="overflow-hidden">
            <Table columns={roomColumns} rows={sortedRooms} dense />
          </Card>
        )}
      </section>

      {contactTarget && (
        <ContactModal key={contactTarget.id || 'new'} initial={contactTarget} hotels={hotels}
          onClose={() => setContactTarget(null)} onSave={saveContact} />
      )}
      {roomTarget && (
        <RoomModal key={roomTarget.id || 'new'} initial={roomTarget} hotels={hotels}
          onClose={() => setRoomTarget(null)} onSave={saveRoom} />
      )}
    </div>
  )
}
