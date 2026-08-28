-- Dos tipos de competencia nuevos: 'Zonal' y 'WC'. Y limpieza de 'Other'.
--
-- El problema: 'Other' se había convertido en un cajón de sastre de 12 de las
-- 74 competencias — el segundo grupo más grande después de U-Series. Adentro
-- convivían el Mundial de mayores, una liga juvenil de clubes, los Juegos
-- Panamericanos y una ventana del calendario FIBA. Como en Calendar.jsx la
-- barra de filtros sale de COMP_TYPES y 'Other' no estaba ahí, esas 12 no se
-- podían aislar y se pintaban todas con el gris de fallback.
--
-- Al revisarlas contra cómo estaba clasificado el resto, 7 de las 12 estaban
-- mal puestas, y lo demuestran los precedentes que ya había en la tabla:
--
--   * 'FIBA Pre-OQT' → WCQ
--     'FIBA Women's Olympic Pre-Qualifying Tournament' ya era WCQ. Es lo mismo
--     —pre-clasificatorio olímpico— y quedó afuera solo por estar cargado con
--     el nombre abreviado.
--
--   * Los dos U20 de Juegos multideportivos → U-Series
--     U-Series ya contenía 'South American U17 Women's Championship' y 'FIBA
--     Centrobasket U15 & U17', que son la misma forma: juvenil de selecciones
--     bajo un ente zonal. Y en U-Series la categoría de edad ya le gana al
--     formato: los Mundiales U17 y U19 están ahí, no en 'Other'.
--
--   * Las 4 zonales femeninas de mayores → 'Zonal' (tipo nuevo)
--     Centrobasket, Sudamericano, CBC y COCABA. No entran en AmeriCup —no son
--     su clasificatorio— pero tampoco son misceláneas: son una familia propia
--     de campeonatos de zona. A futuro este tipo también recibe a los
--     masculinos equivalentes.
--
--   * Los 2 Mundiales de mayores → 'WC' (tipo nuevo)
--     WCQ significa Qualifiers, así que el Mundial en sí no puede ir ahí. Son
--     los dos eventos más grandes del calendario y estaban en el mismo cajón
--     que una ventana FIBA.
--
-- Quedan 3 en 'Other', que ahora sí es un grupo chico y honesto: YBCL-A (la
-- única de las 12 con is_national_team = false: es de clubes), la
-- 'International Window for Women's Basketball' (que no es una competencia
-- sino una ventana) y los Juegos Panamericanos.
--
-- OJO: el CHECK de competition_type hay que extenderlo ANTES de que corra el
-- código que ofrece los tipos nuevos, igual que las migraciones de Budget.
-- Se conserva '3x3', que ya estaba permitido aunque no lo use ninguna fila.

-- 1) Extender el CHECK con los dos tipos nuevos.
alter table competitions drop constraint if exists competitions_competition_type_check;

alter table competitions add constraint competitions_competition_type_check
  check (
    competition_type is null
    or competition_type = any (array[
      'WCQ', 'BCLA', 'LSB', 'LSBF', 'WBLA', 'AmeriCup',
      'U-Series', '3x3', 'Zonal', 'WC', 'Other'
    ])
  );

-- 2) Reclasificar las 7 que estaban mal. Por nombre y año: son filas puntuales
--    y un UPDATE por patrón podría llevarse puesta una competencia futura.
update competitions set competition_type = 'WCQ'
 where name = 'FIBA Pre-OQT' and year = 2027;

update competitions set competition_type = 'U-Series'
 where name in (
   'Central American & Caribbean Games – Basketball U20',
   'Odesur Games – Basketball U20'
 );

update competitions set competition_type = 'Zonal'
 where name in (
   'FIBA Women''s Centrobasket Championship',
   'South American Women''s Championship',
   'CBC Women''s Championship',
   'COCABA Women''s Championship'
 );

update competitions set competition_type = 'WC'
 where name in (
   'FIBA Women''s Basketball WC 2026',
   'FIBA Basketball WC 2027'
 );
