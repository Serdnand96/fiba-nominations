# Glosario de cuentas de gasto

Las 112 cuentas de gasto del plan de cuentas de Finance (`Chart Of Accounts.xlsx`),
con su nombre en español y qué se imputa en cada una. Sirve para decidir a qué
cuenta va una factura antes de cargarla en Presupuesto.

Dos avisos antes de usarlo:

- El archivo de Finance trae solo el número y el nombre de cada cuenta. La
  columna "Qué se imputa" está redactada a partir de ese nombre y del uso
  habitual del rubro. Conviene que Finance la valide antes de tomarla como regla.
- El nombre oficial está copiado tal cual del archivo, incluidos sus errores de
  tipeo ("Fronge", "Plateform", "deductable"), para que coincida con lo que
  aparece en el ledger.

Lo marcado como "por confirmar" es una lectura probable, no un dato. La lista
completa está al final.

## Cómo leer el código

Los primeros dígitos dicen de qué familia es el gasto:

| Rango | Familia | Cuentas |
|---|---|---|
| 500000 a 503902 | Personal: sueldos, beneficios y cargas sociales | 30 |
| 610000 a 612300 | Oficina, servicios e IT | 14 |
| 622000 a 629900 | Administración, servicios profesionales e impuestos | 12 |
| 630000 a 630901 | Viajes | 7 |
| 640000 a 642300 | Marketing, derechos de medios y digital | 16 |
| 648000 a 648900 | Eventos y competencias | 15 |
| 660000 a 662600 | Desarrollo deportivo y federaciones | 9 |
| 680100 a 680999 | Depreciaciones | 9 |

Dentro de cada familia, las cuentas que terminan en 900 o 999 son el "otros"
del grupo: se usan solo cuando ninguna cuenta específica aplica.

## 1. Personal (500000 a 503902)

Todo lo que cuesta el personal en nómina. Un proveedor que factura sus
servicios no va aquí, aunque trabaje todos los días en la oficina: es un
servicio (623100 o 648300).

### Sueldos

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 500000 | Gross salaries | Sueldos brutos | Sueldo bruto del personal en nómina, antes de descuentos. |
| 500010 | Foreign gross salaries | Sueldos brutos en el exterior | Sueldo bruto del personal contratado o pagado en un país distinto al de la entidad. |
| 500020 | Gross salaries - temporary workers | Sueldos brutos de personal temporal | Sueldo del personal en nómina contratado por tiempo determinado o por temporada. |
| 500200 | Bonus | Bonos | Bonos, gratificaciones y pagos variables al personal. |
| 500300 | Untaken holidays | Vacaciones no tomadas | Provisión o pago de los días de vacaciones acumulados y no gozados. |
| 500900 | Interco salaries recharged | Sueldos recargados entre entidades | Sueldos que otra entidad de FIBA le recarga a esta oficina, o que esta oficina le recarga a otra. |

### Beneficios

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 501000 | Representation Expenses | Gastos de representación | Asignación fija por representación que forma parte de la remuneración de un directivo (por confirmar). Una cena con un tercero es un gasto de viaje (630200 o 630900). |
| 501100 | Car Allowance / car leasing | Asignación de vehículo o leasing | Asignación mensual por vehículo o cuota de leasing de un auto entregado a un empleado como beneficio. |
| 501200 | Health insurance - Fronge benefits | Seguro de salud como beneficio | Seguro médico privado que la organización le paga al empleado como beneficio, aparte de los aportes obligatorios. |
| 501900 | Various fringe benefits | Otros beneficios | Beneficios en dinero o en especie sin cuenta propia: celular personal, gimnasio, ayuda escolar, vivienda. |
| 501910 | Various fringe benefits subject to German tax | Otros beneficios gravados en Alemania | Beneficios que tributan en Alemania. No aplica a la oficina regional. |
| 501911 | Various fringe benefits tax free (Company events) - Germany | Beneficios exentos por eventos de empresa (Alemania) | Eventos internos de empresa exentos de impuesto en Alemania. No aplica a la oficina regional. |

