#!/usr/bin/env python3
"""Check the design contract invariants for component-polish."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DESIGN = ROOT / 'docs/design/components.json'
BASELINE = ROOT / 'docs/runs/component-polish/button-baseline.json'
EVIDENCE = ROOT / 'docs/runs/component-polish/figma-structural-evidence.json'


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def main() -> None:
    data = json.loads(DESIGN.read_text())
    variants = data['variants']
    require(data.get('count') == 44 and len(variants) == 44, 'expected exactly 44 variants')
    by_family: dict[str, list[dict]] = {}
    for v in variants:
        by_family.setdefault(v['family'], []).append(v)
    require({k: len(v) for k, v in by_family.items()} == data['families'], 'family counts do not match inventory')
    require(len({(v['family'], v['name']) for v in variants}) == 44, 'duplicate family/state variant')

    for v in by_family['Input']:
        visual = v['visual']
        require(visual.get('controlHeightPx') == 40 and visual.get('feedbackSlotCount') == 1, f"Input/{v['name']} geometry/feedback mismatch")
        require(visual.get('feedbackPrecedence') == 'error-over-hint-over-none', f"Input/{v['name']} feedback precedence mismatch")
        require(visual.get('focusRingAffectsLayout') is False, f"Input/{v['name']} focus ring changes layout")
    for v in by_family['StatusBadge']:
        visual = v['visual']
        require(visual.get('heightPx') == 24 and visual.get('horizontalPaddingPx') == 8, f"StatusBadge/{v['name']} geometry mismatch")
        require(visual.get('widthMode') == 'hug' and visual.get('widthFormula') == 'renderedLabelWidthPx + 16', f"StatusBadge/{v['name']} sizing mismatch")
    for state, weight in [('default', 500), ('hover', 500), ('selected', 700), ('focus', 500)]:
        v = next(x for x in by_family['NavigationItem'] if x['name'] == state)
        require(v['visual'].get('contentAlignment') == 'start' and v['visual'].get('horizontalPaddingPx') == 12, f'NavigationItem/{state} alignment mismatch')
        require(v['visual'].get('labelFontWeight') == weight, f'NavigationItem/{state} weight mismatch')
    nav_contract = data['componentContracts']['NavigationItem']
    require(nav_contract['darkStateSurfaces'] == {
        'parent': 'semantic.color.surface', 'default': 'semantic.color.surface',
        'hover': 'semantic.color.canvas', 'selected': 'semantic.color.surface.subtle'}, 'Dark navigation fill matrix mismatch')

    for family in ('ToolCall', 'PermissionRequest'):
        for v in by_family[family]:
            badge = v['visual']['statusBadge']
            require(badge.get('component') == 'StatusBadge' and badge.get('bindingOwner') == 'StatusBadge-instance', f'{family}/{v["name"]} does not use shared badge')
            require(badge.get('size') == 'shared-24px-hug' and badge.get('label') and badge.get('state'), f'{family}/{v["name"]} badge mapping incomplete')
            require('statusBackground' not in v['bindings'] and 'statusForeground' not in v['bindings'], f'{family}/{v["name"]} repaints nested badge')
    tool = data['componentContracts']['ToolCall']
    require(tool['summaryStroke'] == 'none' and tool['detailStroke'] == 'functional-only-when-expanded', 'ToolCall border semantics mismatch')
    require(tool['resultNavigation'] == 'requires-runtime-target' and tool['missingTarget'] == 'non-actionable-text', 'ToolCall result action condition mismatch')
    require(tool['verticalSizing'] == 'hug-visible-content' and tool['bottomPaddingPx'] == 16, 'ToolCall content-fit contract mismatch')
    require(tool['targetInputPath'] == 'must-match-exactly' and tool['longPath'] == 'wrap-without-truncation', 'ToolCall path contract mismatch')

    permission = data['componentContracts']['PermissionRequest']
    require(permission['buttonVisualHeightPx'] == 40 and permission['actionTargetMinHeightPx'] >= 44 and permission['actionTargetGapMinPx'] >= 8, 'PermissionRequest action target dimensions mismatch')
    expected_actions = {
        'pending': ['approve:Button.primary/default', 'deny:Button.quiet/default'],
        'sending': ['approve:Button.primary/disabled', 'deny:Button.quiet/disabled'],
        'approved': [], 'denied': [], 'stale': ['refresh:Button.quiet/default'],
    }
    require(permission['actions'] == expected_actions, 'PermissionRequest action mapping mismatch')
    for variant in by_family['PermissionRequest']:
        visual_actions = [
            f"{action['action']}:Button.{action['intent']}/{action['state']}"
            for action in variant['visual']['actions']
        ]
        require(visual_actions == expected_actions[variant['name']], f"PermissionRequest/{variant['name']} visual action state mismatch")
        for action in variant['visual']['actions']:
            require(action['component'] == 'Button' and action['enabled'] == (action['state'] != 'disabled'), f"PermissionRequest/{variant['name']} enabled state mismatch")
    tone = {v['name']: v['visual']['statusBadge'].get('tone') for v in by_family['PermissionRequest']}
    require(tone == {'pending':'warning','sending':'info','approved':'info','denied':'error','stale':'neutral'}, 'PermissionRequest badge tones mismatch')

    baseline = json.loads(BASELINE.read_text())
    button = {'componentContract': data.get('componentContracts', {}).get('Button'), 'variants': by_family['Button']}
    require(hashlib.sha256(canonical(button)).hexdigest() == baseline['sha256'] and button == baseline['button'], 'Button family differs from saved normalized baseline')
    require(baseline.get('figma_component_set_id') == '6:20', 'Button Figma set id missing')

    evidence = json.loads(EVIDENCE.read_text())
    source_sha = hashlib.sha256(DESIGN.read_bytes()).hexdigest()
    manifest_path = ROOT / 'docs/design/tokens/manifest.json'
    manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    require(evidence.get('schema_version') == 1 and evidence.get('components_sha256') == source_sha and evidence.get('manifest_sha256') == manifest_sha, 'Figma structural evidence is stale')
    require(evidence.get('figma_file_key') == 'e6QYqEsmA3FHB6A2ohNr2o', 'Figma file binding mismatch')
    for family in ('Input', 'StatusBadge', 'NavigationItem', 'ToolCall', 'PermissionRequest'):
        require(family in evidence.get('families', {}), f'missing structural evidence for {family}')
    nav = evidence['families']['NavigationItem']
    require(nav.get('variant_count') == 4 and all(x['width'] == 220 and x['height'] == 40 and x['alignment'] == 'MIN' for x in nav['variants']), 'Figma NavigationItem structure mismatch')
    require(nav.get('dark_surfaces') == {'parent':'#262626','default':'#262626','hover':'#171717','selected':'#3d3d3d'}, 'Figma dark navigation surfaces mismatch')
    tool_evidence = evidence['families']['ToolCall']
    expected_tool_states = {'queued', 'running', 'waiting', 'success', 'error', 'unknown'}
    require(tool_evidence.get('variant_count') == 6 and {x['state'] for x in tool_evidence['variants']} == expected_tool_states and all(x['stroke_count'] == 0 and x['badge_component_set'] == '7:82' for x in tool_evidence['variants']), 'Figma ToolCall structure mismatch')
    require(len(tool_evidence['variants']) == 6, 'Figma ToolCall evidence must cover all six states')
    for variant in tool_evidence['variants']:
        require(variant['master_geometry']['vertical_sizing'] == 'AUTO' and variant['master_geometry']['bottom_padding'] == 16, f"ToolCall/{variant['state']} master is not content-hug with bottom padding")
        for geometry in (variant['master_geometry'], variant['dark_geometry']):
            require(geometry['height'] - geometry['content_bottom'] == geometry['bottom_gap'] == 16, f"ToolCall/{variant['state']} measured content-to-bottom gap is not 16px")
        require(variant['dark_geometry']['vertical_sizing'] == 'AUTO' and variant['dark_geometry']['bottom_padding'] == 16, f"ToolCall/{variant['state']} Dark instance did not inherit content-fit geometry")
        require(variant['target_path'] == variant['input_path'] == variant['dark_target_path'] == variant['dark_input_path'], f"ToolCall/{variant['state']} target/input path mismatch across modes")
        require(variant['master_geometry']['content_bottom'] <= variant['master_geometry']['height'] and variant['dark_geometry']['content_bottom'] <= variant['dark_geometry']['height'], f"ToolCall/{variant['state']} content overflows component bounds")
        for mode in ('', 'dark_'):
            parent = variant['dark_geometry' if mode else 'master_geometry']['height']
            for role in ('target', 'input'):
                bounds = variant[f'{mode}{role}_geometry']
                require(bounds['width'] == 368 and bounds['bottom'] == bounds['y'] + bounds['height'] and bounds['bottom'] <= parent, f"ToolCall/{variant['state']} {mode or 'light'} {role} text exceeds parent bounds")
    dark_instances = tool_evidence['dark_stack']['instances']
    require(len(dark_instances) == 6 and all(dark_instances[i+1]['y'] - dark_instances[i]['y'] - dark_instances[i]['height'] == 12 for i in range(5)), 'Dark ToolCall example stack overlaps or loses its 12px rhythm')
    req = evidence['families']['PermissionRequest']
    expected_permission_states = {'pending', 'sending', 'approved', 'denied', 'stale'}
    require(req.get('variant_count') == 5 and len(req['variants']) == 5 and {x['state'] for x in req['variants']} == expected_permission_states and all(x['outer_stroke_count'] == 0 and x['scope_stroke_count'] == 1 for x in req['variants']), 'Figma PermissionRequest scope/state evidence mismatch')
    expected_figma_actions = {
        'pending': [('6:2', '허용', 'primary', 'default', True), ('6:8', '거절', 'quiet', 'default', True)],
        'sending': [('6:6', '허용', 'primary', 'disabled', False), ('6:12', '거절', 'quiet', 'disabled', False)],
        'approved': [],
        'denied': [],
        'stale': [('6:8', '최신 상태 확인', 'quiet', 'default', True)],
    }
    for variant in req['variants']:
        actual = [(a['main_component'], a['label'], a['intent'], a['state'], a['enabled']) for a in variant['actions']]
        require(actual == expected_figma_actions[variant['state']], f"Figma PermissionRequest/{variant['state']} action instances mismatch")
        if actual:
            require(variant.get('action_group_gap') == 8, f"Figma PermissionRequest/{variant['state']} action gap mismatch")
    require(all(t['target_height'] == 44 and t['button_height'] == 40 and t['intent'] and t['state'] for t in req['action_targets']), 'Figma PermissionRequest target geometry/state evidence mismatch')
    require(len(req['action_targets']) == 5, 'Figma PermissionRequest must contain exactly five action target instances')
    responsive = req['responsive_examples']
    require(responsive == {'narrow_width':280,'narrow_action_layout':'VERTICAL','wide_width':720,'wide_action_layout':'HORIZONTAL'}, 'Figma responsive examples mismatch')
    print('PASS: component contracts, nested status mapping, Button baseline, and current Figma evidence invariants')


if __name__ == '__main__':
    try:
        main()
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f'FAIL: {exc}')
        raise SystemExit(1)
