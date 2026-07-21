-- Letter template types that can be created from the UI, for events that
-- don't map onto the four built-in ones (WCQ, BCLA, LSB, GENERIC).
--
-- A custom type is just a name plus two choices: which letter *shape* it uses
-- (nomination or confirmation, which picks the context the generator builds)
-- and who signs it. Its .docx is not in the repo — it is uploaded through the
-- Templates page and stored in Supabase Storage like any other uploaded
-- template.
create table if not exists letter_templates (
    key              text primary key,
    label            text not null,
    -- 'nomination' renders the WCQ/GENERIC shape, 'confirmation' the LSB one.
    kind             text not null check (kind in ('nomination', 'confirmation')),
    signatory_name   text not null default '',
    signatory_title  text not null default '',
    signatory_org    text not null default '',
    created_at       timestamptz not null default now()
);

-- Keys are used as storage paths and as competitions.template_key, so keep
-- them to a safe, predictable shape.
alter table letter_templates drop constraint if exists letter_templates_key_format;
alter table letter_templates add constraint letter_templates_key_format
    check (key ~ '^[A-Z][A-Z0-9_]{1,31}$');

alter table letter_templates enable row level security;

-- Same posture as the rest of the schema: the API reaches this table with the
-- service_role key, anon/authenticated clients get nothing directly.
drop policy if exists "letter_templates service only" on letter_templates;
create policy "letter_templates service only" on letter_templates
    for all to service_role using (true) with check (true);
