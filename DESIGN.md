# Moon Joy — Design System

## Theme: "Artemis Neo-Brutalism"

A neo-brutalist design language derived from the NASA Artemis program visual identity.
Hard black borders, bold offset shadows in blue, red primary actions, deep space backgrounds.

---

## Color Palette

### Artemis Core (derived from NASA Artemis logo)

| Token | Hex | Usage |
|-------|-----|-------|
| `--artemis-red` | `#E53935` | Primary action color, active states, CTAs |
| `--artemis-red-light` | `#EF5350` | Hover states on red elements |
| `--artemis-blue` | `#1565C0` | **Shadow color** — all hard offset shadows use this |
| `--artemis-blue-light` | `#1E88E5` | Secondary accent, borders, hover highlights |
| `--artemis-charcoal` | `#455A64` | Body text on light surfaces, dividers |
| `--artemis-silver` | `#90A4AE` | Muted accents, decorative elements |

### Neobrutalism Accent Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--neo-yellow` | `#FFE156` | Highlight backgrounds (unused currently) |
| `--neo-purple` | `#C77DFF` | Accent (unused currently) |
| `--neo-pink` | `#FF6B9D` | Accent (unused currently) |
| `--neo-cyan` | `--artemis-blue-light` | Maps to blue accent |
| `--neo-green` | `--artemis-red` | Maps to red primary |
| `--neo-bg` | `#FFF8E7` | Light background for neo cards |
| `--neo-card` | `#FFFFFF` | Card surface (white) |
| `--neo-border` | `#000000` | All borders are pure black |

### Surface / Dark Mode Tones (Interstellar Brutalism)

| Token | Hex | Usage |
|-------|-----|-------|
| `--surface` | `#07090f` | Page background — deep space blue |
| `--surface-container-lowest` | `#0a0d15` | Lowest elevation surface |
| `--surface-container-low` | `#0d1019` | Low elevation |
| `--surface-container` | `#111420` | Default container |
| `--surface-container-high` | `#161926` | High elevation |
| `--surface-variant` | `#1c1f30` | Variant surface (badges etc.) |
| `--on-surface` | `#e2e6f0` | Primary text on dark surfaces |
| `--on-surface-variant` | `#7e8fa6` | Secondary/muted text |
| `--outline-variant` | `#3a4460` | Subtle borders |

### Semantic Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `--artemis-red` | Main brand/action color |
| `--primary-container` | `#2a0d0c` | Dark bg for primary content |
| `--secondary` | `--artemis-blue-light` | Secondary brand color |
| `--secondary-container` | `#0c1929` | Dark bg for secondary content |
| `--on-secondary` | `--artemis-blue` | Text on secondary bg |
| `--error` | `#f87171` | Error states |

### Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-dark` | `rgba(21, 101, 192, 0.55)` | **Blue-tinted dark shadow** for neumorphism |
| `--shadow-light` | `rgba(255, 255, 255, 0.03)` | Light shadow highlight |

---

## Typography

Three-font system loaded via `next/font/google`:

| Role | Font | CSS Variable | Tailwind Class | Weight / Style |
|------|------|-------------|----------------|----------------|
| **Display** | Space Grotesk | `--font-display` | `font-display` | Black/Extrabold, Uppercase, Tight tracking |
| **Body** | Manrope | `--font-body` | `font-body` | Regular, Relaxed leading |
| **Label** | Inter | `--font-label` | `font-label` | Semibold/Bold, Uppercase, Wide tracking (0.12–0.18em) |

### Type Scale

- **Hero title**: `text-6xl` → `text-8xl`, `font-black uppercase leading-[0.85] tracking-tighter`
- **Subtitle/tagline**: `text-sm` → `text-[15px]`, `uppercase tracking-[0.18em]`
- **Nav labels**: `text-xs font-semibold uppercase tracking-wider`
- **Badge/stat text**: `text-[11px] font-extrabold uppercase tracking-widest`
- **Button text**: `text-base font-extrabold uppercase tracking-[0.15em]`

---

## Layout Architecture

### Structure: Sidebar-in-Panel

