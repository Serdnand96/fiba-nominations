-- Extra official slot per game.
--
-- Some venues carry one additional table official beyond the standard crew.
-- The EXTRA slot is optional (one per game, like the rest) and accepts
-- personnel of role TD or VGO — the app validates which; the nomination sync
-- and the letters resolve fees/templates from the person's real role.

ALTER TABLE game_assignments DROP CONSTRAINT IF EXISTS game_assignments_role_check;
ALTER TABLE game_assignments ADD CONSTRAINT game_assignments_role_check
    CHECK (role IN ('TD', 'VGO', 'CC', 'U1', 'U2', 'INSTR', 'VO', 'EXTRA'));
