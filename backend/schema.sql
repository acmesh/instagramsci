-- Instagramsci — plain PostgreSQL schema (no Supabase).
-- Authorization is enforced by the Python API, not by row-level security.
-- Run as the app's database owner:  psql -U instagramsci -d instagramsci -f backend/schema.sql

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists users (
  id            bigint generated always as identity primary key,
  email         text unique not null,
  password_hash text not null,
  handle        text unique not null,
  display_name  text,
  bio           text,
  pronouns      text,
  avatar_url    text,
  is_approved   boolean not null default false,
  is_admin      boolean not null default false,
  is_blocked    boolean not null default false,
  totp_secret   text,                         -- active TOTP secret (when 2FA on)
  totp_pending  text,                         -- secret awaiting first-code confirmation
  totp_enabled  boolean not null default false,
  token_version integer not null default 0,     -- bump to revoke all of a user's sessions
  created_at    timestamptz not null default now()
);

-- Failed logins and signups per IP/email, for throttling (pruned by the API).
create table if not exists auth_attempts (
  id    bigint generated always as identity primary key,
  kind  text not null check (kind in ('login','signup')),
  ip    text not null,
  email text,
  at    timestamptz not null default now()
);
create index if not exists auth_attempts_ip_idx    on auth_attempts (kind, ip, at);
create index if not exists auth_attempts_email_idx on auth_attempts (kind, email, at);

create table if not exists membership_applications (
  id          bigint generated always as identity primary key,
  user_id     bigint references users(id) on delete cascade,
  handle      text,
  email       text,
  origin      text,
  intentions  text not null,
  status      text not null default 'pending'
              check (status in ('pending','approved','rejected')),
  reviewed_by bigint references users(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists tags (
  id    bigint generated always as identity primary key,
  slug  text unique not null,
  label text not null
);

create table if not exists posts (
  id          bigint generated always as identity primary key,
  author_id   bigint not null references users(id) on delete cascade,
  image_url   text,
  aphorism    text not null check (char_length(aphorism) <= 280),
  caption     text,
  alt_text    text not null,            -- accessibility: required by design
  attribution text,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists post_tags (
  post_id bigint references posts(id) on delete cascade,
  tag_id  bigint references tags(id)  on delete cascade,
  primary key (post_id, tag_id)
);

create table if not exists reactions (
  post_id    bigint references posts(id) on delete cascade,
  user_id    bigint references users(id) on delete cascade,
  kind       text not null check (kind in ('resonate','collect','amplify')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);

create table if not exists comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references posts(id) on delete cascade,
  author_id  bigint not null references users(id) on delete cascade,
  body       text not null,
  parent_id  bigint references comments(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists follows (
  follower_id bigint references users(id) on delete cascade,
  followee_id bigint references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id)
);

create index if not exists posts_created_idx on posts (pinned desc, created_at desc);
create index if not exists reactions_post_idx on reactions (post_id);

-- ============================================================
-- FEED VIEW — posts enriched with author + reaction counts + tags
-- ============================================================
drop view if exists post_feed;
create view post_feed as
select
  p.id, p.image_url, p.aphorism, p.caption, p.alt_text, p.attribution,
  p.pinned, p.created_at,
  u.handle, u.display_name, u.avatar_url, u.pronouns,
  (select count(*) from reactions r where r.post_id=p.id and r.kind='resonate') as resonate_count,
  (select count(*) from reactions r where r.post_id=p.id and r.kind='collect')  as collect_count,
  (select count(*) from reactions r where r.post_id=p.id and r.kind='amplify')  as amplify_count,
  (select count(*) from comments  c where c.post_id=p.id)                       as comment_count,
  coalesce((
    select string_agg(t.label, ' ' order by t.label)
    from post_tags pt join tags t on t.id=pt.tag_id
    where pt.post_id=p.id
  ), '') as tags
from posts p
join users u on u.id = p.author_id;

-- ============================================================
-- SEED — theme tags (first post is added after you create your admin; see docs)
-- ============================================================
insert into tags (slug, label) values
  ('commons','#Commons'),
  ('labour','#Labour'),
  ('care','#Care'),
  ('energy','#Energy'),
  ('decentralization','#Decentralization'),
  ('climate','#Climate'),
  ('cooperation','#Cooperation'),
  ('housing','#Housing'),
  ('solidarity','#Solidarity')
on conflict (slug) do nothing;
