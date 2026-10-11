#!/usr/bin/env python3
"""Advisory Codex Stop hook; no writes, source output, or continuation loop."""

import json
import os
import subprocess
import sys

MAX_EVENT_BYTES = 65536


def check_diff(cwd, staged=False):
    args = [
        "git", "-C", cwd, "diff", "--check", "--no-ext-diff", "--no-textconv",
        "--ignore-submodules",
    ]
    if staged:
        args.append("--cached")
    result = subprocess.run(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=3,
        check=False,
    )
    return result.returncode


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_EVENT_BYTES + 1)
        if len(raw) > MAX_EVENT_BYTES:
            return
        event = json.loads(raw)
    except (ValueError, OSError):
        return
    if not isinstance(event, dict) or event.get("hook_event_name") != "Stop":
        return
    cwd = event.get("cwd", os.getcwd())
    if not isinstance(cwd, str) or not os.path.isdir(cwd):
        return
    try:
        results = [("working tree", check_diff(cwd)), ("staged diff", check_diff(cwd, True))]
    except (OSError, subprocess.TimeoutExpired):
        return
    # git diff --check returns a nonzero status for whitespace issues; 128/129
    # denotes an unusable repository/invocation and is not a whitespace finding.
    dirty = [label for label, code in results if 0 < code < 128]
    if dirty:
        print(json.dumps({
            "systemMessage": "Solopreneur: whitespace errors in " + ", ".join(dirty)
            + ". Inspect git diff --check (or --cached for staged changes). "
            + "This advisory does not block completion."
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
