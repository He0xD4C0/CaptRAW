# Misskey – Claude Code Guide

The main rules live in [AGENTS.md](AGENTS.md) (shared single source of truth for Codex / Copilot). This file is a thin wrapper for Claude Code — the `@AGENTS.md` syntax expands the full rule set into the session context at startup.

Claude Code-specific resources (skills / agents / slash commands / docs) are committed under `.claude/`. Personal local settings go in `.claude/settings.local.json`; MCP credentials go in `.claude/.credentials.json` (both are `.gitignore`d).

@AGENTS.md
