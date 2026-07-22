-- Referee nominations with neutrality restriction (national team events).
--
-- 1. competitions.is_national_team — flags events where the neutrality rule
--    applies (a referee cannot work games of their own country, nor any game
--    of the group their country plays in). Pre-set for WCQ.
-- 2. personnel.country_code — FIBA country code (COL, ARG, USA…) so the
--    check can match reliably against game_schedule.team_a_code/team_b_code
--    instead of comparing free-text names.
-- 3. game_assignments gains the three per-game referee slots:
--    CC = Crew Chief, U1 = Umpire 1, U2 = Umpire 2.

ALTER TABLE competitions
    ADD COLUMN IF NOT EXISTS is_national_team boolean NOT NULL DEFAULT false;

UPDATE competitions SET is_national_team = true WHERE template_key = 'WCQ';

ALTER TABLE personnel
    ADD COLUMN IF NOT EXISTS country_code text;

ALTER TABLE game_assignments DROP CONSTRAINT IF EXISTS game_assignments_role_check;
ALTER TABLE game_assignments ADD CONSTRAINT game_assignments_role_check
    CHECK (role IN ('TD', 'VGO', 'CC', 'U1', 'U2'));

-- Backfill country_code from the free-text country column for the common
-- spellings already in the table (ES + EN). Unmatched rows stay NULL and the
-- neutrality check falls back to normalized name matching.
UPDATE personnel p SET country_code = m.code
FROM (VALUES
    ('argentina', 'ARG'), ('aruba', 'ARU'), ('bahamas', 'BAH'),
    ('barbados', 'BAR'), ('belice', 'BIZ'), ('belize', 'BIZ'),
    ('bermuda', 'BER'), ('bermudas', 'BER'),
    ('bolivia', 'BOL'), ('brasil', 'BRA'), ('brazil', 'BRA'),
    ('canada', 'CAN'), ('canadá', 'CAN'),
    ('chile', 'CHI'), ('colombia', 'COL'),
    ('costa rica', 'CRC'), ('cuba', 'CUB'), ('dominica', 'DMA'),
    ('republica dominicana', 'DOM'), ('república dominicana', 'DOM'),
    ('dominican republic', 'DOM'),
    ('ecuador', 'ECU'), ('el salvador', 'ESA'), ('granada', 'GRN'),
    ('grenada', 'GRN'), ('guatemala', 'GUA'), ('guyana', 'GUY'),
    ('haiti', 'HAI'), ('haití', 'HAI'), ('honduras', 'HON'),
    ('islas virgenes britanicas', 'IVB'), ('british virgin islands', 'IVB'),
    ('islas virgenes', 'ISV'), ('us virgin islands', 'ISV'),
    ('jamaica', 'JAM'), ('mexico', 'MEX'), ('méxico', 'MEX'),
    ('nicaragua', 'NCA'), ('panama', 'PAN'), ('panamá', 'PAN'),
    ('paraguay', 'PAR'), ('peru', 'PER'), ('perú', 'PER'),
    ('puerto rico', 'PUR'), ('surinam', 'SUR'), ('suriname', 'SUR'),
    ('trinidad y tobago', 'TTO'), ('trinidad and tobago', 'TTO'),
    ('estados unidos', 'USA'), ('united states', 'USA'), ('usa', 'USA'),
    ('uruguay', 'URU'), ('venezuela', 'VEN')
) AS m(name, code)
WHERE p.country_code IS NULL
  AND lower(trim(p.country)) = m.name;

-- Rows where the free-text country already holds a FIBA code ("ARG", "COL"…)
UPDATE personnel SET country_code = upper(trim(country))
WHERE country_code IS NULL
  AND upper(trim(country)) IN (
    'ARG','ARU','BAH','BAR','BIZ','BER','BOL','BRA','IVB','CAN','CAY','CHI',
    'COL','CRC','CUB','DMA','DOM','ECU','ESA','GRN','GUA','GUY','HAI','HON',
    'JAM','MEX','NCA','PAN','PAR','PER','PUR','SKN','LCA','VIN','SUR','TTO',
    'TCA','USA','ISV','URU','VEN');
