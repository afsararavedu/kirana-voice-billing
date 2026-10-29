-- Database roles, created once when the PostgreSQL volume is first initialised
-- (postgres/init/10-roles.sh passes the psql variables). Plain SQL: no psql meta-commands.
--
--   kirana_owner  owns the schema and runs `prisma migrate deploy`. Not used by the running app.
--   kirana_app    the API's role: read/write rows only. No DDL, no TRUNCATE, and (see grants.sql)
--                 no UPDATE/DELETE on append-only history tables.
-- The `postgres` superuser is used only for backups, restores and this setup.

CREATE ROLE kirana_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE kirana_app LOGIN PASSWORD :'app_password';

REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
-- CREATE: `prisma migrate deploy` starts with CREATE SCHEMA IF NOT EXISTS, which PostgreSQL checks
-- against the database privilege even when the schema already exists.
GRANT CONNECT, TEMPORARY, CREATE ON DATABASE :"dbname" TO kirana_owner;
GRANT CONNECT ON DATABASE :"dbname" TO kirana_app;

-- The owner creates tables in `public`; nobody else may.
ALTER SCHEMA public OWNER TO kirana_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO kirana_app;

-- Tables and sequences the owner creates later are usable by the app (grants.sql then narrows).
ALTER DEFAULT PRIVILEGES FOR ROLE kirana_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kirana_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kirana_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kirana_app;

-- A stuck query or forgotten transaction must not hold locks for long (finalize locks rows).
ALTER ROLE kirana_app SET statement_timeout = '30s';
ALTER ROLE kirana_app SET idle_in_transaction_session_timeout = '60s';
