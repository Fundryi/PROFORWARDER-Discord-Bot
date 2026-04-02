# AI Tool Reference (MCP + CLI)

This document maps available MCP tools and CLI commands to project tasks.
Read `CLAUDE.md` first for routing. This file is the tool reference.

**MCP architecture:** All MCP servers are aggregated through **MCP Router** (`mcp-router`), a single stdio entry point configured globally in `~/.claude.json` (Claude Code) and `~/.codex/config.toml` (Codex). In Codex, the server name is normalized to `mcp_router`, so all callable tools appear as `mcp__mcp_router__*` (not repeated per section below).

**MCP surfaces available via mcp-router:**

| # | Surface | Tool prefix/pattern | What it provides |
|---|---------|-------------------|-----------------|
| 1 | **MCP_DOCKER** | `search`, `fetch`, `create_*`, `list_*` | Docker MCP Gateway: DuckDuckGo search, fetch, memory, sequential thinking |
| 2 | **context-mode** | `ctx_*` | Sandboxed code execution, output indexing, BM25 search over indexed content |
| 3 | **roam-code** | `roam_*` | Codebase semantic graph: symbols, dependencies, impact analysis, health scores |
| 4 | **draw.io** | `open_drawio_xml`, `open_drawio_mermaid`, `open_drawio_csv` | Diagram creation (XML, Mermaid, CSV formats) |

---

## 1. GitHub (Issues, PRs, Code) — `gh` CLI

Use the `gh` CLI (installed globally) for all GitHub operations.

| Task | Command | When to use |
|------|---------|-------------|
| List open issues | `gh issue list` | Start-of-session triage |
| Create issue | `gh issue create` | Track new bugs or features |
| Read issue details | `gh issue view <number>` | Before starting work on an issue |
| Close an issue | `gh issue close <number>` | After fix is committed and verified |
| Comment on an issue | `gh issue comment <number>` | Posting status updates |
| Search issues | `gh issue list --search "<query>"` | Finding duplicates or related work |
| Create a PR | `gh pr create` | After committing a feature/fix branch |
| Read PR diff/status | `gh pr view <number>` | Reviewing what changed |
| Merge PR | `gh pr merge <number>` | After review passes |
| List PR checks | `gh pr checks <number>` | Checking CI/CD status |
| View PR comments | `gh api repos/{owner}/{repo}/pulls/{number}/comments` | Reading review feedback |

---

## 2. Roam (Codebase Navigation via mcp-router)

Prefer Roam for codebase understanding and impact checks before manual file-by-file exploration.

| Situation | MCP Tool | When to use |
|-----------|----------|-------------|
| First time in repo | `roam_understand` then `roam_explore` | Full codebase briefing |
| Need to modify a symbol | `roam_preflight` | Blast radius + risk check before edits |
| Pre-change safety bundle | `roam_prepare_change` | Preflight + context + effects in one call |
| Debugging a failure | `roam_diagnose` | Root-cause ranking |
| Debug bundle (one call) | `roam_diagnose_issue` | Root cause + side effects combined |
| Need focused files | `roam_context` | Pull relevant files + line ranges |
| Find symbol | `roam_search_symbol` | Locate symbol definitions/usages |
| Batch find symbols | `roam_batch_search` | Search up to 10 patterns in one call |
| Get symbol details (batch) | `roam_batch_get` | Details for up to 50 symbols in one call |
| What breaks if changed | `roam_impact` | Downstream dependency check |
| File skeleton | `roam_file_info` | All symbols with signatures, kinds, line ranges |
| File dependencies | `roam_deps` | Imports and importers for a file |
| All consumers of symbol | `roam_uses` | Callers, importers, inheritors |
| Trace dependency path | `roam_trace` | Shortest path between two symbols |
| Pre-PR risk check | `roam_pr_risk` | Risk score (0-100) for pending changes |
| Review changes bundle | `roam_review_change` | PR risk + breaking changes + structural diff |
| Current change impact | `roam_diff` | Blast radius of uncommitted edits |
| Affected tests | `roam_affected_tests` | Test files that exercise changed code |
| Dead code | `roam_dead_code` | Unreferenced exported symbols |
| Complexity report | `roam_complexity_report` | Functions ranked by cognitive complexity |
| Codebase health | `roam_health` | Overall quality score (0-100) |
| Syntax check | `roam_syntax_check` | Tree-sitter validation, no index needed |

If Roam is missing: install with `pip install roam-code`.
If a repo-wide Roam call times out, retry with a narrower tool (`roam_context`, `roam_search_symbol`). If still failing, fall back to `ctx_*` plus `rg`.

---

## 3. Knowledge Graph (Persistent Memory via mcp-router)

Persists across sessions. Store entities, relationships, and observations about project state beyond what markdown docs capture.

| Task | Tool | When to use |
|------|------|-------------|
| Store a new entity | `create_entities` | Record a bug, feature, decision, or pattern |
| Add observation to entity | `add_observations` | Append new findings to an existing entity |
| Search the graph | `search_nodes` | Start of session — check what's been recorded |
| Read full graph | `read_graph` | Full context dump at session start |
| Open specific nodes | `open_nodes` | Retrieve specific entities by name |
| Create relationships | `create_relations` | Link bugs to files, features to handlers |
| Clean up stale data | `delete_entities`, `delete_observations`, `delete_relations` | Remove outdated info |

**Recommended entities to track:**
- `Bug::{description}` — known bugs with file/line references
- `Feature::{name}` — feature status and implementation notes
- `Decision::{topic}` — architectural decisions and rationale

