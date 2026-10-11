"""Validate audit trace records, not product implementation or release acceptance."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import stat
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
STATES = {'source_missing', 'source_partial', 'runtime_unverified', 'verified_scoped'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local(path):
    require(isinstance(path, str) and path, 'missing evidence path')
    result = (ROOT / path).resolve()
    require(result.is_relative_to(ROOT), 'evidence outside project')
    require(not (ROOT / path).is_symlink(), f'symlink evidence {path}')
    require(result.is_file(), f'missing evidence {path}')
    return result


def inputs():
    data = read(HERE / 'input.json')
    prd = local(data['prd']['path'])
    require(digest(prd) == data['prd']['sha256'], 'PRD drift')
    text = prd.read_text()
    groups = data['groups']
    require([g['id'] for g in groups] == [f'F-{n:02}' for n in range(1, 19)], 'full18 order')
    table = {}
    for line in text.splitlines():
        match = re.match(r'\| \*\*(F-\d{2}) / (AC-\d{2})\*\* \| (.*?) \| (.*?) \|$', line)
        if match:
            table[match[1]] = (match[2], match[3], match[4])
    require(len(table) == 18, 'actual full18 table')
    for group in groups:
        require((group['acceptanceId'], group['name'], group['exactCriteria']) == table[group['id']], 'criterion changed')
        require(' '.join(group['clauses']) == group['exactCriteria'], 'clause loss or punctuation change')
    sections = data['crossCuttingSections']
    require(len(sections) == 4, 'cross-cutting sections missing')
    for content in sections.values():
        require(content in text, 'cross-cutting requirement changed')
    authority = data['sourceAuthority']
    freeze = read(local(authority['path']))
    require(freeze['source_sha256'] == authority['source_sha256'], 'source authority changed')
    for name, entry in freeze['all_sources'].items():
        path = local(name)
        require(entry['type'] == 'file' and not path.is_symlink(), f'source type {name}')
        require(digest(path) == entry['sha256'] and stat.S_IMODE(path.stat().st_mode) == entry['mode'], f'source drift {name}')
    spec = importlib.util.spec_from_file_location('audit_harness', ROOT / '.solopreneur/harness.py')
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)
    require(harness.inventory(ROOT) == freeze['all_sources'], 'current inventory added/deleted/changed files')
    predecessor = read(local(authority['terminalRun']))
    require(predecessor['status'] == 'complete', 'predecessor not complete')
    for gate in ['code', 'design']:
        review = predecessor['reviews'][gate]
        require(review['verdict'] == 'pass', f'predecessor {gate}')
        require(digest(local(review['evidence']['path'])) == review['evidence']['sha256'], 'review evidence changed')
    return data


def refs(row):
    require(row['status'] in STATES, 'invalid coverage status')
    require(isinstance(row.get('gaps'), list), 'explicit gaps required')
    source = row.get('sourceRefs', [])
    require(source, 'source closure required even for missing behavior')
    for ref in source:
        path = local(ref['path'])
        require(digest(path) == ref['sha256'], f'source reference drift {ref["path"]}')
        require(isinstance(ref['line'], int) and 1 <= ref['line'] <= len(path.read_text().splitlines()), 'invalid source line')
        require(ref.get('observation'), 'source observation required')
    runtime = row.get('runtimeRefs', [])
    non_goal = row.get('requirementKind') == 'non_goal'
    if non_goal:
        require((row.get('groupId'), row.get('clauseIndex')) == ('F-11', 3), 'only exact PRD IDE non-goal is source-only')
    if row['status'] == 'verified_scoped' and not non_goal:
        require(runtime, 'scoped verification needs actual evidence')
    for ref in runtime:
        require(digest(local(ref['path'])) == ref['sha256'], 'runtime evidence drift')
        require(ref.get('observation') and ref.get('applicability') and isinstance(ref.get('limits'), list), 'runtime applicability/limits required')
    require(isinstance(row.get('limits'), list), 'explicit coverage limits required')
    if row['status'] != 'verified_scoped':
        require(row['gaps'], 'unverified coverage requires concrete gaps')


def matrix(data):
    report = read(HERE / 'coverage-matrix.json')
    require(report['source_sha256'] == data['sourceAuthority']['source_sha256'], 'matrix source pin')
    require(report['prd_sha256'] == data['prd']['sha256'], 'matrix PRD pin')
    expected = {(g['id'], index): clause for g in data['groups'] for index, clause in enumerate(g['clauses'])}
    actual = {}
    for row in report['clauses']:
        key = (row['groupId'], row['clauseIndex'])
        require(key in expected and key not in actual, 'duplicate or unknown clause')
        require(row['exactClause'] == expected[key], 'clause changed')
        refs(row)
        actual[key] = row
    require(actual.keys() == expected.keys(), 'clause coverage incomplete')
    expected_cross = {(key, index): paragraph for key, content in data['crossCuttingSections'].items() for index, paragraph in enumerate(content.split('\n\n')[1:])}
    cross = {}
    for row in report['crossCutting']:
        key = (row['section'], row['paragraphIndex'])
        require(key in expected_cross and key not in cross and row['exactParagraph'] == expected_cross[key], 'cross-cutting coverage mismatch')
        refs(row)
        cross[key] = row
    require(cross.keys() == expected_cross.keys(), 'cross-cutting incomplete')
    scenarios = report['integratedScenarios']
    require(len(scenarios) == 7 and {r['id'] for r in scenarios} == set(range(1, 8)), 'seven scenarios required')
    expected_scenarios = dict((int(n), text) for n, text in re.findall(r'^([1-7])\. (.+)$', local(data['prd']['path']).read_text(), re.MULTILINE))
    require(len(expected_scenarios) == 7, 'actual PRD scenarios required')
    for row in scenarios:
        require(row['exactScenario'] == expected_scenarios[row['id']], 'scenario changed')
        refs(row)
    require(len(report['platforms']) == 2 and {r['platform'] for r in report['platforms']} == {'macOS', 'Windows'}, 'both platforms required')
    for row in report['platforms']:
        refs(row)
    backlog_report = read(HERE / 'remaining-backlog.json')
    require(backlog_report['source_sha256'] == report['source_sha256'] and backlog_report['prd_sha256'] == report['prd_sha256'], 'backlog pins')
    backlog = backlog_report['items']
    ids = [row['id'] for row in backlog]
    require(ids and len(set(ids)) == len(ids), 'backlog identifiers')
    covered = set()
    for row in backlog:
        require(row.get('outcome') and row.get('nextAction') and row.get('evidence'), 'concrete backlog required')
        for path in row['evidence']:
            local(path)
        require(set(row['dependsOn']) <= set(ids[:ids.index(row['id'])]), 'dependency order')
        for key in row['clauseKeys']:
            require(tuple(key) in expected, 'unknown backlog clause')
            covered.add(tuple(key))
    require({k for k, row in actual.items() if row['gaps']} <= covered, 'remaining clauses missing from backlog')
    return {'clauses': len(actual), 'crossCutting': len(cross), 'scenarios': 7, 'platforms': 2, 'backlog': len(backlog)}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2 and sys.argv[1] in {'inputs', 'matrix'}, 'usage: check-coverage.py inputs|matrix')
        data = inputs()
        result = {'inputs': 'pass', 'sourceFiles': len(read(local(data['sourceAuthority']['path']))['all_sources']), 'productAcceptance': False}
        if sys.argv[1] == 'matrix':
            result.update(matrix(data))
        print(json.dumps(result))
    except (KeyError, ValueError, OSError, TypeError) as error:
        print(f'coverage check failed: {error}', file=sys.stderr)
        sys.exit(1)
