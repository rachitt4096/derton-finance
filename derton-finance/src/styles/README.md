# CSS Architecture

This folder is ordered by responsibility. Keep new CSS in the earliest layer
that can own it without relying on accidental cascade order.

1. `fonts.css`
   External font loading only. Do not add selectors here.

2. `themes.css`
   Design tokens only: colors, fonts, semantic aliases, shadows, surfaces, and
   theme-specific custom properties. Component selectors should consume tokens,
   not define them.

3. `base.css`
   Browser/app reset and global defaults: box sizing, root sizing, document
   typography, media defaults, and shared scrollbar behavior.

4. `legacy-terminal.css`
   Existing terminal/page styles from earlier design passes. Prefer moving
   stable page styles out of this file when touching a screen.

   `legacy/04-compact-terminal.css` is a manifest importing its partials
   from `legacy/04-compact-terminal/`:

   | File | Covers |
   |------|--------|
   | `01-watchlist-flags.css` | `.wl-sidebar`, `.wl-head`, `.wl-list`, `.wl-item`, `.flag-*` (watchlist + stock flags) |
   | `02-chart-graph-meta.css` | `.chart-area`, `.graph-shell`, `.graph-meta`, `.stock-hdr`, `.band-bar`, `.chart-ctrl`, `.ticker` |
   | `03-info-panel-detail.css` | `.info-panel`, `.info-panel-market`, `.s2-*` detail, insight, comparison blocks |
   | `04-history-portfolio-screener.css` | `.hist-section`, `.ptable`, `.port-*`, `.book-*`, `.sc-*`, `.ow-*`, `.fw-*` |
   | `05-admin.css` | `.admin-*` screen, table, form, card components |
   | `06-calendar.css` | `.cal-*` modal, grid, date cells |

5. `v5-parity.css`, `refresh.css`, `institutional-terminal.css`
   Explicit visual skins and page/workstation-specific styling. Keep selectors
   scoped to the page or feature they style.

   `institutional-terminal.css` now uses `--ix-*` theme tokens defined in
   `themes.css` instead of hard-coded colors throughout.

   `refresh.css` is a manifest importing its partials from `refresh/`:

   | File | Covers |
   |------|--------|
   | `01-app-shell-topbar-indexbar.css` | `html`/`body` reset overrides, `.app-shell` backgrounds/glows, `#topbar`, nav, logo, `#indexbar`, `#screens`, `.s1-open-bar`, panel surface `:is()` block |
   | `02-watchlist-sidebar.css` | `.wl-sidebar`, `.wl-head`, `.wl-search`, `.wl-filters`, `.wl-list`, `.wl-item`, `.wl-flag-*` |
   | `03-stock-header-chart-controls.css` | `.stock-hdr`, `.sh-*`, `.band-bar`, `.chart-ctrl`, `.ind-panel`, chart buttons, `.graph-shell`, `.chart-wrap`, `.graph-meta`, `.ticker` |
   | `04-info-panel-stock-detail.css` | `.info-panel`, `.info-panel-market`, `.s2-*` detail section, `.hist-section`, insight/book tables |
   | `05-tables-cards.css` | Shared table styles (`.insight-table`, `.hist-table`, `.sc-table`, `.ptable`, `.ow-table`, `.fw-table`), `.sc-*` screener, `.port-*` portfolio, `.book-*`, `.ow-*` opening window, `.fw-*` flags |
   | `06-toasts.css` | `#toasts`, `.toast` notifications |
   | `07-responsive-viewport-fit.css` | All media queries, compact viewport-fit pass, responsive desktop/monitor scaling, viewport-height queries |

6. `compatibility.css`
   Temporary containment and density overrides. Treat every `!important` here
   as debt: use it only when overriding legacy CSS is cheaper than risking a
   behavioral change, and remove it when the owning component is cleaned up.

7. `screen-overrides.css`
   Screen-specific page overrides that were historically inlined in
   `index.css`. Currently contains `#s2` stock-detail layout and
   `#s5` opening-window table/card styling. Keep selectors scoped to a
   specific screen (`#s2`, `#s5`, etc.) and move rules into a feature
   stylesheet when they are cleaned up.

Best practices:

- Add tokens to `themes.css`; avoid hard-coded colors in new component CSS.
- Prefer component/page-scoped class names over broad element selectors.
- Avoid new `!important` rules unless the rule belongs in `compatibility.css`.
- Keep global `overflow: hidden` decisions in `base.css` or
  `compatibility.css`, not page styles.
- When cleaning a feature, move its rules from `legacy-terminal.css` into a
  clearly named page or component stylesheet before changing behavior.
