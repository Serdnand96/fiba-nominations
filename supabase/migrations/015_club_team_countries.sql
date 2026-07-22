-- Club competitions: referee neutrality is weaker — a referee only cannot
-- work games where a club FROM THEIR COUNTRY plays (no group restriction).
--
-- Club team codes ("FLA", "BOC") are not country codes and the FIBA GDAP
-- games API does not expose the club's country, so we store it per game side.
-- The Games page has a "team countries" panel that fills these for every
-- game of a competition in one pass.

ALTER TABLE game_schedule
    ADD COLUMN IF NOT EXISTS team_a_country text,
    ADD COLUMN IF NOT EXISTS team_b_country text;

-- Data fix (applied 2026-07-22): GENERIC competitions that are actually
-- national-team events get the neutrality flag. Club events (BCLA*, LSB*,
-- WBLA, YBCL-A, 3x3 Pro-Circuit / World Tour / Champions Cup / Lite Quest)
-- stay false. On a fresh DB this matches nothing and is a no-op.
UPDATE competitions SET is_national_team = true
WHERE is_national_team = false AND (
  name ILIKE '%americup%' OR
  name ILIKE '%centrobasket%' OR
  name ILIKE '%basketball wc%' OR
  name ILIKE '%world cup%' OR
  name ILIKE '%nations league%' OR
  name ILIKE '%women''s series%' OR
  name ILIKE '%pan-american games%' OR
  name ILIKE '%odesur%' OR
  name ILIKE '%central american & caribbean games%' OR
  name ILIKE '%juegos sudamericanos%' OR
  name ILIKE '%south american women%' OR
  name ILIKE 'cbc women%' OR
  name ILIKE 'cocaba women%' OR
  name ILIKE '%pre-oqt%' OR
  name ILIKE '%olympic%' OR
  name ILIKE 'international window%' OR
  name ILIKE 'caribbean 3x3 u23%'
);
