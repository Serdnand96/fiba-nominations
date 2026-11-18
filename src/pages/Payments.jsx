/**
 * Pagos — shell con dos pestañas:
 *   queue → la cola de pagos de todos los eventos (por defecto)
 *   event → los nominados de un evento y el pago de cada uno
 *
 * La pestaña va en la URL (`?tab=event`), igual que los filtros de la cola y el
 * pago abierto (`?open=<id>`): los links de la campana caen directo ahí.
 */
import { useLanguage } from '../i18n/LanguageContext'
import { Tabs, useTabParam } from '../components/ui/Tabs'
import QueueTab from './payments/QueueTab'
import EventTab from './payments/EventTab'

const TABS = ['queue', 'event']

export default function Payments() {
  const { t } = useLanguage()
  const [tab, setTab] = useTabParam(TABS, 'queue')

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink-900 dark:text-white">{t('nav.payments')}</h1>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'queue', label: t('payments.tabQueue') },
          { key: 'event', label: t('payments.tabEvent') },
        ]}
      />

      {tab === 'queue' && <QueueTab />}
      {tab === 'event' && <EventTab />}
    </div>
  )
}
