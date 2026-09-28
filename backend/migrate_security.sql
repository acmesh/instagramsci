-- Instagramsci — migration: session revocation + login/signup throttling.
-- Safe to run more than once on an existing database.
--   sudo -u postgres psql instagramsci -f backend/migrate_security.sql
--
-- After this migration every login token issued before it stops working
-- (tokens now carry token_version). Everyone logs in once more.

-- Bumped on password change / block; tokens with an older version are rejected.
alter table users add column if not exists token_version integer not null default 0;

-- Failed logins and signups per IP/email, for throttling. Rows older than a day
-- are pruned by the API itself.
create table if not exists auth_attempts (
  id    bigint generated always as identity primary key,
  kind  text not null check (kind in ('login','signup')),
  ip    text not null,
  email text,
  at    timestamptz not null default now()
);
create index if not exists auth_attempts_ip_idx    on auth_attempts (kind, ip, at);
create index if not exists auth_attempts_email_idx on auth_attempts (kind, email, at);

-- The API connects as the app user; if you run this as postgres, hand it over.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'instagramsci') then
    execute 'alter table auth_attempts owner to instagramsci';
  end if;
end $$;
