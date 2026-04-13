---
name: css-style
description: Apply consistent CSS conventions when writing or modifying styles. Use this skill on any CSS task — new components, layout changes, style fixes, or responsive work in any project.
---

# CSS Style

Before writing any CSS, review the existing stylesheet to understand which system is in use. Then match it exactly.

## What to check before touching CSS

- Are sizing values in `em`? Use `em` throughout.
- Are sizing values in `vw`/`vh`? Use viewport units throughout.
- Where do styles live? Respect that structure — don't introduce new patterns.

## Rules

- **No inline styles** unless explicitly requested or there's no other option.
- **No `px` for sizing** if the project uses `em` or `vw`. The only exception is decorative borders (`1px solid`).
- **Don't mix unit systems** within the same project.
- When in doubt about where a style belongs, ask — don't guess.
