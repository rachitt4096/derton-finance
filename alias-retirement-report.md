# Alias Retirement Verification Report

## Audit Scope
Searched entire repository excluding `node_modules/`, `.git/`, `.venv/`, and `screenshots/`.

## 1. Remaining `--ix-*` References by File

### CSS files
| File | Lines | Type | Verdict |
|------|-------|------|---------|
| `themes.css:19-28` | 10 | Alias declarations (`--ix-accent: var(--accent)`) | Self-referential — can delete |
| Any other `.css` file | **0** | `var(--ix-*)` usage | All 150 replaced in Phase 2 |

### JavaScript / JSX / TypeScript
| Pattern | Matches | Verdict |
|---------|---------|---------|
| `--ix-` (CSS custom property) | **0** | — |
| `ix-` in JSX | 56 | All `className="ix-*"` (CSS class selectors), NOT variable references |
| `getComputedStyle` with `ix-` | 0 | — |
| `setProperty` with `ix-` | 0 | — |
| `documentElement.style` with `ix-` | 0 | — |
| `setAttribute` with `ix-` | 0 | — |
| `cssText` with `ix-` | 0 | — |

### HTML / SVG / Markdown / Config
| File | Match | Verdict |
|------|-------|---------|
| `README.md:38` | `--ix-*` in prose | Documentation — not a runtime reference |
| `phase2-deliverables.md` | Multiple | Our own report — informational |

## 2. Runtime Token Access Audit

Searched for all five runtime patterns across the entire `derton-finance/src/` tree:

| Pattern | Total matches | `--ix-*` specific | Verdict |
|---------|---------------|-------------------|---------|
| `getComputedStyle(` | 22 | **0** | No ix- references |
| `style.setProperty(` | 15 | **0** | No ix- references |
| `document.documentElement.style` | 4 | **0** | No ix- references |
| `CSSStyleDeclaration` | 3 | **0** | No ix- references |
| `setAttribute("style"` | 23 | **0** | No ix- references |
| `cssText` | 13 | **0** | No ix- references |

## 3. Decision

**SAFE TO REMOVE**

All conditions for alias removal are met:
- [x] Zero `var(--ix-*)` references in any CSS file
- [x] Zero `--ix-*` in JS/TS/JSX/TSX source code
- [x] Zero runtime access to `--ix-*` via any JavaScript pattern
- [x] Zero references in HTML, SVG, build scripts, config files
- [x] Dark/Light/Warm themes verified render correctly
- [x] All `.ix-*` CSS class selectors already use canonical `var()` tokens internally

## 4. What Gets Removed
```css
/* Delete these 10 lines from themes.css :root block */
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

## 5. Recommendation
Proceed with Phase 2.1 commit: Remove alias declarations from `themes.css`.
After that, proceed to Phase 3 (Breakpoint Inventory).
