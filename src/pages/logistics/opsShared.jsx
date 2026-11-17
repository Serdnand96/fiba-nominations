import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import AttachmentList from '../../components/AttachmentList'
import {
  getLogisticsDocuments, uploadLogisticsDocument, downloadLogisticsDocument, deleteLogisticsDocument,
} from '../../api/client'
import { audienceLabel } from './audiences'

// Piezas compartidas por las superficies nuevas de Logística (Servicios, detalle
// de hotel, documentos de pasaporte). Los textos van con el t(es, en) local, como
// el resto del módulo.

// El backend responde `detail` como string (400/403/404/409) o, a veces, como
// objeto; las descargas con responseType 'blob' lo dejan en `err.detail`.
export function errorMessage(err, fallback = 'Error') {
  const detail = err?.detail ?? err?.response?.data?.detail
  return typeof detail === 'string' && detail ? detail : fallback
}

export const hhmm = (v) => (v ? String(v).slice(0, 5) : '')

export const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function shortDate(iso, lang) {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { day: 'numeric', month: 'short' })
}

// '' → null: una hora o una fecha vacía no es válida para el backend.
export const nullify = (form) => Object.fromEntries(
  Object.entries(form).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : v]),
)

const AUDIENCE_TONE = { staff: 'navy', delegation: 'info', vip: 'basketball' }

// audience null = compartido: se ve en las tres.
export function AudienceBadge({ audience }) {
  const { lang } = useLanguage()
  if (!audience) return <Badge tone="outline" size="sm">{lang === 'es' ? 'Compartido' : 'Shared'}</Badge>
  return <Badge tone={AUDIENCE_TONE[audience] || 'ink'} size="sm">{audienceLabel(audience, lang)}</Badge>
}

// Opciones del selector de audiencia de un registro: '' = compartido.
export function audienceOptions(lang) {
  return [
    { value: '', label: lang === 'es' ? 'Compartido (las tres)' : 'Shared (all three)' },
    { value: 'staff', label: audienceLabel('staff', lang) },
    { value: 'delegation', label: audienceLabel('delegation', lang) },
    { value: 'vip', label: audienceLabel('vip', lang) },
  ]
}

// No hay primitivo de textarea: mismo aspecto que `Input`.
export function TextArea({ label, rows = 2, className = '', ...rest }) {
  return (
    <label className="block">
      {label && <div className="text-[13px] font-medium text-ink-700 mb-1.5 dark:text-ink-200">{label}</div>}
      <textarea rows={rows}
        className={`w-full px-3 py-2 text-sm bg-white border border-ink-200 rounded-md placeholder:text-ink-400 text-ink-900 focus:outline-none focus:border-navy-500 focus:shadow-focus transition-shadow dark:bg-navy-800 dark:border-navy-700 dark:text-ink-50 ${className}`}
        {...rest} />
    </label>
  )
}

const MAX_BYTES = 10 * 1024 * 1024

// Documentos privados de un registro (menús de un hotel, cotización de un
// adicional, pasaporte de una persona). Carga, sube, baja y borra por su cuenta:
// el caller solo dice a qué cuelgan (`filters`). Sin `canEdit` no hay subida ni
// borrado. La descarga es POST + blob + JWT (queda en el activity log).
export function DocumentsPanel({ competitionId, filters, canEdit, labels }) {
  const { lang } = useLanguage()
  const { push } = useToast()
  const t = (es, en) => (lang === 'es' ? es : en)
  const [items, setItems] = useState([])
  const [loadError, setLoadError] = useState(false)
  // Solo el pedido más reciente escribe el estado: al cambiar de hotel o de
  // persona, una respuesta vieja no debe dejar documentos ajenos en pantalla.
  const requestRef = useRef(0)

  // Las claves de `filters` son primitivas: se desarman para que el efecto no
  // dependa de la identidad del objeto que el caller arma en cada render.
  const { kind, hotel_id: hotelId, participant_id: participantId, charge_id: chargeId } = filters

  const load = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const data = await getLogisticsDocuments(competitionId, {
        kind, hotel_id: hotelId, participant_id: participantId, charge_id: chargeId,
      })
      if (request === requestRef.current) { setItems(data); setLoadError(false) }
    } catch (err) {
      if (request !== requestRef.current) return
      setItems([]); setLoadError(true)
      push({ type: 'error', title: errorMessage(err, t('No se pudieron cargar los documentos.', 'Could not load the documents.')) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, kind, hotelId, participantId, chargeId])

  useEffect(() => { load() }, [load])

  async function handleUpload(file) {
    if (file.size > MAX_BYTES) {
      push({ type: 'error', title: t('El archivo supera los 10 MB.', 'The file is larger than 10 MB.') })
      return false
    }
    try {
      await uploadLogisticsDocument(competitionId, file, { kind, hotel_id: hotelId, participant_id: participantId, charge_id: chargeId })
      await load()
    } catch (err) {
      push({ type: 'error', title: errorMessage(err, t('No se pudo subir el archivo.', 'Could not upload the file.')) })
      return false
    }
  }

  async function handleDownload(doc) {
    try { await downloadLogisticsDocument(doc) }
    catch (err) { push({ type: 'error', title: errorMessage(err, t('No se pudo bajar el archivo.', 'Could not download the file.')) }) }
  }

  async function handleDelete(doc) {
    if (!confirm(t(`¿Eliminar ${doc.file_name}?`, `Delete ${doc.file_name}?`))) return
    try { await deleteLogisticsDocument(doc.id); await load() }
    catch (err) { push({ type: 'error', title: errorMessage(err, t('No se pudo eliminar.', 'Could not delete.')) }) }
  }

  return (
    <div>
      <AttachmentList
        items={items} showKind={false} canEdit={canEdit}
        accept="application/pdf,image/jpeg,image/png"
        onUpload={handleUpload} onDownload={handleDownload} onDelete={handleDelete}
        labels={{
          upload: t('Subir archivo', 'Upload file'),
          remove: t('Eliminar', 'Delete'),
          empty: loadError ? undefined : t('Sin archivos.', 'No files.'),
          ...labels,
        }}
      />
      {canEdit && (
        <p className="text-[11px] text-fiba-muted mt-1.5">{t('PDF, JPG o PNG, hasta 10 MB.', 'PDF, JPG or PNG, up to 10 MB.')}</p>
      )}
    </div>
  )
}
