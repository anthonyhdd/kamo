-- ═══ THE ALARM STOPS BEING SHAPED LIKE ONE VENDOR ══════════════════════════════════════════
--
-- Applied 2026-08-27. Follows infra/2026-08-26-photo-probe.sql, which is still the file that
-- explains WHY the probe exists, what its thresholds are and how they were backtested. This one
-- only changes where it shouts.
--
-- WHAT WAS WRONG. The first version sent a body with one text key: `content`. That is Discord's
-- field name, chosen because CLAUDE.md's accounts table still lists a Discord invite — and it
-- was the wrong reason, twice over:
--
--   · THE INVITE IS STALE. The in-app Discord button was removed on 2026-08-12 (founder's call:
--     "10 taps ... a player who came looking for their results"), DISCORD_URL survives only as
--     a dead constant, and `discord_opened` has read 0 since 08-17. The founder's answer when
--     asked for a webhook was "on a plus rien avec Discord non??", and he was right.
--   · AND EVEN IF IT WERE LIVE, baking a vendor's field name into an ops alarm means the
--     destination has to be decided before the alarm can work at all. This one sat silent for a
--     day and a half for exactly that reason, raising WARNINGs into a Postgres log nobody reads.
--
-- WHAT IT IS NOW. The same sentence under three keys, so the body satisfies whatever it is
-- pointed at without a code change:
--
--     content  -> Discord            text -> Slack, Mattermost
--     message  -> ntfy, Pushover     plus title/priority/tags, and the numbers underneath for
--                                    anything that parses rather than prints
--
-- Plus `webhook_extra`, a jsonb merged into the body. ntfy wants `topic` in the payload when
-- posting to its root endpoint and it will not be the last provider to want a field this
-- function has never heard of. Merged FIRST so it can never shadow pct/photoless/hides.
--
-- ⚠️ THE TOPIC IS NOT IN THIS FILE, AND MUST NOT BE. This repo is served by GitHub Pages and is
-- public. An ntfy topic is a bearer secret in URL form: anyone who knows the name reads the
-- feed. The live value was set straight against the database and is deliberately absent here.
-- The alert body carries only percentages and counts -- no user, no hide id, no handle -- so the
-- worst case of a leaked topic is a stranger learning that uploads are broken.

begin;

-- ── the escape hatch for fields this function does not know about ───────────────────────────
alter table public.ops_photo_probe_config
  add column if not exists webhook_extra jsonb not null default '{}'::jsonb;

-- ── the probe, unchanged except for the body it posts ───────────────────────────────────────
create or replace function public.probe_photo_health()
returns public.ops_photo_probe
language plpgsql
security definer
set search_path = public, storage, extensions
as $$
declare
  c public.ops_photo_probe_config;
  r public.ops_photo_probe;
  v_start timestamptz; v_end timestamptz;
  v_hides integer; v_less integer; v_pct numeric;
  v_breach boolean; v_recent boolean; v_send boolean := false;
  v_err text := null;
  v_msg text;
