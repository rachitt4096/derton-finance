# Phase F — Migration Validation Report

**Goal:** Disprove or validate the Phase E migration plan for the first wave (Admin, Tables, Cards, Portfolio, History).

**Method:** Read all 29 CSS files (15,300+ lines). Build exact dependency maps. Challenge every assumption.

---

## 1. CRITICAL DISCOVERIES THAT UNDERMINE THE PLAN

### 1a. The `:is()` Cross-Component Group in `refresh/01`

`refresh/01-app-shell-topbar-indexbar.css` lines 341–375:

```css
:is(
  .wl-sidebar, .graph-shell, .graph-meta, .info-panel, .stock-hdr,
  .band-bar, .chart-ctrl, .ind-panel, .s2-chart, .s2-col, .s2-rich-card,
  .hist-section, .sc-filter-bar, .sc-table-wrap, .sc-sidebar, .sc-summary,
  .port-card, .port-table-wrap, .port-side, .ow-hero, .ow-stock-card,
  .ow-table-wrap, .fw-summary-bar, .fw-table-wrap, .fw-side,
  .book-header, .port-table-wrap, .book-table-wrap
) {
  border: 1px solid var(--line-soft);
  border-radius: var(--rd-sm);
  background: var(--bg1);
  box-shadow: none;
}
```

This single rule spans **20+ selectors across every component in the system**. It sets the canonical `border`, `border-radius`, `background`, and `box-shadow` for nearly every visible panel.

**Impact:** You cannot migrate ANY component listed here independently. The panel background/border is a system-wide design token applied to ALL components simultaneously. Splitting this into per-component files would require duplicating the same 4 declarations into every owner file.

**Confidence:** The plan's per-component migration approach is architecturally flawed for this pattern. The canonical panel styling is NOT per-component — it is a system-wide visual baseline.

### 1b. `refresh/07` is NOT a "responsive only" file — it is a LAYOUT OWNER

`refresh/07-responsive-viewport-fit.css` (1091 lines) contains:

- **Flexbox layout engine:** `.s1-body`, `.sc-body`, `.port-body`, `.fw-body` display:flex rules (lines 754–763)
- **Grid layout rules:** `.port-top`, `.sc-summary`, `.fw-summary-bar`, `.ow-hero`, `.ow-cards-grid` grid definitions (lines 795–811)
- **Component sizing:** `.wl-sidebar` width/flex (lines 765–770), `.info-panel` width/flex (lines 780–785), `.sc-sidebar`/`.port-side`/`.fw-side` sizing (lines 787–793)
- **Fluid sizing:** CSS `clamp()` and `min()` math for every panel (lines 689–693)
- **Chart heights:** `#s1 .graph-shell` clamp (lines 504–507), `.s2-chart` clamp (lines 509–511)
- **Base component defaults outside @media:** `.wl-sidebar` width 248px (line 413), `.info-panel` width 320px (line 416), `.stock-hdr` padding (line 445), `.sh-sym` font-size 26px (line 449), `.sh-price` font-size 34px (line 453)
- **6 @media blocks:** 1365px, 899px, 1366px+, 1920px+, 980px height, 860px height, 1150px height

**Impact:** The plan says "empty it of component layout defaults" — but those defaults ARE the responsive/fluid layout. Without them, every panel collapses to `width: auto` or `width: 100%`. `refresh/07` IS a layout owner, not a tuning layer.

**Confidence:** The plan fundamentally mischaracterizes `refresh/07`.

### 1c. OW (Opening Window) spans 7+ files — treated as Admin sub-component

The plan treats `.ow-*` as an Admin sub-component. It is NOT.

