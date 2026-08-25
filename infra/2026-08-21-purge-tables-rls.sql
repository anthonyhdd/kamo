-- RLS ON THE TWO BLACK-SLAB PURGE TABLES — NOT APPLIED, see the note at the bottom.
--
-- WHAT IS EXPOSED. Supabase's advisor flags both tables created by
-- infra/2026-08-20-black-slab-purge.sql:
--
--   black_slab_purge_2026_08_20         (328 rows)
--   black_slab_purge_nolqip_2026_08_20  (106 rows)
--
-- with Row Level Security DISABLED. Every other table in this project has it on. The anon
-- key ships inside index.html — it is public by design, it is in every user's browser — so
-- a table without RLS is readable AND writable by anyone who opens the page and reads the
-- source. On these two that means the purge record itself: the list of hide ids that were
-- pulled from the feed, which anyone could read, empty, or fill with rows that were never
-- purged.
--
-- WHY IT IS SAFE TO CLOSE. Nothing outside this directory touches them. `grep
-- black_slab_purge index.html` is empty, and the only references anywhere are the queries in
-- 2026-08-20-black-slab-purge.sql, which are run from the dashboard. The dashboard's SQL
-- editor and the service role BYPASS RLS entirely, so enabling it with no policies at all is
-- exactly right here: it removes anon and authenticated, and leaves the only access path that
-- was ever used working unchanged. That is also why there are no `create policy` lines below
-- — a policy would be granting access nobody needs.
--
-- THE RECORD THEY HOLD IS WORTH KEEPING. These are not scratch tables: 2026-08-20's purge
-- reads back from them (`update hides set is_public=false where id in (select id from …)`),
-- and they are the only account of which hides were pulled and why. Dropping them would close
-- the same hole and lose that, so this enables RLS rather than tidying them away.

alter table public.black_slab_purge_2026_08_20 enable row level security;
alter table public.black_slab_purge_nolqip_2026_08_20 enable row level security;

-- Rollback, if anything turns out to have been reading them through the anon key:
--   alter table public.black_slab_purge_2026_08_20 disable row level security;
--   alter table public.black_slab_purge_nolqip_2026_08_20 disable row level security;

-- ⚠️ NOT APPLIED BY THE AGENT THAT WROTE THIS FILE, ON PURPOSE, AND IT IS ONE PASTE AWAY.
-- Two reasons, and they point the same way. This session was told not to run database
-- migrations, and Supabase's own advisory says to present this SQL rather than auto-apply it
-- — enabling RLS with no policies is correct here and is exactly the shape of change that is
-- catastrophic on the wrong table. The house process is the dashboard anyway: CLAUDE.md says
-- schema changes are applied there and mirrored into this directory as a dated file, which is
-- what this is. Paste the two ALTERs into the SQL editor and the advisory clears.
