# Code Black WX — Public Website

The public marketing/status site for Code Black WX, at `codeblackwx.com`. This is a
self-contained package inside the Code Black Telemetry (OPS app) repository — it shares no
build tooling, dependencies, or runtime code with the OPS app. It does not talk to any private
OPS backend, telemetry stream, or credential.

`codeblackwx.com` = this site (public).
`ops.codeblackwx.com` = the authenticated operations product (separate, private, not part of
this package).

## Brand source of truth

Palette, typography direction, tagline, and logo governance come from the Code Black brand
package (`Documents/Code Black/Brand/BRAND_BIBLE.md` and `BRAND_HANDOFF.json` from the original
prototype handoff), not from this prototype's own visual choices where the two differ. Key
points carried over:

- Primary: Code Black `#0D0D0D`, Stealth Gray `#1C1C1E`, Tactical Gray `#2F3133`, Alert Red
  `#E31919`, White `#FFFFFF`.
- Semantic: Safe `#2ECC71`, Caution `#FFC107`, Advisory `#FF8C00`, Info `#6050FC`, Data
  `#209CDB`.
- Display type: the approved Code Black display face is not available as a web font file yet
  (see "Known blocker" below) — falls back to a bold condensed system stack.
- UI/body type: Inter is referenced in the stack but not currently self-hosted or loaded from
  Google Fonts; falls back to the system UI stack until it's added.
- Tagline: **FROM WATCHING TO WARNING**.
- Logo: `src/assets/codeblack-shield.png`, copied from the OPS app's own
  `src/assets/codeblack-shield.png` (confirmed identical, byte-for-byte, to
  `Desktop/Code Black Branding/CodeBlack_OnePixelMore_FinalFinal.png`).

The Brand Bible also asks for a calmer, more restrained tone than typical storm-chasing
marketing copy ("avoid panic, hype, spectacle, fear-based language"). Copy in this pass was
softened in a few places accordingly (e.g. "internal OPS telemetry" language), while keeping the
tagline, brand pillars, and the owner-approved "WE INTERCEPT IT" band as given.

## Known blocker: display font

No Code Black custom display font file was found in any locally accessible folder (Desktop
Branding folder, `Documents/Code Black/Brand` and `Design`, or elsewhere). The CSS references it
by name (`--display` custom property) with a bold condensed system fallback stack, so swapping in
a real font file later is a one-line change in `src/styles.css` plus a `@font-face` block — no
component changes needed.

## Real media

No authentic storm-structure/supercell photography was found in the locally accessible synced
folders. What was found and reviewed:

- `Pictures/iCloud Photos/Shared/Wakita 2025` — a real Code Black team event album (Wakita, OK
  street festival: car show, team members in Code Black shirts, the branded chase vehicle). Not
  active storm footage.
- `Pictures/iCloud Photos/Shared/Neosho` — inspected one sample image; it turned out to be
  unrelated store security-camera footage of an uninvolved third party. Not used, not browsed
  further.
- `Pictures/iCloud Photos/Shared/Anthony's Chase` and `Tanja's Chase Content` — present as
  albums but had 0 synced files locally at the time of this pass.

One real photo is used: the branded chase vehicle (`src/assets/field-vehicle-web.jpg`, optimized
from a 1.55MB original down to ~730KB, resized to 1600px wide) in the Team section. A second
real photo — two team members in Code Black shirts at a community mural — was deliberately **not**
included pending explicit approval, since it shows identifiable people and this pass didn't have
a way to confirm their consent to publish. See the final pass report for that call.

The hero uses the prototype's original CSS-only storm/horizon illustration (gradients, not a
photo, not AI-generated stock art) rather than a real photo, since no suitable real one was
available. Swap in real drone/chase footage once sourced — `Hero()` in `src/App.jsx` is the only
place that needs to change.

## Public/private boundary

This site contains no API calls, no credentials, no stream ingest keys, and no references to any
OPS backend. `.env.example` only lists placeholder names for a future *public* status/streams API
— never populate it with anything that isn't safe to ship to every browser that loads this site.

## Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Output goes to `dist/`.

## Cloudflare Pages deployment (prepared, not yet executed)

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory (in the Cloudflare Pages project settings):** `web/public`
- **Production branch:** `master` (only once this pass is merged and approved — not yet)
- **Environment variables:** none required for the current build. Future public-only API base
  URLs go through `.env` variables named to match `.env.example`; never a private/secret value.
- **Custom domain:** `codeblackwx.com`, added in Cloudflare Pages once the project exists and a
  first deploy is live — DNS was **not** touched by this pass.

No DNS changes and no production deploy were made in this pass, per instruction.

## Future integrations

See [docs/FUTURE_INTEGRATIONS.md](docs/FUTURE_INTEGRATIONS.md).