### Cargas sociales y seguros del personal

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 502000 | Social Security & Unemployment | Seguridad social y desempleo | Aportes patronales a la seguridad social y al seguro de desempleo. |
| 502010 | Foreign Social Charges | Cargas sociales en el exterior | Aportes patronales del personal contratado en otro país. Acompaña a la 500010. |
| 502020 | Lump-sum tax temporary workers (Germany) | Impuesto a tanto alzado por personal temporal (Alemania) | Impuesto fijo sobre el personal temporal en Alemania. No aplica a la oficina regional. |
| 502100 | Health Insurance Allocation | Aporte al seguro de salud | Aporte patronal obligatorio al seguro o plan de salud. El seguro privado que se da como beneficio va a la 501200 (por confirmar). |
| 502200 | Pension Scheme | Plan de pensiones | Aportes patronales al fondo o plan de retiro. |
| 502300 | Accident Insurance | Seguro de accidentes | Prima del seguro de accidentes del personal. |
| 502400 | Disability | Invalidez | Prima o aporte por la cobertura de invalidez o incapacidad. |
| 502500 | Sick pay /maternity allowance | Subsidio por enfermedad o maternidad | Primas y pagos por licencia de enfermedad o maternidad. Los reintegros del seguro se registran en la misma cuenta. |
| 502600 | Payroll tax | Impuesto sobre la nómina | Impuestos a cargo del empleador que se calculan sobre la nómina. |
| 502900 | Withholding charges PPSI - Ivory Coast | Retención PPSI (Costa de Marfil) | Retención propia de Costa de Marfil. No aplica a la oficina regional. |
| 502901 | Other social charges - Ivory Coast | Otras cargas sociales (Costa de Marfil) | Cargas sociales propias de Costa de Marfil. No aplica a la oficina regional. |

### Otros gastos de personal

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 503100 | Recruiting | Reclutamiento | Avisos de empleo, agencias de selección, evaluaciones y viajes de candidatos. |
| 503200 | Training | Capacitación | Cursos, certificaciones, seminarios e inscripciones del personal propio. La formación de árbitros y oficiales va a la 660000. |
| 503300 | FIBA Restaurant employees | Personal del restaurante de FIBA | Costo del personal del restaurante de la sede central. No aplica a la oficina regional. |
| 503400 | Other personnel expenses | Otros gastos de personal | Gastos del personal sin cuenta propia: exámenes médicos, uniformes, actividades internas, obsequios al personal. |
| 503900 | Apprentices tax - Ivory Coast | Impuesto de aprendizaje (Costa de Marfil) | Impuesto propio de Costa de Marfil. No aplica a la oficina regional. |
| 503901 | Contiuous professional education - Ivory Coast | Impuesto de formación profesional continua (Costa de Marfil) | Impuesto propio de Costa de Marfil. No aplica a la oficina regional. |
| 503902 | Other social chargeas - Ivory Coast | Otras cargas sociales (Costa de Marfil) | Cargas propias de Costa de Marfil. Tiene el mismo nombre que la 502901. No aplica a la oficina regional. |

## 2. Oficina, servicios e IT (610000 a 612300)

Lo que cuesta tener la oficina abierta y funcionando, sin relación con una
competencia en particular.

### Oficina

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 610000 | Rent | Alquiler | Alquiler de oficinas, depósitos y estacionamientos. |
| 610100 | Interco Rent and running building costs | Alquiler y gastos de edificio entre entidades | Alquiler y gastos de funcionamiento del edificio que cobra otra entidad de FIBA. |
| 610200 | Office & building maintenance | Mantenimiento de oficina y edificio | Limpieza, reparaciones, seguridad, jardinería y mantenimiento de aire acondicionado o ascensores. |
| 610300 | Office equipment / furniture | Equipamiento y mobiliario de oficina | Muebles y equipos que no son informáticos: sillas, escritorios, pizarras, electrodomésticos. |
| 610400 | Utilities | Servicios públicos | Electricidad, agua y gas. |
| 610500 | Leasing equipment | Leasing de equipos | Cuotas de leasing o alquiler de equipos, por ejemplo impresoras y fotocopiadoras. |
| 611000 | Telephone, internet, mail & courier | Teléfono, internet, correo y mensajería | Líneas fijas y móviles, internet de la oficina, correo postal y mensajería administrativa. |
| 611200 | Supplies, photocopies & printed materials | Insumos, fotocopias e impresos | Papelería, tóner, insumos de oficina e impresiones administrativas. |
| 611300 | Subscriptions | Suscripciones | Diarios, revistas, bases de datos y membresías de asociaciones. El software por suscripción va a la 612300. |
| 611400 | Cafeteria expenses | Gastos de cafetería | Café, agua, snacks y consumibles de la cocina de la oficina. |
| 611900 | Interco service fees | Servicios entre entidades | Servicios administrativos que factura otra entidad de FIBA: servicios compartidos, cargos de gestión. |

