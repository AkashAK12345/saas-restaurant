# Brand assets

Drop the SAMCO artwork here. Two files are referenced by the app:

| File | Used by | Notes |
| --- | --- | --- |
| `samco-logo.png` | Sign-in screen (`Logo variant="full"`) | The full stacked lockup: globe, SAMCO, "Restaurant \| Banquets". |
| `samco-mark.png` | Top bar, public display boards, browser tab icon | The globe alone. Square, transparent background. |

SVG is preferred if available — save as `.png` names above or update
`SOURCE` in `src/components/brand/logo.tsx` to point at `.svg`.

Until the files exist, `<Logo>` renders a typographic fallback in the brand
maroon rather than a broken image, so nothing looks broken on a guest-facing
screen. Drop the files in and they appear everywhere at once.

The brand maroon is available to CSS as `--color-brand` (see
`src/app/globals.css`). It is the identity colour only — the interface's action
colour is the terracotta `--color-primary`, kept distinct so a button never
competes with the logo next to it.
