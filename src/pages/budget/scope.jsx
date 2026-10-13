/**
 * BudgetScopeContext — qué departamentos ve, edita y aprueba el usuario.
 *
 * Sale de `GET /budget/access/me/scope`, la misma resolución que usa el
 * backend en `_departments_for()` (budget.py). Convención de las listas:
 *
 *   null   → todos los departamentos (superadmin o fila `*` en budget_access)
 *   [...]  → solo esos códigos; `[]` = ninguno
 *
 * Es solo UX: esconder un botón no protege nada. El recorte real vive en
 * `_scoped()` / `_assert_can_edit()` del backend.
 *
 * `approve` todavía no lo devuelve el backend (llega con la aprobación de
 * gastos); mientras falte se trata como `[]`: nadie aprueba por la UI.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getMyBudgetScope } from '../../api/client'

const BudgetScopeContext = createContext(null)

// Si el endpoint falla, se cae del lado cerrado: sin departamentos.
const CLOSED = { is_superadmin: false, view: [], edit: [], approve: [] }

function allows(list, code) {
  return list === null || (Array.isArray(list) && list.includes(code))
}

export function BudgetScopeProvider({ children }) {
  const [raw, setRaw] = useState(null)   // null = cargando

  useEffect(() => {
    let alive = true
    getMyBudgetScope()
      .then(data => { if (alive) setRaw(data || CLOSED) })
      .catch(e => { console.error(e); if (alive) setRaw(CLOSED) })
    return () => { alive = false }
  }, [])

  const value = useMemo(() => {
    if (!raw) {
      return {
        ready: false, isSuperadmin: false, view: [], edit: [], approve: [],
        isGeneralAdmin: false, canEditDept: () => false, canApproveDept: () => false,
      }
    }
    const isSuperadmin = !!raw.is_superadmin
    // `undefined` (campo ausente) no es `null` (todos): ausente = ninguno.
    const view = raw.view === undefined ? [] : raw.view
    const edit = raw.edit === undefined ? [] : raw.edit
    const approve = raw.approve === undefined ? [] : raw.approve
    return {
      ready: true,
      isSuperadmin,
      view,
      edit,
      approve,
      // Admin general = edita todos los departamentos. Es la condición que el
      // backend usa para catálogos (cuentas) y datos bancarios de proveedores.
      isGeneralAdmin: isSuperadmin || edit === null,
      canEditDept: (code) => isSuperadmin || allows(edit, code),
      canApproveDept: (code) => isSuperadmin || allows(approve, code),
    }
  }, [raw])

  return <BudgetScopeContext.Provider value={value}>{children}</BudgetScopeContext.Provider>
}

export function useBudgetScope() {
  const ctx = useContext(BudgetScopeContext)
  if (!ctx) throw new Error('useBudgetScope must be used within BudgetScopeProvider')
  return ctx
}

export { BudgetScopeContext }
