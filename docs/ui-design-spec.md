# FERMA (Bunius-Sense) — UI Design Spec v1
Mobile-first Capacitor app · single column `max-w-xl` · bottom nav · `pb-20`.
Tokens live in `src/styles/globals.css`. Components consume tokens only — no raw hex in `src/components/**`.

## 1. Color system
Direction: **light warm off-white app background** (`#FAF6F1`).
One-line justification: distillery floors are bright/outdoor-gloved contexts where sunlight legibility wins, and every existing screen is already light — so a light system rebrands with zero layout migration; deep plum is reserved for hero/brand moments (ABV hero, auth) for contrast and drama.

### `:root` (light) — exact values in `globals.css`
| Token | Value | Use |
|---|---|---|
| `--background` | `#FAF6F1` | app background |
| `--foreground` | `#2A0A12` | ink (near-black plum) |
| `--card` / `--card-foreground` | `#FFFFFF` / `#2A0A12` | cards, sheets |
| `--popover` / `--popover-foreground` | `#FFFFFF` / `#2A0A12` | popovers, menus |
| `--primary` / `--primary-foreground` | `#8B1538` / `#FFFFFF` | primary actions, active nav (white on wine ≈ 9:1) |
| `--secondary` / `--secondary-foreground` | `#F1E2E6` / `#4B1C3D` | secondary buttons, washes |
| `--muted` / `--muted-foreground` | `#EDE6DF` / `#6B5B5E` | tabs track, subtle surfaces; muted-fg ≈ 5.9:1 on bg |
| `--accent` / `--accent-foreground` | `#F3E3E8` / `#4B1C3D` | hover/ghost washes |
| `--destructive` / `--destructive-foreground` | `#B91C1C` / `#FFFFFF` | danger (≈ 5.9:1) |
| `--border` | `#E7D9DE` | card/input borders (wine-tinted) |
| `--input` / `--input-background` | `#D8C3CB` / `#F5EEEF` | input border / fill (visible inside white cards) |
| `--switch-background` | `#CFC0C6` | off-state switch |
| `--ring` | `#8B1538` | focus ring |
| `--radius` | `0.625rem` | unchanged; sm/md/lg/xl derive from it |
| `--shadow-card` | `0 1px 2px rgba(42,10,18,.06), 0 4px 16px rgba(139,21,56,.07)` | card/hero lift (wine-tinted) |
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | native stack (offline-first, no webfont) |

### `.dark` — deep-plum night treatment (gloved night shifts, OLED-friendly)
`--background #1C0710` · `--foreground #FDF3F0` · `--card #2A0A12` · `--popover #2A0A12` ·
`--primary #E3AAB8` (rose, fg `#2A0A12`) · `--secondary/#muted/#accent #3A1420`, fg `#E9CBD4` ·
`--muted-foreground #C9AEB6` · `--destructive #E5484D` · `--border #4A1E2B` · `--input #4A1E2B` ·
`--ring #E3AAB8`. Sidebar tokens mirror card/primary in both modes.

### Fermentation status bands (Badge/pill — bg/fg/border, Tailwind classes, reuse existing palette)
- Active/fermenting (brand): `bg-[#F6E8EC] text-[#8B1538] border-[#E7C9D2]`
- Success/complete/on-track: `bg-emerald-50 text-emerald-700 border-emerald-200`
- Warning/check-OG/due: `bg-amber-50 text-amber-700 border-amber-200`
- Danger/alert: `bg-red-50 text-[#B91C1C] border-red-200`
- Info/reference: `bg-blue-50 text-blue-700 border-blue-200`
Never color alone — every band pairs with an icon + text label.

### Charts (recharts, readable on white cards)
`chart-1 #8B1538` (wine, primary series) · `chart-2 #6B2C5D` (plum) · `chart-3 #B45309` (craft amber) ·
`chart-4 #15803D` (ferment green) · `chart-5 #2563EB` (reference blue).
All ≥ 4.5:1 on white except amber/green/blue which clear 3:1 graphics minimum — always add legend + tooltip + value labels. Dark mode: `#E8A0B0 / #C084CA / #EAB308 / #4ADE80 / #60A5FA`.

