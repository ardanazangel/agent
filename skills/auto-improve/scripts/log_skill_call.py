#!/usr/bin/env python3
"""PostToolUse hook: log each Skill tool invocation to skill-signals.jsonl."""

import json
import os
import sys
import time
from pathlib import Path

SIGNALS_FILE = Path.home() / ".claude" / "skill-signals.jsonl"


def main():
    # Hooks receive JSON payload on stdin
    try:
        payload = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        payload = {}

    session_id = payload.get("session_id", "unknown")
    tool_input = payload.get("tool_input", {})
    tool_response = payload.get("tool_response", {})
    skill_name = tool_input.get("skill", "unknown")
    tool_result_raw = str(tool_response)[:500]

    record = {
        "skill": skill_name,
        "session_id": session_id,
        "timestamp": int(time.time()),
        "tool_result_snippet": tool_result_raw,
    }

    with open(SIGNALS_FILE, "a") as f:
        f.write(json.dumps(record) + "\n")


if __name__ == "__main__":
    main()
