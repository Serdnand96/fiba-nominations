# Manual de usuario — FIBA Americas

Sistema de administración de FIBA Americas: nominaciones, personal,
disponibilidad, juegos, entrenamientos y logística.

**Dirección:** https://www.fibaapp.com

---

## 1. Empezar

### Entrar al sistema

1. Abre https://www.fibaapp.com en tu navegador (Chrome, Edge o Safari).
2. Escribe tu **email** y tu **contraseña**.
3. Haz clic en **Ingresar**.

> No hay registro público: las cuentas las crea un administrador del
> sistema. Si no tienes cuenta o no recuerdas tu contraseña, pídele a un
> administrador que te la cree o la restablezca.

### Lo que ves al entrar

- **Menú lateral (izquierda):** los módulos a los que tienes acceso.
  Solo aparecen los que tu usuario tiene permitidos, así que es normal
  que tu menú sea distinto al de un compañero.
- **Barra superior:** el nombre de la sección actual y el botón para
  cambiar entre **modo claro y oscuro**.
- **Abajo del menú:** el selector de idioma **ES / EN** y tu usuario con
  el botón para **cerrar sesión**.

### Permisos

Cada módulo tiene dos niveles:

| Nivel | Qué puedes hacer |
|-------|------------------|
| **Ver** | Entrar al módulo y consultar la información |
| **Editar** | Además, crear, modificar y eliminar registros |

Si intentas entrar a una sección sin permiso, verás una pantalla **403**.
Eso no es un error: es que tu usuario no tiene ese módulo habilitado.
Pídeselo a un administrador del sistema.

### Desde el celular

El sistema funciona en el celular. El menú lateral se abre con el botón
de las tres líneas (☰), arriba a la izquierda.

---

## 2. Los módulos, uno por uno

### 📅 Calendario

Es la vista general del año: todas las competencias y eventos.

**Para qué sirve:** ver qué hay en cada mes, crear eventos y asignarles
el staff que va a trabajar en ellos.

**Cómo se usa:**

1. Cambia entre vista **Año** y **Mes** con los botones de arriba.
2. Haz clic en un evento para abrir el panel lateral con su detalle.
3. En el panel:
    - **Agregar Staff** → busca la persona y agrégala al evento.
    - **Generar Nominaciones** → crea las nominaciones de todo el staff
      asignado, de una sola vez.
    - **Editar** / **Eliminar** el evento.
4. **+ Nuevo evento** crea una competencia: nombre, tipo, template,
   ubicación y fechas.

> Si todavía no tienes fechas confirmadas, marca **Fechas por confirmar
> (TBD)** y el evento aparece igual en el calendario.

---

### 🏆 Nominaciones

El corazón del sistema: las cartas de nominación de cada oficial.

**Para qué sirve:** crear nominaciones, generar la carta en PDF y
llevar el control de quién confirmó.

**Crear una nominación:**

1. **+ Nueva nominación**.
2. Selecciona una o varias **personas** (puedes buscar y usar
   *Seleccionar todos*).
3. Elige la **competencia**.
4. Completa los datos: **Game Dates**, **Confirmation Deadline**,
   **Per Game Fee** o **Window Fee**, **Incidentals**, **Arrival /
   Departure Date** y **Venue**.
5. **Crear Nominaciones**. Quedan en estado **Borrador**.

**Generar la carta:**

- Botón **Generar** en la fila → el sistema arma la carta en PDF y la
  guarda. El estado pasa a **Generada**.
- Después puedes **Descargar** o **Regenerar** (si cambiaste algún dato).
- Puedes seleccionar varias filas y usar **Generar N seleccionadas**
  para hacerlas todas juntas.

**Seguimiento de confirmación:**

Cada nominación tiene un estado: **Pendiente → Nominado → Confirmado**
(o **Declinado**). Actualízalo a medida que el oficial responde. Puedes
filtrar la tabla por ese estado.

**Vista de Carga:**

