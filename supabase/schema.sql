-- Instagramsci — Phase 2 schema (PostgreSQL / Supabase)
-- Run this once in the SQL editor (or `psql`) of your self-hosted Supabase.
-- Idempotent-ish: safe to re-run; uses IF NOT EXISTS / OR REPLACE where possible.
-- Access model: reading is public; posting/reacting requires an APPROVED member.

-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  handle       text unique not null,
  display_name text,
  bio          text,
  pronouns     text,
  avatar_url   text,
  is_approved  boolean not null default false,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.membership_applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade,
  handle      text,
  email       text,
  origin      text,
  intentions  text not null,
  status      text not null default 'pending'
              check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.tags (
  id    uuid primary key default gen_random_uuid(),
  slug  text unique not null,
  label text not null
);

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles(id) on delete cascade,
  image_url   text,
  aphorism    text not null check (char_length(aphorism) <= 280),
  caption     text,
  alt_text    text not null,                 -- accessibility: required by design
  attribution text,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.post_tags (
  post_id uuid references public.posts on delete cascade,
  tag_id  uuid references public.tags  on delete cascade,
  primary key (post_id, tag_id)
);

create table if not exists public.reactions (
  post_id    uuid references public.posts    on delete cascade,
  user_id    uuid references public.profiles on delete cascade,
  kind       text not null check (kind in ('resonate','collect','amplify')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts    on delete cascade,
  author_id  uuid not null references public.profiles on delete cascade,
  body       text not null,
  parent_id  uuid references public.comments on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid references public.profiles on delete cascade,
  followee_id uuid references public.profiles on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id)
);

-- ============================================================
-- 2. HELPER FUNCTIONS (SECURITY DEFINER, avoid RLS recursion)
-- ============================================================

create or replace function public.is_approved(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_approved from public.profiles where id = uid), false);
$$;

create or replace function public.is_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

