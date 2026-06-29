-- Instagramsci — migration: add amplify_count to the feed view (existing DB).
--   psql "postgresql://instagramsci:PASSWORD@127.0.0.1:5432/instagramsci" -f backend/migrate_amplify.sql
--
-- NOTE: migrate_comments.sql supersedes this file (it adds comment_count too).
-- We DROP then CREATE because CREATE OR REPLACE VIEW can't insert a column in the
-- middle of the existing column list.

drop view if exists post_feed;
create view post_feed as
select
  p.id, p.image_url, p.aphorism, p.caption, p.alt_text, p.attribution,
  p.pinned, p.created_at,
  u.handle, u.display_name, u.avatar_url, u.pronouns,
  (select count(*) from reactions r where r.post_id=p.id and r.kind='resonate') as resonate_count,
  (select count(*) from reactions r where r.post_id=p.id and r.kind='collect')  as collect_count,
  (select count(*) from reactions r where r.post_id=p.id and r.kind='amplify')  as amplify_count,
  coalesce((
    select string_agg(t.label, ' ' order by t.label)
    from post_tags pt join tags t on t.id=pt.tag_id
    where pt.post_id=p.id
  ), '') as tags
from posts p
join users u on u.id = p.author_id;