El botón **Carga** (junto a *Tabla*) muestra una matriz con cuántas
nominaciones y cuántos días de juego acumula cada oficial, en los
últimos 12 meses o por año calendario. Sirve para repartir el trabajo
de forma pareja.

**Aviso de neutralidad arbitral:**

Si nominas a un árbitro a un torneo donde juega su país, verás un aviso
amarillo. **No bloquea la nominación** — es informativo. La restricción
real se aplica al asignar partidos concretos (módulo Juegos).

---

### 👥 Personal

El listado de oficiales: TDs, VGOs, árbitros, instructores y operadores
de video.

**Para qué sirve:** mantener los datos de las personas que se nominan.

**Cómo se usa:**

- **Buscar** por nombre y **filtrar** por rol.
- **+ Agregar persona** para cargar a alguien nuevo: nombre, rol, país,
  email, pasaporte y teléfono.
- Haz clic en el nombre (o en **Perfil**) para abrir el panel lateral
  con su información completa: foto, idiomas, **visas** con fecha de
  vencimiento y su **carga de trabajo** de los últimos 12 meses.

**El país importa.** Para los árbitros, el país es lo que habilita los
chequeos de elegibilidad. Si una persona tiene más de una nacionalidad,
agrégalas todas en **Otras nacionalidades**: queda restringido por todas.

**Importar en lote:**

1. **Importar CSV/Excel**.
2. **Descargar plantilla** para ver el formato de columnas exacto.
3. Arrastra tu archivo `.xlsx`, `.xls` o `.csv`.
4. Revisa la **Vista previa**, luego **Confirmar Importación**.
5. Al final ves cuántos se importaron, cuántos se omitieron por
   duplicados y el detalle de cada error con su número de fila.

---

### 🗂️ Competencias

El listado de todas las competencias y sus datos de configuración.

**Para qué sirve:** definir cada competencia y, sobre todo, **qué
template de carta usa**.

**Cómo se usa:**

- **+ Nueva competencia**: nombre, template, año.
- Marca **Competencia de selecciones nacionales** cuando corresponda:
  eso activa la restricción de neutralidad arbitral (un árbitro no
  puede dirigir partidos ni grupos donde juegue su país).
- El **tipo de honorario** define el texto de fees que sale impreso en
  la carta de nominación.

---

### 📄 Templates

Los modelos de carta que usa el sistema para generar las nominaciones.

**Para qué sirve:** ver, previsualizar y personalizar el diseño de las
cartas, sin tocar código.

**Ver cómo queda una carta:** botón **Vista previa** — genera una carta
de muestra con datos ficticios.

**Diseñar tu propia carta:**

1. **Descargar .docx** del template del que quieras partir.
2. Ábrelo en **Word** y diséñalo con libertad: logo, membrete, footer,
   tipografías, colores, imagen de firma, redacción y orden.
3. Deja los **campos** (los que la pantalla te lista, del tipo
   `{{ competition }}`) donde quieras que aparezca cada dato.
   Cópialos exactamente como figuran — hay un botón para copiar cada uno.
4. **Subir** el archivo. El sistema lo valida y te avisa si usaste un
   campo que no existe.
5. **Revisar** — ves la carta que produce, con datos de muestra.
   **Todavía no está en uso.**
6. Recién cuando haces **Activar**, el template pasa a usarse de verdad.

**Volver atrás:** el botón **Volver al original** descarta lo que subiste
y restaura el template de fábrica.

> Si borras un campo, ese dato simplemente deja de aparecer. Si inventas
> uno que no existe, sale vacío (y la validación te avisa antes).

---

### 🗓️ Disponibilidad

**Para qué sirve:** saber quién está disponible antes de nominar.

**Dos formas de cargar disponibilidad:**

1. **A mano**, desde el módulo: **+ Agregar Disponibilidad**, eligiendo
   *Por evento* o *Por rango de fechas*, con estado Disponible / No
   disponible / Con restricciones y una nota opcional.

