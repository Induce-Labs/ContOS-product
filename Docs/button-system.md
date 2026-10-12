# ContOS Button System

## Purpose

Shared pastel-lavender button styling for ContOS (dashboard, auth, onboarding wizards) so primary, secondary, selected, and icon controls stay consistent in light and dark mode without changing layout or behavior.

## Implementation overview

- **Tokens** live in [`Frontend/src/index.css`](../Frontend/src/index.css) (`@theme` + `.dark`).
- **Utilities** use the `.contos-btn` family in the same file.
- Call sites apply classes on existing `<button>` / `<Link>` elements (no required React `Button` wrapper). [`PrimaryButton`](../Frontend/src/components/auth/AuthButtons.tsx) uses the same utilities.
- **Action icons** live in [`ActionIcons.tsx`](../Frontend/src/components/icons/ActionIcons.tsx) (`ChatIcon`, `TrashIcon`, `PlusIcon`, `SunIcon`, `MoonIcon`, `SignOutIcon`). Place the icon before the label on Open Chat, Delete, Add competitor, Light/Dark, and Sign out; icons use `currentColor` so they match button text.

## Color tokens

| Token | Light | Dark |
|-------|-------|------|
| `--color-accent-primary` | `#D8C7F5` (pastel fill) | `#BFA4F5` |
| `--color-accent-primary-hover` | `#C5AEED` | `#CDB8F8` |
| `--color-accent-primary-soft` | `#EDE7F9` | `#2A2238` |
| `--color-accent-primary-deep` | `#4B3568` (accent text on soft/canvas) | `#E8DFF8` |
| `--color-btn-primary-fg` | `#4B3568` (text/icon on pastel buttons) | `#241936` |
| `--color-btn-secondary-bg` | `#FFFFFF` | `#1A1725` |
| `--color-btn-secondary-border` | `#E4DFF0` | `#393247` |
| `--color-btn-secondary-hover` | `#F5F0FC` | `#272137` |

Tailwind utilities: `bg-accent-primary`, `text-btn-primary-fg`, `bg-btn-secondary-bg`, etc.

## Utility classes

Combine **base + shape + variant**:

| Class | Role |
|-------|------|
| `.contos-btn` | Base: flex, gap, 170ms transitions, focus-visible ring, disabled |
| `.contos-btn--pill` | Small actions (`rounded-full`) — Chat tabs, New Chat, New Project |
| `.contos-btn--rect` | Larger CTAs (`rounded-xl`) — Save, Create, auth submit |
| `.contos-btn--icon` | Circular icon controls (send, mic); optional `--icon-sm` |
| `.contos-btn--primary` | Pastel fill + `btn-primary-fg`; hover deepen + glow + 1px lift |
| `.contos-btn--secondary` | Off-white / dark secondary surface + lavender-gray border |
| `.contos-btn--selected` | Selected tabs/chips (pastel + deep fg + subtle shadow) |
| `.contos-btn--ghost` | Idle outline tabs / suggestion pills |
| `.contos-btn--accent-label` | With `--ghost`: deep purple label (suggestion pills) |
| `.contos-btn--danger` | Destructive confirm |
| `.contos-btn--block` | Full width |
| `.contos-btn--soft` | Soft lavender icon circle (with `--icon`) |

### Interaction states

- **Hover:** slightly deeper pastel / secondary wash, subtle glow, `translateY(-1px)` (icons: `scale(1.03)`)
- **Active:** no lift, reduced shadow
- **Disabled:** opacity ~0.55, no transform
- **Focus-visible:** 2px ring using hover lavender
- **`prefers-reduced-motion`:** transitions and transforms disabled

## Architecture decisions

- CSS utilities over a large React component API so `Link` and one-off handlers stay untouched.
- Separate `--color-btn-primary-fg` from `--color-accent-primary-deep` so dark mode keeps readable accent labels on soft washes while button text on pastel stays deep purple (`#241936`).
- No gradients or scale-bounce on primary CTAs.

## Known limitations

- Some non-button chrome (badges, progress dots) still use accent tokens directly; prefer `text-accent-primary-deep` over `text-accent-primary` for readable accent text on light surfaces.
- Legacy one-offs should migrate to `.contos-btn` when touched.

## Future improvements

- Optional thin React `Button` / `IconButton` wrappers that compose these classes for TypeScript variants.
- Shared selected-state helper for nav `Link`s that cannot use `.contos-btn` without layout changes.
