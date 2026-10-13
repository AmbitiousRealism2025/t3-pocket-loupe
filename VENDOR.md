# VENDOR.md: third-party code in public/vendor/

Pocket Loupe reuses four view libraries from **T3 Loupe**, so the phone shows the same states, labels, icons, colours and row order as the Omarchy panel. Nothing else is vendored, and nothing is loaded from another origin.

| | |
|---|---|
| Source | T3 Loupe, https://github.com/AmbitiousRealism2025/t3-loupe |
| Version | v2.5.2, commit `6fb1ec8e2f7c573ca1178b038dfca15700926a7e` (the marketplace-verified commit) |
| License | MIT, Copyright (c) Ambitious Realism. `icons.js` holds path data from [Lucide](https://lucide.dev) 1.23.0 (lucide-react), ISC License, Copyright (c) Lucide Icons and Contributors. |
| Copied with | `tools/vendor-sync.sh`, from the installed plugin; it refuses any other commit or local changes |
| Vendored on | 2026-10-12 |

**Transformation.** The sources are QML `.pragma library` scripts. `tools/vendor-sync.sh` drops the `.pragma library` line, adds a two-line provenance comment, and appends one `export { … }` naming every top-level `function` and `var`. The code itself is unchanged.

| File | Source file | SHA-256 of the source file | SHA-256 of the vendored file |
|---|---|---|---|
| `public/vendor/palette.js` | `lib/Palette.js` | `27e7bcb983d5ddbca375c5ec29080d3c60dc27e36819692a2ce7adc4e1901ab9` | `f832682823b871ff79b440db7e63fb54e232cb05665513605afcd20fc74253de` |
| `public/vendor/format.js` | `lib/Format.js` | `ff5701786bc9beb9a94199e3a3e2d638e685596f591c2e8b819c2c62790b7c79` | `c2a21db7297bcfd1457c9e186c7b00f21e26fc865d92ffeed5f3a3c41f6a1960` |
| `public/vendor/icons.js` | `lib/Icons.js` | `cbcba897baa70e982dee3a7e089733eaad7a23a60137fcbeb446b0e90ad571be` | `18553a291cfb590fdf2920c344665b3f4b832b6aa959641698bf9baa09f21836` |
| `public/vendor/store.js` | `lib/Store.js` | `019218d554a3ff98a3b4c065221ba2732784ae43b4940059c2f3b5cb0e2f8e2c` | `15b305574a4a0451d244e475e7c59e409aeb7ab5c64075f38dd19c4722a34985` |

**What each one does here.**
- `palette.js`: derives the colour roles from the host's Omarchy theme (`derive`), with a contrast floor on light and dark themes.
- `format.js`: compact durations, "4m ago", token counts and money.
- `icons.js`: 54 Lucide icons as SVG path strings.
- `store.js`: state labels, icons, the colour budget, and `visibleRows`, the panel's grouping and order (Needs you, Working, Done, folded idle).

To update: move the installed plugin to a new verified commit, change the commit in `tools/vendor-sync.sh`, run it, update this file's table, and bump `VERSION` in `public/sw.js`.