2. **Autoservicio (recomendado):** botón **Enlaces para oficiales**.
   Copia el enlace de cada cargo y compártelo por email o WhatsApp.
   El oficial abre el enlace, busca su nombre, marca su disponibilidad
   para las próximas competencias y agrega sus periodos no disponibles.
   **No necesita cuenta ni contraseña.**

    El enlace queda vivo: pueden volver a entrar cuando quieran para
    actualizarlo. Si un enlace se filtró o quieres invalidarlo, usa
    **Rotar** — el anterior deja de funcionar de inmediato.

**La matriz** muestra de un vistazo, por oficial y por competencia,
quién está disponible, quién ya está nominado, confirmado o declinado.
La columna de frescura te dice **cuándo fue la última vez que cada uno
confirmó** su disponibilidad.

---

### 🏀 Juegos

El calendario de partidos de una competencia y las designaciones por
partido.

**Para qué sirve:** cargar el fixture, asignar TD, VGO y terna arbitral
a cada partido, y desde ahí generar las nominaciones.

**Cargar los partidos** (tres caminos):

- **+ Agregar Juego**, uno por uno.
- **Importar Excel** con el fixture completo.
- **Sincronizar Resultados**: pega la URL de la página de juegos de FIBA
  (o el ID numérico de competencia) y el sistema trae los partidos y
  actualiza los resultados. Sirve también durante el torneo para traer
  los marcadores.

**Asignar personas a un partido** (competencias con honorario **por
partido**): haz clic en el cargo que quieras completar — **TD, VGO,
Crew Chief, Umpire 1, Umpire 2, Instructor de árbitros, Video Operator,
Extra** — busca la persona y asígnala. Cada partido muestra cuántos
cargos llevas cubiertos (*"3 de 7 cargos asignados"*).

**Competencias con honorario por torneo:** el equipo se define **una
sola vez** en el **Crew del torneo** (botón arriba en Juegos, o
**Agregar Staff** en el panel del evento del Calendario) y cubre todos
los partidos y entrenamientos. En cada partido solo se marca, si
quieres, quién estuvo realmente en la mesa en los cargos de arbitraje —
Crew Chief, Umpire 1 y 2, Instructor y Video Operator — así que ahí el
contador es *"de 5"*.

**Neutralidad arbitral — esto sí bloquea.** En competencias marcadas
como *selecciones nacionales*, el sistema **impide** asignar un árbitro
a un partido donde juega su país, o a cualquier partido del grupo donde
compite su país. En competencias de clubes, bloquea solo los partidos
donde juega un club de su país (el resto del grupo sí está permitido).
También aplica restricciones especiales confirmadas por FIBA Americas
(por ejemplo, Puerto Rico → USA). Cuando pasa, el sistema te explica
exactamente por qué.

> Para que esto funcione en torneos de clubes, tienes que completar
> **Países de clubes**. El botón te avisa cuántos clubes están sin país.

**De los partidos a las nominaciones:**

1. **Datos comunes** — define una vez los valores que comparten todas
   las nominaciones: fecha de carta, ubicación, deadline de confirmación,
   honorarios por rol (TD, VGO, árbitros, instructor, video operator) e
   incidentales. También los días de llegada antes del primer partido y
   de salida después del último.
2. **Sincronizar nominaciones** — crea o actualiza los borradores de
   nominación de todos los asignados, calculando la sede y las fechas de
   viaje de cada persona según los partidos que le tocaron.
3. **Generar PDFs** — sincroniza y genera las cartas de todos, de una vez.

**Otras utilidades:**

- **Recalcular viajes**: vuelve a calcular sede y fechas de viaje de
  todos los asignados. ⚠️ Sobrescribe los valores actuales, **incluidas
  las ediciones manuales** que hayas hecho en Nominaciones.
- **Vuelos**: el ícono de avión junto a cada persona alterna entre
  *vuelo pendiente* y *vuelo comprado*, y la tarjeta **Con vuelo** te
  dice cuántos llevas.

---

### 🏋️ Entrenamientos (Training Schedule)

