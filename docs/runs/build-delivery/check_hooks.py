#!/usr/bin/env python3
"""Verify local Codex/Git hook wiring and behavior with synthetic fixtures."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[3]
MAX_EVENT = 65536


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(args: list[str], cwd: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=cwd, text=True, capture_output=True, timeout=10, check=check
    )


def init_repo(path: Path) -> None:
    git(["init", "-q"], path)
    git(["config", "user.name", "Hook Fixture"], path)
    git(["config", "user.email", "hook-fixture@example.invalid"], path)
    (path / "tracked.txt").write_text("fixture\n", encoding="utf-8")
    git(["add", "tracked.txt"], path)
    git(["commit", "-qm", "fixture baseline"], path)


def test_codex_hook_contract() -> None:
    config = json.loads((ROOT / ".codex/hooks.json").read_text(encoding="utf-8"))
    hooks = config.get("hooks", {})
    expected = {
        "SessionStart": {"lifecycle.py"},
        "UserPromptSubmit": {"lifecycle.py"},
        "SubagentStart": {"lifecycle.py"},
        "Stop": {"lifecycle.py", "check_diff.py"},
    }
    for event, required_files in expected.items():
        entries = hooks.get(event)
        require(isinstance(entries, list) and entries, f"missing Codex hook event {event}")
        commands = [h.get("command", "") for entry in entries for h in entry.get("hooks", [])]
        for filename in required_files:
            helper = ROOT / ".codex/hooks" / filename
            digest = hashlib.sha256(helper.read_bytes()).hexdigest()
            require(
                any(filename in command and digest in command for command in commands),
                f"{event} does not pin the current {filename} helper hash",
            )
            require(
                all("python3 -I -c" in command for command in commands),
                f"{event} has a hook command outside isolated Python",
            )

    lifecycle = load_module(ROOT / ".codex/hooks/lifecycle.py", "solopreneur_lifecycle_hook")
    with tempfile.TemporaryDirectory(prefix="hook-lifecycle-") as tmp:
        project = Path(tmp)
        run_dir = project / "docs/runs/synthetic-check"
        run_dir.mkdir(parents=True)
        (run_dir / "run.json").write_text(
            json.dumps(
                {
                    "status": "active",
                    "required_checks": ["unit", "e2e"],
                    "checks": {"unit": {"exit_code": 0}},
                }
            ),
            encoding="utf-8",
        )
        event = {"hook_event_name": "SessionStart", "cwd": str(project)}
        result = lifecycle.output(event, project)
        require(result and "synthetic-check" in json.dumps(result), "SessionStart omitted active run")
        event["hook_event_name"] = "Stop"
        result = lifecycle.output(event, project)
        message = result["systemMessage"] if result else ""
        require("missing e2e" in message, "Stop did not identify the missing required check")
        require("No automatic continuation" in message, "Stop must not request automatic continuation")


def test_stop_whitespace_behavior() -> None:
    with tempfile.TemporaryDirectory(prefix="hook-stop-") as tmp:
        repo = Path(tmp)
        init_repo(repo)
        helper = ROOT / ".codex/hooks/check_diff.py"
        bad = json.dumps({"hook_event_name": "Stop", "cwd": str(repo)}).encode()
        (repo / "tracked.txt").write_text("bad trailing space  \n", encoding="utf-8")
        result = subprocess.run(
            [sys.executable, "-I", str(helper)], input=bad, capture_output=True, timeout=10
        )
        require(b"whitespace errors in working tree" in result.stdout, "Stop missed working-tree whitespace")
        require(b"bad trailing space" not in result.stdout + result.stderr, "Stop printed source content")

        git(["add", "tracked.txt"], repo)
        result = subprocess.run(
            [sys.executable, "-I", str(helper)], input=bad, capture_output=True, timeout=10
        )
        require(b"staged diff" in result.stdout, "Stop missed staged whitespace")


def test_pre_commit_wiring_and_redaction() -> None:
    configured = git(["config", "--local", "--get", "core.hooksPath"], ROOT, check=False)
    require(configured.returncode == 0, "repository has no configured Git hooksPath")
    hook_root = Path(configured.stdout.strip())
    if not hook_root.is_absolute():
        hook_root = ROOT / hook_root
    wrapper = hook_root / "pre-commit"
    require(wrapper.is_file() and os.access(wrapper, os.X_OK), "configured pre-commit wrapper is unavailable")
    require((ROOT / ".solopreneur/hooks/check_staged.py").is_file(), "staged-check helper is missing")

    with tempfile.TemporaryDirectory(prefix="hook-precommit-") as tmp:
        repo = Path(tmp)
        init_repo(repo)
        staged_hooks = repo / ".solopreneur/hooks"
        staged_hooks.mkdir(parents=True)
        shutil.copy2(ROOT / ".solopreneur/hooks/pre-commit", staged_hooks / "pre-commit")
        shutil.copy2(ROOT / ".solopreneur/hooks/check_staged.py", staged_hooks / "check_staged.py")
        git(["config", "core.hooksPath", ".solopreneur/hooks"], repo)

        secret = "SYNTHETIC_CANARY_MUST_NOT_BE_PRINTED"
        (repo / ".env").write_text(secret + "\n", encoding="utf-8")
        git(["add", ".env"], repo)
        result = git(["commit", "-m", "must reject synthetic private filename"], repo, check=False)
        require(result.returncode != 0, "pre-commit accepted a staged .env file")
        require("potentially private staged files" in result.stderr, "pre-commit did not explain rejection")
        require(secret not in result.stdout + result.stderr, "pre-commit leaked file content")


def main() -> int:
    test_codex_hook_contract()
    test_stop_whitespace_behavior()
    test_pre_commit_wiring_and_redaction()
    configured = git(["config", "--local", "--get", "core.hooksPath"], ROOT, check=False)
    print("PASS Codex lifecycle/Stop fixtures, pinned helper hashes, whitespace advisory, and synthetic Git pre-commit rejection")
    print(f"PASS repository pre-commit applicability: core.hooksPath={configured.stdout.strip() if configured.returncode == 0 else 'not configured'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
