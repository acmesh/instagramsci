-- Instagramsci — seed data. Run AFTER schema.sql.

-- Theme tags
insert into public.tags (slug, label) values
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

-- THE FIRST POST (pinned).
-- Requires an admin profile to exist. After you sign up and promote yourself
-- to admin (see SETUP_SUPABASE.md §5), run this block. It attributes the post
-- to the first admin and won't duplicate if a pinned post already exists.
insert into public.posts (author_id, image_url, aphorism, alt_text, attribution, pinned)
select
  pr.id,
  'assets/instagramsci.jpg',
  'The crisis consists precisely in the fact that the old is dying and the new cannot be born; in this interregnum a great variety of morbid symptoms appear.',
  'Illustrated portrait of Antonio Gramsci on an ochre background — the face of Instagramsci.',
  'Antonio Gramsci, Prison Notebooks (trans. Hoare & Nowell-Smith)',
  true
from public.profiles pr
where pr.is_admin = true
  and not exists (select 1 from public.posts where pinned = true)
order by pr.created_at
limit 1;

-- Tag the first post #Commons
insert into public.post_tags (post_id, tag_id)
select p.id, t.id
from public.posts p, public.tags t
where p.pinned = true and t.slug = 'commons'
on conflict do nothing;
