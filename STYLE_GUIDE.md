# Instagramsci — Visual Style Guide

*Derived directly from the Gramsci portrait artwork (`instagramsci.jpg`). Colors below were sampled from the image file, so they are accurate to the source rather than guessed.*

**Version:** 0.1 · **Date:** 2026-06-26

---

## 1. Brand idea

Warm, human, principled. The look pairs the **ochre warmth** of the portrait's ground with **charcoal-navy ink** and a **brick-red accent** that signals the political/cooperative lineage without shouting. Think: a well-printed radical pamphlet meeting a modern, clean photo feed.

**Voice:** direct and warm, plain-spoken but intellectually serious, inclusive, never preachy. Short declarative sentences. The aphorism does the heavy lifting.

---

## 2. Color palette (sampled from the artwork)

| Token | Hex | Source in image | Use |
|---|---|---|---|
| `--ochre` | `#D0A640` | Background field (dominant) | Primary brand color, accents, highlights |
| `--ochre-deep` | `#B98A2A` | Darker ochre | Hover states, borders on light |
| `--ink` | `#2A2A33` | Collar / dark garment | Primary text, dark surfaces, nav |
| `--ink-soft` | `#383842` | Mid charcoal-navy | Secondary text, lines |
| `--abyss` | `#150303` | Deepest shadow | Footer / max-contrast blocks |
| `--cream` | `#EBD2BC` | Skin highlight | Light surface / cards on dark |
| `--cream-soft` | `#F4E7D8` | Lightened cream | Page background (light mode) |
| `--brick` | `#B23A2E` | *Accent (added)* — keys off the plum lip tone | Primary CTA, "resonate" active, links |
| `--plum` | `#5A2A3A` | Lip / shadow tone | Tags, secondary accent |
| `--sienna` | `#312112` | Hair shadow | Borders, muted detail |

**Accessibility checks (WCAG):**
- `--ink` on `--cream-soft` → very high contrast, body text safe.
- `--brick` on `--cream-soft` → passes AA for normal text (verify exact ratio with a contrast tool before shipping).
- Ochre is a **surface/accent**, not a text color on light — never set body text in ochre.

---

## 3. Typography

Use free, self-hostable typefaces (no proprietary lock-in):

- **Display / aphorisms:** a characterful editorial **sans** — **Bricolage Grotesque** (token `--display`). Warm and quirky like a soft serif, but sans-serif. Aphorisms are the hero; set them large, generous line-height, slightly tight tracking. (Note: Bricolage has no true italic, so italic display text renders as a synthesized oblique.)
- **UI / body:** a clean humanist sans — **Inter** (token `--sans`). Neutral, highly legible, great accessibility track record.

**Scale (rem):**
| Role | Size | Weight | Family |
|---|---|---|---|
| Aphorism hero | 1.75–2.25 | 500–600 | Serif |
| H1 page title | 2.0 | 700 | Sans |
| H2 | 1.5 | 600 | Sans |
| Body | 1.0 | 400 | Sans |
| Meta / caption | 0.85 | 500 | Sans |

> Fonts are referenced by name in the mockup; swap in self-hosted files for production. (Confirm each font's license before bundling.)

---

## 4. Spacing, radius, elevation

- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64 px.
- **Radius:** `--r-sm: 8px`, `--r-md: 14px`, `--r-lg: 22px`. Cards use `--r-md`; images `--r-md`; pills fully rounded.
- **Elevation:** soft, warm-tinted shadows (e.g. `0 6px 24px rgba(21,3,3,.12)`), never harsh black.
- **Layout:** single centered feed column (max ~600px) like Instagram; sidebar nav on desktop, bottom tab bar on mobile.

---

## 5. Core components

**Post card**
- Image (4:5 or 1:1), rounded.
- Aphorism overlaid or directly beneath, in the serif display face.
- Author row: avatar + @handle + theme tag pill.
- Action row: **Resonate** (brick heart/fist), **Discuss** (comment), **Collect** (bookmark), **Amplify** (reshare).
- Required **alt text** indicator (small "ALT" badge) reinforcing the accessibility norm.

**Theme tag pill:** plum/ochre text on translucent surface, fully rounded. E.g. `#Commons` `#Labour` `#Energy` `#Care`.

**Nav:** left vertical rail on desktop (logo, Home, Explore, Compose, Profile, Manifesto); bottom bar on mobile.

**Buttons:** primary = `--brick` fill, cream text; secondary = ink outline; ghost = text-only.

---

## 6. Imagery & illustration

- Lean on **illustrated portraiture** in the style of the Gramsci artwork for editorial/brand moments — flat fills, confident linework, warm palette.
- User photos sit on cream/ink cards so the ochre brand frame stays consistent.
- Avoid stocky corporate photography; favor documentary, community, and craft imagery.

---

## 7. Tone of microcopy

| Context | Example |
|---|---|
| Empty feed | "Nothing here yet. Post an idea worth sharing." |
| Compose placeholder | "Write the aphorism. Keep it sharp." |
| Alt-text nudge | "Describe the image so everyone can see it." |
| CTA | "Share your idea" (not "Post now!") |

---

*Tokens are implemented as CSS custom properties in `instagramsci-mockup.html` and carry over unchanged to the production framework build.*
