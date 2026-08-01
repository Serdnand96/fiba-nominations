-- Permiso propio para los días compensatorios.
--
-- La columna "Días comp." de Empleados (sábados y domingos caídos dentro de
-- cada viaje) es insumo de RRHH, no información general: quién la ve se elige
-- usuario por usuario, como cualquier otro módulo.
--
-- `comp_days` NO es una página: no tiene ruta ni entrada en el sidebar. Es un
-- permiso que gobierna una columna dentro de Employees y los campos
-- `weekend_days` que devuelven /employees/trip-counts y
-- /employees/{id}/trips. Por eso solo usa can_view — no hay nada que editar,
-- el número es derivado (ver api/_lib/routers/employees.py).
--
-- Nadie lo tiene por defecto: al no insertar filas, todos los no-superadmin
-- arrancan sin verlo y hay que otorgarlo explícitamente desde Usuarios. Los
-- superadmin lo ven siempre, como con todos los permisos.
--
-- Mantener en sync con MODULES en api/_lib/routers/permissions.py y en
-- src/pages/Users.jsx.

ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_module_check;

ALTER TABLE user_permissions
  ADD CONSTRAINT user_permissions_module_check CHECK (module IN (
    'calendar', 'nominations', 'personnel', 'competitions', 'templates',
    'users', 'logistics', 'availability', 'training', 'games', 'assets',
    'loans', 'employees', 'payments', 'reports', 'evaluations', 'comp_days'
  ));
