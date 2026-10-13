/**
 * Budget — gastos por departamento, con o sin evento.
 *
 * Complementa Pagos, que solo paga a personas nominadas. Acá entra todo lo
 * demás: licencias e internet (departamento sin evento) y shipping, branding o
 * seguros (evento sin persona). Ver BUDGET_MODULE.md.
 *
 * Solo el gasto en estado "pagado" consume presupuesto; lo aprobado sin pagar
 * se muestra aparte como comprometido.
 *
 * Este archivo es solo el shell: carga los catálogos compartidos y el scope
 * por departamento, y dibuja la pestaña activa. Cada pestaña vive en
 * `pages/budget/*Tab.jsx` y sus editores en `pages/budget/editors/`.
 *
 * La pestaña va en la URL (`?tab=expenses`) y una pestaña puede abrir un
 * registro con `?open=<id>`: así los links de las notificaciones caen directo
 * en el detalle.
 */
import { useEffect, useState } from 'react'
import {
  getDepartments, getAccounts, getCalendarCompetitions, getEmployees, getVendors,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useToast } from '../components/ui/Toast'
import { Tabs, useTabParam } from '../components/ui/Tabs'
import { useAuth } from '../contexts/AuthContext'
import { BudgetScopeProvider, useBudgetScope } from './budget/scope'
import DashboardTab from './budget/DashboardTab'
import PlanTab from './budget/PlanTab'
import ExpensesTab from './budget/ExpensesTab'
import RecurringTab from './budget/RecurringTab'
import RevenuesTab from './budget/RevenuesTab'
import VendorsTab from './budget/VendorsTab'

const TABS = ['dashboard', 'plan', 'expenses', 'recurring', 'revenues', 'vendors']

export default function Budget() {
  return (
    <BudgetScopeProvider>
      <BudgetShell />
    </BudgetScopeProvider>
  )
}

function BudgetShell() {
  const { t } = useLanguage()
  const { push } = useToast()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('budget')
  const scope = useBudgetScope()

  const [tab, setTab] = useTabParam(TABS, 'dashboard')

  // Catálogos, compartidos por todas las pestañas.
  const [departments, setDepartments] = useState([])
  const [expenseAccounts, setExpenseAccounts] = useState([])
  const [revenueAccounts, setRevenueAccounts] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [vendors, setVendors] = useState([])
  const [employees, setEmployees] = useState([])
  const [catalogsReady, setCatalogsReady] = useState(false)

  useEffect(() => {
    Promise.all([
      getDepartments(),
      getAccounts({ kind: 'expense' }),
      getAccounts({ kind: 'revenue' }),
      getCalendarCompetitions(),
      getVendors(),
      getEmployees(),
    ]).then(([deps, accE, accR, comps, vs, emps]) => {
      setDepartments(deps)
      setExpenseAccounts(accE)
      setRevenueAccounts(accR)
      setCompetitions(comps)
      setVendors(vs)
      setEmployees(emps)
    }).catch(e => {
      console.error(e)
      push({ type: 'error', title: t('common.error') })
    }).finally(() => setCatalogsReady(true))
  }, [])

  async function reloadVendors() {
    try { setVendors(await getVendors()) } catch (e) { console.error(e) }
  }

  // El scope se espera junto con los catálogos: una pestaña que decide qué
  // botones mostrar por departamento no tiene que dibujarse sin él.
  if (!catalogsReady || !scope.ready) return <div className="text-fiba-muted text-sm">{t('common.loading')}</div>

  const shared = {
    t, push, canEdit, departments, expenseAccounts, revenueAccounts,
    competitions, vendors, employees, reloadVendors,
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('budget.title')}</h2>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={TABS.map(key => ({ key, label: t(`budget.tab${key.charAt(0).toUpperCase()}${key.slice(1)}`) }))}
      />

      {tab === 'dashboard' && <DashboardTab {...shared} />}
      {tab === 'plan' && <PlanTab {...shared} />}
      {tab === 'expenses' && <ExpensesTab {...shared} />}
      {tab === 'recurring' && <RecurringTab {...shared} />}
      {tab === 'revenues' && <RevenuesTab {...shared} />}
      {tab === 'vendors' && <VendorsTab {...shared} />}
    </div>
  )
}
