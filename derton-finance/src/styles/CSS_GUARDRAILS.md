# CSS Architecture Guardrails

*Last updated: June 2026 — End of Phase Z modernization*

## Rules for future contributors

### 1. New shared styles → `system/*`
Any cross-component pattern shared by 2+ screens must live in `system/`:
- `system/tables.css` → table frame, cells, overflow, truncation, compact overrides
- `system/layout-base.css` → sidebar padding, overflow hidden group, body gap
- `system/typography.css` → titles, labels, mono utility, market direction colors
- `system/surfaces.css` → screen-scoped theme variables (e.g., `#s5` Opening Window)
- `system/responsive.css` → responsive grid layouts, mobile sidebar full-width

### 2. New component styles → owner file only
Add component-specific styles to the file that owns the selector. Never scatter the same selector's declarations across 5+ files. If you need to add a property to `.wl-sidebar`, add it to `refresh/02-watchlist-sidebar.css` (the layout file), not `compatibility.css`.

### 3. No selector ownership across 5+ files
A non-utility selector (e.g., `.wl-sidebar`, `.info-panel`) should appear in at most 4 files:
1. Component/render file (owns visual styling)
2. Layout base file (owns layout properties: overflow, padding)
3. Responsive file (owns responsive overrides)
4. Compatibility file (owns density/integration overrides)

If you add a 5th, consider whether it belongs in an existing file instead.

### 4. No `!important` without justification
Every `!important` must have a comment explaining WHY it's needed:
```css
/* !important: overrides inline style from TradingView widget */
```

Current remaining `!important` (43 total, 33 active) fall into justified categories:
- Chart library widget fixes (TradingView canvas sizing)
- Width overrides fighting inline styles (sidebar/info-panel)
- Height containment for chart containers (clamp with !important)

### 5. No parallel theme systems
The only theme system is `themes.css` with `body[data-theme='dark']` and `body[data-theme='light']`. All color values must use `var(--*)` tokens from this file. Do not add hardcoded theme colors, do not create alternate theme files, do not add `data-theme` third values.

### 6. Responsive behavior belongs in the layout/responsive layer
Breakpoints must use the canonical values:

| Label | Width | Canonical @media |
|-------|-------|------------------|
| Mobile | <640px | `(max-width: 639px)` |
| Tablet | 640–899px | `(max-width: 899px)` |
| Small desktop | 900–1365px | `(max-width: 1365px)` & `(min-width: 900px)` |
| Desktop | 1366–1919px | `(min-width: 1366px)` & `(max-width: 1919px)` |
| Ultra-wide | ≥1920px | `(min-width: 1920px)` |

Responsive overrides belong in `refresh/07-responsive-viewport-fit.css`. Density or device-specific overrides may go in `compatibility.css`. Do not scatter responsive rules across component files.

## Legacy color
- `legacy/` folder contains CSS that was migrated from the monolithic stylesheet.
- Do NOT add new rules to legacy files.
- Do NOT remove rules from legacy files without proving they're overridden by their `system/` or `refresh/` counterparts.

## Ownership map
```
system/tables.css          P2-P6, P12-P13  (table frame, cells, hover, overflow, truncation, compact)
system/layout-base.css     P7-P9           (sidebar padding, overflow hidden group, body gap)
system/typography.css      P10-P11, P14-P15 (titles, labels, mono, market colors)
system/surfaces.css        P24             (#s5 Opening Window theme variables)
system/responsive.css      P22-P23         (responsive grid, mobile sidebar full-width)
refresh/01                 P1              (panel surfaces) + #topbar + #indexbar
compatibility.css          —               density containment (sidebar widths, chart overflow, indexbar height)
```

## Known technical debt (post-Phase Z)
1. **Spacing/font-size tokens**: 343 hardcoded spacing + 449 hardcoded font-size values remain outside `system/` files. Deferred — too high risk of visual regressions for a pure-structural refactor.
2. **22 unused tokens**: 11 spacing, 6 font-size, 3 font-family, 2 z-index tokens defined in `themes.css` have 0 references. They form the canonical scale for future use.
3. **Legacy responsive**: `legacy/` files have responsive `#topbar`/`#indexbar` rules not yet consolidated into `refresh/07`.
4. **`!important` count**: 43 remain (33 active + 10 legacy). Active ones are justified (chart widgets, inline-style fighting).