### IT

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 612100 | IT hardware & equipment | Hardware y equipos de IT | Computadoras, monitores, periféricos, celulares y equipos de red. |
| 612200 | IT maintenance & repairs | Mantenimiento y reparaciones de IT | Soporte técnico, reparaciones, contratos de mantenimiento y garantías extendidas. |
| 612300 | IT software & licenses | Software y licencias | Licencias y suscripciones de software de uso general: ofimática, diseño, videollamadas, antivirus. |

## 3. Administración, servicios profesionales e impuestos (622000 a 629900)

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 622000 | Insurances (non event related) | Seguros no vinculados a eventos | Seguros de la oficina: responsabilidad civil, contenido, vehículos. El seguro de una competencia va a la 648600. |
| 623100 | Consulting and other service fees (administrative) | Consultoría y otros servicios administrativos | Honorarios de consultores y proveedores de servicios administrativos: contabilidad externa, nómina, consultoría de gestión. |
| 623110 | Other consulting and services fees subject to PPSSI - Ivory Coast | Consultoría y servicios sujetos a PPSSI (Costa de Marfil) | Servicios con retención propia de Costa de Marfil. No aplica a la oficina regional. |
| 623200 | Interpreter and translation fees | Intérpretes y traducciones | Traducción de documentos e interpretación en reuniones. |
| 623300 | Meeting allowances | Dietas por reuniones | Asignaciones que se pagan a los miembros de órganos y comisiones por asistir a una reunión. |
| 624000 | Legal advice & professional services | Asesoría legal y servicios profesionales | Abogados, notarios, auditores y asesores fiscales. |
| 624200 | Trademark | Marcas | Registro, renovación y defensa de marcas y de propiedad intelectual. |
| 625000 | Donations & gifts | Donaciones y obsequios | Donaciones a terceros y obsequios institucionales. |
| 625001 | Donations & gifts non deductible - Germany (§37b) | Donaciones y obsequios no deducibles (Alemania) | Obsequios con tratamiento fiscal propio de Alemania. No aplica a la oficina regional. |
| 625200 | Miscellaneous & sundry expenses | Gastos varios | Gastos administrativos menores sin cuenta propia. Es el último recurso, no el primero. |
| 629000 | Non-recoverable VAT | IVA no recuperable | IVA o impuesto a las ventas pagado que no se puede recuperar. |
| 629900 | Other Taxes | Otros impuestos | Impuestos y tasas que no son sobre la nómina ni IVA: municipales, timbres, tasas. |

## 4. Viajes (630000 a 630901)

Gastos de viaje por su naturaleza: en qué se gastó, no para qué evento. Los
viajes de equipos, oficiales y proveedores de una competencia tienen cuentas
propias en la familia 648 (648250, 648400 y 648450).

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 630000 | Transport expenses | Transporte | Pasajes aéreos, tren, taxi, alquiler de auto, combustible, estacionamiento y peajes. |
| 630100 | Accommodation expenses | Alojamiento | Hotel y hospedaje en viajes de trabajo. |
| 630200 | Meal expenses | Comidas | Comidas durante un viaje y comidas de trabajo. |
| 630201 | Meal expenses non deductable | Comidas no deducibles | Comidas que la norma fiscal no permite deducir. Se usa solo si Finance lo indica. |
| 630202 | Meal expenses subject to tax | Comidas gravadas | Comidas que cuentan como beneficio gravado para el empleado. Se usa solo si Finance lo indica. |
| 630900 | Other travel expenses (Per diem, Entertainment, etc) | Otros gastos de viaje | Viáticos, visas, seguro de viaje, propinas y atenciones. |
| 630901 | Daily allowance subject to tax | Viático gravado | La parte del viático que supera el tope exento y tributa. Se usa solo si Finance lo indica. |

