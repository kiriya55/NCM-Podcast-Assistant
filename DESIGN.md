# NCM Podcast Assistant Design System

> Operational desktop console for NCM podcast contributors and the Music Partner workflow. Extracted from the existing Ant Design + React layout before the workflow feature was added.

## 1. Direction

An operational desktop console: quiet neutral shell, blue action hierarchy, compact status-dense cards, and a phone-window motif for Music Partner. The console is built to be watched while it works — every state change is announced in plain text and never relies on color alone.

## 2. Foundations

### Color tokens

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#f4f6f8` | App background |
| `--surface` | `#ffffff` | Cards, sidebar, header bar |
| `--surface-muted` | `#fafafa` | Subtle fills (drop zone, phone screen preview) |
| `--border` | `#edf0f3` | Card and divider borders |
| `--border-strong` | `#e5e7eb` | Sidebar edge |
| `--text` | `#111827` | Primary text |
| `--text-muted` | `#374151` | Secondary text |
| `--text-tertiary` | `#6b7280` | Hints, captions |
| `--action` | `#1677ff` | Primary actions, focus, links |
| `--action-bg` | `#e6f4ff` | Hovered/selected action background |
| `--success` | `#52c41a` | Login valid, completed |
| `--warning` | `#faad14` | Needs attention |
| `--danger` | `#ff4d4f` | Destructive actions, paused state |
| `--ink-strong` | `#111827` | Phone shell |
| `--ink-mid` | `#374151` | Phone speaker |

### Typography

- 14 px body, 16 px section title, 20 px page title, 13 px caption.
- System CJK sans-serif stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`.
- Page title weight 650; section title weight 600; body 400.

### Spacing

4 px base. Named steps: `4 / 8 / 12 / 16 / 24 / 32`. Cards use 16 px inner padding; page content uses 24 px.

### Radius

- 6 px — buttons, inputs (Ant Design `borderRadius` token).
- 8 px — cards, content panel.
- 12 px — QR code surface.
- 14 px — phone screen preview.
- 24 px — phone shell.
- 99 px — pill (phone speaker).

### Shadow

- `0 8px 24px rgba(15,23,42,0.04)` — content panel.
- `0 2px 12px rgba(0,0,0,0.08)` — QR code surface.
- `0 2px 8px rgba(22,119,255,0.15)` — selected podcast card.
- `0 14px 34px rgba(15,23,42,0.18)` — phone shell.

## 3. Layout

- Fixed 216 px sidebar; content scrolls independently.
- 1200 px desktop target; content panel capped at 1280 px and centered.
- Two-column editor grid collapses to one column below 768 px.
- Below 960 px the page header and music partner status rows stack vertically; below 768 px all two-column grids stack.

## 4. Interaction

- Visible focus rings (Ant Design defaults aligned with `--action`).
- Disabled and busy states use opacity + cursor; busy actions show a spinner inside the button.
- No decorative motion. The only allowed transitions are hover colors on cards, drop zones, and buttons.
- Status changes are announced through an `aria-live="polite"` region inside the Music Partner console.

## 5. Primitives

| Primitive | Purpose | Default | Hover | Focus | Disabled | Loading | Warning | Error |
|---|---|---|---|---|---|---|---|---|
| AppShell | Full-screen layout frame | — | — | — | — | — | — | — |
| PageHeader | Title + actions row | — | — | — | — | — | — | — |
| StatusCard | Login/state summary | neutral | — | — | — | spinner | warning icon | — |
| ProgressCard | Phase + counter + countdown | idle | — | — | start disabled | spinner | paused | — |
| ActionCluster | Group of buttons | primary + secondary | hover bg | focus ring | opacity 0.5 | button spinner | — | — |
| PhonePreview | Decorative phone shell | — | — | — | — | — | — | — |
| AlertBanner | Inline alert | info | — | — | — | — | warning | error |
| StatusTag | Colored tag | green/orange | — | — | — | — | warning | error |

`DesignSystemShowcase` (`src/components/DesignSystemShowcase.jsx`) renders one instance of every primitive in each state above; it is mounted only when `import.meta.env.DEV && window.location.hash === '#design-system'`, and is never linked from production navigation.

## 6. Accessibility

- All interactive targets are at least 32 px tall; primary actions are 40 px+.
- WCAG AA contrast: `--text` on `--surface` ≈ 16:1; `--text-muted` on `--surface` ≈ 9:1; `--action` on `--surface` ≈ 4.5:1; `--danger`/`--warning` used only as accent, never as sole status indicator.
- Status text accompanies every colored tag.
- Keyboard reachability: every menu item, button, and tab is reachable; focus stays inside modals (Ant Design default).
- Reduced-motion compatibility: no animation is required to understand state.

## 7. Personas

- **Routine operator** — runs the daily flow start to finish; needs obvious progress and a single primary action.
- **Keyboard-first operator** — never uses the mouse; needs visible focus rings and predictable tab order.
- **Low-vision operator** — relies on contrast and text labels; never relies on color alone.
- **Interruption-prone operator** — looks away and comes back; must understand the paused state in one glance.

## 8. Accepted Debt

- Existing pages retain Ant Design primitives and inline styles; only Music Partner console migrates to tokens in this feature.
- No unrelated visual redesign in this feature; `DESIGN.md` is the reference for the next migration wave.
- The development showcase is intentionally plain; it is a verification surface, not a styled page.