```
┌─────────────────────────────────────────────┐
│  body (bg-surface, h-[100dvh])              │
│  ┌── safe-area-wrapper (flex row) ─────────┐│
│  │                                         ││
│  │  ┌─ neo-panel (max-w-4xl) ───────────┐ ││
│  │  │ ┌── sidebar ──┐  ┌─ content ────┐  │ ││
│  │  │ │ Moon Joy    │  │              │  │ ││
│  │  │ │             │  │  MOON        │  │ ││
│  │  │ │  HQ (active)│  │  JOY         │  │ ││
│  │  │ │  Deploy     │  │              │  │ ││
│  │  │ │  Active     │  │  Tagline     │  │ ││
│  │  │ │  Ops        │  │              │  │ ││
│  │  │ │             │  │  [Button]    │  │ ││
│  │  │ └─────────────┘  └──────────────┘  │ ││
│  │  └────────────────────────────────────┘ ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

- **No bottom tab bar** — navigation lives inside the main panel's left sidebar
- **Mobile**: sidebar stacks above content with bottom border (`border-b`)
- **Desktop (`lg:`)**: sidebar is left column (`w-[200px]`) with right border (`border-r`)
- **Panel**: `neo-panel` class — white card, 5px black border, 12px blue offset shadow, slight rotation (`-rotate-[0.7deg]`)
- **Page fills viewport**: `min-h-full` on hero, `h-[100dvh]` on wrapper

### Navigation Items

| Label | Href | Icon |
|-------|------|------|
| HQ | `/` | Moon/crescent |
| Deploy | `/match/create` | Rocket |
| Active | `/match` | Target/bullseye |
| Ops | `/agents` | Wrench |

Active state: `bg-artemis-red text-white` + `shadow-[3px_3px_0_0_#1565C0]` + `border-2 border-black`

---

## Component Patterns

### Neo-Brutalist Panel (`.neo-panel`)

```css
background: #fff;
border: 5px solid #000;
border-radius: 20px;
box-shadow: 12px 12px 0 0 var(--artemis-blue); /* blue offset */
```

### Neo-Brutalist Button (`.neo-btn`)

```css
background: var(--artemis-red);       /* red fill */
color: #fff;                           /* white text */
border: 3px solid #000;
border-radius: 12px;
box-shadow: 6px 6px 0 0 var(--artemis-blue);  /* blue offset shadow */
font-weight: 800;
text-transform: uppercase;
letter-spacing: 0.08em;
```

**Interaction**:
- Hover: `translate(2px, 2px)` → shadow shrinks to `4px 4px`
- Active: `translate(6px, 6px)` → shadow collapses to `0`

### Neo-Brutalist Button Secondary (`.neo-btn-secondary`)

Same as `.neo-btn` but:
- Background: `#fff`
- Text color: `var(--artemis-charcoal)`
- Focus ring: `var(--artemis-blue)`

### Neo-Brutalist Card (`.neo-card`)

```css
background: #fff;
border: 3px solid #000;
border-radius: 16px;
box-shadow: 6px 6px 0 0 var(--artemis-blue);
```

### Neo Divider (`.neo-divider`)

```css
border-top: 3px dashed var(--artemis-charcoal);
opacity: 0.35;
```

### Neo Badge (`.neo-badge`)

```css
border: 2px solid #000;
border-radius: 8px;
font-weight: 800;
text-transform: uppercase;
padding: 6px 16px;
background: var(--artemis-red);
color: #fff;
```

### Neo Well (`.neo-well` / `.neo-well-alt`)

- `.neo-well`: `#f0ebe0` bg, black border
- `.neo-well-alt`: `var(--artemis-blue-light)` bg, white text

---

## Key Design Rules

1. **All offset shadows are BLUE** (`#1565C0`) — never black, never gold
2. **All borders are BLACK** (`#000`) — 2–5px depending on element weight
3. **Primary action = RED** (`#E53935`) — buttons, active nav, badges
4. **Background = Deep space** (`#07090f`) — the page behind the panel
5. **Panel interior = WHITE** — high contrast brutalist card floating on space
6. **Text hierarchy**: Display font for headlines (uppercase, tight), Label font for UI chrome (uppercase, wide), Body for reading
7. **Slight rotation** on main panel (`-rotate-[0.7deg]`) for brutalist energy
8. **No 1px borders** — minimum 2px, typically 3–5px for structural elements
9. **Uppercase everywhere** — headings, labels, buttons, nav items, badges

---

## File Map

| File | Purpose |
|------|---------|
| `apps/web/app/globals.css` | All CSS variables, theme tokens, utility classes, keyframes |
| `apps/web/app/layout.tsx` | Root layout, fonts, safe-area wrapper, no tab bar |
| `apps/web/components/landing-hero-panel.tsx` | Main page — panel with sidebar + content |
| `apps/web/components/artemis-logo.tsx` | Native SVG Artemis-style logo (red swoosh, blue crescent, charcoal A) |
| `apps/web/components/sidebar-nav.tsx` | Standalone sidebar component (not currently used in layout) |
| `apps/web/components/tab-bar.tsx` | Legacy bottom tab bar (not used in current layout) |

---

## Tech Stack Notes

- **Tailwind CSS v4** — config via `@theme inline` in globals.css (no tailwind.config.js)
- **Next.js App Router** — Server Components by default
- **PostCSS** — `@tailwindcss/postcss` plugin
- **Fonts** — loaded via `next/font/google`, exposed as CSS variables + Tailwind font utilities
