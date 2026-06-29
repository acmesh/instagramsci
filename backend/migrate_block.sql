-- Instagramsci — migration: add the is_blocked column for member management.
--   psql "postgresql://instagramsci:PASSWORD@127.0.0.1:5432/instagramsci" -f backend/migrate_block.sql

alter table users add column if not exists is_blocked boolean not null default false;
