# Phase 2 — Token Unification Deliverables

## Git Commit
`2bfb349` — "Phase 2: Token Unification — replace --ix-* variables with canonical tokens"

## Variable Inventory Report

### Before Phase 2
| Metric | Count |
|--------|-------|
| `--ix-*` variables defined in `:root` | **10** |
| `var(--ix-*)` references in CSS | **150** |
| Unique `--ix-*` variables used | **9** |
| Files using `var(--ix-*)` | **2** (institutional-terminal.css, screen-overrides.css) |

### --ix-* Variable Usage Breakdown
| Variable | Canonical Token | Usages |
|----------|----------------|--------|
| `--ix-border` | `var(--border)` | highest |
| `--ix-surface` | `var(--surface-1)` | high |
| `--ix-accent` | `var(--accent)` | high |
| `--ix-text-strong` | `var(--text)` | moderate |
| `--ix-text` | `var(--text2)` | moderate |
| `--ix-text-muted` | `var(--text3)` | moderate |
| `--ix-up` | `var(--green)` | moderate |
| `--ix-down` | `var(--red)` | moderate |
| `--ix-warn` | `var(--gold)` | low |
| `--ix-accent-2` | `var(--accent2)` | **0** (declared but unused) |

## Files Modified
| File | Lines changed | Change |
|------|--------------|--------|
| `themes.css` | 20 | Replaced hardcoded `:root` values with `var()` aliases |
| `institutional-terminal.css` | 298 | Replaced 149 `var(--ix-*)` → canonical `var()` |
| `screen-overrides.css` | 2 | Replaced 1 `var(--ix-text)` → `var(--text2)` |

## Before/After Counts
| Metric | Before | After |
|--------|--------|-------|
| `var(--ix-*)` references | **150** | **0** |
| `--ix-*` alias declarations | **10** (hardcoded) | **10** (var() aliases) |
| CSS files with ix-* refs | **2** | **0** |
| CSS line count | 15,382 | 15,382 (no net change) |

## Alias Variables (still present in themes.css :root for backward compat)
```css
--ix-accent: var(--accent);
--ix-accent-2: var(--accent2);
--ix-up: var(--green);
--ix-down: var(--red);
--ix-warn: var(--gold);
--ix-text-strong: var(--text);
--ix-text: var(--text2);
--ix-text-muted: var(--text3);
--ix-border: var(--border);
--ix-surface: var(--surface-1);
```

## Visual Verification
Screenshots at `screenshots/p2-01-dark-batch1.png`, `p2-02-light-batch1.png`, `p2-03-warm-batch1.png`.
All three themes render without crashes or console errors.

## Pre-existing Issue Flagged
`--ix-surface` and `--ix-warn` are only defined in `:root` — they were hardcoded to dark values in the original code. They did NOT respond to light/warm theme changes (pre-existing bug). Now aliased to `--surface-1` and `--gold` which are properly themed.

## Next Decision
Alias variables can be removed once you confirm — zero `var(--ix-*)` references remain in CSS and no JS/TS code accesses them dynamically. Or keep them as safety net for any unbilled code paths.