-- ============================================================
-- 3. SIGNUP TRIGGER — create profile + application from signup metadata
--    Frontend calls supabase.auth.signUp({ email, password,
--      options:{ data:{ handle, origin, intentions } } })
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, handle, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'handle',''), split_part(new.email,'@',1)),
    coalesce(nullif(new.raw_user_meta_data->>'handle',''), split_part(new.email,'@',1))
  )
  on conflict (id) do nothing;

  insert into public.membership_applications (user_id, handle, email, origin, intentions)
  values (
    new.id,
    new.raw_user_meta_data->>'handle',
    new.email,
    new.raw_user_meta_data->>'origin',
    coalesce(nullif(new.raw_user_meta_data->>'intentions',''), '(none provided)')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevent users from self-escalating is_admin / is_approved on their profile.
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then
    new.is_admin    := old.is_admin;
    new.is_approved := old.is_approved;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_privileges on public.profiles;
create trigger guard_profile_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ============================================================
-- 4. APPROVAL RPCs (called from the in-app admin page)
-- ============================================================

create or replace function public.approve_member(app_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  update public.membership_applications
     set status='approved', reviewed_by=auth.uid(), reviewed_at=now()
   where id=app_id
   returning user_id into uid;
  update public.profiles set is_approved=true where id=uid;
end;
$$;

create or replace function public.reject_member(app_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  update public.membership_applications
     set status='rejected', reviewed_by=auth.uid(), reviewed_at=now()
   where id=app_id
   returning user_id into uid;
  update public.profiles set is_approved=false where id=uid;
end;
$$;

-- ============================================================
-- 5. FEED VIEW — posts enriched with author + reaction counts + tags
--    security_invoker=on so the view respects the caller's RLS (PG15+).
-- ============================================================

drop view if exists public.post_feed;
create view public.post_feed
with (security_invoker = on) as
select
  p.id, p.image_url, p.aphorism, p.caption, p.alt_text, p.attribution,
  p.pinned, p.created_at,
  pr.handle, pr.display_name, pr.avatar_url, pr.pronouns,
  (select count(*) from public.reactions r where r.post_id=p.id and r.kind='resonate') as resonate_count,
  (select count(*) from public.reactions r where r.post_id=p.id and r.kind='collect')  as collect_count,
  (select count(*) from public.reactions r where r.post_id=p.id and r.kind='amplify')  as amplify_count,
  (select count(*) from public.comments  c where c.post_id=p.id)                        as comment_count,
  coalesce((
    select string_agg(t.label, ' ' order by t.label)
    from public.post_tags pt join public.tags t on t.id=pt.tag_id
    where pt.post_id=p.id
  ), '') as tags
from public.posts p
join public.profiles pr on pr.id = p.author_id;

-- ============================================================
-- 6. ROW-LEVEL SECURITY
-- ============================================================
alter table public.profiles               enable row level security;
alter table public.membership_applications enable row level security;
alter table public.tags                    enable row level security;
alter table public.posts                   enable row level security;
alter table public.post_tags               enable row level security;
alter table public.reactions               enable row level security;
alter table public.comments                enable row level security;
alter table public.follows                 enable row level security;

-- profiles: public read; users update their own row (privileges guarded by trigger)
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select using (true);
create policy profiles_update on public.profiles for update using (auth.uid() = id);

-- applications: a user may insert/read their own; admins read/update all
drop policy if exists apps_insert_own on public.membership_applications;
drop policy if exists apps_read       on public.membership_applications;
drop policy if exists apps_update      on public.membership_applications;
create policy apps_insert_own on public.membership_applications
  for insert with check (auth.uid() = user_id or user_id is null);
create policy apps_read on public.membership_applications
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy apps_update on public.membership_applications
  for update using (public.is_admin(auth.uid()));

-- tags: public read; admins manage
drop policy if exists tags_read   on public.tags;
drop policy if exists tags_write  on public.tags;
create policy tags_read  on public.tags for select using (true);
create policy tags_write on public.tags for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- posts: public read; approved members create; authors edit/delete own
drop policy if exists posts_read   on public.posts;
drop policy if exists posts_insert on public.posts;
drop policy if exists posts_update on public.posts;
drop policy if exists posts_delete on public.posts;
create policy posts_read   on public.posts for select using (true);
create policy posts_insert on public.posts for insert
  with check (auth.uid() = author_id and public.is_approved(auth.uid()));
create policy posts_update on public.posts for update using (auth.uid() = author_id);
create policy posts_delete on public.posts for delete using (auth.uid() = author_id);

-- post_tags: public read; only the post's author may tag (and must be approved)
drop policy if exists post_tags_read  on public.post_tags;
drop policy if exists post_tags_write on public.post_tags;
create policy post_tags_read  on public.post_tags for select using (true);
create policy post_tags_write on public.post_tags for all
  using (exists (select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid()))
  with check (exists (select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid()));

-- reactions: public read; approved members react; remove own
drop policy if exists reactions_read   on public.reactions;
drop policy if exists reactions_insert on public.reactions;
drop policy if exists reactions_delete on public.reactions;
create policy reactions_read   on public.reactions for select using (true);
create policy reactions_insert on public.reactions for insert
  with check (auth.uid() = user_id and public.is_approved(auth.uid()));
create policy reactions_delete on public.reactions for delete using (auth.uid() = user_id);

-- comments: public read; approved members comment; edit/delete own
drop policy if exists comments_read   on public.comments;
drop policy if exists comments_insert on public.comments;
drop policy if exists comments_modify on public.comments;
create policy comments_read   on public.comments for select using (true);
create policy comments_insert on public.comments for insert
  with check (auth.uid() = author_id and public.is_approved(auth.uid()));
create policy comments_modify on public.comments for all using (auth.uid() = author_id);

-- follows: public read; approved members follow; unfollow own
drop policy if exists follows_read   on public.follows;
drop policy if exists follows_write  on public.follows;
create policy follows_read  on public.follows for select using (true);
create policy follows_write on public.follows for all
  using (auth.uid() = follower_id)
  with check (auth.uid() = follower_id and public.is_approved(auth.uid()));

-- ============================================================
-- 7. STORAGE — public bucket for post images + avatars
-- ============================================================
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists media_public_read on storage.objects;
drop policy if exists media_upload      on storage.objects;
drop policy if exists media_modify_own  on storage.objects;
create policy media_public_read on storage.objects
  for select using (bucket_id = 'media');
create policy media_upload on storage.objects
  for insert with check (bucket_id = 'media' and public.is_approved(auth.uid()));
create policy media_modify_own on storage.objects
  for update using (bucket_id = 'media' and owner = auth.uid());

-- Done. Next: run seed.sql, then promote your admin account (see SETUP_SUPABASE.md).