begin
  select * into c from public.ops_photo_probe_config;
  if c is null or not c.enabled then return null; end if;

  v_end   := now() - make_interval(mins => c.lag_minutes);
  v_start := v_end - make_interval(hours => c.window_hours);

  -- `source is not null` excludes the harness. See the 08-26 file: the DOM suites publish
  -- against the live database, and without this line the floor is 2-6% instead of under 1%.
  select count(*),
         count(*) filter (
           where not exists (select 1 from storage.objects o
                             where o.bucket_id = 'hides' and o.name = h.img_path))
    into v_hides, v_less
    from public.hides h
   where h.created_at >= v_start and h.created_at < v_end
     and h.source is not null;

  v_pct := case when v_hides > 0 then round(100.0 * v_less / v_hides, 1) else null end;
  v_breach := v_hides >= c.min_hides
          and v_less  >= c.min_photoless
          and coalesce(v_pct, 0) >= c.pct_threshold;

  -- One alert per incident. 08-21 would have breached seventeen windows in a row, and a channel
  -- that says the same thing seventeen times gets muted.
  select exists (select 1 from public.ops_photo_probe p
                  where p.alerted and p.ran_at > now() - make_interval(hours => c.cooldown_hours))
    into v_recent;
  v_send := v_breach and not v_recent;

  if v_send then
    v_msg := format('%s%% of hides have no photo behind them (%s of %s, %s → %s UTC). '
                    || 'Normal is under 1%%. Last time this happened the anon role had lost its '
                    || 'upload path and it ran for 15 hours.',
                    v_pct, v_less, v_hides,
                    to_char(v_start at time zone 'UTC','MM-DD HH24:MI'),
                    to_char(v_end   at time zone 'UTC','HH24:MI'));
    -- The measurement must survive the messenger: a 404, a full pg_net queue or a typo in the
    -- URL may not cost the row that records what was actually seen.
    begin
      if c.webhook_url <> '' then
        perform net.http_post(
          url     := c.webhook_url,
          headers := jsonb_build_object('Content-Type','application/json'),
          body    := coalesce(c.webhook_extra,'{}'::jsonb) || jsonb_build_object(
                       'content',   'KAMO · ' || v_msg,
                       'text',      'KAMO · ' || v_msg,
                       'message',   v_msg,
                       'title',     'KAMO · hides with no photo',
                       'priority',  4,
                       'tags',      jsonb_build_array('rotating_light'),
                       'probe',     'photo_health',
                       'pct',       v_pct,
                       'photoless', v_less,
                       'hides',     v_hides,
                       'win_start', v_start,
                       'win_end',   v_end));
      else
        raise warning 'KAMO · %', v_msg;
      end if;
    exception when others then
      v_err := left(SQLERRM, 300);
      v_send := false;
    end;
  end if;

  insert into public.ops_photo_probe (win_start, win_end, hides, photoless, pct, breached, alerted, alert_error)
  values (v_start, v_end, v_hides, v_less, v_pct, v_breach, v_send, v_err)
  returning * into r;
  return r;
end $$;

revoke all on function public.probe_photo_health() from public, anon, authenticated;

commit;

-- ── ARMING IT (values are placeholders; the live ones are set against the database) ─────────
--
--   update public.ops_photo_probe_config
--      set webhook_url   = 'https://ntfy.sh/',
--          webhook_extra = jsonb_build_object('topic','<the secret topic>');
--
-- Slack instead:  webhook_url = '<incoming webhook url>', webhook_extra = '{}'  (reads `text`)
-- Discord:        webhook_url = '<webhook url>',          webhook_extra = '{}'  (reads `content`)
--
-- ── THE FILE AND THE DATABASE ARE THE SAME BYTES ────────────────────────────────────────────
-- This directory is the ONLY record of what the database contains -- there is no migration
-- history behind it -- so a file that merely resembles what is deployed is worse than no file:
-- it is a record that will be trusted and is wrong. The first draft of this one drifted
-- immediately, by three comments that were written into the file and never applied.
-- Verified 2026-08-27 by comparing md5(prosrc) against the body between the $$ markers below:
--
--     md5 4ad4b12d15d9d5d2e2318cc4ee36c9a0, 3497 bytes, both sides
--
-- Re-check with:
--   select md5(prosrc), length(prosrc) from pg_proc where proname='probe_photo_health';
--
-- ── PROVEN END TO END, NOT MERELY CONFIGURED ────────────────────────────────────────────────
-- Fired on 2026-08-27 by rewinding the window onto the real 08-21 outage (lag_minutes := 8500)
-- rather than by lowering a threshold: 57 hides, 54 photoless, 94.7%, breached, alerted. ntfy
-- answered 200 with message id bDzaHUs2rD5c and the title and body intact. Config restored to
-- lag_minutes=5 afterwards and the breaching row deleted -- it carried alerted=true and would
-- have suppressed a real alert for three hours.
--
-- Kill switch:  update public.ops_photo_probe_config set enabled = false;
-- Last 24 h:    select ran_at, hides, photoless, pct, breached, alerted
--                 from public.ops_photo_probe where ran_at > now() - interval '24 hours'
--                order by ran_at desc;