---

## 4. Context Mode (Sandboxed Execution via mcp-router)

Sandboxed code execution that keeps large output out of context. Output is indexed into a BM25 searchable knowledge base.

| Task | Tool | When to use |
|------|------|-------------|
| Execute code in sandbox | `ctx_execute` | Run shell/JS commands, only stdout enters context |
| Batch execute + search | `ctx_batch_execute` | Multiple commands + queries in one call |
| Process a file without loading it | `ctx_execute_file` | Analyze logs, large files — print summary only |
| Index content for search | `ctx_index` | Store docs/API refs in searchable KB |
| Search indexed content | `ctx_search` | Retrieve specific sections from indexed content |
| Fetch URL + index | `ctx_fetch_and_index` | Fetch page, convert to markdown, index for search |
| Diagnostics | `ctx_doctor` | Check context-mode installation health |
| Usage stats | `ctx_stats` | Context consumption statistics |

**When to use over Bash:** Prefer `ctx_execute` / `ctx_batch_execute` for commands with large output (>20 lines): `git log`, `git diff`, API calls, data processing. Use Bash for file mutations and git writes.

---

## 5. Web Search & Documentation Lookup (Fallback via mcp-router)

Use when local tools don't cover a topic (Discord.js docs, npm packages, Node.js API).

| Task | Tool | When to use |
|------|------|-------------|
| Search the web | `search` | Discord.js API, npm packages, Node.js docs, error messages |
| Fetch a URL as markdown | `fetch` | Read docs, forum threads, API references |
| Fetch webpage content | `fetch_content` | Parse structured content from a URL |
| Fetch + index into searchable KB | `ctx_fetch_and_index` | Large pages — indexes content for later search |
| Find a library's doc ID | `resolve-library-id` | Before calling `get-library-docs` |
| Get library documentation | `get-library-docs` | Discord.js, Express, SQLite3, etc. |

**Common lookups:**
- Discord.js docs: `https://discord.js.org/docs/`
- Express v5 docs: `https://expressjs.com/en/5x/api.html`
- Telegram Bot API: `https://core.telegram.org/bots/api`
- Node.js docs: `https://nodejs.org/docs/latest/api/`
- SQLite3 npm: `https://github.com/TryGhost/node-sqlite3/wiki/API`

---

## 6. draw.io Diagrams (via mcp-router)

| Task | Tool | When to use |
|------|------|-------------|
| Create XML diagram | `open_drawio_xml` | Full control over diagram layout |
| Create Mermaid diagram | `open_drawio_mermaid` | Quick flowcharts, sequence diagrams |
| Create CSV diagram | `open_drawio_csv` | Tabular/hierarchical diagrams |

---

## 7. CLI Commands (Not MCP — Run via Bash)

| Task | Command | When to use |
|------|---------|-------------|
| Start the bot (dev) | `npm run dev` | Local development with auto-reload |
| Start the bot (prod) | `npm start` | Production or manual testing |
| Install dependencies | `npm install` | After cloning or adding packages |
| Start Docker stack | `docker compose up -d` | Docker deployment |
| View container logs | `docker compose logs -f proforwarder-bot` | Debugging runtime issues |
| Restart container | `docker compose restart` | After config changes |
| Init config | `docker compose --profile init run --rm init-config` | First-time setup |
| Git status | `git status` | Before commit |

---

## 8. General Principles

1. **All MCP tools go through mcp-router** — a single aggregator. In Codex, the callable tool namespace is `mcp__mcp_router__*`.
2. **Use Roam (`roam_*`)** for understanding code structure and impact analysis before making changes.
3. **Use context-mode (`ctx_*`)** for large output commands — keeps context clean.
4. **Use `gh` CLI** for all GitHub operations (issues, PRs, branches).
5. **Use Memory/Knowledge Graph** to persist important decisions and project-specific knowledge across sessions.
6. **No test suite** — verify changes via web admin UI or bot behavior.

## 9. Troubleshooting

If an MCP tool fails or is unavailable:

- **mcp-router not loading** → Check `~/.claude.json` (Claude Code) or `~/.codex/config.toml` (Codex) has the `mcp-router` entry. Restart the client fully after config changes.
- **Docker MCP tools not responding** → Docker Desktop may need to be running.
- **Roam not found** → `pip install roam-code`
- **Roam index stale** → `roam index` (incremental) or `roam index --force` after major refactors.
- **Roam times out in Codex** → Retry with a narrower call; if still failing, use `ctx_batch_execute` and `rg`.
- **context-mode issues** → Run `ctx_doctor` to diagnose.

---

## 10. Cross-Reference Quick Links

| Topic | Document | Section |
|-------|----------|---------|
| Agent instructions (Codex entry point) | [AGENTS.md](AGENTS.md) | Start Here |
| Architecture & patterns | [CLAUDE.md](CLAUDE.md) | Architecture, Key Patterns |
| Config & environment | [CLAUDE.md](CLAUDE.md) | Environment Variables |
| Database schema | [CLAUDE.md](CLAUDE.md) | Database Tables |
| Docker setup | [CLAUDE.md](CLAUDE.md) | Docker Compose Behavior |
| Gotchas | [CLAUDE.md](CLAUDE.md) | Gotchas |
| Stack overview | [README.md](README.md) | Quick Start, Web Admin |
| Planning & design docs | [Documentations/](Documentations/) | Historical reference |
