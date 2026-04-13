---
name: vault
description: Search, create, and manage notes in the Obsidian vault with wikilinks and index notes. Use when user wants to find, create, or organize notes in Obsidian.
---

# Obsidian Vault

## Vault location

`~/Vault/`

Mostly flat at root level.

## Naming conventions

- **Index notes**: aggregate related topics (e.g., `Ralph Wiggum Index.md`, `Skills Index.md`, `RAG Index.md`)
- **Title case** for all note names
- No folders for organization - use links and index notes instead

## Linking

- Use Obsidian `[[wikilinks]]` syntax: `[[Note Title]]`
- Notes link to dependencies/related notes at the bottom
- Index notes are just lists of `[[wikilinks]]`

## Workflows

### Search for notes

Use Grep/Glob tools directly on `~/Vault/`. Bash alternative:

```bash
# Search by filename
find ~/Vault/ -name "*.md" | grep -i "keyword"

# Search by content
grep -rl "keyword" ~/Vault/ --include="*.md"
```

### Create a new note

1. Use **Title Case** for filename
2. Write content as a unit of learning (per vault rules)
3. Add `[[wikilinks]]` to related notes at the bottom

### Find related notes

```bash
grep -rl "\[\[Note Title\]\]" ~/Vault/
```

### Find index notes

```bash
find ~/Vault/ -name "*Index*"
```

## Auto-save dev problems

When a non-trivial dev problem is encountered and solved during a session (bug, library quirk, unexpected behavior, workaround), save it as a note in `~/Vault/` **without waiting for the user to ask**. Format: Title Case filename, document problem + solution, link related notes at bottom.
