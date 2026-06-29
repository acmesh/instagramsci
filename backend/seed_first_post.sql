-- Instagramsci — insert the pinned first post.
-- Run AFTER you've created your admin account and promoted it (see SETUP_POSTGRES.md §6).
-- Attributes the post to the first admin; won't duplicate if a pinned post exists.

insert into posts (author_id, image_url, aphorism, alt_text, attribution, pinned)
select
  u.id,
  '/assets/instagramsci.jpg',
  'The crisis consists precisely in the fact that the old is dying and the new cannot be born; in this interregnum a great variety of morbid symptoms appear.',
  'Illustrated portrait of Antonio Gramsci on an ochre background — the face of Instagramsci.',
  'Antonio Gramsci, Prison Notebooks (trans. Hoare & Nowell-Smith)',
  true
from users u
where u.is_admin = true
  and not exists (select 1 from posts where pinned = true)
order by u.created_at
limit 1;

insert into post_tags (post_id, tag_id)
select p.id, t.id
from posts p, tags t
where p.pinned = true and t.slug = 'commons'
on conflict do nothing;
