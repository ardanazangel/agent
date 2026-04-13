#!/usr/bin/env python3
"""Orchestrator: detect underperforming skills, rewrite them, validate, commit or revert.

Flow:
  1. Read skill-performance-log.jsonl, find skills exceeding negative-signal threshold
  2. For each qualifying skill:
     a. git snapshot (pre-auto-improve commit)
     b. synthesize_body.py → proposed new SKILL.md
     c. run_eval.py to score (if evals exist)
     d. commit if score >= before, revert otherwise
     e. append to skill-improvement-log.jsonl
  3. Write skill-health.md summary
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
SKILLS_DIR = CLAUDE_DIR / "skills"
PERF_LOG = CLAUDE_DIR / "skill-performance-log.jsonl"
IMPROVEMENT_LOG = CLAUDE_DIR / "skill-improvement-log.jsonl"
HEALTH_FILE = CLAUDE_DIR / "skill-health.md"
SCRIPTS_DIR = Path(__file__).parent

# Thresholds for qualifying a skill for improvement
NEG_RATE_THRESHOLD = 0.25   # >25% negative in last 20 invocations
NEG_COUNT_7D = 3             # OR 3+ explicit negatives in last 7 days
WINDOW_SIZE = 20
SEVEN_DAYS = 7 * 24 * 3600

DEFAULT_MODEL = "claude-sonnet-4-6"


def run_cmd(cmd: list[str], cwd: Path | None = None, check=True) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd or SKILLS_DIR, env=env, check=check)


def git_has_repo() -> bool:
    result = run_cmd(["git", "rev-parse", "--git-dir"], check=False)
    return result.returncode == 0


def git_commit(message: str, skill_name: str) -> str | None:
    run_cmd(["git", "add", f"{skill_name}/SKILL.md"])
    result = run_cmd(["git", "commit", "-m", message], check=False)
    if result.returncode == 0:
        sha = run_cmd(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()
        return sha
    return None


def git_revert(skill_name: str):
    run_cmd(["git", "checkout", "HEAD", "--", f"{skill_name}/SKILL.md"])


def load_perf_log() -> list[dict]:
    if not PERF_LOG.exists():
        return []
    records = []
    for line in PERF_LOG.read_text().splitlines():
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def find_qualifying_skills(records: list[dict]) -> list[str]:
    """Return skill names that exceed the negative-signal threshold."""
    now = time.time()
    by_skill: dict[str, list[dict]] = {}
    for r in records:
        by_skill.setdefault(r["skill"], []).append(r)

    qualifying = []
    for skill_name, skill_records in by_skill.items():
        skill_path = SKILLS_DIR / skill_name
        if not (skill_path / "SKILL.md").exists():
            continue

        sorted_records = sorted(skill_records, key=lambda r: r["timestamp"], reverse=True)
        recent = sorted_records[:WINDOW_SIZE]

        # Check rate threshold
        if len(recent) >= 5:
            neg_rate = sum(1 for r in recent if r.get("signal") == "negative") / len(recent)
            if neg_rate > NEG_RATE_THRESHOLD:
                qualifying.append(skill_name)
                continue

        # Check 7-day count threshold
        recent_7d = [r for r in sorted_records if now - r["timestamp"] < SEVEN_DAYS]
        neg_7d = sum(1 for r in recent_7d if r.get("signal") == "negative")
        if neg_7d >= NEG_COUNT_7D:
            qualifying.append(skill_name)

    return list(set(qualifying))


def run_eval_if_available(skill_name: str, description: str | None = None) -> dict | None:
    """Run run_eval.py if evals/evals.json exists. Returns summary dict or None."""
    skill_path = SKILLS_DIR / skill_name
    evals_file = skill_path / "evals" / "evals.json"
    if not evals_file.exists():
        return None

    skill_creator_scripts = SKILLS_DIR / "skill-creator" / "scripts"
    if not (skill_creator_scripts / "run_eval.py").exists():
        return None

    cmd = [
        "python3", "-c",
        f"""
