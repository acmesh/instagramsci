# Instagramsci — Architecture & Build Plan

*A visual social network for socialist, community-driven, inclusive ideas, grounded in a Third Industrial Revolution (Rifkin-style) decentralized economic model.*

**Version:** 0.1 (draft) · **Date:** 2026-06-26 · **Owner:** acme

---

## 1. Concept

**Instagramsci** = *Instagram* + *Antonio Gramsci*. An image-first feed where people post pictures paired with **aphorisms** — short, quotable political/societal statements — around a shared mission: cooperative economics, commons, decentralization, and inclusion.

The product borrows Instagram's proven mechanics (visual feed, profiles, follows, likes, comments) but reorients them toward **ideas over influencers**: the aphorism is the unit of value, not the selfie.

> **Note on scope.** This document describes the full target product *and* the lean prototype we build first. Decisions flagged **[PROTOTYPE]** apply to the current plain HTML/CSS/JS build; **[PRODUCTION]** describes the live version with real accounts and data.

---

## 2. Guiding principles

1. **Ideas first.** Composition centers the aphorism + image; vanity metrics are de-emphasized (no public follower counts on the prototype; "resonance" instead of raw likes — see open questions).
2. **Inclusive by default.** Accessibility (WCAG 2.1 AA), alt text required on every image, content warnings, multi-language ready.
3. **Decentralization as ethos now, infrastructure later.** Phase 1 uses standard hosting; the data model and storage layer are designed so post media can migrate to decentralized storage (Cubbit/IPFS) without schema changes.
4. **Own your stack.** No CMS lock-in (no WordPress). Everything editable in Code; the prototype is hand-written HTML/CSS/JS.
5. **Community governance over algorithmic feeds.** Chronological and curated/community feeds preferred over opaque ranking.

---

## 3. Tech stack

### Phase 1 — Prototype **[PROTOTYPE]**
| Layer | Choice | Why |
|---|---|---|
| Markup/Style | Hand-written HTML + CSS (CSS custom properties) | Full control, zero build step, slick, editable in Code |
| Interactivity | Vanilla JS (ES modules) | No framework overhead for a static demo |
| Data | In-file mock JSON | Lets the feed feel real with no backend |
| Hosting | Any static host (Netlify / Vercel / GitHub Pages) | Free, instant |

### Phase 2 — Production **[PRODUCTION]**
| Layer | Choice | Notes |
|---|---|---|
| Frontend | Migrate prototype to a framework (Next.js or Astro) when interactivity grows | Keep the CSS design system intact |
| Auth | **Supabase Auth** | Email/password + magic link + OAuth |
| Database | **Supabase Postgres** | Relational, row-level security |
| Media storage | **Supabase Storage** → later **Cubbit/IPFS** | Storage abstraction keeps the path swappable |
| Hosting | Vercel/Netlify (frontend) + Supabase (backend) | Generous free tiers |

> **Verification note:** Supabase free-tier limits and feature availability change over time. Confirm current quotas at supabase.com before committing — figures should be checked against the primary source.

---

## 4. Site map

```
/                     Home feed (chronological + "Commons" curated tab)
/explore              Discover aphorisms by theme/tag (Cooperation, Commons,
                      Energy, Labour, Care, Climate, Decentralization…)
/post/:id             Single post (image + aphorism + discussion)
/compose              Create a post (image upload + aphorism + tags + alt text)
/u/:handle            Public profile (grid of a user's aphorisms)
/u/:handle/saved      Saved/"Collected" posts (private)
/tag/:slug            All posts under a theme tag
/manifesto            The project's mission / principles page
/login  /signup       Auth (Phase 2)
/settings             Profile, accessibility, language, privacy
/about                Who/what/why + governance model
```

---

## 5. Data model **[PRODUCTION]**

Designed for Supabase Postgres. Media stored as a URL/key so the storage backend (Supabase → Cubbit/IPFS) is swappable.

### `profiles`
| column | type | notes |
|---|---|---|
| id | uuid (PK, = auth.users.id) | |
| handle | text unique | @username |
| display_name | text | |
| bio | text | |
| avatar_url | text | storage key |
| pronouns | text | inclusivity |
| location | text | optional |
| created_at | timestamptz | |

