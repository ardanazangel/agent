#!/usr/bin/env python3
"""Stop hook: scan the session for correction phrases and classify skill signals.

Reads:
  - ~/.claude/projects/**/*.jsonl  (session conversation turns)
  - ~/.claude/skill-signals.jsonl  (PostToolUse log)
  - ~/.claude/projects/*/memory/feedback_*.md  (explicit typed feedback)
  - ~/.claude/telemetry/1p_failed_events.*.json  (failure events)

Appends classified records to ~/.claude/skill-performance-log.jsonl.
"""

import glob
import json
import os
import re
import sys
import time
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
SIGNALS_FILE = CLAUDE_DIR / "skill-signals.jsonl"
PERF_LOG = CLAUDE_DIR / "skill-performance-log.jsonl"

CORRECTION_PHRASES = [
    r"\bno[,.]?\s+(don'?t|please don'?t|wait|actually|that'?s)",
    r"\bactually[,.]?\s+",
    r"that'?s wrong",
    r"try again",
    r"\bundo that\b",
    r"not like that",
    r"don'?t do that",
    r"that'?s not (right|what I wanted|correct)",
    r"wrong approach",
    r"revert (that|this)",
    r"start over",
]
CORRECTION_RE = re.compile("|".join(CORRECTION_PHRASES), re.IGNORECASE)

POSITIVE_PHRASES = [
    r"\bperfect\b",
    r"\bexactly\b",
    r"(yes|yeah),?\s+(that'?s|this is|looks?)\s+(right|perfect|great|exactly what)",
    r"thanks?[,.]?\s+that'?s\s+(exactly|perfect|great|what I needed)",
    r"great[,!]",
]
POSITIVE_RE = re.compile("|".join(POSITIVE_PHRASES), re.IGNORECASE)


def load_skill_signals(session_id: str) -> list[dict]:
    """Load PostToolUse-logged signals for this session."""
    if not SIGNALS_FILE.exists():
        return []
    records = []
    for line in SIGNALS_FILE.read_text().splitlines():
        try:
            r = json.loads(line)
            if r.get("session_id") == session_id:
                records.append(r)
        except (json.JSONDecodeError, KeyError):
            continue
    return records


def load_session_turns(session_id: str) -> list[dict]:
    """Load all conversation turns for the given session from project jsonl files."""
    turns = []
    pattern = str(CLAUDE_DIR / "projects" / "**" / f"{session_id}.jsonl")
    for filepath in glob.glob(pattern, recursive=True):
        for line in Path(filepath).read_text().splitlines():
            try:
                record = json.loads(line)
                if record.get("type") in ("user", "assistant"):
                    turns.append(record)
            except (json.JSONDecodeError, KeyError):
                continue
    return turns


def extract_text(content) -> str:
    """Extract text from message content (string or list of content blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return " ".join(parts)
    return str(content)


def scan_session_for_corrections(session_id: str, skill_signals: list[dict]) -> list[dict]:
    """Find user turns that correct Claude after a skill invocation."""
    turns = load_session_turns(session_id)
    if not turns:
        return []

    results = []
    # Build a timeline: for each skill invocation, look at the next user turn
    skill_invocation_times = {s["timestamp"] for s in skill_signals}
    skill_by_name = {s["timestamp"]: s["skill"] for s in skill_signals}

    # Since we can't perfectly correlate timestamps to turn positions,
    # scan for skill invocations in assistant turns (tool use), then check next user turn
    for i, turn in enumerate(turns):
        if turn.get("type") != "assistant":
            continue

        content = turn.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue

        # Check if this assistant turn used the Skill tool
        skill_used = None
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "Skill":
                skill_used = block.get("input", {}).get("skill", "unknown")
                break

        if not skill_used:
            continue

        # Look at the next few user turns for correction/positive signals
        for j in range(i + 1, min(i + 4, len(turns))):
            next_turn = turns[j]
            if next_turn.get("type") != "user":
                continue
            text = extract_text(next_turn.get("message", {}).get("content", ""))
            if not text.strip():
                continue

            if CORRECTION_RE.search(text):
                results.append({
                    "skill": skill_used,
                    "session_id": session_id,
                    "timestamp": int(time.time()),
                    "signal": "negative",
                    "source": "correction_phrase",
                    "context_snippet": text[:300],
                })
                break
            elif POSITIVE_RE.search(text):
                results.append({
                    "skill": skill_used,
                    "session_id": session_id,
                    "timestamp": int(time.time()),
                    "signal": "positive",
                    "source": "positive_phrase",
                    "context_snippet": text[:300],
                })
                break

    return results


def scan_feedback_files() -> list[dict]:
    """Read explicit typed feedback from memory files that mention a skill."""
    results = []
    pattern = str(CLAUDE_DIR / "projects" / "*" / "memory" / "feedback_*.md")
    skills_dir = CLAUDE_DIR / "skills"
    known_skills = {d.name for d in skills_dir.iterdir() if d.is_dir() and (d / "SKILL.md").exists()}

    for filepath in glob.glob(pattern, recursive=True):
        content = Path(filepath).read_text()
        for skill_name in known_skills:
            if skill_name in content:
                results.append({
                    "skill": skill_name,
                    "session_id": "feedback_file",
                    "timestamp": int(Path(filepath).stat().st_mtime),
                    "signal": "negative",
                    "source": "feedback_file",
                    "context_snippet": content[:500],
                    "source_file": filepath,
                })
    return results


def load_existing_perf_log() -> set[str]:
    """Return set of (skill, session_id, source) already logged to avoid duplicates."""
    if not PERF_LOG.exists():
        return set()
    seen = set()
    for line in PERF_LOG.read_text().splitlines():
        try:
            r = json.loads(line)
            seen.add(f"{r['skill']}|{r['session_id']}|{r.get('source', '')}")
        except (json.JSONDecodeError, KeyError):
            continue
    return seen


def main():
    # Try stdin first (hook payload), fall back to argv / env
    stdin_data = sys.stdin.read().strip() if not sys.stdin.isatty() else ""
    if stdin_data:
        try:
            payload = json.loads(stdin_data)
            session_id = payload.get("session_id", "")
        except json.JSONDecodeError:
            session_id = ""
    else:
        session_id = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("CLAUDE_SESSION_ID", "")

    new_records = []

    if session_id:
        skill_signals = load_skill_signals(session_id)
        if skill_signals:
            correction_signals = scan_session_for_corrections(session_id, skill_signals)
            new_records.extend(correction_signals)

    # Scan feedback files (idempotent via dedup below)
    feedback_signals = scan_feedback_files()
    new_records.extend(feedback_signals)

    if not new_records:
        return

    seen = load_existing_perf_log()
    written = 0
    with open(PERF_LOG, "a") as f:
        for record in new_records:
            key = f"{record['skill']}|{record['session_id']}|{record.get('source', '')}"
            if key not in seen:
                f.write(json.dumps(record) + "\n")
                seen.add(key)
                written += 1

    if written:
        print(f"[auto-improve] logged {written} new signal(s) to skill-performance-log.jsonl", file=sys.stderr)


if __name__ == "__main__":
    main()
