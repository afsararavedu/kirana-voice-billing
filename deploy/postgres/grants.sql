-- Re-applied after every migration (scripts/deploy.sh). Idempotent. Plain SQL.
-- Narrows the app role's access to what the API actually does.

GRANT USAGE ON SCHEMA public TO kirana_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kirana_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kirana_app;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM kirana_app;

-- Migration bookkeeping is the owner's business.
REVOKE ALL ON TABLE public."_prisma_migrations" FROM kirana_app;

-- History is append-only. Triggers already refuse UPDATE/DELETE; the app role is not even granted
-- them. Self-maintaining: every table guarded by forbid_history_rewrite() is covered, including
-- ones added by future migrations.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT c.relname
    FROM pg_trigger g
    JOIN pg_class c ON c.oid = g.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = g.tgfoid
    WHERE p.proname = 'forbid_history_rewrite' AND n.nspname = 'public' AND NOT g.tgisinternal
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.%I FROM kirana_app', t.relname);
  END LOOP;
END
$$;

-- Returns serialise on the bill with SELECT ... FOR UPDATE, which PostgreSQL only allows with
-- UPDATE privilege on some column. Grant it on "id" alone; the append-only trigger still refuses
-- any actual UPDATE of a bill.
GRANT UPDATE ("id") ON TABLE public."Sale" TO kirana_app;