### `posts`
| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| author_id | uuid (FK → profiles.id) | |
| image_key | text | storage path (swappable backend) |
| aphorism | text | the quote/statement (≤ 280 chars) |
| caption | text | optional longer context |
| alt_text | text **NOT NULL** | accessibility — required |
| source_attribution | text | if quoting someone, credit them |
| content_warning | text null | optional CW label |
| created_at | timestamptz | |

### `tags` / `post_tags`
- `tags(id, slug, label)` — theme taxonomy (Commons, Labour, Care, Energy…).
- `post_tags(post_id, tag_id)` — many-to-many.

### `reactions`
| column | type | notes |
|---|---|---|
| post_id | uuid (FK) | |
| user_id | uuid (FK) | |
| kind | enum('resonate','amplify','collect') | "resonate"=like, "amplify"=reshare, "collect"=save |
| created_at | timestamptz | composite PK (post_id, user_id, kind) |

### `comments`
| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| post_id | uuid (FK) | |
| author_id | uuid (FK) | |
| body | text | |
| parent_id | uuid null | threaded replies |
| created_at | timestamptz | |

### `follows`
| column | type | notes |
|---|---|---|
| follower_id | uuid (FK) | |
| followee_id | uuid (FK) | composite PK |
| created_at | timestamptz | |

### `membership_applications` (access model: open application + manual approval)
| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| handle | text | requested @name |
| email | text | contact |
| origin | text | "where are you coming from" |
| intentions | text | free text — the human review reads this |
| status | enum('pending','approved','rejected') | default 'pending' |
| reviewed_by | uuid null | admin profile |
| created_at | timestamptz | |

**Access model (decided):** Reading is public to everyone. **Posting/reacting/commenting requires an approved account.** Anyone may apply via `/join` with info about themselves and their intentions; a human reviews every application; approval provisions the auth account and emails the applicant. The front-end form exists in Phase 1 (confirmation only); the review queue + approval action is built in Phase 2.

**Row-Level Security:** read public; write restricted to the authenticated, *approved* owner. Reactions/comments require an approved account.

---

## 6. Core features by phase

**Phase 1 (prototype, this session)**
- Home feed with mock posts (image + aphorism + tags + reactions UI)
- Compose screen (non-functional form showing the flow)
- Profile grid view
- Explore by theme tags
- Manifesto/About page
- Full responsive + accessible design system

**Phase 2 (MVP, live)**
- Supabase auth (signup/login)
- Real post creation with image upload + required alt text
- Resonate / collect / comment
- Follows + chronological feed
- Theme tags + explore

**Phase 3 (community & decentralization)**
- Migrate media to Cubbit/IPFS storage
- Community moderation / governance tooling
- Multi-language UI
- Optional ActivityPub bridge (Fediverse interoperability)

---

## 7. Prototype → Production migration path

1. **Keep the design system.** `tokens.css` (colors, type, spacing) carries over verbatim into the framework build.
2. **Componentize.** Each repeated block in the mockup (post card, nav, compose form) becomes a component.
3. **Swap mock JSON for Supabase queries.** The mock data shape mirrors the DB schema, so wiring is a find-and-replace of the data source.
4. **Add auth gate** around compose/react/comment.
5. **Abstract storage** behind a single `getMediaUrl(key)` helper so Supabase Storage → Cubbit/IPFS is a one-function change.

---

## 8. Open questions for acme

1. **Metric framing:** keep familiar "likes," or rename to *resonate / amplify / collect* as proposed? (Affects copy throughout.)
2. **Anonymity:** real names encouraged, or pseudonymous handles to lower barriers to political speech?
3. **Moderation model:** centralized (you), elected community mods, or reputation-based?
4. **Languages at launch:** English only, or English + Italian (Gramsci heritage) from day one?
5. **Quote integrity:** require source attribution when posting someone else's words, to avoid misattributed quotes?

---

*Next deliverables in this session: `STYLE_GUIDE.md` and `instagramsci-mockup.html`.*
