-- Instagramsci — migration: feed view with amplify_count + comment_count.
-- Supersedes migrate_amplify.sql (includes amplify_count too), so running this
-- one is enough on an existing database. The comments table already exists from
-- schema.sql; only the view needs updating.
--   psql "postgresql://instagramsci:PASSWORD@127.0.0.1:5432/instagramsci" -f backend/migrate_comments.sql
--
-- We DROP then CREATE (not CREATE OR REPLACE): replacing a view can't insert a
-- column in the middle of the existing column list, only append at the end.

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