| File | Selectors |
|---|---|
| `04-history-portfolio-screener.css` | `.ow-summary-strip`, `.ow-table-wrap`, `.ow-table` |
| `05-admin.css` | `.ow-shell`, `.ow-headbar`, `.ow-h-title`, `.ow-sub`, `.ow-head-meta`, `.ow-countdown`, `.ow-status`, `.ow-filter-bar`, `.ow-filter-group`, `.ow-clear-btn`, `.ow-download-btn`, `.ow-radio`, `.ow-summary-strip`, `.ow-table-wrap`, `.ow-table` |
| `05-desktop-dashboard-surfaces.css` | `.ow-gap-hero`, `.ow-gap-value`, `.ow-gap-label`, `.ow-mini-bars`, `.ow-detail-list`, `.ow-detail-row` |
| `v5-parity.css` | `.ow-gap-big`, `.ow-gap-val`, `.ow-gap-lbl`, `.ow-row`, `.ow-rl`, `.ow-rv`, `.mini-bars`, `.mini-bar-c` |
| `refresh/05-tables-cards.css` | `.ow-hero`, `.ow-h-title`, `.ow-countdown`, `.ow-status`, `.ow-stock-card`, `.owc-sym`, `.owc-co`, `.owc-gap` |
| `refresh/07-responsive-viewport-fit.css` | `.ow-hero`, `.ow-status`, `.ow-countdown`, `.ow-stock-card`, `.ow-cards-grid`, `.owc-gap` |
| `screen-overrides.css` (entire `#s5`) | `.ow-summary-strip`, `.ow-table-wrap`, `.ow-table`, `.ow-*` |

**Impact:** Any migration of Admin, History, Portfolio, or Tables that touches `04-history-portfolio-screener.css` or `05-admin.css` must handle `.ow-*` selectors. They cannot be blindly deleted or moved — they belong to a separate component.

**Confidence:** The plan's claim that Admin is "2 files" is wrong. Admin touches `.admin-*` in 2 files, but `05-admin.css` also declares `.ow-*` (which belongs to OW) and `.fw-*` (which belongs to FW).

### 1d. `04-history-portfolio-screener.css` is a 5-component file

This 450-line file contains selectors for:

| Lines | Component | Selectors |
|---|---|---|
| 1–76 | History | `.hist-section`, `.hist-head`, `.hist-title`, `.hist-sub`, `.hist-table-wrap`, `.hist-table` |
| 78–83 | General | `#s3`, `#s4`, `#s5`, `#s6` background |
| 85–217 | Screener | `.sc-filter-bar`, `.sc-filter-label`, `.fchip`, `.sc-body`, `.sc-table-wrap`, `.sc-table`, `.sc-sym`, `.sc-co`, `.star-btn`, `.sc-sidebar`, `.sc-wl-item` |
| 219–237 | Screener summary | `.sc-summary`, `.sc-sum-item`, `.sc-sum-l` |
| 239–271 | Portfolio | `.port-top`, `.port-card`, `.pc-l`, `.pc-v`, `.pc-c` |
| 273–317 | Portfolio tables | `.port-body`, `.port-main`, `.port-table-wrap`, `.ptable` |
| 319–322 | Sparkline | `.spark` |
| 324–358 | Book/Order | `.book-header`, `.book-title`, `.inline-tabs`, `.book-table-wrap`, `.port-side` |
| 360–450 | Portfolio sidebar | `.port-side-tabs`, `.pst`, `.port-side-body`, `.port-entry-form`, `.port-entry-grid` |
| 584–690 | **OW** | `.ow-summary-strip`, `.ow-table-wrap`, `.ow-table`, `.ow-symbol-cell`, `.ow-expand-btn` |
| 692–906 | FW (Fraud Watch) | `.fw-summary-bar`, `.fw-count`, `.fw-actions`, `.fw-body`, `.fw-table-wrap`, `.fw-table`, `.sev-badge`, `hm-*`, `.overlay`, `.modal` |

**Impact:** This file cannot be "divested to refresh/05" in one step. It contains 5 components and must be decomposed first. Any migration of "History" or "Portfolio" from this file requires preserving the Screener, OW, and FW selectors that share the same file.

**Confidence:** The plan's claim that "move history from legacy/04" is straightforward is incorrect. The file is a monolith.

### 1e. Admin has hidden responsive dependency on `05-desktop-dashboard-surfaces.css`

`05-admin.css` (906 lines) has exactly **zero** @media queries. All admin responsive behavior is in `05-desktop-dashboard-surfaces.css`:

```css
/* lines 1027-1038 */
@media (max-width: 1365px) {
  .admin-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .admin-body { grid-template-columns: 1fr; }
  .admin-main { border-right: 0; border-bottom: 1px solid var(--border); }
}
/* lines 1102-1133 */
@media (max-width: 899px) {
  .admin-top { flex-direction: column; }
  .admin-card-grid { grid-template-columns: 1fr; }
  .admin-side { padding: 12px; }
}
```

These 11 admin-specific rules are embedded in a 1400-line file alongside overrides for info-panel, chart-legend, s2-bottom, port-top, ow-cards-grid, hist-section, etc.

**Impact:** To migrate Admin, you must either:
- Extract the responsive rules from `05-desktop-dashboard-surfaces.css` (surgery on a shared file)
- Or duplicate them in the admin owner

Either way, it's more work than "just move the file."

### 1f. `compatibility.css` chart !important are PERMANENT

The plan says to remove `!important` from `compatibility.css`. But these specific `!important` declarations are required because TradingView's Lightweight Charts library sets inline `width`/`height` on chart canvas elements:

```css
/* lines 168-218 */
.graph-shell > .chart-wrap { width: 100% !important; height: 100% !important; }
.chart-wrap > .tv-chart { width: 100% !important; height: 100% !important; }
.native-chart-wrap { width: 100% !important; height: 100% !important; }
```

8 out of 16 `!important` declarations in `compatibility.css` are for chart containment. These can **never** be removed because:
1. The chart library sets inline `width`/`height` on mount
2. CSS can only override inline styles with `!important`
3. Without these, chart canvases collapse to 0×0 or their JavaScript fallback size

### 1g. Calendar has history dependency

`legacy/04-compact-terminal/06-calendar.css` lines 136–143:
```css
.sd-modal-body .hist-section {
  height: calc(100vh - 190px);
  min-height: 520px;
  border-top: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  overflow: hidden;
}
```

This overrides `.hist-section` height when it appears inside a stock detail modal. If `.hist-section` is migrated to `refresh/05`, this override must follow it. This is a hidden cross-file dependency the plan missed.

---

## 2. PER-COMPONENT VALIDATION

### 2a. ADMIN

| Metric | Value |
|---|---|
| Files with admin selectors | 2 (`05-admin.css`, `05-desktop-dashboard-surfaces.css`) |
| Total admin declarations | ~200 |
| admin-* unique selectors | Yes — all prefixed `.admin-*`, zero overlap |
| Cross-component selectors | None (but `05-admin.css` also has `.ow-*` and `.fw-*` for OTHER components) |
| Breakpoints | 2 (1365px, 899px) both in `05-desktop-dashboard-surfaces.css` |
| !important | 0 |
| `:is()` group | Not in refresh/01 group |
| refresh/07 dependency | None |
| Dark theme | None specific to admin |
| Calendar dependency | None |
| Institutional dependency | None |

**If we migrate admin:**
- Move `05-admin.css` → `admin.css` (out of legacy/)
- Extract 11 lines of admin responsive rules from `05-desktop-dashboard-surfaces.css` into `admin.css`
- Strip `.ow-*` and `.fw-*` from `05-admin.css` (belong to other components — leave behind)
- Delete `05-admin.css` original

**BUT:** Extracting just the 11 admin lines from `05-desktop-dashboard-surfaces.css` without touching the 1389 other lines in that file is possible but requires surgical precision.