**Para qué sirve:** administrar los horarios de entrenamiento de los
equipos y qué TD supervisa cada uno.

**Cómo se usa:**

1. Selecciona la **competencia**.
2. Mira el cronograma en tres vistas: **Por Día**, **Por Equipo** o
   **Por TD**.
3. Carga los slots:
    - **+ Agregar Slot** a mano: fecha, hora de inicio y fin, sede,
      equipo, deporte, cancha y notas.
    - **Importar Excel** con la planilla de FIBA. Arrastra el `.xlsx`,
      revisa la vista previa y confirma. Te dice cuántos slots creó y
      cuántos actualizó.
4. **Asignar TD** a cada slot. Si el TD ya tiene otro compromiso a esa
   misma hora, el sistema **te avisa del cruce de horario** pero te deja
   asignarlo igual — la decisión es tuya.

**Exportar:**

- **Exportar PDF** — el cronograma de entrenamientos.
- **Game & Practice (Excel)** — el documento completo en formato FIBA,
  con partidos y entrenamientos juntos. Te pide el idioma del documento,
  la sede principal y la sede de entrenamiento (si las dejas vacías, el
  sistema infiere la sede desde los partidos y muestra "TBC").

> El export Game & Practice necesita partidos cargados en **Juegos** o
> slots cargados aquí. Si no hay ninguno de los dos, te va a avisar.

---

### 🚐 Logística

**Para qué sirve:** organizar todo lo que rodea a un evento fuera de la
cancha: los traslados, el hotel con sus comidas y el registro de
llegadas y salidas de cada persona.

**Tres secciones:**

| Sección | Qué se hace ahí |
|---------|-----------------|
| **Transporte** | Vehículos, choferes y el cronograma de viajes |
| **Hoteles y alimentación** | Hoteles, rooming list y comidas |
| **Travel Manifest** | Quién viene, cuándo llega y cuándo se va |

**Transporte** tiene dos pestañas: **Cronograma** (los viajes del día,
agrupados por vehículo) y **Vehículos, choferes y venues** (dar de alta
la flota, los conductores y los lugares).

- **Cargar un viaje:** número de viaje, hora de salida, partida,
  destino, equipo que se lleva (ej. `REM1 + IBC2`), contacto y hora
  estimada de llegada.
- **Detección de conflictos:** si un chofer queda con dos viajes que se
  solapan, la fila se marca en rojo con un punto y arriba aparece el
  detalle del cruce.
- **Exportar PDF** arma la hoja de transporte del día, lista para
  imprimir o guardar como PDF desde el navegador.

**Hoteles y alimentación:** das de alta los hoteles y armas la
**rooming list**. La grilla de noches se calcula sola a partir del
check-in y check-out de cada persona, y el total que se informa al
hotel cuenta **habitaciones, no personas** (de una pareja que comparte
cuarto suma una sola fila). También se registran las **comidas**.

**Travel Manifest:** el padrón de la competencia — quién viene
(oficiales, staff de FIBA, VIPs, delegaciones e invitados) con su
llegada y su salida. Dos vistas: **Por persona** y **Grupos de
traslado**. Las personas a trasladar se administran aquí (ya no hay
una pestaña de pasajeros dentro de Transporte).

**Importar desde Excel:** el **Flight Manifest** y la **Rooming List**
se importan desde las planillas de FIBA en dos pasos: subes el archivo,
revisas la vista previa — cada fila marcada como *vinculado*, *revisar*
o *nuevo* — y recién entonces **Confirmar importación**. Si un nombre
no coincide con seguridad, el sistema no adivina: lo importa sin
vincular y te lo deja como aviso para resolverlo a mano.

**Compartir (enlace público):** el botón **Compartir** genera un enlace
por competencia para pasarle al hotel, la agencia o el staff local; se
abre sin usuario ni contraseña.

> ⚠️ El enlace público muestra los datos completos, **número de
> pasaporte incluido**. Compártelo solo con quien deba verlo. Puedes
> **Desactivar** el enlace o usar **Rotar link** — el anterior deja de
> funcionar de inmediato.