## 5. Marketing, derechos de medios y digital (640000 a 642300)

### Patrocinio y marketing

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 640000 | Sponsorship rights partners - core expenses | Socios de patrocinio: gastos base | Lo que cuesta cumplir un contrato de patrocinio: entrega de derechos, activaciones, hospitalidad, materiales para el patrocinador. |
| 640100 | Sponsorship rights partners - income share | Socios de patrocinio: participación en ingresos | La parte del ingreso de patrocinio que se le cede a un tercero (agencia, federación, organizador). |
| 640200 | Other marketing expenses | Otros gastos de marketing | Publicidad, merchandising, estudios de mercado y acciones de marca sin patrocinador. |
| 640300 | Interventions | Intervenciones | Servicios puntuales contratados para atender a un patrocinador (por confirmar). |

### Derechos de medios y audiovisual

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 641000 | Media rights partners - core expenses | Socios de derechos de medios: gastos base | Lo que cuesta cumplir un contrato de derechos de TV y medios: distribución de la señal, entrega de contenido. |
| 641010 | Media rights partners - interventions | Socios de derechos de medios: intervenciones | Servicios puntuales contratados para atender a un socio de medios (por confirmar). |
| 641100 | Media rights partners - income share | Socios de derechos de medios: participación en ingresos | La parte del ingreso de derechos de medios que se le cede a un tercero. |
| 641200 | Intercompany media right expenses | Derechos de medios entre entidades | Gastos de derechos de medios que factura otra entidad de FIBA. |
| 641201 | Intercompany media right expenses - Adjustment clause | Derechos de medios entre entidades: cláusula de ajuste | Ajustes posteriores al cargo de la 641200 según lo pactado entre las entidades (por confirmar). |
| 641300 | HB Costs - Interventions | Costos del host broadcaster: intervenciones | Costos de la emisora anfitriona de un evento (por confirmar). |
| 641400 | Audiovisual expenses | Gastos audiovisuales | Producción de TV y streaming: cámaras, unidad móvil, comentaristas, gráfica en pantalla, transmisión. |
| 641500 | Media Archiving | Archivo de medios | Almacenamiento, digitalización y catalogación de video y foto. |

### Digital

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 642000 | Website / Plateform | Sitio web y plataformas | Desarrollo y mantenimiento del sitio web y de las plataformas digitales hacia el público. |
| 642100 | Mobile App | Aplicación móvil | Desarrollo, soporte y mantenimiento de la aplicación móvil. |
| 642200 | Contents | Contenidos | Producción de contenido editorial y para redes: redactores, fotógrafos, videógrafos, editores, diseñadores. |
| 642300 | Promotions | Promociones | Pauta paga, impulso de publicaciones, campañas y concursos. |

## 6. Eventos y competencias (648000 a 648900)

