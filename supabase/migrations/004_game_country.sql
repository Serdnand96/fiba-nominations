-- Add `country` to game_schedule so nominations can render
-- "City, Country" on the WCQ letter from the games connected to the
-- competition. The FIBA GDAP API does not always return country, so this
-- starts null and can be populated by sync (when available) or by the user
-- editing the game.

ALTER TABLE game_schedule
    ADD COLUMN IF NOT EXISTS country text;
