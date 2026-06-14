# Phase E — Single Owner Migration Plan

## Goal
Restructure 29 CSS files (15,300 lines) so every component has exactly one owning file. Files that do not own a component must stop declaring its selectors. This eliminates declaration conflicts, `!important` hacks, and cascade‑order dependencies.

---

## Rules of the Plan

- **Owner** = the file that alone declares that component's canonical styles (layout, typography, color, spacing). All other files must be stripped of selectors belonging to that component.
- **Non‑owner contributions** are either moved into the owner file, removed (if already duplicated), or kept only if they add genuinely new functionality (rare).
- **`compatibility.css`** is the only cross‑cutting file: it owns *containment/layout‑safety* (flex safety, scroll overflow, grid primitives). It must not own component‑visuals.
- **`refresh/07-responsive-viewport-fit.css`** currently wins most responsive overrides by cascade order. In the new architecture it owns only *responsive viewport tuning* (media query breakpoints) — it must be emptied of component layout defaults that are better placed in the component's owner file.
- **`screen-overrides.css`** owns only `#s5` (OW) panel variables and `body[data-theme='dark']` cascade neutralizers. Everything else it touches (especially #s2/info‑panel layout) must be moved.
- **`institutional-terminal.css`** owns the broadcast/historical screens (`#s6`‑`#s9`) and `ix-` prefixed institutional components. It must yield Stock Header, Chart, and Info‑Panel selectors to the refresh files.

---

## Per‑Component Ownership Plan

### 1. Admin — Score B (2 files) · EASY · ROI: Immediate

| File | Declarations | Win % | Role |
|---|---|---|---|
| `legacy/04-compact-terminal/05-admin.css` | 186 | 85% | **Owner** (already owns it) |
| `legacy/05-desktop-dashboard-surfaces.css` | 12 | 6% | Must divest: move unique admin selectors into owner, delete duplicates |
| `compatibility.css` | 8 | 4% | Keep only utility classes; strip admin‑specific selectors |

**Actions:**
1. Diff `05-admin.css` vs `05-desktop-dashboard-surfaces.css` for unique declarations.
2. Move any unique admin declarations into `05-admin.css`.
3. Strip `.admin-*` selectors from `05-desktop-dashboard-surfaces.css`.
4. Rename `legacy/04-compact-terminal/05-admin.css` → `admin.css` and promote out of `legacy/`.

**Difficulty:** Easy. Already 85% single‑owner. 2 source files, no `!important` to resolve.

---

### 2. Indexbar — Score F (8 files) · HARD · ROI: High

| File | Declarations | Win % | Role |
|---|---|---|---|
| `refresh/01-app-shell-topbar-indexbar.css` | 29 | 18% | **Owner candidate** (canonical height, border, token bg) |
| `refresh/07-responsive-viewport-fit.css` | ~30 | 19% | Must keep only responsive breakpoint overrides |
| `compatibility.css` | ~20 | 13% | Must yield all indexbar selectors (keep only if `!important` is required) |
| `legacy/01-market-panel-parity.css` | 29 | 18% | Full divest |
| `legacy/02-responsive-stabilization.css` | ~12 | 8% | Full divest |
| `legacy/05-desktop-dashboard-surfaces.css` | ~10 | 6% | Full divest |
| `legacy/06-v6-exact-size.css` | ~15 | 9% | Full divest |
| `v5-parity.css` | 24 | 15% | Full divest |

**The problem:** 8 files all declare `min-height`, `background`, `align-items`, `gap`, `padding` on `#indexbar`. The cascade winner (`compatibility.css`, lines 34–42) uses `!important` to force `min-height: 34px`. Six legacy files set completely different heights (78px, 42px, 40px).

**Actions:**
1. Consolidate the canonical `#indexbar` rules into `refresh/01-app-shell-topbar-indexbar.css`:
   - `min-height: 40px`, `background: var(--bg1)`, `border: 1px solid var(--border)`, `border-radius: var(--rd-xl)`.
2. Move responsive `#indexbar` overrides from `07-responsive-viewport-fit.css` but keep them in that file (it is the correct home for breakpoint overrides).
3. Remove `#indexbar` selectors from all 6 legacy files + v5‑parity.
4. Remove `!important` from `compatibility.css` — make the canonical height unconditional.
5. Strip `#indexbar` from `compatibility.css` entirely; the canonical file's values are now the source of truth.

**Difficulty:** Hard because 8 files compete, one uses `!important`, and legacy values span 38px of height variance. Requires regression testing at every breakpoint.

---

### 3. Topbar — Score F (9 files) · HARD · ROI: High

| File | Declarations | Win % | Role |
|---|---|---|---|
| `refresh/01-app-shell-topbar-indexbar.css` | 138 | 25% | **Owner candidate** (canonical height: 56px, flex layout, border) |
| `refresh/07-responsive-viewport-fit.css` | ~80 | 14% | Keep only responsive overrides; move density rules to owner |
| `compatibility.css` | ~15 | 3% | Must yield `.nav-btn`, `.topbar-right` (keep `!important` density only) |
| `screen-overrides.css` | ~25 | 5% | Must yield `.nav`, `.nav-btn` dark‑theme rules to owner |
| `institutional-terminal.css` | ~30 | 5% | Must yield `.topbar-command`, `.top-nav-tabs` to owner or rename to `ix-` prefix |
| `legacy/01-market-panel-parity.css` | 101 | 18% | Full divest |
| `legacy/02-responsive-stabilization.css` | ~30 | 5% | Full divest |
| `legacy/05-desktop-dashboard-surfaces.css` | ~25 | 5% | Full divest |
| `legacy/06-v6-exact-size.css` | 70 | 13% | Full divest |
| `v5-parity.css` | ~42 | 8% | Full divest |

**The problem:** Topbar used to be 80px (market-panel-parity), then 72px (v6), then 48px (dashboard-surfaces), now 56px (refresh). The legacy layering means every old height is still declared and is only overridden by cascade order. `compatibility.css` reapplies `.nav-btn` geometry in its density block. `screen-overrides.css` resets `.nav` background and border.

**Actions:**
1. Consolidate all base `.nav`, `.nav-btn`, `.topbar`, `.topbar-right`, `.logo`, `.market-pill` rules into `refresh/01-app-shell-topbar-indexbar.css`.
2. Merge dark‑theme `.nav` / `.nav-btn` overrides from `screen-overrides.css` into owner (with `body[data-theme='dark']` wrapper).
3. Move `.nav-btn` density rules from `compatibility.css` into owner's density variant.
4. Remove all topbar selectors from legacy files (01, 02, 05, 06, v5‑parity).
5. Rename/promote `institutional-terminal.css`'s `.topbar-command` → `.ix-topbar-command` or move into owner.

**Difficulty:** Hard. 9 files. Legacy values for height span 24px (48→72). `screen-overrides.css` uses `body[data-theme='dark']` which has higher specificity than the owner's classes — must be wrapped identically in the owner file.

---

### 4. Watchlist — Score F (10 files) · HARD · ROI: High

| File | Declarations | Win % | Role |
|---|---|---|---|
| `refresh/02-watchlist-sidebar.css` | ~120 | 14% | **Owner candidate** (token‑based, modern layout) |
| `refresh/07-responsive-viewport-fit.css` | ~60 | 7% | Keep only responsive `width` overrides |
| `legacy/03-watchlist-overrides.css` | 250 | 29% | Full divest (largest contributor!) |
| `legacy/04-compact-terminal/01-watchlist-flags.css` | 200 | 23% | Full divest |
| `legacy/01-market-panel-parity.css` | 149 | 17% | Full divest |
| `legacy/02-responsive-stabilization.css` | ~30 | 3% | Full divest |
| `legacy/05-desktop-dashboard-surfaces.css` | ~25 | 3% | Full divest |
| `legacy/06-v6-exact-size.css` | ~15 | 2% | Full divest |
| `v5-parity.css` | ~20 | 2% | Full divest |
| `compatibility.css` | ~15 | 2% | Must yield `.wl-sidebar`, `.wl-list` layout; keep only if `!important` is required |

**The problem:** `legacy/03-watchlist-overrides.css` actually declares *more* winning selectors than `refresh/02-watchlist-sidebar.css` because it appears earlier but has comprehensive `!important` overrides. The watchlist's own legacy file (`legacy/04-compact-terminal/01-watchlist-flags.css`) alone contributes 200 declarations. Ten files touch this component.

**Actions:**
1. Audit `legacy/03-watchlist-overrides.css` for any genuinely unique rules (e.g., `.wl-item` color‑flash variants) and merge them into `refresh/02-watchlist-sidebar.css`. Strip everything else.
2. Audit `legacy/04-compact-terminal/01-watchlist-flags.css` — most `.wl-item` flags (up/down/gap) are duplicated in `refresh/02`. Merge unique flag animations, delete the rest.
3. Strip `.wl-*` selectors from all other legacy files + v5‑parity.
4. `compatibility.css`'s `.wl-list` scroll rules (lines 125–132) are not in `refresh/02` — move them into the owner.

**Difficulty:** Hard. Legacy watchlist files are very large and comprehensive. `legacy/03` uses its own color scheme distinct from tokens — must be manually ported.

---

### 5. Charts — Score F (11 files) · EXTREME · ROI: Medium

| File | Declarations | Win % | Role |
|---|---|---|---|
| `legacy/04-compact-terminal/02-chart-graph-meta.css` | 148 | 36% | Divest to `refresh/03` |
| `compatibility.css` | 68 | 17% | Keep chart containment (`position: absolute`, `inset: 0`, `width/height: 100%`) — that is genuinely layout‑safety |
| `v5-parity.css` | 72 | 17% | Full divest |
| `refresh/03-stock-header-chart-controls.css` | ~50 | 12% | **Owner candidate** (modern chart controls, graph‑shell, ticker) |
| `refresh/07-responsive-viewport-fit.css` | ~40 | 10% | Must keep responsive `height: clamp()` for `#s1 .graph-shell`, `.s2-chart` |
| `screen-overrides.css` | ~15 | 4% | Divest to `compatibility.css` (chart legend theme) |
| `legacy/01-market-panel-parity.css` | ~20 | 5% | Full divest |
| `legacy/02-responsive-stabilization.css` | ~10 | 2% | Full divest |
| `legacy/05-desktop-dashboard-surfaces.css` | ~10 | 2% | Full divest |
| `legacy/06-v6-exact-size.css` | ~10 | 2% | Full divest |
| `institutional-terminal.css` | ~10 | 2% | Divest (chart loading states should live in owner) |

**The problem:** No single file dominates charts. `legacy/04-compact-terminal/02-chart-graph-meta.css` has the most declarations (148, 36%) but is itself a legacy file. `compatibility.css` has 68 declarations for chart containment — which is correct (that file's mandate is layout safety). `v5-parity.css` has 72 more. Chart sizing is split between `refresh/03` (controls) and `refresh/07` (clamp heights).

**Actions:**
1. Move all `.graph-shell`, `.graph-meta`, `.ticker`, `.chart-legend`, `.chart-ctrl` base rules from `legacy/04-compact-terminal/02-chart-graph-meta.css` into `refresh/03-stock-header-chart-controls.css`.
2. Move chart loading‑state rules from `institutional-terminal.css` into `refresh/03`.
3. Strip chart selectors from `v5-parity.css` (72 declarations).
4. Strip chart selectors from all other legacy files.
5. `compatibility.css` keeps its chart containment rules (lines 161–218) — those are the only correct home for `position: absolute; inset: 0; width: 100% !important`.
6. `refresh/07` keeps responsive `height: clamp()` for graph shells.
7. `screen-overrides.css` yields `.chart-legend` dark‑theme to `compatibility.css`.

**Difficulty:** Extreme. 11 files. No natural owner exists today. Chart containment is deeply tied to `compatibility.css`'s mandate. Requires the largest merge effort.

---

### 6. Stock Header — Score F (9 files) · HARD · ROI: High

| File | Declarations | Win % | Role |
|---|---|---|---|
| `legacy/04-compact-terminal/02-chart-graph-meta.css` | 76 | 27% | Divest to `refresh/03` |
| `legacy/06-v6-exact-size.css` | 64 | 23% | Full divest |
| `v5-parity.css` | 48 | 17% | Full divest |
| `refresh/03-stock-header-chart-controls.css` | ~40 | 14% | **Owner candidate** |
| `refresh/07-responsive-viewport-fit.css` | ~25 | 9% | Keep responsive overrides |
| `refresh/01-app-shell-topbar-indexbar.css` | ~10 | 4% | Divest (border grouping only) |
| `legacy/01-market-panel-parity.css` | ~10 | 4% | Full divest |
| `legacy/05-desktop-dashboard-surfaces.css` | ~8 | 3% | Full divest |
| `screen-overrides.css` | ~3 | 1% | Divest |

**The problem:** Stock header's `.sh-sym` font‑size is declared in 6 different files (v6: 18px, legacy/02: 22px, chart‑graph‑meta: 24px, refresh/07: 26px, refresh/03: 28px). The cascade winner (refresh/03's 28px) only wins because it imports later — not because it's the intended size.

**Actions:**
1. Move `.stock-hdr`, `.sh-sym`, `.sh-price`, `.sh-change`, `.sh-arrow`, `.sh-stats`, `.ss-item` base rules from `legacy/04-compact-terminal/02-chart-graph-meta.css` into `refresh/03-stock-header-chart-controls.css`.
2. Move `.sh-sym` font‑size variants from `legacy/06-v6-exact-size.css` into `refresh/03`.
3. Strip stock‑header selectors from `v5-parity.css`, `01-market-panel-parity.css`, `05-desktop-dashboard-surfaces.css`.
4. Remove the `.stock-hdr` / `.sh-*` border grouping from `refresh/01` (it was placed there for visual grouping, not ownership).

**Difficulty:** Hard. 9 files, font‑sizes vary by 10px across legacy layers.

---

### 7. Info Panel — Score F (14 files) · EXTREME · ROI: Medium

| File | Declarations | Win % | Role |
|---|---|---|---|
| `legacy/04-compact-terminal/03-info-panel-detail.css` | 162 | 34% | Divest to `refresh/04` |
| `legacy/01-market-panel-parity.css` | 96 | 20% | Full divest |
| `legacy/05-desktop-dashboard-surfaces.css` | 68 | 14% | Full divest |
| `refresh/04-info-panel-stock-detail.css` | ~50 | 10% | **Owner candidate** |
| `v5-parity.css` | ~40 | 8% | Full divest |
| `refresh/07-responsive-viewport-fit.css` | ~30 | 6% | Keep responsive `width` overrides |
| `compatibility.css` | ~15 | 3% | Must yield `.info-panel` layout; keep only `!important` |
| `screen-overrides.css` | ~45 | 9% | Must yield all `#s2` layout to `refresh/04`, keep only `#s5` variables |
| `institutional-terminal.css` | ~10 | 2% | Divest (rename `ix-panel` → keep in institutional) |
| Remaining legacy files | ~20 | 4% | Full divest |

**The problem:** The most fragmented component. `screen-overrides.css` overrides `#s2` layout at high specificity (`#s2 .s2-*`), which is the file loaded *last*. This means `refresh/04`'s carefully designed layout is silently overwritten by `screen-overrides.css`'s cascade position, not by intent.

**Actions:**
1. Move ALL `.info-panel`, `#s2`, `.s2-*`, `.right-col-stack`, `.ip-*`, `.stk-flags`, `.sd-shortcuts` base rules from `legacy/04-compact-terminal/03-info-panel-detail.css` into `refresh/04-info-panel-stock-detail.css`.
2. Move ALL `#s2` selectors from `screen-overrides.css` (lines 51–159) into `refresh/04` with their `body[data-theme='dark']` wrappers.
3. Strip `.info-panel` selectors from `01-market-panel-parity.css`, `05-desktop-dashboard-surfaces.css`, `v5-parity.css`.
4. `compatibility.css` keeps `.right-col-stack` layout (lines 92–111) — that is genuinely a layout‑safety pattern. Move `.info-panel` scroll rules there.
5. `institutional-terminal.css` renames `.ix-panel` explicitly to avoid overlap, or moves it entirely into `refresh/04`.

**Difficulty:** Extreme. 14 files. `screen-overrides.css`'s `#s2` section (lines 51–159) is 109 lines that must be surgically transplanted. Dark‑theme wrappers must be preserved.

---

### 8. Tables — Score F (7 files) · MEDIUM · ROI: High

| File | Declarations | Win % | Role |
|---|---|---|---|
| `legacy/04-compact-terminal/04-history-portfolio-screener.css` | 78 | 24% | Divest to `refresh/05` |
| `compatibility.css` | 74 | 23% | Keep only layout‑safety table rules (overflow, scrollbar, min‑width); divest all visual table styles |
| `refresh/05-tables-cards.css` | 62 | 19% | **Owner candidate** |
| `refresh/07-responsive-viewport-fit.css` | ~40 | 12% | Keep responsive table overrides |
| `institutional-terminal.css` | ~30 | 9% | Divest to `refresh/05` or rename to `ix-table` |
| `refresh/01-app-shell-topbar-indexbar.css` | ~20 | 6% | Divest (border grouping) |
| `legacy/05-desktop-dashboard-surfaces.css` | ~20 | 6% | Divest |

**The problem:** `compatibility.css` has 74 table declarations (23%) because it enforces `white-space: nowrap`, `text-overflow: ellipsis`, and scroll containment. These are legitimate layout‑safety rules. But it also sets table‑layout, border‑collapse, and width — which duplicate `refresh/05`.

**Actions:**
1. Move all table visual rules (striped rows, hover states, header colors) from `legacy/04-compact-terminal/04-history-portfolio-screener.css` into `refresh/05-tables-cards.css`.
2. `compatibility.css` keeps only: `overflow-x: auto`, `scrollbar-width`, `white-space: nowrap`, `text-overflow: ellipsis`, `max-width: 220px`. Strip `table-layout`, `width`, `border-collapse` (duplicated in `refresh/05`).
3. Strip `.hist-table`, `.sc-table`, `.ptable`, `.fw-table`, `.ow-table`, `.book-table` selectors from legacy files.
4. Rename `institutional-terminal.css`'s table selectors to `ix-` prefix or move into `refresh/05`.

**Difficulty:** Medium. `compatibility.css`'s 74 table declarations are well‑isolated. The diff between `compatibility.css` table rules vs `refresh/05` is easy to identify.

---

### 9. Cards — Score F (12 files) · MEDIUM · ROI: Low

| File | Declarations | Win % | Role |
|---|---|---|---|
| `legacy/04-compact-terminal/04-history-portfolio-screener.css` | 34 | 24% | Divest to `refresh/05` |
| `legacy/05-desktop-dashboard-surfaces.css` | 28 | 20% | Divest to `refresh/05` |
| `refresh/05-tables-cards.css` | 26 | 18% | **Owner candidate** |
| `refresh/07-responsive-viewport-fit.css` | ~20 | 14% | Keep responsive card padding |
| `v5-parity.css` | ~15 | 11% | Divest |
| Remaining legacy files | ~19 | 13% | Divest |

**The problem:** "Cards" is not a unified concept — there are `.ow-hero`, `.port-card`, `.fin-card`, `.fin-callout`, `.news-card`, `.s2-rich-card`, `.ow-stock-card`, `.market-card`. Each is specific to its parent component. The real card‑like elements should be owned by their parent's file, not a central "cards" file.

**Actions:**
1. Delegate card ownership to the parent component:
   - `.ow-hero`, `.ow-stock-card` → owned by `refresh/05-tables-cards.css` (OW section).
   - `.port-card` → owned by `refresh/05-tables-cards.css` (portfolio section).
   - `.s2-rich-card` → owned by `refresh/04-info-panel-stock-detail.css`.
   - `.fin-card`, `.fin-callout`, `.market-card` → move into `refresh/05-tables-cards.css`.
2. Strip `.ow-hero`, `.ow-stock-card`, `.port-card` from all legacy files.
3. Move `.fin-card` styles from `v5-parity.css` into `refresh/05`.

**Difficulty:** Medium. The main challenge is splitting card types to their correct parent owners.

---

### 10. Portfolio — Score E (7 files) · MEDIUM · ROI: Medium

| File | Declarations | Win % | Role |
|---|---|---|---|
| `legacy/04-compact-terminal/04-history-portfolio-screener.css` | 52 | 41% | Divest to `refresh/05` |
| `refresh/05-tables-cards.css` | 22 | 17% | **Owner candidate** |
| `refresh/07-responsive-viewport-fit.css` | 18 | 14% | Keep responsive grid |
| `compatibility.css` | ~10 | 8% | Divest (flex safety already applied globally) |
| `legacy/02-responsive-stabilization.css` | ~8 | 6% | Full divest |
| `legacy/05-desktop-dashboard-surfaces.css` | ~10 | 8% | Full divest |
| `institutional-terminal.css` | ~8 | 6% | Divest / rename to `ix-` |

**Actions:**
1. Move `.port-top`, `.port-card`, `.port-summary`, `.port-body` base rules from `legacy/04-compact-terminal/04-history-portfolio-screener.css` into `refresh/05-tables-cards.css`.
2. Strip portfolio selectors from `02-responsive-stabilization.css`, `05-desktop-dashboard-surfaces.css`, `compatibility.css`.
3. Rename `institutional-terminal.css`'s portfolio references.

**Difficulty:** Medium. Legacy file has 52 declarations that need careful extraction.

---

### 11. History — Score E (7 files) · MEDIUM · ROI: Low

| File | Declarations | Win % | Role |
|---|---|---|---|
| `legacy/04-compact-terminal/04-history-portfolio-screener.css` | 36 | 34% | Divest to `refresh/05` |
| `institutional-terminal.css` | 20 | 19% | Must yield hist‑section base styles (keep only `ix-` history) |
| `refresh/05-tables-cards.css` | ~15 | 14% | **Owner candidate** |
| `refresh/07-responsive-viewport-fit.css` | 10 | 9% | Keep responsive |
| Remaining files | 25 | 24% | Divest |

**Actions:**
1. Move `.hist-section`, `.hist-controls`, `.hist-title` base rules from `legacy/04-compact-terminal/04-history-portfolio-screener.css` into `refresh/05-tables-cards.css`.
2. Rename `institutional-terminal.css`'s `.hist-` selectors to `.ix-hist-` or move base styles into `refresh/05`.
3. Strip history from other legacy files.

**Difficulty:** Medium. History is a small component (106 total declarations).

---

## Migration Order (Ranked by ROI)

| Rank | Component | Difficulty | ROI | Reason |
|---|---|---|---|---|
| 1 | **Admin** | Easy | Immediate | Already 85% single‑owner; 2 files to reconcile |
| 2 | **Tables** | Medium | High | `compatibility.css` rules are well‑isolated; 7 files → 3 |
| 3 | **Cards** | Medium | Low | Delegation pattern is simple; low value visually |
| 4 | **Portfolio** | Medium | Medium | 7 files → 3; legacy file is large but self‑contained |
| 5 | **History** | Medium | Low | Small component; low visual impact |
| 6 | **Topbar** | Hard | High | High visibility; 9 files → 3; `!important` removal |
| 7 | **Indexbar** | Hard | High | Most fragmented selector (#indexbar); 8 files → 2 |
| 8 | **Watchlist** | Hard | High | 10 files → 3; two legacy files are huge |
| 9 | **Stock Header** | Hard | High | 9 files → 3; font‑size reconciliation |
| 10 | **Charts** | Extreme | Medium | 11 files; no natural owner; chart containment is tricky |
| 11 | **Info Panel** | Extreme | Medium | 14 files; `screen-overrides.css` transplant requires surgery |

---

## Files After Migration

| New State | File | Owns |
|---|---|---|
| Keep | `fonts.css` | Font‑face imports only (already single‑purpose) |
| Keep | `themes.css` | CSS custom properties only (already single‑purpose) |
| Keep | `base.css` | HTML resets, scrollbar, selection (already single‑purpose) |
| Keep | `v5-parity.css` | **Empty** (all selectors migrated to owners or deleted) — delete the file |
| Keep | `login.css` | Login/Auth screens (already single‑purpose) |
| Keep | `refresh/06-auth-and-state.css` | Auth/state screens (already single‑purpose) |
| Keep | `refresh/01-app-shell-topbar-indexbar.css` | **Topbar + Indexbar** |
| Keep | `refresh/02-watchlist-sidebar.css` | **Watchlist** |
| Keep | `refresh/03-stock-header-chart-controls.css` | **Stock Header + Charts + Chart Controls** |
| Keep | `refresh/04-info-panel-stock-detail.css` | **Info Panel** (incl. `#s2` from screen‑overrides) |
| Keep | `refresh/05-tables-cards.css` | **Tables + Portfolio + History + Cards (OW/Port)** |
| Keep | `refresh/07-responsive-viewport-fit.css` | **Responsive viewport tuning only** (no base component defaults) |
| Keep | `compatibility.css` | **Layout safety only** (containment, flex safety, scroll, grid primitives, flash animations) — stripped of component‑visuals |
| Keep | `institutional-terminal.css` | **Institutional screens** (`ix-*` prefix only) — stripped of common component selectors |
| Keep | `screen-overrides.css` | **`#s5` OW variables + dark‑theme helpers** — stripped of `#s2` layout |
| Delete | `legacy/terminal.css` | Entirely replaced by individual file migrations |
| Delete | `legacy/01-market-panel-parity.css` | Completely divested |
| Delete | `legacy/02-responsive-stabilization.css` | Completely divested |
| Delete | `legacy/03-watchlist-overrides.css` | Completely divested (merged into `refresh/02`) |
| Delete | `legacy/04-compact-terminal/01-watchlist-flags.css` | Completely divested (merged into `refresh/02`) |
| Delete | `legacy/04-compact-terminal/02-chart-graph-meta.css` | Completely divested (merged into `refresh/03`) |
| Delete | `legacy/04-compact-terminal/03-info-panel-detail.css` | Completely divested (merged into `refresh/04`) |
| Delete | `legacy/04-compact-terminal/04-history-portfolio-screener.css` | Completely divested (merged into `refresh/05`) |
| Promote | `legacy/04-compact-terminal/05-admin.css` → `admin.css` | **Admin** (keep content, rename file, move out of legacy/) |
| Delete | `legacy/04-compact-terminal/06-calendar.css` | Completely divested (merged into `refresh/05`) |
| Delete | `legacy/05-desktop-dashboard-surfaces.css` | Completely divested |
| Delete | `legacy/06-v6-exact-size.css` | Completely divested |

**End state:** 15 files (down from 29). 7 `legacy/` files deleted. `v5-parity.css` deleted. 5 `refresh/*` files each own a well‑defined component set. 3 cross‑cutting files (`compatibility.css`, `institutional-terminal.css`, `screen-overrides.css`) have strictly limited scope.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `compatibility.css` !important removals break 1366×768 layout | High | Keep 1‑2 density !important as documented exceptions. Test on 1366×768 before deploying. |
| `screen-overrides.css` #s2 transplant breaks info‑panel layout | High | Create a staging file with the transplanted #s2 rules; diff visually against production. |
| Legacy file deletion breaks CI/CD | Medium | Keep legacy files as empty stubs with a `/* DEPRECATED — content moved to refresh/N */` comment for one release cycle. |
| Height regressions in Indexbar after !important removal | Medium | Set `min-height: 40px` explicitly in owner; test at 1366×768, 1920×1080, and 2560×1440. |
| Watchlist flag animations break after legacy file merge | Medium | Flag animations (flash‑up/flash‑dn) live in `compatibility.css` — not in legacy. Should be unaffected. |
| Institutional terminal loses styling after `ix-` renaming | Low | Run a grep for every `.ix-*` selector before rename to ensure completeness. |

---

## How to Execute (Per‑Component Playbook)

For each component in migration order:

1. **Identify** all selectors in non‑owner files — `grep -rn '\.wl-' --include='*.css'`
2. **Categorize** each as: (a) already in owner file → delete, (b) unique → move to owner, (c) `!important` emergency → keep in `compatibility.css` with documented exception.
3. **Move** unique rules into the owner file (same selector, same specificity, same `body[data-theme='dark']` wrapper).
4. **Delete** duplicated rules from non‑owner files.
5. **Remove** `!important` from the owner file's canonical rules (the owner is now the source of truth).
6. **Verify** — `npm run dev`, check every viewport width and theme.

Repeat. 11 iterations. After all 11: delete empty legacy files, update `index.css` imports, commit.