import sys
sys.path.insert(0, '{SKILLS_DIR / "skill-creator"}')
from scripts.run_eval import find_project_root, run_eval
from scripts.utils import parse_skill_md
import json
from pathlib import Path

skill_path = Path('{skill_path}')
evals = json.loads(Path('{evals_file}').read_text())
name, desc, _ = parse_skill_md(skill_path)
description = {repr(description)} or desc

result = run_eval(
    eval_set=evals,
    skill_name=name,
    description=description,
    num_workers=5,
    timeout=30,
    project_root=find_project_root(),
    runs_per_query=2,
    trigger_threshold=0.5,
    model='{DEFAULT_MODEL}',
)
print(json.dumps(result['summary']))
""",
    ]
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=300)
    if result.returncode != 0:
        print(f"[auto-improve] eval failed for {skill_name}: {result.stderr[:200]}", file=sys.stderr)
        return None
    try:
        return json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        return None


def get_signals_for_skill(skill_name: str, records: list[dict]) -> list[dict]:
    return [r for r in records if r["skill"] == skill_name]


def synthesize(skill_name: str, records: list[dict], model: str) -> str | None:
    """Call synthesize_body.py and return the proposed new body."""
    import tempfile
    signals_file = Path(tempfile.mktemp(suffix=".json"))
    try:
        signals_file.write_text(json.dumps(records))
        cmd = [
            "python3",
            str(SCRIPTS_DIR / "synthesize_body.py"),
            "--skill", skill_name,
            "--signals", str(signals_file),
            "--model", model,
        ]
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=600)
        if result.returncode != 0:
            print(f"[auto-improve] synthesize failed for {skill_name}: {result.stderr[:300]}", file=sys.stderr)
            return None
        return result.stdout.strip()
    finally:
        signals_file.unlink(missing_ok=True)


def score_from_summary(summary: dict | None) -> float:
    if summary is None:
        return 1.0  # no evals = treat as passing
    total = summary.get("total", 0)
    if total == 0:
        return 1.0
    return summary.get("passed", 0) / total


def append_improvement_log(record: dict):
    with open(IMPROVEMENT_LOG, "a") as f:
        f.write(json.dumps(record) + "\n")


def write_health_file(all_records: list[dict]):
    by_skill: dict[str, list[dict]] = {}
    for r in all_records:
        by_skill.setdefault(r["skill"], []).append(r)

    lines = [
        "# Skill Health",
        f"_Updated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_",
        "",
        "| Skill | Last signal | Neg rate (last 20) | Last improved |",
        "|-------|-------------|-------------------|---------------|",
    ]

    improvement_records = []
    if IMPROVEMENT_LOG.exists():
        for line in IMPROVEMENT_LOG.read_text().splitlines():
            try:
                improvement_records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    last_improved = {r["skill"]: r["timestamp"] for r in improvement_records}

    for skill_name, records in sorted(by_skill.items()):
        sorted_r = sorted(records, key=lambda r: r["timestamp"], reverse=True)
        recent = sorted_r[:WINDOW_SIZE]
        neg_count = sum(1 for r in recent if r.get("signal") == "negative")
        neg_rate = neg_count / len(recent) if recent else 0
        last_ts = sorted_r[0]["timestamp"] if sorted_r else 0
        last_signal = datetime.fromtimestamp(last_ts, timezone.utc).strftime("%Y-%m-%d") if last_ts else "—"
        improved_ts = last_improved.get(skill_name, 0)
        improved_str = datetime.fromtimestamp(improved_ts, timezone.utc).strftime("%Y-%m-%d") if improved_ts else "never"
        trend = "🔴" if neg_rate > NEG_RATE_THRESHOLD else ("🟡" if neg_rate > 0.1 else "🟢")
        lines.append(f"| {skill_name} | {last_signal} | {trend} {neg_rate:.0%} ({neg_count}/{len(recent)}) | {improved_str} |")

    HEALTH_FILE.write_text("\n".join(lines) + "\n")


def improve_skill(skill_name: str, records: list[dict], model: str) -> dict:
    skill_path = SKILLS_DIR / skill_name
    skill_md = skill_path / "SKILL.md"
    ts = datetime.now(timezone.utc).isoformat()

    neg_records = [r for r in records if r.get("signal") == "negative"]
    print(f"[auto-improve] improving {skill_name} ({len(neg_records)} negative signals)...", file=sys.stderr)

    # Score before
    eval_before = run_eval_if_available(skill_name)
    score_before = score_from_summary(eval_before)

    # Git snapshot
    has_git = git_has_repo()
    if has_git:
        git_commit(f"snapshot: {skill_name} pre-auto-improve {ts}", skill_name)

    # Synthesize
    new_body = synthesize(skill_name, neg_records, model)
    if not new_body:
        return {"skill": skill_name, "timestamp": ts, "error": "synthesis_failed", "reverted": False}

    # Write proposed body
    original_body = skill_md.read_text()
    skill_md.write_text(new_body)

    # Score after
    eval_after = run_eval_if_available(skill_name)
    score_after = score_from_summary(eval_after)

    reverted = False
    commit_sha = None

    if score_after >= score_before:
        if has_git:
            score_delta = f"{(score_after - score_before) * 100:+.0f}%"
            commit_sha = git_commit(
                f"auto-improve: {skill_name} | signals: {len(neg_records)} | score delta: {score_delta}",
                skill_name,
            )
        print(f"[auto-improve] {skill_name}: improved (score {score_before:.0%} → {score_after:.0%})", file=sys.stderr)
    else:
        # Revert
        skill_md.write_text(original_body)
        if has_git:
            git_revert(skill_name)
        reverted = True
        print(f"[auto-improve] {skill_name}: reverted (score {score_before:.0%} → {score_after:.0%}, regression)", file=sys.stderr)

    record = {
        "skill": skill_name,
        "timestamp": ts,
        "trigger": "negative_signal_rate",
        "signals_used": len(neg_records),
        "score_before": f"{score_before:.0%}" if eval_before else None,
        "score_after": f"{score_after:.0%}" if eval_after else None,
        "body_changed": not reverted,
        "git_commit": commit_sha,
        "reverted": reverted,
    }
    append_improvement_log(record)
    return record


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Auto-improve underperforming skills")
    parser.add_argument("--skill", default=None, help="Force improve a specific skill (skip threshold check)")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true", help="Show qualifying skills without improving")
    args = parser.parse_args()

    all_records = load_perf_log()

    if args.skill:
        qualifying = [args.skill]
    else:
        qualifying = find_qualifying_skills(all_records)

    if not qualifying:
        print("[auto-improve] no skills qualify for improvement", file=sys.stderr)
        write_health_file(all_records)
        return

    print(f"[auto-improve] qualifying skills: {qualifying}", file=sys.stderr)

    if args.dry_run:
        for s in qualifying:
            neg = sum(1 for r in all_records if r["skill"] == s and r.get("signal") == "negative")
            print(f"  {s}: {neg} negative signals")
        write_health_file(all_records)
        return

    results = []
    for skill_name in qualifying:
        skill_records = get_signals_for_skill(skill_name, all_records)
        result = improve_skill(skill_name, skill_records, args.model)
        results.append(result)

    write_health_file(all_records)

    print("\n[auto-improve] summary:")
    for r in results:
        status = "REVERTED" if r.get("reverted") else ("ERROR" if r.get("error") else "IMPROVED")
        print(f"  {r['skill']}: {status}")

    print(f"\nHealth report: {HEALTH_FILE}")


if __name__ == "__main__":
    main()
