# Overlay semantic color table -- development snapshot

Status: DEVELOPMENT. Prevents decorative brand color from silently acquiring warning meaning.
Not a full brand-color redesign -- scope is limited to the tokens `EventTakeover` currently uses.

## Locked

These are fixed per `docs/design/code-black-brand-reference-v1.md` and must not change without a
brand-reference revision:

| State | Token | Value | Notes |
|---|---|---|---|
| Brand identity (Signal Red) | `--cb-signal-red` | `#FF2A0C` | Decorative/identity only -- never itself a warning signal. |
| Tornado Warning | `--cb-warn-tornado` | `#FF2A0C` | True warning red. Also used for Observed Tornado. |
| Severe Thunderstorm Warning | `--cb-warn-severe` | `#FFCC00` | Vivid yellow, locked per brand doc. |

## Provisional (this pass only)

Not specified by the brand doc. Chosen to keep watches/discussions visually distinct from an
actual Warning, but explicitly **not** final Code Black semantic colors -- do not copy these into
any other document as if approved:

| State | Token | Value | Rationale (provisional) |
|---|---|---|---|
| Tornado Watch / PDS Tornado Watch | `--cb-warn-watch` | `#FF6A4D` | Red-family but lighter/less saturated than the Warning red, so a watch never reads as urgently as a warning at a glance. |
| SPC Mesoscale Discussion | `--cb-warn-discussion` | `#C7CED6` | Neutral gray-white -- a discussion is not a warning and must never borrow red or yellow. |

## Next step

A dedicated semantic-color review (out of scope for this pass) should confirm or replace the two
provisional values above against the full watch/advisory taxonomy, then this table gets folded
back into the Brand Reference as locked values.
