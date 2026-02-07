# Project Remaining Improvements

Date: 2026-02-07  
Purpose: Track remaining fixes/improvements after current web-admin and Telegram UX work.

## Priority: Medium

1. Reader diagnostics parity in Web Admin
Details: add a dedicated panel equivalent to `/proforward reader-status` with reader bot enabled/online state, guild reachability summary, source-channel access diagnostics, and invite/action guidance when missing access.  
Status: open.  
Source: `Documentations/COMMAND_WEB_COVERAGE_DEPRECATION.md`.

2. Web security hardening (Phase 4 backlog)
Details: add CSRF protection for mutating routes, rate limiting for auth/mutation endpoints, and mutation audit logs (who/what/when, before/after summary).  
Status: open.  
Source: `Documentations/COMMAND_UX_REWORK_PLAN.md` (Phase 4).

## Priority: Low

1. Clarify Telegram `discoveredVia` semantics
Details: ensure tracked chat metadata distinguishes update-discovered, manually verified, auto-verified during config creation, and forward-observed states.  
Status: open.  
Source: `Documentations/COMMAND_WEB_COVERAGE_DEPRECATION.md`.

2. Emoji remove behavior decision
Details: decide whether per-emoji remove should also delete the Discord application emoji asset, not only remove DB name entry.  
Status: open decision.  
Source: `Documentations/COMMAND_WEB_COVERAGE_DEPRECATION.md`.

3. `/debug database` future
Details: decide whether to keep `/debug database` as command-only diagnostics or expose equivalent web debug view.  
Status: open decision.  
Source: `Documentations/COMMAND_WEB_COVERAGE_DEPRECATION.md`.

## Suggested Order

1. Reader diagnostics parity (medium).
2. Phase 4 web security hardening (medium).
3. Low-priority metadata/decision items.
