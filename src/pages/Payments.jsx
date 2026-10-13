/**
 * Pagos — shell con dos pestañas:
 *   queue → la cola de pagos de todos los eventos (llega con el pipeline de pagos)
 *   event → los nominados de un evento y el pago de cada uno
 *
 * La pestaña va en la URL (`?tab=event`) y el editor se abre con `?open=<id>`.
 * Mientras la cola no exista, la pestaña por defecto es `event`, que es lo que
 * la página mostraba hasta ahora.
 */
import { useLanguage } from '../i18n/LanguageContext'
import { Tabs, useTabParam } from '../components/ui/Tabs'
import { Empty } from '../components/ui/Empty'
import { Icon } from '../lib/icons'
import EventTab from './payments/EventTab'

const TABS = ['queue', 'event']

export default function Payments() {
  const { t } = useLanguage()
  const [tab, setTab] = useTabParam(TABS, 'event')

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink-900 dark:text-white">{t('nav.payments')}</h1>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'queue', label: t('budget.paymentsTabQueue') },
          { key: 'event', label: t('budget.paymentsTabEvent') },
        ]}
      />

      {tab === 'queue' && <Empty icon={<Icon.Clock />} title="Próximamente" />}
      {tab === 'event' && <EventTab />}
    </div>
  )
}