Gastos que existen porque hay una competencia. Casi todo lo que hoy presupuesta
Competitions cae en esta familia.

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 648000 | Event organiser's fees | Honorarios del organizador | Pagos al comité organizador local o al anfitrión por organizar el evento. |
| 648100 | Branding, design and signage production | Branding, diseño y señalética | Identidad gráfica del evento, vallas publicitarias, stickers de piso, fondos de prensa y banners. |
| 648120 | Documentation & materials | Documentación y materiales | Manuales, acreditaciones, formularios e impresos del evento. |
| 648160 | Public Entertainment | Entretenimiento del público | Animación, mascota, música, shows de medio tiempo y ceremonias. |
| 648200 | Prize money / players involvement / Awards | Premios | Premios en dinero, trofeos, medallas, premios individuales y pagos por participación de jugadores. |
| 648250 | Teams travel expenses | Viajes de los equipos | Pasajes, alojamiento y transporte local de las delegaciones cuando los cubre FIBA. |
| 648300 | External providers on events fees | Honorarios de proveedores externos en eventos | Honorarios de quienes trabajan el evento sin ser oficiales ni empleados: coordinadores, operadores, estadísticos, personal médico. |
| 648350 | Officiating fees | Honorarios de oficiales | Honorarios de árbitros, comisionados, instructores de árbitros y oficiales de mesa. |
| 648400 | External providers on events - travel expenses | Viajes de proveedores externos en eventos | Pasajes, alojamiento y viáticos de quienes cobran por la 648300. |
| 648450 | Officiating teams - travel expenses | Viajes de oficiales | Pasajes, alojamiento y viáticos de quienes cobran por la 648350. |
| 648500 | Technology Applications | Aplicaciones tecnológicas | Software y sistemas de la competencia: estadísticas, repetición instantánea, acreditación, gestión de competencias. |
| 648510 | Infrastructure Hosting | Hosting de infraestructura | Servidores, nube y conectividad que sostienen esas aplicaciones. |
| 648600 | Insurances events & competitions related | Seguros de eventos y competencias | Pólizas contratadas para una competencia: responsabilidad civil del evento, cancelación, accidentes de participantes. |
| 648700 | Anti-Doping costs | Antidopaje | Controles, kits, oficiales de control, laboratorio y envío de muestras. |
| 648900 | Other event & competition expenses | Otros gastos de eventos y competencias | Gastos de la competencia sin cuenta propia. Probables: sorteo, visitas de inspección, envío de equipamiento, reuniones técnicas (por confirmar). |

## 7. Desarrollo deportivo y federaciones (660000 a 662600)

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 660000 | Officials development | Desarrollo de oficiales | Clínicas, cursos, licencias y material de formación para árbitros, comisionados, oficiales de mesa y estadísticos. |
| 661900 | Other Sport Initiatives | Otras iniciativas deportivas | Programas deportivos sin cuenta propia (por confirmar cuáles). |
| 662000 | National Federations development | Desarrollo de federaciones nacionales | Talleres, proyectos y asistencia técnica a las federaciones. |
| 662100 | International Transfers of Players - Redistribution Fees | Transferencias internacionales de jugadores: redistribución | La parte de los aranceles de transferencia internacional de jugadores que se reparte a las federaciones. |
| 662200 | Media rights redistribution to National Federations | Redistribución de derechos de medios a federaciones | La parte del ingreso de derechos de medios que se reparte a las federaciones. |
| 662210 | Solidarity funding to National Federations | Fondo de solidaridad para federaciones | Aportes de solidaridad a las federaciones. |
| 662300 | Youth Participation Fee | Aporte por participación juvenil | Pagos a las federaciones por participar en competencias juveniles (por confirmar). |
| 662310 | Youth Development Fund | Fondo de desarrollo juvenil | Aportes a programas de desarrollo de categorías juveniles. |
| 662600 | Equipment Allotment | Asignación de equipamiento | Equipamiento que se entrega a las federaciones: balones, tableros, pisos (por confirmar). |

## 8. Depreciaciones (680100 a 680999)

No reciben facturas. Las registra Finance al cierre, sobre los bienes que ya
están en el activo. Si compras un equipo, la factura va a su cuenta de compra
(por ejemplo 612100) o al activo, según el monto que defina Finance.

