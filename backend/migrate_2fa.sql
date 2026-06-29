-- Instagramsci — migration: add TOTP 2FA columns to an EXISTING database.
-- Safe to run once on a database created before 2FA support.
--   psql "postgresql://instagramsci:PASSWORD@127.0.0.1:5432/instagramsci" -f backend/migrate_2fa.sql

alter table users add column if not exists totp_secret  text;
alter table users add column if not exists totp_pending text;
alter table users add column if not exists totp_enabled boolean not null default false;
