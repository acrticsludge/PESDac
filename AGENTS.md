# PESDac — Development Rules

## 1. CRITICAL: Existing UI is the design source of truth

The current PESDac UI was designed and exported from the official Meta Astryx Playground.

The existing implementation is NOT a starting point for redesigning the UI.

It is the canonical design that must be preserved.

### NEVER:

- Redesign the existing UI.
- Replace Astryx components with custom HTML/CSS.
- Recreate Astryx components visually.
- Change spacing, sizing, typography, colors, radii, shadows, or layout unless explicitly requested.
- "Improve" the visual design on your own.
- Replace an existing component because another implementation seems easier.
- Add Tailwind or another CSS framework to reproduce Astryx styling.
- Add arbitrary global CSS to override Astryx components.
- Modify the exported Astryx theme to compensate for implementation problems.
- Remove existing functionality while adding new functionality.
- Rewrite the existing component from scratch when adding a feature.

### ALWAYS:

- Treat the current Playground-exported implementation as the visual source of truth.
- Preserve existing component hierarchy and layout.
- Use the actual Astryx components.
- Use the existing `PESDacMockupTheme`.
- Make the smallest possible change required to implement the requested feature.
- Add functionality around the existing UI rather than redesigning it.
- Preserve all existing behavior unless the user explicitly asks for a change.

---

## 2. Astryx is mandatory

PESDac uses Meta Astryx.

Astryx components must be used whenever an appropriate Astryx component exists.

Examples include:

- AppShell
- SideNav
- SideNavItem
- Layout
- LayoutContent
- ChatLayout
- ChatMessage
- ChatMessageBubble
- ChatMessageList
- ChatMessageMetadata
- ChatSystemMessage
- ChatToolCalls
- ChatComposer
- ChatComposerInput
- Card
- ClickableCard
- Dialog
- Toolbar
- Markdown
- CodeBlock
- Token
- Button
- Icon
- DropdownMenu
- MoreMenu
- StatusDot
- Grid
- VStack
- HStack

Before creating a custom UI implementation, check whether Astryx already provides the required component.

Do not create a custom approximation of an Astryx component.

---

## 3. Astryx version and environment

The project currently uses:

- Astro
- React 19
- Astryx 0.5.2
- StyleX
- @astryxdesign/theme-neutral

Do not change Astryx versions unless explicitly instructed.

Do not introduce a different UI library.

The Astryx environment must remain compatible with the Playground-exported implementation.

---

## 4. Theme is authoritative

The file:

`src/theme/PESDacMockupTheme.ts`

contains the exported Astryx Playground theme.

This file is authoritative.

Do NOT manually recreate its colors, spacing, typography, shadows, radii, or component styles elsewhere.

Do NOT modify the theme simply to make a new component look correct.

If something looks different from the Playground, first investigate:

1. Astryx version
2. Astryx CSS imports
3. Theme mounting
4. React/Astro integration
5. StyleX setup
6. Font loading
7. Browser viewport
8. Existing CSS overrides

Only modify the theme if the user explicitly asks to change the design/theme.

---

## 5. Global CSS

Astryx CSS is loaded through:

`src/styles/global.css`

It contains the Astryx foundation imports.

Do not add broad global selectors such as:

```css
* {
}
body {
}
button {
}
div {
}
```
