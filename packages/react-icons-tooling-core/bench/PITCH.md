# Pitch (3 slides)

## 1. The docs already said this

No single icon rendering mode fits every surface, and no single sprite fits every route. Tooling still forced one mode per build and one sprite per app.

## 2. What we shipped

One shared core. Sprite subsetting on **rspack** as well as webpack. Rendering mode and sprite group are a **per-rule** choice in the build config:

- fonts in the grid
- a critical sprite inlined for the toolbar
- a deferred sprite for the lazy route
- inline SVG in the hero

One compilation. Everything subsetted. **Zero option changes** for existing users.

## 3. The numbers

JS gzip, critical-path bytes, requests before first paint, build time — at 35 / 100 / 300 icons, webpack vs rspack, single mode vs mixed, merged vs split. Duplicate shared symbols are cheap (H4); hoist is optional.
