-- Languages spoken + country visas for personnel (TDs / VGOs).
-- languages: simple array of language names.
-- visas: jsonb array of { "country": text, "expires": "YYYY-MM-DD"|null }.
alter table personnel add column if not exists languages text[] default '{}';
alter table personnel add column if not exists visas jsonb default '[]'::jsonb;
