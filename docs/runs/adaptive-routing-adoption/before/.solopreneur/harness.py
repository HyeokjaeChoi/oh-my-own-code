#!/usr/bin/env python3
"""Local run ledger with review and evidence gates; no model or service calls."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

KINDS = {
    "research": ["plan"], "docs": ["plan"],
    "product": ["plan", "product"],
    "design-spec": ["plan", "design_spec"],
    "feature": ["plan", "code", "checks"],
    "bugfix": ["plan", "code", "checks"],
    "design": ["plan", "design"],
    "analysis": ["plan", "analysis"],
    "growth": ["plan", "growth"],
    "release": ["plan", "code", "checks", "release"],
}
REVIEWERS = {
    "plan": "plan_reviewer", "code": "reviewer", "design": "design_qa",
    "analysis": "analytics_analyst", "growth": "marketing_specialist",
    "release": "release_engineer",
    "product": "product_reviewer", "design_spec": "design_spec_reviewer",
}
DOCUMENT_GATES = ("product", "design_spec")
ARTIFACT_TYPES = ("general",) + DOCUMENT_GATES
SKIP_DIRS = {".git", "node_modules", ".next", ".expo", ".turbo", ".venv", "__pycache__", "coverage", "dist"}
EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")
MODEL_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
DOCUMENT_SUFFIXES = {".md", ".markdown", ".rst", ".adoc"}
AGENT_INSTRUCTION_NAMES = {"agents.md", "agents.override.md"}
FINAL_GATES = set(REVIEWERS) - {"plan", "product", "design_spec"}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha(path):
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def plain(value):
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object.")
    return value


def slug(value):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", value):
        raise ValueError("Use a lowercase slug of at most 80 letters, digits, or hyphens.")
    return value


def local(project, name, exists=False):
    relative = Path(name)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Use a project-relative path without '..'.")
    path = project / relative
    for item in [path] + list(path.parents):
        if item == project:
            break
        if item.is_symlink():
            raise ValueError("Symlinked evidence/state paths are not supported.")
    if exists and (not path.is_file() or not path.stat().st_size):
        raise ValueError("Evidence must be an existing, nonempty file: " + str(name))
    return path


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp-" + str(os.getpid()))
    with temporary.open("x") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
    temporary.replace(path)


def state_file(project, run):
    return local(project, "docs/runs/" + slug(run) + "/run.json")


@contextmanager
def run_lock(project, run):
    path = local(project, "docs/runs/.locks/" + slug(run) + ".lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Run is busy; retry after its current ledger command finishes.") from None
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def base_gates(state):
    required = list(KINDS[state["kind"]])
    ui = state.get("ui", "design" in state["required_gates"])
    if type(ui) is not bool:
        raise ValueError("Invalid run UI setting.")
    if ui and "design" not in required:
        required.append("design")
    return required


def artifact_gates(item):
    kind = item.get("type", "general")
    if kind not in ARTIFACT_TYPES:
        raise ValueError("Invalid artifact type.")
    gates = [kind] if kind in DOCUMENT_GATES else []
    parts = tuple(part.casefold() for part in Path(item["path"]).parts)
    if parts[:2] in (("docs", "product"), ("docs", "specs")):
        gates.append("product")
    if parts == ("docs", "design", "system.md") or parts[:3] == ("docs", "design", "specs"):
        gates.append("design_spec")
    return list(dict.fromkeys(gates))


def required_gates(state):
    extra = state.get("required_reviews", [])
    if not isinstance(extra, list) or any(gate not in REVIEWERS for gate in extra):
        raise ValueError("Invalid additional review requirements.")
    required = base_gates(state) + extra
    for item in state["artifacts"]:
        required.extend(artifact_gates(item))
    return list(dict.fromkeys(required))


def required_checks(state):
    checks = state.get("required_checks", [])
    if not isinstance(checks, list) or any(not isinstance(name, str) for name in checks):
        raise ValueError("Invalid required check names.")
    if any(not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", name) for name in checks):
        raise ValueError("Invalid required check names.")
    if len(set(checks)) != len(checks):
        raise ValueError("Duplicate required check names.")
    return checks


def retain_requirements(state):
    # Persist inferred gates as additive requirements, even after reclassification.
    extra = state.setdefault("required_reviews", [])
    for item in state["artifacts"]:
        for gate in artifact_gates(item):
            if gate not in extra:
                extra.append(gate)
    state["required_gates"] = required_gates(state)
    state.setdefault("required_checks", [])
    required_checks(state)


def load(project, run):
    state = json.loads(state_file(project, run).read_text())
    if state.get("schema_version") not in (1, 2) or state.get("run") != run:
        raise ValueError("Unsupported or inconsistent run record.")
    if state["schema_version"] == 2:
        if state.get("status") not in ("active", "blocked", "cancelled", "superseded", "complete"):
            raise ValueError("Invalid run lifecycle state.")
        expected = required_gates(state)
        if state.get("required_gates") != expected:
            raise ValueError("Run gates do not match its kind, UI, and artifact/review requirements.")
        return state
    legacy = "required_reviews" not in state
    expected = base_gates(state) if legacy else required_gates(state)
    if state["required_gates"] != expected:
        raise ValueError("Run gates do not match its kind, UI, and artifact/review requirements.")
    required_checks(state)
    if legacy and state["status"] == "active":
        retain_requirements(state)
    state.setdefault("dispatches", [])
    state.setdefault("ownership", [])
    return state


def registry(project):
    path = project / ".solopreneur/roles.json"
    if not path.exists():
        path = project / "harness/roles.json"
    return json.loads(path.read_text())["roles"]


def managed_product_marker(path):
    """Return whether path is an independently managed product boundary."""
    marker = path / ".solopreneur/managed.json"
    try:
        agents_path = path / "AGENTS.md"
        if (path.is_symlink() or marker.is_symlink() or marker.parent.is_symlink()
                or agents_path.is_symlink() or not agents_path.is_file()):
            return False
        agents = agents_path.read_text()
        start = "<!-- solopreneur:begin -->"
        end = "<!-- solopreneur:end -->"
        if (agents.count(start) != 1 or agents.count(end) != 1
                or agents.index(start) > agents.index(end)):
            return False
        state = json.loads(marker.read_text())
        files_map = state.get("files") if isinstance(state, dict) else None
        if (not isinstance(state, dict) or type(state.get("version")) is not int
                or state.get("version") != 1 or not isinstance(files_map, dict) or not files_map
                or not isinstance(state.get("agents_hash"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", state["agents_hash"])):
            return False
        for name, value in files_map.items():
            if not isinstance(name, str) or not name:
                return False
            relative = Path(name)
            if (relative == Path(".")
                    or relative.is_absolute() or ".." in relative.parts
                    or not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)):
                return False
        result = subprocess.run(["git", "-C", str(path), "rev-parse", "--show-toplevel"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        return result.returncode == 0 and Path(result.stdout.strip()).resolve() == path.resolve()
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False


def fingerprint(project):
    result = subprocess.run(["git", "-C", str(project), "rev-parse", "--show-toplevel"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    git_project = result.returncode == 0 and Path(result.stdout.strip()).resolve() == project
    if git_project:
        raw = subprocess.check_output(["git", "-C", str(project), "ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        names = {os.fsdecode(name) for name in raw.split(b"\0") if name}
    else:
        names = set()
        toolkit = (project / "scripts/solo.py").is_file() and (project / "harness/roles.json").is_file()
        for directory, folders, files in os.walk(project, followlinks=False):
            folders[:] = [name for name in folders if name not in SKIP_DIRS and not (Path(directory) / name).is_symlink()]
            if toolkit and Path(directory).resolve() == (project / "projects").resolve():
                folders[:] = [name for name in folders
                              if not managed_product_marker(Path(directory) / name)]
            for name in files:
                names.add(str((Path(directory) / name).relative_to(project)))
    digest = hashlib.sha256()
    for name in sorted(names):
        parts = Path(name).parts
        basename = Path(name).name
        secret_env = (basename == ".env" or basename.startswith(".env.")) and not basename.endswith((".example", ".sample", ".template"))
        if (name.startswith("docs/runs/") or (not git_project and any(part in SKIP_DIRS for part in parts))
                or secret_env or name.endswith((".pyc", ".swp", ".swo", "~"))):
            continue
        path = project / name
        digest.update(name.encode("utf-8", "surrogateescape") + b"\0")
        if path.is_symlink():
            digest.update(os.readlink(path).encode("utf-8", "surrogateescape"))
        elif path.is_file():
            digest.update(sha(path).encode())
        else:
            digest.update(b"<deleted>")
    return digest.hexdigest()


def included_name(name, git_project=False):
    if (not isinstance(name, str) or not name or name == "." or name.startswith("/")
            or ".." in Path(name).parts or "\\" in name or "//" in name
            or str(Path(name)) != name):
        return False
    parts = Path(name).parts
    basename = parts[-1]
    secret_env = (basename == ".env" or basename.startswith(".env.")) and not basename.endswith((".example", ".sample", ".template"))
    return not (name.startswith("docs/runs/") or secret_env or name.endswith((".pyc", ".swp", ".swo", "~"))
                or (not git_project and any(part in SKIP_DIRS for part in parts)))


def inclusion_policy(project):
    result = subprocess.run(["git", "-C", str(project), "rev-parse", "--show-toplevel"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=10)
    return "git" if result.returncode == 0 and Path(result.stdout.strip()).resolve() == project else "walk"


def inventory(project):
    git_project = inclusion_policy(project) == "git"
    if git_project:
        raw = subprocess.check_output(["git", "-C", str(project), "ls-files", "--cached", "--others", "--exclude-standard", "-z"], timeout=10)
        names = {os.fsdecode(name) for name in raw.split(b"\0") if name}
    else:
        names = set()
        toolkit = (project / "scripts/solo.py").is_file() and (project / "harness/roles.json").is_file()
        for directory, folders, files in os.walk(project, followlinks=False):
            folders[:] = [name for name in folders if name not in SKIP_DIRS and not (Path(directory) / name).is_symlink()]
            if toolkit and Path(directory).resolve() == (project / "projects").resolve():
                folders[:] = [name for name in folders if not managed_product_marker(Path(directory) / name)]
            names.update(str((Path(directory) / name).relative_to(project)) for name in files)
    result = {}
    for name in sorted(names):
        if not included_name(name, git_project):
            continue
        path = project / name
        if path.is_symlink():
            result[name] = {"type": "symlink", "mode": stat.S_IMODE(path.lstat().st_mode),
                            "sha256": hashlib.sha256(os.readlink(path).encode("utf-8", "surrogateescape")).hexdigest()}
        elif path.is_file():
            result[name] = {"type": "file", "mode": stat.S_IMODE(path.stat().st_mode), "sha256": sha(path)}
    return result


def changed_paths(before, after):
    return sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))


def legacy_inventory_fingerprint(files):
    result = hashlib.sha256()
    for name, item in sorted(files.items()):
        result.update(name.encode("utf-8", "surrogateescape") + b"\0")
        # Legacy fingerprints stored link targets verbatim; a digest alone cannot reconstruct them.
        if item["type"] != "file":
            raise ValueError("Legacy symlink inventory needs target bytes to verify its aggregate.")
        result.update(item["sha256"].encode())
    return result.hexdigest()


def validate_inventory_record(project, record, old_fingerprint):
    plain(record)
    files = record.get("files")
    if record.get("schema_version") != 1 or record.get("captured_before_implementation") is not True or not isinstance(files, dict) or not files:
        raise ValueError("Historical inventory is missing or malformed.")
    if record.get("v1_fingerprint") != old_fingerprint:
        raise ValueError("Historical inventory does not bind the registered v1 plan.")
    policy = record.get("inclusion_policy", "walk")
    if policy not in ("git", "walk"):
        raise ValueError("Historical inventory inclusion policy is invalid.")
    if "inclusion_policy" not in record and inclusion_policy(project) != "walk":
        raise ValueError("Historical inventory omits inclusion policy; cannot infer a Git transition.")
    for name, item in files.items():
        if not included_name(name, policy == "git") or name == "." or Path(name).is_absolute():
            raise ValueError("Historical inventory has an excluded or unsafe path: " + str(name))
        if not isinstance(item, dict) or set(item) != {"type", "mode", "sha256"}:
            raise ValueError("Historical inventory has malformed entry: " + name)
        if item["type"] not in ("file", "symlink") or type(item["mode"]) is not int or not 0 <= item["mode"] <= 0o7777 or not isinstance(item["sha256"], str) or not HEX64.fullmatch(item["sha256"]):
            raise ValueError("Historical inventory has invalid type, mode, or digest: " + name)
        if policy == "walk" and any(part in SKIP_DIRS for part in Path(name).parts):
            raise ValueError("Historical inventory inclusion policy is incompatible: " + name)
    if legacy_inventory_fingerprint(files) != old_fingerprint:
        raise ValueError("Historical inventory legacy aggregate does not match registered plan.")
    return files


def evidence(project, name):
    path = local(project, name, exists=True)
    return {"path": str(path.relative_to(project)), "sha256": sha(path)}


def fresh_evidence(project, item):
    try:
        return sha(local(project, item["path"], exists=True)) == item["sha256"]
    except (OSError, ValueError, KeyError):
        return False


def verification_digest(state):
    items = {"checks": state["checks"],
             "artifacts": sorted(state["artifacts"], key=lambda item: item["path"])}
    return hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()


def document_digest(project, state, gate):
    items = [{"path": item["path"], "sha256": item["sha256"]}
             for item in state["artifacts"] if gate in artifact_gates(item)]
    if not items or any(not fresh_evidence(project, item) for item in items):
        raise ValueError(gate + " documents missing or changed; register current documents with --type " + gate + ".")
    return hashlib.sha256(json.dumps(sorted(items, key=lambda item: item["path"]), sort_keys=True).encode()).hexdigest()


def document_handoff(project, state, gate):
    reviewed_plan(project, state)
    review = state["reviews"].get(gate)
    if (not review or review["verdict"] != "pass"
            or review["plan_sha256"] != state["plan"]["sha256"]
            or not fresh_evidence(project, review["evidence"])):
        raise ValueError(gate + " handoff needs an independent pass for the current plan and documents.")
    if review.get("documents_sha256") != document_digest(project, state, gate):
        raise ValueError(gate + " handoff documents changed since review; obtain a fresh independent review.")


def reviewed_plan(project, state):
    plan = state.get("plan")
    review = state["reviews"].get("plan")
    if (not plan or not fresh_evidence(project, plan) or not review or review["verdict"] != "pass"
            or review["plan_sha256"] != plan["sha256"] or not fresh_evidence(project, review["evidence"])):
        raise ValueError("Obtain and record an independent pass for the current plan first.")


def advisory_warnings(project, state):
    """Warning-only hints; never block finish."""
    warnings = []
    dispatches = state.get("dispatches", [])
    if not dispatches:
        warnings.append("no specialist dispatches recorded; dispatch is optional and advisory")
    else:
        for entry in dispatches:
            if not entry.get("plan_sha256"):
                warnings.append("dispatch missing plan binding (advisory only): " + entry.get("role", "?") + " — pass --plan docs/runs/<run-id>/plan.md to bind clean-context dispatch to its SSOT")
                break
    ownership = state.get("ownership", [])
    if ownership:
        import fnmatch
        for item in state.get("artifacts", []):
            path = item.get("path", "")
            if not any(fnmatch.fnmatch(path, pattern)
                       for entry in ownership for pattern in entry.get("paths", [])):
                warnings.append("artifact outside declared ownership (advisory only): " + path)
                break
    return warnings


def gaps(project, state):
    missing = []
    plan = state.get("plan")
    if not plan or not fresh_evidence(project, plan):
        missing.append("missing or changed plan")
    current = fingerprint(project)
    checks = state["checks"]
    declared = required_checks(state)
    absent = [name for name in declared if name not in checks]
    if absent:
        missing.append("required checks missing: " + ", ".join(absent))
    if (("checks" in state["required_gates"] and not checks)
            or any(c["exit_code"] != 0 or c["fingerprint"] != current
                   or not plan or c.get("plan_sha256") != plan["sha256"] for c in checks.values())):
        missing.append("checks missing, failed, or stale")
    for gate in dict.fromkeys(state["required_gates"] + list(state["reviews"])):
        if gate == "checks":
            continue
        review = state["reviews"].get(gate)
        if not review or review["verdict"] != "pass" or not fresh_evidence(project, review["evidence"]):
            missing.append(gate + " review missing or unresolved")
        elif not plan or review["plan_sha256"] != plan["sha256"]:
            missing.append(gate + " review uses an older plan")
        elif gate != "plan" and review["fingerprint"] != current:
            missing.append(gate + " review is stale")
        elif gate != "plan" and review.get("verification_sha256") != verification_digest(state):
            missing.append(gate + " review predates current checks or deliverables")
        if gate in DOCUMENT_GATES:
            try:
                document_handoff(project, state, gate)
            except ValueError as error:
                missing.append(str(error))
    if not state["artifacts"] or any(not fresh_evidence(project, item) for item in state["artifacts"]):
        missing.append("deliverable artifacts missing or changed")
    return missing


def contract_record(project, name):
    item = evidence(project, name)
    data = plain(json.loads(local(project, name, exists=True).read_text()))
    if data.get("schema_version") != 2:
        raise ValueError("Contract must use schema_version 2.")
    if not {"schema_version", "acceptance", "checks"} <= set(data) or set(data) - {"schema_version", "acceptance", "checks", "documents", "user_approvals", "environment_files"}:
        raise ValueError("Contract has missing or unknown fields.")
    acceptance = data.get("acceptance")
    if not isinstance(acceptance, list) or not acceptance:
        raise ValueError("Contract needs acceptance entries.")
    ids = []
    for entry in acceptance:
        if not isinstance(entry, dict) or set(entry) != {"id", "description"} or not isinstance(entry["description"], str) or not entry["description"].strip():
            raise ValueError("Invalid acceptance entry.")
        if not isinstance(entry["id"], str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,79}", entry["id"]):
            raise ValueError("Invalid acceptance ID.")
        ids.append(entry["id"])
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate acceptance IDs.")
    checks = data.get("checks", {})
    if not isinstance(checks, dict):
        raise ValueError("Contract checks must be an object.")
    for name, check in checks.items():
        slug(name)
        if (not isinstance(check, dict) or set(check) != {"argv", "cwd", "scope", "acceptance_ids", "required"}
                or not isinstance(check["argv"], list) or not check["argv"]
                or any(not isinstance(arg, str) or not arg or "\0" in arg for arg in check["argv"])
                or not isinstance(check["scope"], str) or not check["scope"].strip()
                or type(check["required"]) is not bool
                or not isinstance(check["acceptance_ids"], list) or not check["acceptance_ids"]
                or any(aid not in ids for aid in check["acceptance_ids"])):
            raise ValueError("Invalid contracted check: " + name)
        cwd = local(project, check["cwd"])
        if not cwd.is_dir():
            raise ValueError("Contract check cwd must exist: " + name)
    for key in ("documents", "user_approvals", "environment_files"):
        if not isinstance(data.get(key, []), list):
            raise ValueError("Contract " + key + " must be a list.")
    for path in data.get("environment_files", []):
        local(project, path, exists=True)
    for doc in data.get("documents", []):
        if (not isinstance(doc, dict) or set(doc) != {"path", "gate", "version", "sha256"}
                or doc["gate"] not in DOCUMENT_GATES or not isinstance(doc["version"], str)
                or not doc["version"] or not isinstance(doc["sha256"], str) or not HEX64.fullmatch(doc["sha256"])):
            raise ValueError("Invalid document dependency.")
        if sha(local(project, doc["path"], exists=True)) != doc["sha256"]:
            raise ValueError("Document dependency is stale: " + doc["path"])
    for approval in data.get("user_approvals", []):
        if (not isinstance(approval, dict) or set(approval) != {"id", "version", "target", "evidence"}
                or not isinstance(approval["id"], str) or not approval["id"]
                or not isinstance(approval["version"], str) or not approval["version"]
                or not isinstance(approval["target"], dict)
                or set(approval["target"]) != {"path", "sha256"}
                or not isinstance(approval["evidence"], dict)
                or set(approval["evidence"]) != {"path", "sha256"}):
            raise ValueError("Invalid user approval dependency.")
        if (not isinstance(approval["target"]["sha256"], str)
                or not HEX64.fullmatch(approval["target"]["sha256"])
                or sha(local(project, approval["target"]["path"], exists=True)) != approval["target"]["sha256"]):
            raise ValueError("User approval target is stale: " + approval["id"])
        if not isinstance(approval["evidence"]["sha256"], str) or not HEX64.fullmatch(approval["evidence"]["sha256"]):
            raise ValueError("Invalid user approval evidence digest.")
        if sha(local(project, approval["evidence"]["path"], exists=True)) != approval["evidence"]["sha256"]:
            raise ValueError("User approval evidence is stale: " + approval["id"])
    return item, data


def contract_current(project, state):
    item = state.get("contract")
    if not item or not fresh_evidence(project, item):
        raise ValueError("Reviewed contract is missing or changed; register a new plan and review.")
    _, data = contract_record(project, item["path"])
    return data


def source_fingerprint(project):
    return digest(inventory(project))


def environment_fingerprint(project, contract):
    return digest({name: sha(local(project, name, exists=True)) for name in contract.get("environment_files", [])})


def document_binding(project, state, gate):
    docs = [doc for doc in contract_current(project, state).get("documents", []) if doc["gate"] == gate]
    if not docs:
        raise ValueError(gate + " documents missing from contract.")
    for doc in docs:
        if sha(local(project, doc["path"], exists=True)) != doc["sha256"]:
            raise ValueError(gate + " document changed: " + doc["path"])
        if not any(a["path"] == doc["path"] and fresh_evidence(project, a) for a in state["artifacts"]):
            raise ValueError(gate + " document is not a current artifact: " + doc["path"])
    return digest(docs)


def v2_review_binding(project, state, gate):
    if not state.get("plan") or not fresh_evidence(project, state["plan"]):
        raise ValueError("Current plan missing or changed.")
    contract = contract_current(project, state)
    binding = {"schema_version": 2, "gate": gate, "plan_sha256": state["plan"]["sha256"],
               "contract_sha256": state["contract"]["sha256"]}
    if gate in DOCUMENT_GATES:
        binding["documents_sha256"] = document_binding(project, state, gate)
    elif gate == "plan":
        binding["source_sha256"] = state["plan"]["source_sha256"]
    else:
        binding["source_sha256"] = source_fingerprint(project)
        binding["environment_sha256"] = environment_fingerprint(project, contract)
        binding["verification_sha256"] = digest({"checks": state["checks"], "artifacts": state["artifacts"], "outcome": state.get("outcome")})
    return binding


def v2_review_current(project, state, gate):
    review = state["reviews"].get(gate)
    if not review or review.get("verdict") != "pass" or not fresh_evidence(project, review["evidence"]):
        return False
    try:
        return review["reviewed"] == v2_review_binding(project, state, gate)
    except (ValueError, OSError, KeyError):
        return False


def v2_reviewed_plan(project, state):
    if not v2_review_current(project, state, "plan"):
        raise ValueError("Obtain and record an independent pass for the current plan and contract first.")


def source_change_gate(state, current):
    changes = changed_paths(state["baseline"], current)
    # Only ordinary documents can keep a weak run kind; unknown paths need review.
    return any(name.startswith(("scripts/", ".agents/", ".codex/", "src/", "app/", "apps/", "packages/", "tests/"))
               or name.startswith(".github/") or Path(name).name.casefold() in AGENT_INSTRUCTION_NAMES
               or Path(name).suffix.lower() not in DOCUMENT_SUFFIXES
               or any((item or {}).get("mode", 0) & 0o111 for item in (state["baseline"].get(name), current.get(name)))
               for name in changes)


def v2_required_gates(state, current):
    required = required_gates(state)
    if source_change_gate(state, current):
        for gate in ("code", "checks"):
            if gate not in required:
                required.append(gate)
    return required


def v2_gaps(project, state):
    missing = []
    if state["status"] != "active":
        missing.append("run is " + state["status"])
    try:
        contract = contract_current(project, state)
    except (ValueError, OSError) as error:
        return missing + [str(error)]
    current = inventory(project)
    required = v2_required_gates(state, current)
    if not v2_review_current(project, state, "plan"):
        missing.append("plan review missing or stale")
    selected = contract["checks"]
    absent = [name for name, check in selected.items() if check["required"] and name not in state["checks"]]
    if absent:
        missing.append("required checks missing: " + ", ".join(absent))
    if ("checks" in required and not state["checks"]) or any(
            name not in selected or not attempts or attempts[-1]["exit_code"] != 0
            or attempts[-1].get("inputs_changed")
            or attempts[-1]["source_sha256"] != digest(current)
            or attempts[-1]["environment_sha256"] != environment_fingerprint(project, contract)
            or attempts[-1]["plan_sha256"] != state["plan"]["sha256"]
            or attempts[-1]["contract_sha256"] != state["contract"]["sha256"]
            for name, attempts in state["checks"].items()):
        missing.append("checks missing, failed, or stale")
    if any(not fresh_evidence(project, item) for item in state["artifacts"]) or not state["artifacts"]:
        missing.append("deliverable artifacts missing or changed")
    for gate in dict.fromkeys(required + list(state["reviews"])):
        if gate != "checks" and not v2_review_current(project, state, gate):
            missing.append(gate + " review missing, unresolved, or stale")
    for approval in contract.get("user_approvals", []):
        try:
            current_sha = sha(local(project, approval["evidence"]["path"], exists=True))
        except (ValueError, OSError):
            current_sha = None
        if current_sha != approval["evidence"]["sha256"]:
            missing.append("user approval stale: " + approval["id"])
    outcome = state.get("outcome")
    if not outcome or not fresh_evidence(project, outcome):
        missing.append("final outcome missing or changed")
    else:
        data = json.loads(local(project, outcome["path"]).read_text())
        actual_changes = set(changed_paths(state["baseline"], current))
        actual_deleted = {name for name in actual_changes if name not in current}
        if set(data.get("changed_paths", [])) != actual_changes or set(data.get("deleted_paths", [])) != actual_deleted:
            missing.append("final outcome does not cover all changed and deleted paths")
        acceptance = data.get("acceptance", {})
        if set(acceptance) != {entry["id"] for entry in contract["acceptance"]}:
            missing.append("final outcome does not cover all acceptance IDs")
        else:
            for aid, entry in acceptance.items():
                if not isinstance(entry, dict) or entry.get("status") not in ("verified", "deferred"):
                    missing.append("acceptance unresolved: " + aid)
                    continue
                if entry["status"] == "verified":
                    if not entry.get("artifacts") and not entry.get("checks"):
                        missing.append("acceptance lacks verification: " + aid)
                    if any(name not in selected or name not in state["checks"] or aid not in selected[name]["acceptance_ids"] for name in entry.get("checks", [])):
                        missing.append("acceptance check binding invalid: " + aid)
                    if any(name not in [item["path"] for item in state["artifacts"]] for name in entry.get("artifacts", [])):
                        missing.append("acceptance artifact binding invalid: " + aid)
                elif entry.get("approval_id") not in [item["id"] for item in contract.get("user_approvals", [])]:
                    missing.append("unapproved acceptance deferral: " + aid)
    return missing


def safe_output(raw, secrets=()):
    value = raw.decode("utf-8", "replace")[:8192]
    for secret in sorted(secrets, key=len, reverse=True):
        if len(secret) >= 3:
            value = value.replace(secret, "[REDACTED]")
    value = re.sub(r"(?i)(password|token|secret|api[_-]?key|authorization)([=: ]+)([^\s]+)", r"\1\2[REDACTED]", value)
    return value


def environment_secrets(project, contract):
    values = set()
    for name in contract.get("environment_files", []):
        for line in local(project, name, exists=True).read_text(errors="replace").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                value = line.split("=", 1)[1].strip().strip("\"'")
                if value:
                    values.add(value)
    return values


def execute_check(argv, cwd, timeout, secrets=()):
    started = time.monotonic()
    captured = {"stdout": bytearray(), "stderr": bytearray()}
    truncated = {"stdout": False, "stderr": False}
    try:
        process = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    except OSError as error:
        return 127, "", safe_output(str(error).encode(), secrets), False, False
    selector = selectors.DefaultSelector()
    for name, pipe in (("stdout", process.stdout), ("stderr", process.stderr)):
        os.set_blocking(pipe.fileno(), False)
        selector.register(pipe, selectors.EVENT_READ, name)
    timed_out = False
    interrupted = False
    try:
        while True:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                timed_out = True
                break
            if not selector.get_map():
                try:
                    process.wait(timeout=min(remaining, 0.2))
                    break
                except subprocess.TimeoutExpired:
                    continue
            for key, _ in selector.select(min(remaining, 0.2)):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                name = key.data
                room = 8192 - len(captured[name])
                captured[name].extend(chunk[:max(room, 0)])
                truncated[name] |= len(chunk) > room
    except KeyboardInterrupt:
        interrupted = True
    finally:
        if timed_out or interrupted:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait()
        selector.close()
    stdout = safe_output(captured["stdout"], secrets)
    stderr = safe_output(captured["stderr"], secrets)
    if truncated["stdout"]:
        stdout += "\n[truncated]"
    if truncated["stderr"]:
        stderr += "\n[truncated]"
    return (130 if interrupted else 124 if timed_out else process.returncode), stdout, stderr, timed_out, interrupted


def v2_command(args, project, command, state, path):
    action = args.command
    if action == "status":
        print(json.dumps({"run": state["run"], "schema_version": 2, "status": state["status"],
                          "required_gates": v2_required_gates(state, inventory(project)),
                          "gaps": v2_gaps(project, state), "dispatches": state.get("dispatches", [])}, indent=2))
        return 0
    if action == "review-input":
        if args.gate != "plan":
            v2_reviewed_plan(project, state)
        print(json.dumps(v2_review_binding(project, state, args.gate), indent=2, sort_keys=True))
        return 0
    if action == "handoff":
        v2_reviewed_plan(project, state)
        if not v2_review_current(project, state, args.gate):
            raise ValueError(args.gate + " document approval missing or stale.")
        print(args.gate + " handoff ready")
        return 0
    if action == "reopen":
        raise ValueError("Terminal v2 runs are immutable; begin a continuation run.")
    if action == "resume":
        if state["status"] != "blocked":
            raise ValueError("Only a blocked run can resume.")
        if not args.reason.strip():
            raise ValueError("Resume needs a reason.")
        state["status"] = "active"
    elif action in ("block", "cancel", "supersede"):
        if state["status"] not in ("active", "blocked"):
            raise ValueError("Cannot transition a terminal run.")
        if not args.reason.strip() or not args.evidence:
            raise ValueError("Lifecycle transition needs reason and evidence.")
        state["status"] = {"block": "blocked", "cancel": "cancelled", "supersede": "superseded"}[action]
        if action == "supersede":
            slug(args.by)
            if args.by == state["run"] or not state_file(project, args.by).is_file():
                raise ValueError("Superseding run must be a distinct existing record.")
    elif state["status"] != "active":
        raise ValueError("Run is " + state["status"] + "; resume or begin a continuation run.")
    elif action == "plan":
        if not args.contract:
            raise ValueError("Schema v2 plan requires --contract.")
        item, contract = contract_record(project, args.contract)
        for name in state.get("begin_required_checks", []):
            if name not in contract["checks"] or not contract["checks"][name]["required"]:
                raise ValueError("Begin-time required check missing from reviewed contract: " + name)
        state["plan"] = evidence(project, args.file)
        state["plan"]["source_sha256"] = source_fingerprint(project)
        state["contract"] = item
        if state["reviews"]:
            state.setdefault("review_history", []).append(state["reviews"])
        if state["checks"]:
            state.setdefault("check_history", []).append(state["checks"])
        state["reviews"] = {}
        state["checks"] = {}
        state["outcome"] = None
        state["required_checks"] = [name for name, check in contract["checks"].items() if check["required"]]
    elif action == "artifact":
        v2_reviewed_plan(project, state)
        item = evidence(project, args.file)
        if item["path"].endswith("/run.json"):
            raise ValueError("Ledger record is not a deliverable.")
        item["type"] = args.type
        state["artifacts"] = [old for old in state["artifacts"] if old["path"] != item["path"]] + [item]
        retain_requirements(state)
    elif action == "require-review":
        if args.gate not in state["required_reviews"]:
            state["required_reviews"].append(args.gate)
        retain_requirements(state)
    elif action == "require-check":
        raise ValueError("Update the reviewed contract to add a required check.")
    elif action == "own":
        if not args.paths:
            raise ValueError("Declare at least one --path glob.")
        registry(project)[args.role]
        if any(not name or name.startswith("/") or ".." in Path(name).parts for name in args.paths):
            raise ValueError("Ownership paths must be project-relative globs.")
        state["ownership"] = [item for item in state.get("ownership", []) if item["role"] != args.role]
        state["ownership"].append({"role": args.role, "paths": args.paths})
    elif action == "review":
        if args.reviewer != REVIEWERS[args.gate]:
            raise ValueError("This gate requires the " + REVIEWERS[args.gate] + " role.")
        if args.model is not None and not MODEL_PATTERN.fullmatch(args.model):
            raise ValueError("Invalid review model name.")
        if args.gate != "plan":
            v2_reviewed_plan(project, state)
        if args.gate == "plan" and state["plan"].get("source_sha256") != source_fingerprint(project):
            raise ValueError("Inputs changed since plan registration; register the current plan/contract.")
        report = plain(json.loads(local(project, args.evidence, exists=True).read_text()))
        if report.get("schema_version") != 2 or report.get("reviewed") != v2_review_binding(project, state, args.gate):
            raise ValueError("Review report examined inputs are stale or contradictory.")
        if report.get("verdict") not in ("pass", "changes_requested", "blocked") or (args.verdict and args.verdict != report["verdict"]):
            raise ValueError("Review verdict conflicts with structured report.")
        if not isinstance(report.get("summary"), str) or not report["summary"].strip() or not isinstance(report.get("open_findings"), list):
            raise ValueError("Review report requires summary and open_findings array.")
        if report["verdict"] == "pass" and report["open_findings"]:
            raise ValueError("Passing review cannot have open findings.")
        provenance = plain(report.get("provenance"))
        child = provenance.get("child_task_id")
        if not isinstance(child, str) or not child.strip() or child == provenance.get("author_task_id"):
            raise ValueError("Review needs distinct child reviewer provenance.")
        if args.gate in FINAL_GATES and child in [entry.get("child_ref") for entry in state["dispatches"] if entry.get("phase") == "implementation"]:
            raise ValueError("Implementation child cannot review its own work.")
        registry(project)[args.reviewer]
        request = {"basis": "coordinator_reported_explicit" if args.model or args.effort else "inherit_parent_requested"}
        if args.model:
            request["model"] = args.model
        if args.effort:
            request["effort"] = args.effort
        elif args.model:
            request["effort_resolution"] = "selected_model_default"
        state["reviews"][args.gate] = {"reviewer": args.reviewer, "verdict": report["verdict"],
                                        "reviewed": report["reviewed"], "evidence": evidence(project, args.evidence),
                                        "provenance": provenance, "routing_request": request, "recorded_at": now(),
                                        "attestation": "Coordinator-reported metadata; not runtime identity attestation"}
    elif action == "check":
        v2_reviewed_plan(project, state)
        contract = contract_current(project, state)
        spec = contract["checks"].get(args.name)
        if not spec:
            raise ValueError("Check name is absent from reviewed contract.")
        if command and command != spec["argv"]:
            raise ValueError("Check argv differs from reviewed contract.")
        if not 1 <= args.timeout <= 3600:
            raise ValueError("Timeout must be 1..3600 seconds.")
        before = source_fingerprint(project)
        env_before = environment_fingerprint(project, contract)
        code, stdout, stderr, timed_out, interrupted = execute_check(spec["argv"], local(project, spec["cwd"]), args.timeout,
                                                                     environment_secrets(project, contract))
        after = source_fingerprint(project)
        attempt = {"argv": spec["argv"], "cwd": spec["cwd"], "scope": spec["scope"],
                   "exit_code": code, "timed_out": timed_out, "interrupted": interrupted,
                   "stdout": stdout, "stderr": stderr,
                   "source_sha256": before, "environment_sha256": env_before,
                   "inputs_changed": before != after or env_before != environment_fingerprint(project, contract),
                   "plan_sha256": state["plan"]["sha256"], "contract_sha256": state["contract"]["sha256"],
                   "recorded_at": now()}
        state["checks"].setdefault(args.name, []).append(attempt)
        state["updated_at"] = now()
        write_json(path, state)
        if stdout:
            print(stdout)
        if stderr:
            print(stderr, file=sys.stderr)
        return code if 0 <= code <= 255 else 1
    elif action == "outcome":
        v2_reviewed_plan(project, state)
        data = plain(json.loads(local(project, args.file, exists=True).read_text()))
        if data.get("schema_version") != 2 or not isinstance(data.get("acceptance"), dict) or not isinstance(data.get("changed_paths"), list) or not isinstance(data.get("deleted_paths"), list):
            raise ValueError("Malformed schema v2 outcome.")
        state["outcome"] = evidence(project, args.file)
    elif action == "prepare-handoff":
        v2_reviewed_plan(project, state)
        contract = contract_current(project, state)
        registry(project)[args.role]
        if args.phase == "implementation":
            for doc in contract.get("documents", []):
                if not v2_review_current(project, state, doc["gate"]):
                    raise ValueError("Implementation handoff needs current " + doc["gate"] + " approval.")
            for approval in contract.get("user_approvals", []):
                if sha(local(project, approval["evidence"]["path"], exists=True)) != approval["evidence"]["sha256"]:
                    raise ValueError("Implementation handoff needs current user approval: " + approval["id"])
        packet = {"schema_version": 2, "run": state["run"], "phase": args.phase, "role": args.role,
                  "plan_sha256": state["plan"]["sha256"], "contract_sha256": state["contract"]["sha256"],
                  "documents": contract.get("documents", []), "user_approvals": contract.get("user_approvals", []),
                  "prepared_at": now(), "attestation": "Prepared input metadata; not a spawn or identity attestation"}
        out = local(project, args.out)
        if out.exists():
            raise ValueError("Handoff packet already exists.")
        write_json(out, packet)
        state.setdefault("prepared_handoffs", []).append(evidence(project, args.out))
    elif action == "dispatch":
        if not args.packet or not args.child_ref or not args.context or not args.role_file:
            raise ValueError("Schema v2 dispatch needs --packet, --child-ref, --context, and --role-file.")
        if args.model is not None and not MODEL_PATTERN.fullmatch(args.model):
            raise ValueError("Invalid dispatch model name.")
        packet_evidence = evidence(project, args.packet)
        if packet_evidence not in state.get("prepared_handoffs", []):
            raise ValueError("Dispatch packet was not prepared for this run or changed.")
        packet = plain(json.loads(local(project, args.packet).read_text()))
        if packet["role"] != args.role or packet["plan_sha256"] != state["plan"]["sha256"] or packet["contract_sha256"] != state["contract"]["sha256"]:
            raise ValueError("Dispatch packet inputs changed.")
        if packet["phase"] == "implementation":
            for doc in contract_current(project, state).get("documents", []):
                if not v2_review_current(project, state, doc["gate"]):
                    raise ValueError("Document approval stale before dispatch.")
        registry(project)[args.role]
        request = {"basis": "coordinator_reported_explicit" if args.model or args.effort else "inherit_parent_requested"}
        if args.model:
            request["model"] = args.model
        if args.effort:
            request["effort"] = args.effort
        elif args.model:
            request["effort_resolution"] = "selected_model_default"
        state["dispatches"].append({"role": args.role, "phase": packet["phase"], "packet": packet_evidence,
                                    "child_ref": args.child_ref, "context": args.context,
                                    "routing_request": request,
                                    "role_instruction_sha256": sha(local(project, args.role_file, exists=True)),
                                    "recorded_at": now(), "attestation": "Coordinator-reported link; not runtime identity attestation"})
    elif action == "finish":
        missing = v2_gaps(project, state)
        if missing:
            raise ValueError("Run cannot complete:\n  " + "\n  ".join(missing))
        state["status"] = "complete"
        state["completed_at"] = now()
    else:
        raise ValueError("Command is unavailable for schema v2: " + action)
    if action in ("block", "cancel", "supersede", "resume"):
        transition = {"action": action, "reason": args.reason, "recorded_at": now()}
        if action != "resume":
            transition["evidence"] = evidence(project, args.evidence)
        if action == "supersede":
            transition["by"] = args.by
        state.setdefault("transitions", []).append(transition)
    state["updated_at"] = now()
    write_json(path, state)
    print(action + ": " + state["run"])
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=".", help="Product root; defaults to cwd")
    sub = parser.add_subparsers(dest="command", required=True)
    begin = sub.add_parser("begin")
    begin.add_argument("run")
    begin.add_argument("--kind", choices=KINDS, required=True)
    begin.add_argument("--objective", required=True)
    begin.add_argument("--ui", action="store_true")
    begin.add_argument("--require-review", choices=REVIEWERS, action="append", default=[])
    begin.add_argument("--require-check", action="append", default=[])
    for action in ("plan", "artifact"):
        child = sub.add_parser(action)
        child.add_argument("run")
        child.add_argument("--file", required=True)
        if action == "plan":
            child.add_argument("--contract")
        if action == "artifact":
            child.add_argument("--type", choices=ARTIFACT_TYPES, default="general")
    require_check = sub.add_parser("require-check")
    require_check.add_argument("run")
    require_check.add_argument("--name", required=True)
    for action in ("require-review", "handoff"):
        child = sub.add_parser(action)
        child.add_argument("run")
        child.add_argument("--gate", choices=DOCUMENT_GATES if action == "handoff" else REVIEWERS, required=True)
    review = sub.add_parser("review")
    review.add_argument("run")
    review.add_argument("--gate", choices=REVIEWERS, required=True)
    review.add_argument("--reviewer", required=True)
    review.add_argument("--verdict", choices=("pass", "changes_requested", "blocked"))
    review.add_argument("--evidence", required=True)
    review.add_argument("--model")
    review.add_argument("--effort", choices=EFFORTS)
    check = sub.add_parser("check")
    check.add_argument("run")
    check.add_argument("--name", required=True)
    check.add_argument("--timeout", type=int, default=600)
    dispatch = sub.add_parser("dispatch", help="Manual specialist handoff log; advisory only, never blocks finish")
    dispatch.add_argument("run")
    dispatch.add_argument("--role", required=True)
    dispatch.add_argument("--model", help="Coordinator-reported requested model, only for an explicit user override")
    dispatch.add_argument("--effort", choices=EFFORTS, help="Coordinator-reported requested effort, only for an explicit user override")
    dispatch.add_argument("--minutes", type=float, default=0)
    dispatch.add_argument("--result", choices=("pass", "changes_requested", "blocked", "failed", "done"), default="done")
    dispatch.add_argument("--tokens", type=int, default=None)
    dispatch.add_argument("--note", default="")
    dispatch.add_argument("--plan", default=None, help="Plan SSOT path to bind clean-context dispatch (advisory)")
    dispatch.add_argument("--packet")
    dispatch.add_argument("--child-ref")
    dispatch.add_argument("--context")
    dispatch.add_argument("--role-file")
    own = sub.add_parser("own", help="Declare owned path globs; advisory only, never blocks finish")
    own.add_argument("run")
    own.add_argument("--role", required=True)
    own.add_argument("--path", dest="paths", action="append", default=[])
    for action in ("status", "finish", "reopen"):
        child = sub.add_parser(action)
        child.add_argument("run")
    for action in ("review-input", "outcome", "prepare-handoff", "block", "resume", "cancel", "supersede", "migrate"):
        child = sub.add_parser(action)
        child.add_argument("run")
        if action == "review-input":
            child.add_argument("--gate", choices=REVIEWERS, required=True)
        elif action == "outcome":
            child.add_argument("--file", required=True)
        elif action == "prepare-handoff":
            child.add_argument("--role", required=True)
            child.add_argument("--phase", choices=("research", "implementation", "review"), required=True)
            child.add_argument("--out", required=True)
        elif action == "migrate":
            child.add_argument("--inventory", required=True)
            child.add_argument("--contract", required=True)
        else:
            child.add_argument("--reason", required=True)
            if action != "resume":
                child.add_argument("--evidence", required=True)
            if action == "supersede":
                child.add_argument("--by", required=True)
    sub.add_parser("roles")
    # Split at the explicit separator: command arguments are never shell-expanded.
    argv = sys.argv[1:]
    command = []
    if "--" in argv:
        split = argv.index("--")
        argv, command = argv[:split], argv[split + 1:]
    args = parser.parse_args(argv)
    project = Path(args.project).expanduser().resolve()
    if not (project / "AGENTS.md").is_file():
        raise ValueError("Select the applied product root with --project.")
    if args.command == "roles":
        for name, role in registry(project).items():
            print(name + ": " + role["skill"] + " (inherits session model and effort)")
        return 0
    if args.command in ("status", "handoff", "review-input"):
        return run_command(args, project, command)
    with run_lock(project, args.run):
        return run_command(args, project, command)


def run_command(args, project, command):
    path = state_file(project, args.run)
    if args.command == "begin":
        if path.parent.exists():
            raise ValueError("Run already exists; use status or a new slug.")
        if not args.objective.strip():
            raise ValueError("Objective cannot be empty.")
        required = list(KINDS[args.kind])
        if args.ui and "design" not in required:
            required.append("design")
        state = {"schema_version": 2, "run": args.run, "objective": args.objective,
                 "kind": args.kind, "ui": args.ui, "created_at": now(), "status": "active",
                 "required_gates": required, "required_reviews": list(dict.fromkeys(args.require_review)),
                 "required_checks": list(dict.fromkeys(args.require_check)),
                 "plan": None, "reviews": {}, "checks": {}, "artifacts": [],
                 "dispatches": [], "ownership": [], "baseline": inventory(project),
                 "contract": None, "outcome": None, "prepared_handoffs": [], "transitions": [],
                 "begin_required_checks": list(dict.fromkeys(args.require_check))}
        for name in state["required_checks"]:
            slug(name)
        retain_requirements(state)
        write_json(path, state)
        print("Created " + str(path.relative_to(project)) + "; required: " + ", ".join(state["required_gates"]))
        return 0
    state = load(project, args.run)
    if args.command == "migrate":
        if state["schema_version"] != 1 or state["status"] != "active":
            raise ValueError("Only an active schema v1 run can migrate.")
        if not state.get("plan") or not state["plan"].get("fingerprint"):
            raise ValueError("Legacy run has no original plan fingerprint.")
        inventory_evidence = evidence(project, args.inventory)
        historical = plain(json.loads(local(project, args.inventory, exists=True).read_text()))
        baseline = validate_inventory_record(project, historical, state["plan"]["fingerprint"])
        contract_item, contract = contract_record(project, args.contract)
        old = {"reviews": state["reviews"], "checks": state["checks"], "dispatches": state.get("dispatches", [])}
        state.update({"schema_version": 2, "baseline": baseline, "migration": {"inventory": inventory_evidence,
                      "original_v1_fingerprint": historical["v1_fingerprint"], "recorded_at": now(),
                      "historical_inclusion_policy": historical.get("inclusion_policy", "walk"),
                      "current_inclusion_policy": inclusion_policy(project),
                      "policy_source": "explicit" if "inclusion_policy" in historical else "legacy_default_walk_only",
                      "note": "Coordinator-observed historical inventory; chronology and identity are not attested"},
                      "legacy_evidence": old, "reviews": {}, "checks": {}, "dispatches": [],
                      "contract": contract_item, "outcome": None, "prepared_handoffs": [], "transitions": []})
        state["plan"]["source_sha256"] = source_fingerprint(project)
        state["required_checks"] = [name for name, check in contract["checks"].items() if check["required"]]
        retain_requirements(state)
        write_json(path, state)
        print("migrate: " + args.run)
        return 0
    if state["schema_version"] == 2:
        return v2_command(args, project, command, state, path)
    if args.command in ("block", "cancel", "supersede", "resume"):
        if state["status"] == "complete" or state["status"] in ("cancelled", "superseded"):
            raise ValueError("Terminal v1 history is immutable.")
        if args.command == "resume":
            if state["status"] != "blocked":
                raise ValueError("Only a blocked v1 run can resume.")
            state["status"] = "active"
        else:
            if state["status"] not in ("active", "blocked"):
                raise ValueError("Cannot transition this v1 run.")
            state["status"] = {"block": "blocked", "cancel": "cancelled", "supersede": "superseded"}[args.command]
        transition = {"action": args.command, "reason": args.reason, "recorded_at": now()}
        if args.command != "resume":
            transition["evidence"] = evidence(project, args.evidence)
        if args.command == "supersede":
            slug(args.by)
            if args.by == args.run or not state_file(project, args.by).is_file():
                raise ValueError("Superseding run must be a distinct existing record.")
            transition["by"] = args.by
        state.setdefault("transitions", []).append(transition)
        state["updated_at"] = now()
        write_json(path, state)
        print(args.command + ": " + args.run)
        return 0
    if args.command != "status":
        raise ValueError("Active schema v1 history is read-only until explicit migration; completed history is immutable.")
    if args.command == "status":
        print(json.dumps({"run": args.run, "status": state["status"], "objective": state["objective"],
                          "required_gates": state["required_gates"], "gaps": gaps(project, state),
                          "warnings": advisory_warnings(project, state),
                          "dispatches": state.get("dispatches", []),
                          "ownership": state.get("ownership", [])}, indent=2))
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print("Error: " + str(error), file=sys.stderr)
        sys.exit(1)