> Necesitas al menos una competencia creada en el **Calendario** para
> poder usar Logística.

---

## 3. Flujo completo de un evento

Así se ve el trabajo de punta a punta:

```
1. CALENDARIO      Creas el evento con sus fechas
        ↓
2. COMPETENCIAS    Le asignas el template de carta
                   y marcas si es de selecciones nacionales
        ↓
3. DISPONIBILIDAD  Compartes el enlace de autoservicio
                   y esperas las respuestas
        ↓
4. JUEGOS          Cargas el fixture (Excel o sync FIBA)
                   y asignas TD / VGO / árbitros por partido
        ↓
5. JUEGOS          Datos comunes → Generar PDFs
        ↓
6. NOMINACIONES    Revisas las cartas, las envías
                   y marcas quién confirmó
        ↓
7. ENTRENAMIENTOS  Cargas los slots y asignas TDs
                   → exportas Game & Practice
        ↓
8. LOGÍSTICA       Traslados, hotel y manifest del evento
```

Para eventos chicos puedes saltarte Juegos y crear las nominaciones a
mano desde **Nominaciones**, o de una vez desde el panel del evento en
el **Calendario**.

---

## 4. Problemas frecuentes

**No veo un módulo en el menú**
Tu usuario no tiene permiso de ver ese módulo. Pídeselo a un
administrador del sistema.

**Me sale una pantalla 403**
Lo mismo: falta el permiso para esa sección.

**No puedo asignar un árbitro a un partido**
Es la regla de neutralidad. El sistema te dice exactamente cuál es el
conflicto. No es un error y no se puede saltar: hay que asignar a otro
árbitro.

**El sistema me avisa de un cruce de horario de un TD**
En Entrenamientos el aviso es solo eso, un aviso: puedes asignarlo igual
si sabes que está bien. Revisa el horario antes de confirmar.

**Bajé un `.docx` en vez del PDF que esperaba**
La conversión a PDF falló en ese momento. El contenido es el mismo:
puedes abrirlo en Word y exportarlo a PDF, o intentar **Regenerar** más
tarde.

**Importé un Excel y varias filas dieron error**
El resultado de la importación lista cada fila con su motivo. Lo más
común es una columna con nombre distinto al de la plantilla, o un rol o
país que el sistema no reconoce. Descarga la plantilla y compara.

**Cambié datos de una nominación pero el PDF sigue igual**
El PDF se arma en el momento de generarlo. Usa **Regenerar** para que
tome los datos nuevos.

**Recalculé viajes y perdí ediciones manuales**
Es el comportamiento esperado: **Recalcular viajes** sobrescribe sede y
fechas de viaje de todos los asignados. Úsalo solo cuando quieras
rehacerlas desde cero.

**Un oficial dice que su enlace de disponibilidad no funciona**
Probablemente el enlace fue rotado. Copia el enlace actual desde
**Disponibilidad → Enlaces para oficiales** y vuelve a compartirlo.

---

## 5. Buenas prácticas

- **Completa bien el país de cada persona.** De ahí salen todos los
  chequeos de elegibilidad arbitral.
- **Usa los enlaces de autoservicio** para la disponibilidad. Te ahorra
  la carga manual y quedan registradas la fecha y la respuesta de cada
  oficial.
- **Revisa un template antes de activarlo.** La pantalla de revisión
  existe justo para eso: lo ves renderizado y nada cambia hasta que
  aprietas *Activar*.
- **Carga los "Datos comunes" antes de generar PDFs en lote.** Ahorra
  corregir nominación por nominación después.
- **Mira la vista de Carga** antes de nominar, para repartir el trabajo
  de forma pareja entre los oficiales.
- **Cierra sesión** si usas una computadora compartida.

---

## 6. ¿Dudas?

Si algo no funciona como dice este manual, o necesitas un permiso, un
módulo nuevo o un cambio en las cartas, avísale al administrador del
sistema.
