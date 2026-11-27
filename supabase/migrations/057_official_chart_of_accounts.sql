-- 057_official_chart_of_accounts.sql: plan de cuentas oficial de Finance.
--
-- Finance entregó el plan de cuentas de gasto (`Chart Of Accounts.xlsx`, 112
-- cuentas, 500000 a 680999). Hasta ahora `accounts` tenía solo 9 de esos
-- códigos (los de IT y 648500); el resto de las líneas vive en los provisorios
-- COMP-*, COMM-* y REV-*. Esta migración carga las 103 que faltaban para que un
-- gasto se pueda imputar a su cuenta real, que es como llega en el ledger.
--
-- Qué hace:
--
--   * Inserta las cuentas nuevas con `pending_mapping = false` (son oficiales)
--     y `kind = 'expense'`. El label es el nombre de Finance con los espacios
--     limpios y cinco errores de tipeo corregidos (Fronge, Contiuous, chargeas,
--     Plateform, deductable).
--   * 11 entran `active = false`: son cuentas de otras entidades de FIBA
--     (Alemania, Costa de Marfil y el restaurante de la sede central). Quedan
--     en el plan, no aparecen en los selectores y un gasto no se les puede
--     imputar hasta que alguien las active desde Presupuesto > Cuentas.
--   * Deja las 112 en orden de código (`sort` 1010 a 2120, de a 10). Para las 9
--     que ya existían es lo único que cambia: label, escalación y estado quedan
--     como estaban.
--
-- Qué NO hace:
--
--   * No toca los provisorios ni mueve nada de lo ya cargado. Las líneas de
--     presupuesto siguen en COMP-* y COMM-*.
--   * No resuelve el pase de provisorio a oficial. "Asignar código oficial"
--     (`POST /budget/accounts/{code}/remap`) renombra la PK y responde 409 si
--     el código destino ya existe, así que NO sirve para llevar un COMP-* a
--     una de estas cuentas. Tampoco servía para el caso real: varias líneas
--     provisorias caen en la misma cuenta oficial (vallas y stickers de piso
--     van las dos a 648100). Hace falta una fusión, no un renombre.
--   * No toca `api/_lib/budget_accounts.py`: los pagos a oficiales se siguen
--     imputando a COMP-07..14 y COMP-29/30.
--
-- Mientras dure la convivencia, lo presupuestado en un provisorio y lo
-- ejecutado en su cuenta oficial salen en filas separadas del reporte por
-- cuenta.
--
-- NO forma parte del deploy automático: se aplica a mano contra Supabase. Es
-- solo datos, ningún código depende de ella. Idempotente.

begin;

