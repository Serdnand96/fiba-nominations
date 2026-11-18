// Barrel de gráficos. Importalo SIEMPRE con React.lazy:
//   const BudgetCharts = lazy(() => import('../../components/charts'))
// Un import estático metería recharts (chunk `charts`) en la página que lo use.
export { default } from './BudgetCharts'
export { default as BudgetCharts } from './BudgetCharts'
