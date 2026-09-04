# PESDac StatusDot Removal Plan

Task: Remove colored StatusDot from sidebar conversation items.

File: `frontend/src/components/Pesdac.tsx`

Implementation:
- Find `StatusDot variant={status} label={statusLabel}` in ConversationItem
- Remove the StatusDot branch from `endContent` ternary
- Keep `MoreMenu` on hover; keep `label` and `onClick`

Verification: Build passes; sidebar shows labels only; hover still shows MoreMenu.