## 2. Typography — system stack only
No font is bundled and the app must work offline in Capacitor → **no webfont**. Stack: `--font-sans` above (SF Pro / Roboto / Segoe carry the brand fine at these sizes).
Mobile dashboard scale: hero metric `text-4xl font-extrabold tabular-nums` (34–40px) · card metric `text-2xl font-bold tabular-nums` ·
`h1 text-2xl font-bold tracking-tight` · section eyebrow `text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70` ·
body `text-sm` (14px, dense lists) / `text-base` (auth, forms) · caption `text-xs text-muted-foreground`.
Weights: max **two** per screen — `400/500` body + `700` metrics/headings (`600` only for eyebrows/pills). Live numbers always `tabular-nums` (`.tnum` utility) to stop jitter.

## 3. Surface & elevation
- Card: white `bg-card`, `rounded-2xl` (mobile) / `rounded-3xl` (hero, sheets), `border border-border`, `shadow: var(--shadow-card)`. No shadow stacking (shadow OR ring, never both except hero).
- Hero/brand moments only: wine gradient `from-[#23060F] via-[#4A0E1E] to-[#8B1538]` + `ring-1 ring-white/10` (already in `AbvHero` — keep as the single exception).
- Screen padding: `p-4 space-y-4 pb-20 max-w-xl mx-auto`. Section gap `space-y-4`, card padding `p-4`/`p-5`, sheet `px-4 pb-5 rounded-t-3xl`.
- Radius: one family — pills `rounded-full` (buttons, nav, pills), cards `rounded-2xl/3xl`, inputs `rounded-xl`, badges `rounded-md`. Never mix `rounded-md` and `rounded-3xl` on the same element row.

## 4. Component treatments (one line each)
- **Button primary**: `bg-primary text-primary-foreground rounded-full shadow-md shadow-primary/25 hover:bg-[#6B1028]`; secondary: `bg-secondary text-secondary-foreground rounded-full`; ghost: `text-muted-foreground hover:text-primary hover:bg-accent rounded-full`; danger: `text-red-600 border-red-100 hover:bg-red-50`.
- **Badge/status pill**: `rounded-full border text-xs font-semibold px-2.5 py-0.5` + status-band colors above + lucide icon, never dot-only.
- **Input**: `bg-input-background border-input rounded-xl h-11` (44px touch), focus `ring-primary/30`, error text sits under the field.
- **Card**: rule in §3; header eyebrow + title + metric; no nested cards.
- **Tabs**: `TabsList bg-muted rounded-xl p-1`, active trigger `bg-card shadow-sm text-foreground font-semibold`.
- **BottomNav**: `bg-[#FAF6F1]/90 backdrop-blur-md border-t border-primary/10`, active `text-primary bg-primary/10 rounded-2xl`, inactive `text-muted-foreground`; labels always visible, `aria-current="page"`.
- **Sheet/Modal**: bottom sheet `rounded-t-3xl bg-card max-h-[90vh]`, scrim `bg-black/50`, destructive confirm uses danger button + red icon well.
- **Progress**: track `bg-primary/15 rounded-full`, fill `bg-primary`; status-tinted fill allowed (green/amber) with matching label.
- **Charts**: stroke `2–2.5px`, `dot={false}`, monotone; grid `stroke-border` dashed; tooltip white card style; `animationDuration={300}`.

## 5. Motion
Micro (press/hover/focus): `150–200ms ease-out`; sheets/modals/charts: `250–300ms ease-out`; never animate width/height (transform/opacity only). `prefers-reduced-motion` block in `globals.css` is normative — recharts gets `isAnimationActive={false}` under reduced motion.

## 6. Do not (amateur tells)
- No raw hex/oklch in components — tokens (`bg-primary`, `text-muted-foreground`) or the §1 band/hero values only.
- No more than 2 font weights per screen; no `< 12px` body text.
- No mixed radii on one row (pick pill OR card radius per element family).
- No color-only status (every red/green/amber signal needs icon + words).
- No new gray backgrounds (`bg-gray-50/100`) — warm tokens (`bg-muted`, `bg-accent`, `bg-input-background`) only.
