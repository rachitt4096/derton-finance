# Workstation Analysis

## Chart Width at Key Viewport Sizes

### Assumptions
- Chart lives inside `.screen` → `#screens` → `.app-shell`
- The chart occupies the `.chart-area` column in `s1-body` grid
- Watchlist sidebar (~228-280px) and info-panel (~320-438px) consume horizontal space alongside the chart
- Content cap = 1460px default, 1760px at ≥1500px

### Effective Chart Area Width

| Viewport | Content width | Sidebar | Info-panel | ~Chart width | Notes |
|----------|--------------|---------|------------|-------------|-------|
| **390px** (Mobile) | ~370px | hidden (collapse at 820) | hidden | **~370px** | Full-width chart, single column |
| **768px** (Tablet) | ~740px | hidden (820 collapse) | hidden | **~740px** | Full-width, stacked layout |
| **1366px** (Laptop) | ~1326px | 240px | 0 (laptop mode) | **~1086px** | Sidebar visible, no info-panel |
| **1920px** (Desktop) | 1760px | 240px | 360px | **~1160px** | Both panels visible |
| **2560px** (2K) | 1760px | 270px | 380px | **~1110px** | Content-capped to 1760px |
| **3840px** (4K) | 1760px | 270px | 380px | **~1110px** | Same cap, massive dead space |

### Key Finding
The chart **never exceeds ~1160px** even on a 4K monitor. The 1760px content cap plus two side panels leaves only 66% of the capped width for the chart.

## Dashboard Grid Behavior

### s1-body (main dashboard)
| Breakpoint | Layout | Behavior |
|-----------|--------|----------|
| > 820px | Grid: sidebar \| chart-area | Two-column dashboard |
| ≤ 820px | Single column | Sidebar becomes full-width, chart below |
| ≥ 821px | Desktop grid restored | v5-parity.css re-enables sidebar |

### s2 (stock detail)
| Breakpoint | Layout | Behavior |
|-----------|--------|----------|
| > 1200px | Chart + info-panel side-by-side | Row: chart (1.75fr) \| orderbook (0.72fr) |
| ≤ 1200px | Stacked | Info-panel collapses to full-width below |
| ≤ 992px | Single column | Everything stacks vertically |

### s2-bottom (metrics grid)
| Breakpoint | Layout | Behavior |
|-----------|--------|----------|
| > 1400px | 6-column grid | Full data density |
| ≤ 1400px | 3-column | Reduced columns |
| ≤ 1200px | 2-column | Compact |
| ≤ 560px | 1-column | Minimal |

## 1460px Content Cap Analysis

### Space waste at each monitor size

| Monitor | Resolution | Content width | Dead space (total) | Topbar dead space | Screens dead space |
|---------|-----------|--------------|-------------------|-------------------|-------------------|
| 14" Laptop | 1366×768 | 1326px | 40px (3%) | 40px margins | 0 (uncapped) |
| 15" Laptop | 1920×1080 | 1760px | 160px (8.3%) | 160px | 160px |
| 27" 2K | 2560×1440 | 1760px | 800px (31%) | 800px | 800px |
| 32" 4K | 3840×2160 | 1760px | 2080px (54%) | 2080px | 2080px |

### What the 1460px cap achieves
- **Readability**: Prevents line-length from exceeding comfortable reading width
- **Consistency**: App looks similar across all screen sizes above 1500px
- **Centering**: Content is centered (auto margins), feels balanced

### What it costs
- **Wasted real estate**: 4K monitors lose 54% of horizontal space to empty gutters
- **Chart area capped**: Chart never exceeds ~1160px even on massive displays
- **Dashboard grids don't scale**: `auto-fit` grids bottom out at their `minmax()` minimums rather than adding columns

## Recommendation A: Conservative Plan

**Keep desktop-oriented breakpoints.**

- Retain the 1460px/1760px content cap for topbar/indexbar (reduces reflow risk)
- Bump the content cap to `min(1920px, calc(100% - 40px))` at ≥1920px to use more 4K space
- Collapse breakpoints to **9 tiers**: 560, 760, 820, 900, 1024, 1200, 1400, 1600, 1920
- Merge the 1366px rule into 1400px
- Merge 1500px into 1600px
- **No layout migrations** — just consolidate existing breakpoints into fewer values

| Effort | Risk | Benefit |
|--------|------|---------|
| Low (merge @media blocks, update values) | Low | Slightly cleaner code |

## Recommendation B: Aggressive Plan

**Reduce to 5 breakpoint tiers.**

| Tier | Target | Key behavior |
|------|--------|-------------|
| `< 640px` | Mobile phones | Single column, compact topbar, hidden sidebar, bare-minimum spacing |
| `640–899px` | Tablets | Full-width chart, stacked panels, watchlist as search-only |
| `900–1365px` | Laptops | Sidebar visible, info-panel toggleable, compact grids |
| `1366–1919px` | Desktops | Both panels visible, 6-column s2-bottom, full nav |
| `≥ 1920px` | 4K workstations | Content cap at 80vw or `min(2200px, 95vw)`, additional dashboard columns |

### Required changes
1. **Merge all mobile tiers** (560, 720, 760, 800, 820) → single `<640px` + `640-899px`
2. **Merge all laptop tiers** (900, 920, 980, 992, 1024, 1120, 1180, 1200, 1240, 1280) → single `900-1365px`
3. **Merge all desktop tiers** (1366, 1400, 1440, 1500) → `1366-1919px`
4. **Expand content cap at ≥1920px** to reduce 4K waste
5. **Introduce `640px` breakpoint** (doesn't exist today) for true mobile tier

| Effort | Risk | Benefit |
|--------|------|---------|
| High (rewrite 52 @media blocks across 19 files) | Medium | 23→5 breakpoints, 17% of current complexity |

### Files requiring the most attention
| File | @media blocks | Key merger |
|------|-------------|-----------|
| `refresh/07-responsive-viewport-fit.css` | 14 | Merge 1200+980+760 into 2 tiers |
| `compatibility.css` | 7 | Merge 1120+1180+1366+1440 |
| `legacy/02-responsive-stabilization.css` | 5 | Merge into 3 tiers |
| `legacy/05-desktop-dashboard-surfaces.css` | 6 | Merge 820+1024+1280 |
| `institutional-terminal.css` | 4 | Already clean (1200 + 760×3) |

## Summary

The 1460px content cap is a reasonable constraint for laptop users but wastes significant space on 4K workstations. The primary path forward depends on whether Derton's user base skews toward:

- **Traders with multi-monitor setups** → Conservative plan (prioritize stability)
- **4K workstation users** → Aggressive plan (unlock screen real estate)
- **Mobile/tablet users growing** → 640px tier introduction needed regardless

The 5-tier proposal (640/900/1366/1920/2400+) would reduce breakpoint complexity by 78% while adding a proper mobile tier and better 4K utilization.