**Verdict: SAFE TO MIGRATE (EASY)**
The plan's #1 recommendation is correct. Admin is the safest first migration. However, the effort is slightly higher than stated because:
- `.ow-*` and `.fw-*` must be left behind in the original file (they don't belong to admin)
- The responsive rules must be surgically extracted

### 2b. TABLES

| Metric | Value |
|---|---|
| Files with table selectors | 7+ |
| Total table declarations | ~324 |
| Unique table selectors | Partially — `.hist-table`, `.sc-table`, `.ptable`, `.ow-table`, `.fw-table` are each unique to their component |
| Cross-component selectors | `:is(.insight-table, .hist-table, .sc-table, .ptable, .ow-table, .fw-table)` in refresh/05 — this is a SHARED rule |
| `[class*="table-wrap"]` in compatibility.css | A WILDCARD that catches ALL table wrappers |
| Breakpoints | 4+ across multiple files |
| !important | 0 for visual, but `compatibility.css` uses it for scroll containment |
| `:is()` group | refresh/01 includes `.sc-table-wrap`, `.ow-table-wrap`, `.fw-table-wrap`, `.port-table-wrap`, `.book-table-wrap` |
| Dark theme | `screen-overrides.css` has `#s5 .ow-table` rules (specific to OW, not general tables) |

**The `:is()` trap:** `refresh/05-tables-cards.css` lines 11–44:
```css
:is(.insight-table, .hist-table, .sc-table, .ptable, .ow-table, .fw-table) {
  width: 100%; border-collapse: separate; border-spacing: 0;
}
:is(...) thead th { padding: 12px 14px; ... }
:is(...) tbody td { padding: 12px 14px; ... }
:is(...) tbody tr:hover td { background: ... }
:is(...) tbody tr:last-child td { border-bottom: 0; }
```

These 5 rules apply to **all 6 table types simultaneously**. You cannot move `.hist-table` to a "history owner" without also moving `.sc-table`, `.ptable`, `.ow-table`, `.fw-table` — they share the same rule block. Splitting the `:is()` into individual selectors per table type would mean duplicating the same 5 declarations 6 times.

**If we migrate tables:**
- You'd need to break the `:is()` into per-table selectors (6× the declarations)
- Or accept that `refresh/05` remains the owner for ALL table types (not per-component)

**Verdict: MIGRATE WITH REVIEW (HARD — harder than stated)**
Tables cannot be per-component owners. The `:is()` group forces a shared owner. The plan's migration for tables is correct only if the goal is "tables go to refresh/05" as a group, not individually.

### 2c. CARDS

| Metric | Value |
|---|---|
| Files with card selectors | 12+ |
| Card concept | **Not unified** — `.port-card`, `.ow-hero`, `.ow-stock-card`, `.s2-rich-card`, `.fin-card`, `.fin-callout`, `.fin-card-new`, `.market-card` are all different |
| Cross-component selectors | `.port-card` is unique to portfolio; `.ow-hero` is unique to OW; no shared card types |
| Breakpoints | Port-card sizing in refresh/07; s2-rich-card in 05-desktop-dashboard-surfaces |
| `:is()` group | refresh/01 includes `.port-card`, `.s2-rich-card`, `.ow-stock-card`, `.ow-hero` |
| Current refresh/05 owns | `.ow-hero`, `.ow-stock-card`, `.port-card` |
| Current refresh/04 owns | `.s2-rich-card` (or should) |

**If we migrate cards:**
- This is not a single-component migration. Each "card type" belongs to its parent component.
- `.port-card` → Portfolio (refresh/05)
- `.ow-hero`, `.ow-stock-card` → OW (refresh/05)
- `.s2-rich-card` → Info Panel (refresh/04)
- `.fin-card`, `.fin-callout` → Info Panel (refresh/04)

**But:** Every card type documented here is already in its intended parent file. The migration is already done! The only work is stripping legacy duplicates.

**Verdict: SAFE TO MIGRATE (EASY — but already done)**
Cards are essentially already migrated. The remaining work is cleanup of legacy duplicates. The plan correctly delegates to parent owners.

### 2d. PORTFOLIO

| Metric | Value |
|---|---|
| Files with portfolio selectors | 7 |
| Total portfolio declarations | ~128 |
| Unique selectors | `.port-top`, `.port-card`, `.port-body`, `.port-main`, `.port-table-wrap`, `.ptable`, `.port-side`, `.port-side-body`, `.port-side-tabs`, `.pst`, `.port-entry-*` |
| Cross-component | `.port-side` in `:is()` group (refresh/01); `.port-card` in `:is()` group (refresh/01); `.port-table-wrap` in `:is()` group |
| Breakpoints | `port-top` grid changes at 1365px (02-responsive), 899px (05-desktop), 639px (02-responsive), plus all the ones in refresh/07 |
| Shared file | `04-history-portfolio-screener.css` shares space with History, Screener, Book, OW, FW |
| Dark theme | Nothing specific |
| refresh/07 | `.port-top` gap/breakpoints, `.port-card` padding/min-height at multiple breakpoints |

**Critical problem:** The source file `04-history-portfolio-screener.css` cannot be deleted after portfolio extraction because it also contains:
- `.hist-*` (History)
- `.sc-*` (Screener)
- `.book-*` (Book)
- `.ow-*` (OW)
- `.fw-*` (FW)

**If we migrate portfolio:**
- Must surgically extract `.port-*`, `.pc-*`, `.ptable`, `.pst`, `.port-entry-*` from `04-history-portfolio-screener.css`
- Must preserve the other component selectors in the source file
- Must move responsive overrides from `02-responsive-stabilization.css` and `05-desktop-dashboard-surfaces.css`
- Must account for `:is()` groups in refresh/01 and refresh/07
- refresh/07 already has `.port-card` rules — those conflict with what the new owner declares

**Verdict: DO NOT MIGRATE YET (EXTREME — harder than stated)**
Portfolio cannot be migrated independently because:
1. Its source file is a 5-component monolith
2. Its responsive behavior is spread across 3 legacy files + refresh/07
3. The `:is()` group in refresh/01 sets portfolio panel border/background — moving these would break consistency
4. refresh/07 overrides `.port-card` padding/min-height at every breakpoint — these would need reconciliation

### 2e. HISTORY

| Metric | Value |
|---|---|
| Files with history selectors | 8 |
| Total history declarations | ~106 |
| Unique selectors | `.hist-section`, `.hist-head`, `.hist-title`, `.hist-sub`, `.hist-table-wrap`, `.hist-table` |
| Cross-component | `.hist-section` in `:is()` group (refresh/01); `.hist-table` in `:is()` group (refresh/05); `.hist-title` style shared with `.sc-sb-title`, `.book-title` (refresh/07) |
| Calendar dependency | `.sd-modal-body .hist-section` in `06-calendar.css` |
| Institutional dependency | `.hist-controls`, `.hist-symbol-input`, `.hist-date-input`, `.hist-interval-group`, `.hist-chart-shell`, `.hist-empty` in `institutional-terminal.css` |
| Breakpoints | 1365px height change (05-desktop), 899px height change (05-desktop), plus refresh/07 responsive |
| !important | 0 |
| Dark theme | Nothing specific |

**The institutional overlap:** `institutional-terminal.css` (lines 1292–1358) has a full set of history UI controls — inputs, interval selectors, chart shells. These are NOT part of the history table — they're the exploration UI for a different history view (probably `#ix-workspace`). But they share the `.hist-*` prefix.

If history table styles move to `refresh/05`, the `.hist-*` controls in `institutional-terminal.css` would still target the same class names. This creates a NEW ownership conflict — or forces renaming the institutional ones to `.ix-hist-*`.

**If we migrate history:**
- Must extract `.hist-*` from `04-history-portfolio-screener.css` (shared monolith)
- Must handle `.sd-modal-body .hist-section` override in `06-calendar.css`
- Must rename institutional history controls to `.ix-hist-*` or they'll conflict
- Must account for `:is()` groups
- The responsive overrides in `05-desktop-dashboard-surfaces.css` set `.hist-section` height at 3 breakpoints

**Verdict: DO NOT MIGRATE YET (HARD — mischaracterized as Medium)**
History has 3 hidden dependencies the plan missed:
1. Calendar override (`06-calendar.css`)
2. Institutional controls (`institutional-terminal.css` — naming conflict)
3. Shared `:is()` group with `refresh/01` (panel border/background)

---

## 3. RESPONSIVE DEPENDENCY MAP

Every component in the first wave depends on `refresh/07` for its responsive sizing:

| Component | refresh/07 rules |
|---|---|
| Admin | None (✅ independent) |
| Tables | `:is(.insight-table, .hist-table, .sc-table, .ptable, .ow-table, .fw-table)` thead/tbody padding/font-size at root and in @media |
| Cards | `.port-card` padding, `.ow-hero` grid/breakpoints, `.s2-rich-card` padding |
| Portfolio | `.port-top` gap/breakpoints, `.port-card` min-height/padding, `.port-side` in `:is()` radius group |
| History | `.hist-section` in `:is()` radius group (refresh/01 `:is()` has `.hist-section`) |

`refresh/07` is the **sole source of viewport-fit sizing** for all panels. You cannot migrate any of these components without either:
- Duplicating the responsive rules in the new owner (defeating the purpose of centralization)
- Keeping responsive rules in `refresh/07` even after migration (acceptable — `refresh/07` can remain a responsive layer)

---

## 4. THEME DEPENDENCY MAP

| Component | Dark theme rules | Where |
|---|---|---|
| Admin | None | ✅ |
| Tables | `#s5 .ow-table` dark theme | `screen-overrides.css` (only OW tables, not general) |
| Cards | `.s2-rich-card` no dark theme | ✅ |
| Portfolio | None | ✅ |
| History | None | ✅ |

**No dark-theme blockers for first wave.** Admin, Tables, Cards, Portfolio, History have no `body[data-theme='dark']` dependencies.

---

## 5. ROADMAP CHALLENGE — REVISED ORDER

### Original Order:
1. Admin — EASY
2. Tables — MEDIUM
3. Cards — MEDIUM
4. Portfolio — MEDIUM
5. History — MEDIUM
6–11. The rest (Hard/Extreme)

### What's wrong:
- **Tables (#2) → Move down.** The `:is()` group forces shared ownership. Migrating "tables" doesn't reduce complexity because the grouped rule can't be split without duplication.
- **Portfolio (#4) → DO NOT MIGRATE.** Source file is a 5-component monolith. Responsive behavior is scattered. Deadlock with refresh/07.
- **History (#5) → DO NOT MIGRATE.** Institutional naming conflict. Calendar override. `:is()` entanglement.
- **Cards (#3) → Already done.** The card migration is essentially complete. Only legacy cleanup remains.

### Validated Order:

| Rank | Component | Difficulty | Verdict |
|---|---|---|---|
| 1 | **Admin** | Easy | **SAFE TO MIGRATE** — but must strip `.ow-*`/`.fw-*` first |
| 2 | **Cards** | Easy | **SAFE TO MIGRATE** — already mostly migrated; only legacy cleanup |
| 3 | **Tables** | Medium | **MIGRATE WITH REVIEW** — `:is()` group prevents per-table ownership; must move as a group |
| — | Portfolio | Extreme | **DO NOT MIGRATE YET** — 5-component monolith, scattered responsive rules |
| — | History | Hard | **DO NOT MIGRATE YET** — institutional/calendar overlap, `:is()` entanglement |

---

## 6. DECLARATION ACCOUNTING PER COMPONENT

### ADMIN — What moves:

| Source | Declarations | Destination |
|---|---|---|
| `legacy/04-compact-terminal/05-admin.css` | 186 | `admin.css` (keep all `.admin-*`) |
| `legacy/05-desktop-dashboard-surfaces.css` admin responsive | 11 | `admin.css` (extract from @media blocks) |
| `.ow-*` in `05-admin.css` | ~120 | **Leave behind** (belongs to OW) |
| `.fw-*` in `05-admin.css` | ~60 | **Leave behind** (belongs to FW) |
| `:is()` group in `refresh/01` | 0 | No admin selectors affected |

**Moves:** 197 | **Deletes:** 0 | **Retained (source):** 180 (OW+FW) | **Files affected:** 2→1

### TABLES — What moves (as a group):

| Source | Declarations | Destination |
|---|---|---|
| `legacy/04-compact-terminal/04-history-portfolio-screener.css` (table rules) | 78 | `refresh/05-tables-cards.css` |
| `compatibility.css` (table containment) | 15 | Keep in `compatibility.css` |
| `refresh/05-tables-cards.css` (existing) | 62 | Already in destination |
| `:is()` group expansion | 0 | Must expand `:is()` → 6× per-table selectors = 30 new declarations |

**Moves:** 78 | **Duplicates created:** 30 | **Files affected:** 5→2

### CARDS — What moves:

| Source | Declarations | Destination |
|---|---|---|
| `legacy/04-compact-terminal/04-history-portfolio-screener.css` (`.port-card`) | 20 | Already in `refresh/05` |
| `legacy/05-desktop-dashboard-surfaces.css` (`.fin-callout`) | 10 | Already in `refresh/04` or `v5-parity` |
| `v5-parity.css` (`.fin-card-new`) | 15 | `refresh/05` |
| `05-admin.css` (`.ow-hero`, `.ow-stock-card`) | 20 | Already in `refresh/05` |

**Moves:** 0 (already in destination) | **Deletes:** 45 (legacy duplicates) | **Files affected:** 4 cleanups

---

## 7. COMPLEXITY REDUCTION ESTIMATES

| Metric | Current | After First Wave | Reduction |
|---|---|---|---|
| Total CSS files | 29 | 27 (delete 05-admin.css, merge card rules) | −7% |
| Legacy files | 12 | 11 (delete 05-admin.css) | −8% |
| Files with admin selectors | 2 | 1 | −50% |
| Files with table selectors | 7 | 5 | −29% |
| Files with portfolio selectors | 7 | 7 | 0% (not touched) |
| Files with history selectors | 8 | 8 | 0% (not touched) |
| `!important` declarations | 51 | 51 | 0% (none in first wave) |
| Ownership conflicts (3+ files) | 35+ | 35+ | 0% (none in first wave) |

The first wave removes only 1 file from the 29 and reduces file-count-of-selectors only for admin (−50%) and tables (−29%). Portfolio and history remain untouched.

---

## 8. REVISED EXECUTION ORDER

### Actually Safe to Migrate:

1. **Admin** — Straightforward. Extract `.ow-*`/`.fw-*` first. Extract 11 responsive lines. Move to root.
2. **Cards** — Already done. Delete legacy duplicates from `04-history-portfolio-screener.css`, `05-desktop-dashboard-surfaces.css`, `v5-parity.css`.
3. **Tables (as group)** — Expand `:is()` to individual selectors. Move table rules from `04-history-portfolio-screener.css` to `refresh/05`. Keep `compatibility.css` containment as-is.

### Must wait for deeper analysis:

4. **Tables (per-component)** — Blocked by `:is()` group. Needs architecture decision: do we accept 6× duplication or keep the group?
5. **Portfolio** — Blocked by 5-component monolith. Must decompose `04-history-portfolio-screener.css` first.
6. **History** — Blocked by institutional naming conflict and calendar override.

---

## 9. CONFIDENCE SCORES

| Component | MIGRATE NOW | Confidence | Reason |
|---|---|---|---|
| Admin | YES | 95% | Safest first step. No cross-component dependencies. |
| Cards | YES | 90% | Already done. Only legacy cleanup needed. |
| Tables | WITH REVIEW | 70% | Must expand `:is()` group; no per-component ownership possible |
| Portfolio | NO | 20% | 5-component monolith, scattered responsive rules |
| History | NO | 15% | Institutional naming conflict, calendar override, `:is()` entanglement |

---

## 10. SUMMARY OF PLAN FAILURES

The Phase E plan was wrong about:

1. **`refresh/07` role** — It called it a "tuning layer." It's a layout owner for every component.
2. **Portfolio/History difficulty** — Called Medium. Actually Extreme/Hard due to shared monolith file.
3. **Admin effort** — Called "2 files." But `05-admin.css` also declares `.ow-*` and `.fw-*` for other components.
4. **Table ownership model** — Assumed per-component ownership. The `:is()` group prevents this without 6× duplication.
5. **Cards as "migration"** — Cards are already in their intended owners. No migration needed, only cleanup.
6. **History independence** — Missed the calendar override (`06-calendar.css`) and institutional conflict (`institutional-terminal.css`).
7. **!importance removability** — Chart `!important` are permanent (TradingView inline styles).
8. **The `:is()` cross-component group** — Missed entirely. This single rule in `refresh/01` ties 20+ selectors across all components together.

### What survives:
- **Admin first** ✅ Correct priority, slightly more work than stated
- **Cards second** ✅ Already positioned correctly
- **Tables third** ✅ Correct tier, but must move as group not per-component

### What changes:
- **Portfolio** → Remove from first wave. Defer to second wave after monolith decomposition.
- **History** → Remove from first wave. Defer to wave that handles institutional-terminal.css renaming.
- **`is()` group** → Must be dealt with BEFORE any second-wave migration. This is a Phase E.5 prerequisite.
