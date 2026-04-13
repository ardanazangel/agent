#!/usr/bin/env python3
"""Rewrite a SKILL.md body based on negative signals.

Modeled on skill-creator/scripts/improve_description.py — same _call_claude()
pattern, same env-stripping trick, parses output from <new_body> tags.

Two-pass approach (PromptWizard + SCOPE principles):
  Pass 1 — Critique: identify which lines/sections caused failures
  Pass 2 — Synthesis: rewrite those sections, balancing tactical fixes with
           strategic generalization (avoid overfitting)
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"
SKILLS_DIR = CLAUDE_DIR / "skills"
MAX_BODY_LINES = 500


def _call_claude(prompt: str, model: str | None = None, timeout: int = 300) -> str:
    cmd = ["claude", "-p", "--output-format", "text"]
    if model:
        cmd.extend(["--model", model])
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    result = subprocess.run(cmd, input=prompt, capture_output=True, text=True, env=env, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"claude -p exited {result.returncode}\nstderr: {result.stderr}")
    return result.stdout


def synthesize_body(
    skill_name: str,
    current_body: str,
    negative_signals: list[dict],
    positive_signals: list[dict],
    model: str | None = None,
) -> str:
    """Two-pass rewrite of SKILL.md body based on signals. Returns new body text."""

    neg_snippets = "\n".join(
        f"- [{s.get('source', '?')}] {s.get('context_snippet', '')[:200]}"
        for s in negative_signals[:10]
    )
    pos_snippets = "\n".join(
        f"- [{s.get('source', '?')}] {s.get('context_snippet', '')[:200]}"
        for s in positive_signals[:5]
    )

    # Pass 1: Critique
    critique_prompt = f"""You are analyzing a Claude Code skill called "{skill_name}" that has been underperforming.

Current SKILL.md body:
<current_body>
{current_body}
</current_body>

Negative signals from real usage sessions (user corrections after the skill was used):
<negative_signals>
{neg_snippets or "(none logged yet)"}
</negative_signals>

Positive signals (when it worked well):
<positive_signals>
{pos_snippets or "(none logged yet)"}
</positive_signals>

Analyze the current body and identify SPECIFIC sections, instructions, or omissions that likely caused the failures.
Be concrete: reference actual lines or sections. Keep your critique to the point (under 300 words).

Respond with your critique inside <critique> tags."""

    critique_response = _call_claude(critique_prompt, model)
    critique_match = re.search(r"<critique>(.*?)</critique>", critique_response, re.DOTALL)
    critique = critique_match.group(1).strip() if critique_match else critique_response.strip()

    # Pass 2: Synthesis
    synthesis_prompt = f"""You are improving a Claude Code skill called "{skill_name}".

Current SKILL.md body:
<current_body>
{current_body}
</current_body>

Analysis of what went wrong:
<critique>
{critique}
</critique>

Negative signals from real usage:
<negative_signals>
{neg_snippets or "(none logged yet)"}
</negative_signals>

Rewrite the SKILL.md body to fix the identified issues. Apply these principles:

TACTICAL: Fix the specific failures identified in the critique.
STRATEGIC (SCOPE principle): Also generalize — evolve the instructions to prevent SIMILAR failures in the future, not just the exact scenarios shown. Avoid overfitting to the specific examples.

Hard constraints:
- Keep the frontmatter (---...---) exactly as-is — only rewrite the body after the closing ---
- Do NOT modify the `name:` field
- Keep the total file under {MAX_BODY_LINES} lines
- Do not add excessive comments or padding

Return ONLY the complete new SKILL.md (frontmatter + improved body) inside <new_body> tags, nothing else."""

    synthesis_response = _call_claude(synthesis_prompt, model)
    match = re.search(r"<new_body>(.*?)</new_body>", synthesis_response, re.DOTALL)
    new_body = match.group(1).strip() if match else synthesis_response.strip()

    # Safety: enforce line limit
    lines = new_body.split("\n")
    if len(lines) > MAX_BODY_LINES:
        new_body = "\n".join(lines[:MAX_BODY_LINES])

    return new_body


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Synthesize improved SKILL.md body from signals")
    parser.add_argument("--skill", required=True, help="Skill name")
    parser.add_argument("--signals", required=True, help="Path to filtered signals JSON (list)")
    parser.add_argument("--model", default=None, help="Model for synthesis")
    args = parser.parse_args()

    skill_path = SKILLS_DIR / args.skill
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        print(f"Error: {skill_md} not found", file=sys.stderr)
        sys.exit(1)

    signals = json.loads(Path(args.signals).read_text())
    negative = [s for s in signals if s.get("signal") == "negative"]
    positive = [s for s in signals if s.get("signal") == "positive"]

    current_body = skill_md.read_text()
    new_body = synthesize_body(
        skill_name=args.skill,
        current_body=current_body,
        negative_signals=negative,
        positive_signals=positive,
        model=args.model,
    )

    print(new_body)


if __name__ == "__main__":
    main()