| Código | Nombre oficial | En español | Qué se imputa |
|---|---|---|---|
| 680100 | Depreciation Building | Depreciación de edificios | Depreciación del edificio propio. |
| 680200 | Depreciation Interior and exterior layout | Depreciación de instalaciones interiores y exteriores | Depreciación de obras y mejoras del edificio y sus exteriores. |
| 680300 | Depreciation Office Furniture | Depreciación de mobiliario de oficina | Depreciación de los muebles activados. |
| 680400 | Depreciation Office Machines | Depreciación de máquinas de oficina | Depreciación de las máquinas de oficina activadas. |
| 680500 | Depreciation Vehicles | Depreciación de vehículos | Depreciación de los vehículos propios. |
| 680600 | Depreciation IT Equipment | Depreciación de equipos de IT | Depreciación del hardware activado. |
| 680700 | Depreciation Basketball Artefacts / Collections | Depreciación de objetos y colecciones de básquet | Depreciación de piezas de colección y objetos históricos. |
| 680800 | Depreciation Software | Depreciación de software | Depreciación del software activado. |
| 680999 | Depreciation of low-value tangible assets | Depreciación de bienes de bajo valor | Bienes de bajo valor que se deprecian por completo en el año. |

## Dudas frecuentes

| Si el gasto es... | Va a | Y no a |
|---|---|---|
| Honorarios de un árbitro o un comisionado | 648350 | 623100, que es consultoría administrativa |
| El pasaje de ese árbitro | 648450 | 648350 ni 630000: honorarios y viaje van en cuentas separadas |
| Honorarios de un proveedor contratado para un evento | 648300 | 648350, que es solo para oficiales |
| El pasaje de ese proveedor | 648400 | 630000 |
| Un pasaje de trabajo fuera de un evento | 630000 | 648400 o 648450 |
| El seguro de una competencia | 648600 | 622000, que es el seguro de la oficina |
| El software de estadísticas de una competencia | 648500 | 612300, que es software de uso general |
| El servidor donde corre ese software | 648510 | 612200 |
| Una suscripción a un diario | 611300 | 612300 |
| Vallas, stickers de piso o banners de un evento | 648100 | 640200 |
| Producción de TV o streaming de un partido | 641400 | 648300 |
| Un fotógrafo para redes sociales | 642200 | 641400 |
| Un curso para un empleado | 503200 | 660000, que es formación de oficiales |
| Un freelancer que factura | 623100 o 648300 | 500020, que es personal temporal en nómina |
| La compra de una notebook | 612100 | 680600, que es su depreciación |

## Cuentas que no aplican a la oficina regional

Son cuentas de otras entidades de FIBA. Están en el plan porque es único para
toda la organización, pero un gasto de FIBA Americas no debería caer en ellas:

- Alemania: 501910, 501911, 502020 y 625001.
- Costa de Marfil: 502900, 502901, 503900, 503901, 503902 y 623110.
- Sede central: 503300 (personal del restaurante).

Las cuentas "entre entidades" (500900, 610100, 611900, 641200 y 641201) se usan
solo cuando la contraparte es otra entidad de FIBA.

## Por confirmar con Finance

El nombre de estas cuentas no alcanza para definirlas con seguridad:

- 501000: si es la asignación fija del directivo o también gastos de atención.
- 502100 y 501200: qué seguro de salud va a cada una.
- 640300, 641010 y 641300: qué significa "interventions" en cada caso, y si "HB"
  es host broadcaster.
- 641201: cómo se usa la cláusula de ajuste.
- 648900: qué gastos de competencia van aquí (sorteo, inspecciones, envíos).
- 661900: qué programas cuenta como "otras iniciativas deportivas".
- 662300 y 662600: el alcance de cada una.
- Honorarios y viajes del TD, del VGO y del Video Operator: si van como
  oficiales (648350 y 648450) o como proveedores externos (648300 y 648400).
- Viajes del personal de FIBA a una competencia: si van a la familia 630 o a
  la 648.
- Envío de equipamiento a una sede: si va a 611000 (mensajería) o a 648900.

## Qué hay cargado hoy en Presupuesto

Las 112 cuentas están en el plan de cuentas de Presupuesto (Presupuesto >
Cuentas). Las 11 de otras entidades de FIBA están inactivas: figuran en el
plan, pero no aparecen al cargar un gasto.

Las líneas de Competitions (COMP-01 a COMP-30), de Comms (COMM-01 a COMM-28) y
de ingresos (REV-01 a REV-05) siguen con códigos provisorios. Lo presupuestado
sigue en esos códigos, así que un gasto cargado en una cuenta oficial todavía
no se compara con su presupuesto en el reporte por cuenta.
