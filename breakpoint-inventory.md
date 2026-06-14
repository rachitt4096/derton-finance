# Breakpoint Inventory

## Summary

| Metric | Count |
|--------|-------|
| Total `@media` blocks | **52** |
| CSS files containing `@media` | **19** |
| Unique width breakpoint values | **23** |
| Height breakpoints | **3** (max-height: 980, 860; min-height: 1150) |

## Unique Width Breakpoint Values (sorted)

| Value | Direction | Count | Current tier |
|-------|-----------|-------|-------------|
| 560px | max-width | 4 | Mobile |
| 720px | max-width | 1 | Mobile |
| 760px | max-width | 8 | Mobile |
| 800px | max-width | 1 | Tablet |
| 820px | max-width | 7 | Tablet |
| 821px | min-width | 3 | Tablet+ |
| 900px | max-width | 1 | Laptop |
| 920px | max-width | 1 | Tablet |
| 980px | max-width | 2 | Tablet |
| 992px | max-width | 1 | Tablet/Laptop |
| 1024px | max-width | 1 | Tablet/Laptop |
| 1120px | max-width | 2 | Laptop |
| 1180px | max-width | 2 | Laptop |
| 1200px | max-width | 5 | Laptop |
| 1240px | max-width | 1 | Laptop |
| 1280px | max-width | 1 | Desktop |
| 1366px | max-width | 1 | Desktop |
| 1400px | max-width | 1 | Desktop |
| 1440px | max-width | 1 | Desktop |
| 1500px | min-width | 1 | Desktop+ |
| 1600px | min-width | 2 | Large Desktop |
| 1760px | max-width (content cap) | 1 | Large Desktop |
| 1920px | min-width | 1 | 4K |

## Breakpoint Distribution by File

### `refresh/07-responsive-viewport-fit.css` (14 @media blocks)
| Breakpoint | What it controls |
|---|---|
| max-width: 1200px | Topbar/indexbar shrink, reduced spacing |
| max-width: 980px | Medium screen adjustments |
| max-width: 760px | Mobile compact layout |
| max-width: 1240px | Info-panel width reductions |
| max-width: 1120px | Content density tweaks |
| min-width: 1500px | Content cap expands from 1460px → 1760px |
| max-height: 980px | Short screen vertical compaction |
| max-height: 860px | Very short screen tight layout |
| min-width: 1600px | Wider desktop adjustments |
| min-height: 1150px | Tall screen spacing |

### `institutional-terminal.css` (4 @media blocks)
| Breakpoint | What it controls |
|---|---|
| max-width: 1200px | Collapse nav layout, info-panel size |
| max-width: 760px | Mobile stacking (3 blocks, same rule) |

### `compatibility.css` (7 @media blocks)
| Breakpoint | What it controls |
|---|---|
| min-width: 1600px | Watchlist sidebar charter compat |
| max-width: 1120px | Tight dashboard widths |
| max-width: 800px | Mobile sidebar override |
| max-width: 1440px | Chart area sizing |
| max-width: 1366px | Topbar/indexbar tighter spacing |
| min-width: 1920px | 4K content spacing |
| max-width: 1180px | S1-body grid column tweak |

### `v5-parity.css` (2 @media blocks)
| Breakpoint | What it controls |
|---|---|
| min-width: 821px | Desktop parity — watchlist, info-panel, chart, nav |
| max-width: 820px | Mobile fallback for parity overrides |

### `legacy/02-responsive-stabilization.css` (5 @media blocks)
| Breakpoint | What it controls |
|---|---|
| max-width: 1400px | Info-panel width, portfolio grids |
| max-width: 1200px | Topbar wrap, indexbar shrink, grid changes |
| max-width: 992px | Full column layout, sidebar collapse |
| max-width: 760px | Compact topbar, reduced spacing |
| max-width: 560px | Minimal mobile layout, single column |

### `legacy/05-desktop-dashboard-surfaces.css` (6 @media blocks)
| Breakpoint | What it controls |
|---|---|
| max-width: 1280px | Medium desktop grid reduction |
| max-width: 1024px | Small desktop viewport adapt |
| max-width: 820px | Sidebar collapse, column stack |
| max-width: 560px | Mobile single column |
| min-width: 821px (×2) | Desktop surface overrides |

### Other files
| File | @media count | Breakpoints |
|------|-------------|-------------|
| `legacy/01-market-panel-parity.css` | 2 | 820, 560 |
| `legacy/03-watchlist-overrides.css` | 3 | 820 (×3) |
| `legacy/04-compact-terminal/01-watchlist-flags.css` | 1 | 820 |
| `legacy/04-compact-terminal/02-chart-graph-meta.css` | 3 | 1600, 1200, 900 |
| `legacy/06-v6-exact-size.css` | 1 | 760 |
| `login.css` | 2 | 920, 560 |
| `screen-overrides.css` | 2 | 1180, 720 |
| `01-app-shell-topbar-indexbar.css` | 0 | (inline width constraints instead) |

## Content Cap Analysis

### Current behavior
- **Default** (#topbar, #indexbar): `width: min(1460px, calc(100% - 40px))`
- **Default** (#screens .screen): `max-width: 1460px`
- **≥1500px** (#topbar, #indexbar): `width: min(1760px, calc(100% - 12px))`
- **≥1500px** (#screens .screen): `max-width: 1760px`

### Effective content width at key viewport sizes
| Viewport | Content cap | Used width | Wasted | Waste % |
|----------|-------------|------------|--------|---------|
| 390px (mobile) | none (100% - gutters) | ~370px | 0 | 0% |
| 768px (tablet) | none | ~740px | 0 | 0% |
| 1366px (laptop) | 1460px | ~1326px | 0 | 0% |
| 1920px (desktop) | 1760px | 1760px | 160px | 8.3% |
| 2560px (2K) | 1760px | 1760px | 800px | 31% |
| 3840px (4K) | 1760px | 1760px | 2080px | 54% |

## Proposed 5-Tier Migration Mapping

| Proposed tier | Replaces these breakpoints | Files affected |
|--------------|---------------------------|----------------|
| `< 640px` (Mobile) | 560px, 720px | 6 files |
| `640-899px` (Tablet) | 760px, 800px, 820px, 900px, 920px | 12 files |
| `900-1365px` (Laptop) | 980px, 992px, 1024px, 1120px, 1180px, 1200px, 1240px, 1280px | 9 files |
| `1366-1919px` (Desktop) | 1366px, 1400px, 1440px, 1500px | 4 files |
| `≥ 1920px` (Large/4K) | 1600px, 1920px | 3 files |

## Observations

1. **760px and 820px dominate** (15 of 52 @media blocks). These are the key mobile/tablet boundary.
2. **1200px is the most fragmented** — 5 blocks across 3 files, all doing slightly different things.
3. **1366px appears only once** (compatibility.css), suggesting limited value as a standalone breakpoint.
4. **1600px appears as min-width (2×) and max-width (1×)** — inconsistent direction usage.
5. **Content cap at 1460px/1760px** wastes significant space on monitors ≥1920px.
6. **No 640px breakpoint exists** — the current <640px tier doesn't exist; mobile starts at 560px or 760px.