INSERT INTO accounts (code, label, active, sort, notes) VALUES
    ('500000', 'Gross salaries'                                                   , true , 1010, NULL),
    ('500010', 'Foreign gross salaries'                                           , true , 1020, NULL),
    ('500020', 'Gross salaries - temporary workers'                               , true , 1030, NULL),
    ('500200', 'Bonus'                                                            , true , 1040, NULL),
    ('500300', 'Untaken holidays'                                                 , true , 1050, NULL),
    ('500900', 'Interco salaries recharged'                                       , true , 1060, NULL),
    ('501000', 'Representation Expenses'                                          , true , 1070, NULL),
    ('501100', 'Car Allowance / car leasing'                                      , true , 1080, NULL),
    ('501200', 'Health insurance - Fringe benefits'                               , true , 1090, NULL),
    ('501900', 'Various fringe benefits'                                          , true , 1100, NULL),
    ('501910', 'Various fringe benefits subject to German tax'                    , false, 1110, 'Cuenta de otra entidad de FIBA (Alemania). No aplica a la oficina regional.'),
    ('501911', 'Various fringe benefits tax free (Company events) - Germany'      , false, 1120, 'Cuenta de otra entidad de FIBA (Alemania). No aplica a la oficina regional.'),
    ('502000', 'Social Security & Unemployment'                                   , true , 1130, NULL),
    ('502010', 'Foreign Social Charges'                                           , true , 1140, NULL),
    ('502020', 'Lump-sum tax temporary workers (Germany)'                         , false, 1150, 'Cuenta de otra entidad de FIBA (Alemania). No aplica a la oficina regional.'),
    ('502100', 'Health Insurance Allocation'                                      , true , 1160, NULL),
    ('502200', 'Pension Scheme'                                                   , true , 1170, NULL),
    ('502300', 'Accident Insurance'                                               , true , 1180, NULL),
    ('502400', 'Disability'                                                       , true , 1190, NULL),
    ('502500', 'Sick pay / maternity allowance'                                   , true , 1200, NULL),
    ('502600', 'Payroll tax'                                                      , true , 1210, NULL),
    ('502900', 'Withholding charges PPSI - Ivory Coast'                           , false, 1220, 'Cuenta de otra entidad de FIBA (Costa de Marfil). No aplica a la oficina regional.'),
    ('502901', 'Other social charges - Ivory Coast'                               , false, 1230, 'Cuenta de otra entidad de FIBA (Costa de Marfil). No aplica a la oficina regional.'),
    ('503100', 'Recruiting'                                                       , true , 1240, NULL),
    ('503200', 'Training'                                                         , true , 1250, NULL),
    ('503300', 'FIBA Restaurant employees'                                        , false, 1260, 'Cuenta de otra entidad de FIBA (sede central). No aplica a la oficina regional.'),
    ('503400', 'Other personnel expenses'                                         , true , 1270, NULL),
    ('503900', 'Apprentices tax - Ivory Coast'                                    , false, 1280, 'Cuenta de otra entidad de FIBA (Costa de Marfil). No aplica a la oficina regional.'),
    ('503901', 'Continuous professional education - Ivory Coast'                  , false, 1290, 'Cuenta de otra entidad de FIBA (Costa de Marfil). No aplica a la oficina regional.'),
    ('503902', 'Other social charges - Ivory Coast'                               , false, 1300, 'Cuenta de otra entidad de FIBA (Costa de Marfil). No aplica a la oficina regional.'),
    ('610000', 'Rent'                                                             , true , 1310, NULL),
    ('610100', 'Interco Rent and running building costs'                          , true , 1320, NULL),
    ('610200', 'Office & building maintenance'                                    , true , 1330, NULL),
    ('610300', 'Office equipment / furniture'                                     , true , 1340, NULL),
    ('610400', 'Utilities'                                                        , true , 1350, NULL),
    ('610500', 'Leasing equipment'                                                , true , 1360, NULL),
    ('611000', 'Telephone, internet, mail & courier'                              , true , 1370, NULL),
    ('611200', 'Supplies, photocopies & printed materials'                        , true , 1380, NULL),
    ('611300', 'Subscriptions'                                                    , true , 1390, NULL),
    ('611400', 'Cafeteria expenses'                                               , true , 1400, NULL),
    ('611900', 'Interco service fees'                                             , true , 1410, NULL),
    ('612100', 'IT hardware & equipment'                                          , true , 1420, NULL),
    ('612200', 'IT maintenance & repairs'                                         , true , 1430, NULL),
    ('612300', 'IT software & licenses'                                           , true , 1440, NULL),
    ('622000', 'Insurances (non event related)'                                   , true , 1450, NULL),
    ('623100', 'Consulting and other service fees (administrative)'               , true , 1460, NULL),
    ('623110', 'Other consulting and services fees subject to PPSSI - Ivory Coast', false, 1470, 'Cuenta de otra entidad de FIBA (Costa de Marfil). No aplica a la oficina regional.'),
    ('623200', 'Interpreter and translation fees'                                 , true , 1480, NULL),
    ('623300', 'Meeting allowances'                                               , true , 1490, NULL),
    ('624000', 'Legal advice & professional services'                             , true , 1500, NULL),
    ('624200', 'Trademark'                                                        , true , 1510, NULL),
    ('625000', 'Donations & gifts'                                                , true , 1520, NULL),
    ('625001', 'Donations & gifts non deductible - Germany (§37b)'                , false, 1530, 'Cuenta de otra entidad de FIBA (Alemania). No aplica a la oficina regional.'),
    ('625200', 'Miscellaneous & sundry expenses'                                  , true , 1540, NULL),
    ('629000', 'Non-recoverable VAT'                                              , true , 1550, NULL),
    ('629900', 'Other Taxes'                                                      , true , 1560, NULL),
    ('630000', 'Transport expenses'                                               , true , 1570, NULL),
    ('630100', 'Accommodation expenses'                                           , true , 1580, NULL),
    ('630200', 'Meal expenses'                                                    , true , 1590, NULL),
    ('630201', 'Meal expenses non deductible'                                     , true , 1600, NULL),
    ('630202', 'Meal expenses subject to tax'                                     , true , 1610, NULL),
    ('630900', 'Other travel expenses (Per diem, Entertainment, etc)'             , true , 1620, NULL),
    ('630901', 'Daily allowance subject to tax'                                   , true , 1630, NULL),
    ('640000', 'Sponsorship rights partners - core expenses'                      , true , 1640, NULL),
    ('640100', 'Sponsorship rights partners - income share'                       , true , 1650, NULL),
    ('640200', 'Other marketing expenses'                                         , true , 1660, NULL),
    ('640300', 'Interventions'                                                    , true , 1670, NULL),
    ('641000', 'Media rights partners - core expenses'                            , true , 1680, NULL),
    ('641010', 'Media rights partners - interventions'                            , true , 1690, NULL),
    ('641100', 'Media rights partners - income share'                             , true , 1700, NULL),
    ('641200', 'Intercompany media right expenses'                                , true , 1710, NULL),
    ('641201', 'Intercompany media right expenses - Adjustment clause'            , true , 1720, NULL),
    ('641300', 'HB Costs - Interventions'                                         , true , 1730, NULL),
    ('641400', 'Audiovisual expenses'                                             , true , 1740, NULL),
    ('641500', 'Media Archiving'                                                  , true , 1750, NULL),
    ('642000', 'Website / Platform'                                               , true , 1760, NULL),
    ('642100', 'Mobile App'                                                       , true , 1770, NULL),
    ('642200', 'Contents'                                                         , true , 1780, NULL),
    ('642300', 'Promotions'                                                       , true , 1790, NULL),
    ('648000', 'Event organiser''s fees'                                          , true , 1800, NULL),
    ('648100', 'Branding, design and signage production'                          , true , 1810, NULL),
    ('648120', 'Documentation & materials'                                        , true , 1820, NULL),
    ('648160', 'Public Entertainment'                                             , true , 1830, NULL),
    ('648200', 'Prize money / players involvement / Awards'                       , true , 1840, NULL),
    ('648250', 'Teams travel expenses'                                            , true , 1850, NULL),
    ('648300', 'External providers on events fees'                                , true , 1860, NULL),
    ('648350', 'Officiating fees'                                                 , true , 1870, NULL),
    ('648400', 'External providers on events - travel expenses'                   , true , 1880, NULL),
    ('648450', 'Officiating teams - travel expenses'                              , true , 1890, NULL),
    ('648500', 'Technology Applications'                                          , true , 1900, NULL),
    ('648510', 'Infrastructure Hosting'                                           , true , 1910, NULL),
    ('648600', 'Insurances events & competitions related'                         , true , 1920, NULL),
    ('648700', 'Anti-Doping costs'                                                , true , 1930, NULL),
    ('648900', 'Other event & competition expenses'                               , true , 1940, NULL),
    ('660000', 'Officials development'                                            , true , 1950, NULL),
    ('661900', 'Other Sport Initiatives'                                          , true , 1960, NULL),
    ('662000', 'National Federations development'                                 , true , 1970, NULL),
    ('662100', 'International Transfers of Players - Redistribution Fees'         , true , 1980, NULL),
    ('662200', 'Media rights redistribution to National Federations'              , true , 1990, NULL),
    ('662210', 'Solidarity funding to National Federations'                       , true , 2000, NULL),
    ('662300', 'Youth Participation Fee'                                          , true , 2010, NULL),
    ('662310', 'Youth Development Fund'                                           , true , 2020, NULL),
    ('662600', 'Equipment Allotment'                                              , true , 2030, NULL),
    ('680100', 'Depreciation Building'                                            , true , 2040, NULL),
    ('680200', 'Depreciation Interior and exterior layout'                        , true , 2050, NULL),
    ('680300', 'Depreciation Office Furniture'                                    , true , 2060, NULL),
    ('680400', 'Depreciation Office Machines'                                     , true , 2070, NULL),
    ('680500', 'Depreciation Vehicles'                                            , true , 2080, NULL),
    ('680600', 'Depreciation IT Equipment'                                        , true , 2090, NULL),
    ('680700', 'Depreciation Basketball Artefacts / Collections'                  , true , 2100, NULL),
    ('680800', 'Depreciation Software'                                            , true , 2110, NULL),
    ('680999', 'Depreciation of low-value tangible assets'                        , true , 2120, NULL)
ON CONFLICT (code) DO UPDATE SET sort = EXCLUDED.sort;

commit;
