#!/usr/bin/env python3
"""Check staged filenames and whitespace; never print file contents."""
import os
import subprocess
import sys

GIT_TIMEOUT = 10


def main():
    names = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        check=True, stdout=subprocess.PIPE, timeout=GIT_TIMEOUT,
    ).stdout.split(b"\0")
    blocked = []
    for raw in filter(None, names):
        path = os.fsdecode(raw)
        name = path.rsplit("/", 1)[-1].lower()
        example = name.endswith((".example", ".sample", ".template"))
        if not example and (
            name == ".env" or name.startswith(".env.")
            or name.endswith((".p8", ".p12", ".pfx", ".keystore", ".jks", ".key"))
            or name in ("id_rsa", "id_ed25519", "credentials.json", "service-account.json")
        ):
            blocked.append(path)
    if blocked:
        print("Commit blocked: review potentially private staged files:", file=sys.stderr)
        for path in blocked:
            print("  " + repr(path), file=sys.stderr)
    whitespace = subprocess.run(
        ["git", "diff", "--cached", "--check"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=GIT_TIMEOUT,
    ).returncode
    if whitespace:
        print("Commit blocked: staged diff contains whitespace errors; inspect git diff --cached --check locally.", file=sys.stderr)
    return 1 if blocked or whitespace else 0


if __name__ == "__main__":
    sys.exit(main())
