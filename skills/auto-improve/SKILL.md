---
name: auto-improve
description: Autonomously improve Claude Code skills based on session feedback and usage patterns. Use when you want skills to self-improve without manual intervention, when a skill has been underperforming, or to run a scheduled improvement cycle. Also use when the user asks to "check skill health", "see which skills need improvement", or "run the improvement loop".
---

# Auto-Improve

Automatically detects underperforming skills from session signals and rewrites their bodies using a two-pass LLM approach (critique → synthesis). Validates with evals if available, commits on improvement, reverts on regression.

## Usage

Run the improvement loop:
```bash
python3 ~/.claude/skills/auto-improve/scripts/auto_improve_loop.py
```

Dry-run (see qualifying skills without changing anything):
```bash
python3 ~/.claude/skills/auto-improve/scripts/auto_improve_loop.py --dry-run
```

Force-improve a specific skill:
```bash
python3 ~/.claude/skills/auto-improve/scripts/auto_improve_loop.py --skill <skill-name>
```

Check skill health report:
```bash
cat ~/.claude/skill-health.md
```

Backfill signals from existing session history:
```bash
python3 ~/.claude/skills/auto-improve/scripts/collect_signals.py
```

## How it works

1. **Signal collection** (passive, runs on every session stop via hook):
   - `collect_signals.py` scans session conversation turns for correction phrases after skill invocations
   - Also reads explicit `feedback_*.md` memory files
   - Appends classified records to `~/.claude/skill-performance-log.jsonl`

2. **Threshold detection** (in `auto_improve_loop.py`):
   - Qualifies if negative rate > 25% in last 20 invocations
   - OR 3+ explicit negatives in last 7 days

3. **Two-pass synthesis** (in `synthesize_body.py`):
   - Pass 1: Claude critiques which sections caused failures
   - Pass 2: Claude rewrites those sections (tactical fix + strategic generalization)

4. **Validation**: runs `run_eval.py` if `evals/evals.json` exists
5. **Git safety**: pre-improvement snapshot commit, auto-revert on regression

## Files

- `~/.claude/skill-signals.jsonl` — raw PostToolUse log
- `~/.claude/skill-performance-log.jsonl` — classified signals
- `~/.claude/skill-improvement-log.jsonl` — improvement history
- `~/.claude/skill-health.md` — per-skill health summary
