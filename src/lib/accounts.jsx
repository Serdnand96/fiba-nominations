/**
 * Opciones del plan de cuentas para los desplegables de imputación.
 *
 * Vive acá y no dentro de una página porque lo usan Budget (líneas, gastos,
 * ingresos) y Payments (el fee y el pasaje de cada pago). Cuando estaban
 * duplicados, la misma cuenta se dibujaba distinta en cada pantalla: en una con
 * el asterisco de código provisorio y en la otra sin él.
 *
 * `used_by` no es una columna: la cuenta NO pertenece a un departamento —son
 * dimensiones separadas, "TV Production" es plata de Comms dentro del
 * presupuesto de Competitions—. El backend lo deriva de lo que ya hay cargado,
 * y sirve para poner arriba las 2-4 cuentas del área en la que estás parado en
 * vez de las 34 del plan entero.
 */

/** Parte el catálogo en las cuentas del departamento y el resto. */
export function splitAccounts(accounts, department) {
  if (!department) return { mine: accounts, rest: [] }
  const mine = accounts.filter(a => (a.used_by || []).includes(department))
  return { mine, rest: accounts.filter(a => !(a.used_by || []).includes(department)) }
}

export function accountOption(a) {
  // El asterisco marca el código provisorio (`pending_mapping`): el plan de
  // cuentas oficial de Finance todavía no llegó.
  return (
    <option key={a.code} value={a.code}>
      {a.code} — {a.label}{a.pending_mapping ? ' *' : ''}
    </option>
  )
}

/** Todas las cuentas, con las del departamento primero. Para los editores. */
export function AccountOptions({ accounts, department, t }) {
  const { mine, rest } = splitAccounts(accounts, department)
  if (!department || mine.length === 0) return accounts.map(accountOption)
  return (
    <>
      <optgroup label={t('budget.accountsOfDepartment')}>{mine.map(accountOption)}</optgroup>
      {rest.length > 0 && <optgroup label={t('budget.otherAccounts')}>{rest.map(accountOption)}</optgroup>}
    </>
  )
}
