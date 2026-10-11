#!/usr/bin/env python3
"""Validate the workbench token graph, CSS export, and Figma variant contract.

No dependencies, network access, or writes. Run from any working directory.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "tokens" / "manifest.json"
CSS = ROOT / "tokens" / "tokens.css"
COMPONENTS = ROOT / "components.json"
MODES = ("light", "dark")
TYPES = {"color", "dimension", "duration", "number", "fontFamily"}
SCOPE_BY_TYPE = {
    "color": {"FRAME_FILL", "SHAPE_FILL", "TEXT_FILL", "STROKE_COLOR"},
    "dimension": {"GAP", "CORNER_RADIUS", "WIDTH_HEIGHT", "FONT_SIZE", "LINE_HEIGHT", "STROKE_FLOAT"},
    "duration": set(),
    "number": {"FONT_WEIGHT", "LINE_HEIGHT"},
    "fontFamily": {"FONT_FAMILY"},
}
REF = re.compile(r"^\{([a-z][a-z0-9.-]*)\}$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
DIM = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?px$")
DURATION = re.compile(r"^(?:0|[1-9][0-9]*)ms$")


def fail(message: str) -> None:
    raise ValueError(message)


def css_value(value: str | int | float) -> str:
    if isinstance(value, str) and (match := REF.fullmatch(value)):
        return f"var(--omoc-{match.group(1).replace('.', '-')})"
    if value == "Noto Sans KR":
        return '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Noto Sans KR", sans-serif'
    if value == "IBM Plex Mono":
        return '"IBM Plex Mono", monospace'
    return str(value)


def generated_css(manifest: dict) -> str:
    lines = ["/* Generated from manifest.json; run validate_system.py after editing. */"]
    for mode in MODES:
        lines.append(manifest["cssSelector"][mode] + " {")
        for token in manifest["tokens"]:
            value = token["value"]
            if mode == "dark" and not isinstance(value, dict):
                continue
            lines.append(f"  {token['css']}: {css_value(value[mode] if isinstance(value, dict) else value)};")
        lines.append("}")
    return "\n".join(lines) + "\n"


def luminance(color: str) -> float:
    channels = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    channels = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return sum(a * b for a, b in zip(channels, (0.2126, 0.7152, 0.0722)))


def ratio(a: str, b: str) -> float:
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def check() -> None:
    manifest = json.loads(MANIFEST.read_text())
    components = json.loads(COMPONENTS.read_text())
    if manifest.get("schemaVersion") != 1 or manifest.get("modes") != list(MODES):
        fail("manifest schema/modes mismatch")
    if manifest.get("cssSelector") != {"light": ":root", "dark": '[data-theme="dark"]'}:
        fail("CSS mode selectors mismatch")
    tokens = manifest["tokens"]
    by_path = {}
    by_css = {}
    for token in tokens:
        path, layer, kind = token["path"], token["layer"], token["type"]
        if path in by_path:
            fail(f"duplicate token path: {path}")
        if token["css"] in by_css:
            fail(f"duplicate CSS name: {token['css']}")
        if not path.startswith(layer + ".") or layer not in {"primitive", "semantic", "component"}:
            fail(f"invalid layer: {path}")
        scopes = token.get("figmaScopes")
        if kind not in TYPES or not isinstance(scopes, list) or len(scopes) != len(set(scopes)) or not set(scopes) <= SCOPE_BY_TYPE[kind]:
            fail(f"invalid type or Figma scopes: {path}")
        if layer == "primitive" and scopes:
            fail(f"primitive must be hidden from Figma picker: {path}")
        if layer != "primitive" and not scopes:
            fail(f"missing Figma scope: {path}")
        if layer != "primitive" and kind == "color":
            if "foreground" in path or ".text." in path:
                expected_scope = ["TEXT_FILL"]
            elif "border" in path or path == "semantic.color.focus":
                expected_scope = ["STROKE_COLOR"]
            else:
                expected_scope = ["FRAME_FILL", "SHAPE_FILL"]
            if scopes != expected_scope:
                fail(f"incorrect color picker scope: {path}")
        if layer != "primitive" and kind != "color":
            if ".type.size." in path:
                expected_scope = ["FONT_SIZE"]
            elif ".type.weight." in path:
                expected_scope = ["FONT_WEIGHT"]
            elif ".type.line." in path:
                expected_scope = ["LINE_HEIGHT"]
            elif ".type.family." in path:
                expected_scope = ["FONT_FAMILY"]
            elif "radius" in path:
                expected_scope = ["CORNER_RADIUS"]
            elif path == "semantic.stroke.focus":
                expected_scope = ["STROKE_FLOAT"]
            elif "height" in path:
                expected_scope = ["WIDTH_HEIGHT"]
            else:
                expected_scope = ["GAP"]
            if scopes != expected_scope:
                fail(f"incorrect numeric/text picker scope: {path}")
        if token["css"] != "--omoc-" + path.replace(".", "-"):
            fail(f"invalid CSS name: {path}")
        if layer == "primitive" and isinstance(token["value"], dict):
            fail(f"primitive must be global: {path}")
        if layer != "primitive" and (not isinstance(token["value"], dict) or set(token["value"]) != set(MODES)):
            fail(f"token must cover both modes: {path}")
        by_path[path] = token
        by_css[token["css"]] = path
    if set(by_path) != {v["path"] for v in tokens}:
        fail("duplicate token path")

    resolving = set()
    resolved = {}

    def resolve(path: str, mode: str):
        key = (path, mode)
        if key in resolved:
            return resolved[key]
        if key in resolving:
            fail(f"alias cycle: {path} in {mode}")
        if path not in by_path:
            fail(f"missing alias: {path}")
        resolving.add(key)
        token = by_path[path]
        value = token["value"]
        value = value[mode] if isinstance(value, dict) else value
        if isinstance(value, str) and (match := REF.fullmatch(value)):
            target = match.group(1)
            expected = {"semantic": "primitive", "component": "semantic"}.get(token["layer"])
            if not expected or by_path.get(target, {}).get("layer") != expected:
                fail(f"invalid layer alias {path} -> {target}")
            if by_path[target]["type"] != token["type"]:
                fail(f"alias type mismatch {path} -> {target}")
            value = resolve(target, mode)
        if token["type"] == "color" and not (isinstance(value, str) and HEX.fullmatch(value)):
            fail(f"invalid color: {path}/{mode} = {value}")
        if token["type"] == "dimension" and not (isinstance(value, str) and DIM.fullmatch(value)):
            fail(f"invalid dimension: {path}/{mode} = {value}")
        if token["type"] == "duration" and not (isinstance(value, str) and DURATION.fullmatch(value)):
            fail(f"invalid duration: {path}/{mode} = {value}")
        if token["type"] == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
            fail(f"invalid number: {path}/{mode} = {value}")
        if token["type"] == "fontFamily" and not (isinstance(value, str) and value.strip()):
            fail(f"invalid font family: {path}/{mode}")
        resolving.remove(key)
        resolved[key] = value
        return value

    for path in by_path:
        for mode in MODES:
            resolve(path, mode)
    if CSS.read_text() != generated_css(manifest):
        fail("CSS export diverges from manifest")

    contrast_pairs = [
        ("text.primary", "surface", 4.5), ("text.secondary", "surface", 4.5),
        ("text.primary", "canvas", 4.5), ("text.secondary", "canvas", 4.5),
        ("text.inverse", "overlay", 4.5), ("action.foreground", "action.background", 4.5),
        ("action.foreground", "action.hover", 4.5), ("action.foreground", "action.pressed", 4.5),
        ("selection.foreground", "selection.background", 4.5),
    ]
    for role in ("success", "warning", "danger", "info", "permission.pending", "permission.denied"):
        contrast_pairs.append((role + ".foreground", role + ".background", 4.5))
    contrast_pairs += [("focus", "surface", 3), ("focus", "canvas", 3), ("border.default", "surface", 3), ("border.strong", "surface", 3)]
    for mode in MODES:
        for fg, bg, threshold in contrast_pairs:
            a = resolve("semantic.color." + fg, mode)
            b = resolve("semantic.color." + bg, mode)
            score = ratio(a, b)
            if score + 1e-9 < threshold:
                fail(f"contrast {mode} {fg}/{bg}: {score:.2f} < {threshold}")

    families = {"Button": 18, "Input": 5, "StatusBadge": 6, "NavigationItem": 4, "ToolCall": 6, "PermissionRequest": 5}
    if components.get("schemaVersion") != 1 or components.get("families") != families or components.get("count") != 44:
        fail("component family counts mismatch")
    expected = {("Button", f"{intent}/{state}") for intent in ("primary", "quiet", "danger") for state in ("default", "hover", "pressed", "focus", "disabled", "loading")}
    expected |= {("Input", x) for x in ("default", "hover", "focus", "disabled", "error")}
    expected |= {("NavigationItem", x) for x in ("default", "hover", "selected", "focus")}
    expected |= {(family, x) for family in ("StatusBadge", "ToolCall") for x in ("queued", "running", "waiting", "success", "error", "unknown")}
    expected |= {("PermissionRequest", x) for x in ("pending", "sending", "approved", "denied", "stale")}
    variants = components["variants"]
    actual = [(v["family"], v["name"]) for v in variants]
    if len(variants) != 44 or len(set(actual)) != 44 or set(actual) != expected:
        fail("variant inventory mismatch")
    compositions = components.get("composedStates", [])
    if {(c.get("family"), c.get("base"), c.get("overlay")) for c in compositions} != {
        ("Input", "error", "focus-visible"),
        ("NavigationItem", "selected", "focus-visible"),
    }:
        fail("focus overlay composition inventory mismatch")
    for composition in compositions:
        if not composition.get("expected") or not composition.get("preserve") or not composition.get("add"):
            fail("incomplete focus overlay composition")
    required_bindings = {
        "Button": {"background", "foreground", "radius", "height"},
        "Input": {"background", "foreground", "border", "radius", "height"},
        "StatusBadge": {"background", "foreground", "radius", "paddingX"},
        "NavigationItem": {"background", "foreground", "height"},
        "ToolCall": {"background", "foreground", "border", "radius", "padding"},
        "PermissionRequest": {"background", "foreground", "border", "radius", "padding"},
    }
    for variant in variants:
        family = variant["family"]
        if not required_bindings[family] <= variant["bindings"].keys() or not variant.get("content") or not variant.get("behavior") or not variant.get("properties") or not variant.get("visual"):
            fail(f"incomplete variant: {family}/{variant['name']}")
        for binding, path in variant["bindings"].items():
            if path is not None and path not in by_path:
                fail(f"missing component binding: {family}/{variant['name']}/{binding}: {path}")
            if path is not None and by_path[path]["layer"] == "primitive":
                fail(f"variant binds primitive: {family}/{variant['name']}/{binding}")
        for mode in MODES:
            bindings = variant["bindings"]
            pairs = [("foreground", "background", 4.5)]
            if "statusForeground" in bindings:
                pairs.append(("statusForeground", "statusBackground", 4.5))
            if "border" in bindings and family in ("Input", "ToolCall", "PermissionRequest"):
                pairs.append(("border", "background", 3))
            for fg, bg, threshold in pairs:
                if family == "Button" and variant["name"].endswith("/disabled"):
                    continue  # Disabled controls have a WCAG contrast exception.
                score = ratio(resolve(bindings[fg], mode), resolve(bindings[bg], mode))
                if score + 1e-9 < threshold:
                    fail(f"variant contrast {mode} {family}/{variant['name']} {fg}/{bg}: {score:.2f} < {threshold}")
            if bindings.get("focusRing"):
                if bindings.get("focusGapBackground") != "semantic.color.surface" or bindings.get("focusGapWidth") != "semantic.size.focus-gap":
                    fail(f"focus ring lacks semantic surface gap: {family}/{variant['name']}")
                if variant["visual"].get("focusOffsetPx") != 2:
                    fail(f"focus ring must use a 2px outside gap: {family}/{variant['name']}")
                focus = resolve(bindings["focusRing"], mode)
                adjacent = resolve(bindings["focusGapBackground"], mode)
                score = ratio(focus, adjacent)
                if score + 1e-9 < 3:
                    fail(f"focus ring contrast {mode} {family}/{variant['name']} against adjacent surface: {score:.2f} < 3")
        if family == "Input" and (not variant["properties"].get("label") or "placeholder" not in variant["bindings"]):
            fail(f"Input label/placeholder absent: {variant['name']}")
        if family == "PermissionRequest":
            state = variant["name"]
            props = variant["properties"]
            if props["approveEnabled"] != (state == "pending") or props["denyEnabled"] != (state == "pending") or props["refreshEnabled"] != (state == "stale"):
                fail(f"permission action state mismatch: {state}")
            if not variant["visual"].get("scopeNeverTruncated"):
                fail(f"permission scope can be truncated: {state}")
        if family in ("ToolCall", "PermissionRequest"):
            if "statusBackground" in variant["bindings"] or "statusForeground" in variant["bindings"]:
                fail(f"{family}/{variant['name']} must not repaint its nested StatusBadge")
            status = variant["visual"].get("statusBadge", {})
            if (
                status.get("component") != "StatusBadge"
                or status.get("bindingOwner") != "StatusBadge-instance"
                or status.get("size") != "shared-24px-hug"
                or not status.get("state")
                or not status.get("label")
            ):
                fail(f"missing nested StatusBadge contract: {family}/{variant['name']}")
            badge_states = {v["name"] for v in variants if v["family"] == "StatusBadge"}
            if status["state"] not in badge_states:
                fail(f"unknown nested StatusBadge state: {family}/{variant['name']}/{status['state']}")
    if components["layout"]["touchTargetMinPx"] < 44 or components["layout"]["controlMinHeightPx"] < 40:
        fail("control minimums too small")
    by_variant = {(v["family"], v["name"]): v for v in variants}
    nav_contract = components.get("componentContracts", {}).get("NavigationItem", {})
    if nav_contract.get("selectedLabelFontWeight") != 700 or nav_contract.get("defaultLabelFontWeight") != 500:
        fail("NavigationItem selected/default label weight contract mismatch")
    if nav_contract.get("darkStateSurfaces") != {
        "parent": "semantic.color.surface",
        "default": "semantic.color.surface",
        "hover": "semantic.color.canvas",
        "selected": "semantic.color.surface.subtle",
    }:
        fail("NavigationItem dark surface contract mismatch")
    expected_nav_aliases = {
        "component.color.navigation.background": "{semantic.color.surface}",
        "component.color.navigation.hover-background": "{semantic.color.canvas}",
        "component.color.navigation.selected-background": "{semantic.color.surface.subtle}",
    }
    for path, alias in expected_nav_aliases.items():
        if by_path[path]["value"]["dark"] != alias:
            fail(f"NavigationItem dark alias mismatch: {path} must resolve through {alias}")
    for name, expected_weight in (("default", 500), ("hover", 500), ("selected", 700), ("focus", 500)):
        nav = by_variant[("NavigationItem", name)]
        if nav["visual"].get("labelFontWeight") != expected_weight:
            fail(f"NavigationItem/{name} label weight mismatch")
    for family in ("ToolCall", "PermissionRequest"):
        expected_count = 6 if family == "ToolCall" else 5
        mapped = [v for v in variants if v["family"] == family]
        if len(mapped) != expected_count:
            fail(f"{family} StatusBadge mappings incomplete")
        for variant in mapped:
            badge = variant["visual"]["statusBadge"]
            if not badge["label"].strip() or not badge["state"].strip():
                fail(f"{family}/{variant['name']} has an empty StatusBadge mapping")
    permission = components.get("componentContracts", {}).get("PermissionRequest", {})
    if permission.get("runtimeStatusContract") != (
        "runtimeStateMap is required for every runtime label, visualState and action decision before composing the five visual variants. Never render preview sample labels as runtime status."
    ):
        fail("PermissionRequest runtime status source must be explicit")
    if permission.get("statusBadge", {}).get("runtimeLabelSource") != "runtimeStateMap":
        fail("PermissionRequest runtime StatusBadge labels must come from runtimeStateMap")
    permission_variants = {v["name"]: v for v in variants if v["family"] == "PermissionRequest"}
    for name, variant in permission_variants.items():
        props = variant.get("properties", {})
        badge = variant.get("visual", {}).get("statusBadge", {})
        if "statusLabel" in props or not props.get("previewSampleStatusLabel"):
            fail(f"PermissionRequest/{name} runtime status property must be preview-only")
        if props.get("statusLabelPurpose") != "static-preview-only-not-runtime":
            fail(f"PermissionRequest/{name} sample status label purpose missing")
        if badge.get("labelPurpose") != "static-preview-only-not-runtime":
            fail(f"PermissionRequest/{name} StatusBadge sample label purpose missing")
    applied = permission.get("runtimeStateMap", {}).get("applied", {})
    if applied.get("preconditions", []).count("matching-applied-receipt") != 1 or set(applied.get("labelByDecision", {})) != {"allow", "deny"}:
        fail("PermissionRequest applied labels must be decision-specific and receipt-bound")
    denied = permission.get("runtimeStateMap", {}).get("denied", {})
    if set(denied.get("labelByReason", {})) != {"USER_DENY", "POLICY_DENY"}:
        fail("PermissionRequest denial labels must distinguish user refusal from policy denial")
    danger_states = [by_variant[("Button", f"danger/{state}")]["bindings"]["background"] for state in ("default", "hover", "pressed")]
    for mode in MODES:
        danger_colors = [resolve(path, mode) for path in danger_states]
        if len(set(danger_colors)) != len(danger_colors):
            fail(f"danger button states must have distinct backgrounds in {mode}")
        nav_default = resolve(by_variant[("NavigationItem", "default")]["bindings"]["background"], mode)
        nav_hover = resolve(by_variant[("NavigationItem", "hover")]["bindings"]["background"], mode)
        if nav_default == nav_hover:
            fail(f"navigation hover must differ from default in {mode}")
        if mode == "dark":
            nav_selected = resolve(by_variant[("NavigationItem", "selected")]["bindings"]["background"], mode)
            parent = resolve("semantic.color.surface", mode)
            reviewed = {
                "parent": resolve("semantic.color.surface", mode),
                "default": resolve("semantic.color.surface", mode),
                "hover": resolve("semantic.color.canvas", mode),
                "selected": resolve("semantic.color.surface.subtle", mode),
            }
            if {
                "parent": parent,
                "default": nav_default,
                "hover": nav_hover,
                "selected": nav_selected,
            } != reviewed:
                fail("dark NavigationItem parent/default/hover/selected surfaces must match the reviewed matrix")
    print(f"PASS: {len(tokens)} tokens, {len(variants)} exact variants, two modes, CSS parity, contrast, aliases")


if __name__ == "__main__":
    try:
        check()
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
