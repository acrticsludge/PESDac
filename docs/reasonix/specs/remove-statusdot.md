# PESDac StatusDot Removal Spec

Problem: Multicolor dots (StatusDot: green, orange, blue, gray) beside chat names in sidebar.

Goal: Remove StatusDot from ConversationItem; keep only hover-triggered MoreMenu.

Non-goals: Remove MoreMenu, change conversation data, change theme colors.

Files: `frontend/src/components/Pesdac.tsx` (line ~1083), `frontend/src/data/index.ts` (optional — keep status fields for future backend).

Acceptance: Sidebar conversation items show only text label; no colored dot; MoreMenu still appears on hover.
