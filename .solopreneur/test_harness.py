"""Focused local tests for schema-v2 decision validation and handoff gates."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("solopreneur_harness", Path(__file__).with_name("harness.py"))
harness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(harness)


def decision(status="open", blocks=None, resolution=None):
    return {"id": "D-1", "statement": "private platform choice", "status": status,
            "source": "private user direction", "impact": "private consequence",
            "blocks": ["implementation"] if blocks is None else blocks, "resolution": resolution}


class ContractFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.contract_path = self.project / "contract.json"
        self.contract = {"schema_version": 2,
                         "acceptance": [{"id": "A1", "description": "Works"}], "checks": {}}

    def record(self):
        self.contract_path.write_text(json.dumps(self.contract))
        return harness.contract_record(self.project, "contract.json")[1]


class DecisionRegisterTests(ContractFixture, unittest.TestCase):
    def test_legacy_schema_v2_contract_without_register(self):
        parsed = self.record()
        self.assertNotIn("decision_register", parsed)
        for phase in harness.HANDOFF_PHASES:
            harness.require_decision_clear(parsed, phase)

    def test_valid_states_and_phase_specific_blocks(self):
        cases = [
            decision(blocks=["implementation"]),
            decision(status="assumption", blocks=["review"], resolution="Reason for temporary choice"),
            decision(status="confirmed", blocks=[], resolution="Explicit user choice"),
            decision(status="delegated", blocks=[], resolution="Authorized coordinator choice"),
        ]
        for entry in cases:
            with self.subTest(status=entry["status"]):
                self.contract["decision_register"] = [entry]
                parsed = self.record()
                for phase in harness.HANDOFF_PHASES:
                    if phase in entry["blocks"]:
                        with self.assertRaisesRegex(ValueError, entry["id"] + r" \(" + entry["status"] + r"\) blocks " + phase):
                            harness.require_decision_clear(parsed, phase)
                    else:
                        harness.require_decision_clear(parsed, phase)

    def test_each_cli_phase_can_block(self):
        for phase in harness.HANDOFF_PHASES:
            for status in ("open", "assumption"):
                with self.subTest(phase=phase, status=status):
                    self.contract["decision_register"] = [decision(
                        status=status, blocks=[phase],
                        resolution="Temporary rationale" if status == "assumption" else None)]
                    parsed = self.record()
                    with self.assertRaisesRegex(ValueError, "blocks " + phase):
                        harness.require_decision_clear(parsed, phase)

    def test_invalid_entries_rejected_without_free_text_in_errors(self):
        invalid = [
            "private statement", [],
            {**decision(), "id": "private secret!"},
            {**decision(), "status": "private unsupported"},
            {**decision(), "source": " "},
            {**decision(), "impact": None},
            {**decision(), "blocks": []},
            {**decision(), "blocks": ["release"]},
            {**decision(), "blocks": ["review", "review"]},
            {**decision(), "blocks": ["review", 3]},
            {**decision(), "resolution": "premature answer"},
            decision(status="assumption", resolution=None),
            decision(status="confirmed", blocks=["implementation"], resolution="chosen"),
            decision(status="confirmed", blocks=[], resolution=None),
            decision(status="delegated", blocks=[], resolution=""),
            {**decision(), "extra": "private extra"},
        ]
        for entry in invalid:
            with self.subTest(entry=repr(entry)):
                self.contract["decision_register"] = [entry]
                with self.assertRaises(ValueError) as caught:
                    self.record()
                self.assertIn("decision_register", str(caught.exception))
                self.assertNotIn("private", str(caught.exception))
                self.assertNotIn("premature", str(caught.exception))
        self.contract["decision_register"] = [decision(), decision()]
        with self.assertRaisesRegex(ValueError, "decision_register"):
            self.record()
        self.contract["decision_register"] = {"private": "register"}
        with self.assertRaisesRegex(ValueError, "decision_register must be a list"):
            self.record()

    def test_block_error_excludes_free_text(self):
        self.contract["decision_register"] = [decision()]
        parsed = self.record()
        with self.assertRaises(ValueError) as caught:
            harness.require_decision_clear(parsed, "implementation")
        self.assertEqual(str(caught.exception), "Decision D-1 (open) blocks implementation handoff.")


class HandoffTests(ContractFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        (self.project / ".solopreneur").mkdir()
        (self.project / ".solopreneur/roles.json").write_text(json.dumps({"roles": {"engineer": {}}}))
        (self.project / "role.txt").write_text("role instructions")
        self.state = {"run": "sample", "status": "active", "plan": {"sha256": "a" * 64},
                      "contract": None, "prepared_handoffs": [], "dispatches": []}
        self.state_path = self.project / "run.json"

    def register(self):
        self.record()
        self.state["contract"] = harness.evidence(self.project, "contract.json")

    def invoke(self, command, phase=None):
        args = SimpleNamespace(command=command, role="engineer", phase=phase,
                               out="packet.json", packet="packet.json", child_ref="child-1",
                               context="fresh", role_file="role.txt", model=None, effort=None)
        with patch.object(harness, "v2_reviewed_plan"):
            return harness.v2_command(args, self.project, [], self.state, self.state_path)

    def test_prepare_and_dispatch_gate_all_supported_phases(self):
        for phase in harness.HANDOFF_PHASES:
            with self.subTest(phase=phase):
                self.contract["decision_register"] = [decision(blocks=[phase])]
                self.register()
                with self.assertRaisesRegex(ValueError, "blocks " + phase):
                    self.invoke("prepare-handoff", phase)
                self.assertFalse((self.project / "packet.json").exists())
                self.contract["decision_register"] = [decision(status="confirmed", blocks=[], resolution="Chosen")]
                self.register()
                self.invoke("prepare-handoff", phase)
                packet = json.loads((self.project / "packet.json").read_text())
                self.assertEqual(packet["decision_register"], self.contract["decision_register"])
                self.invoke("dispatch")
                self.assertEqual(self.state["dispatches"][-1]["phase"], phase)
                (self.project / "packet.json").unlink()
                self.state["prepared_handoffs"].clear()

    def test_open_and_assumed_decision_block_dispatch_after_preparation(self):
        for phase in harness.HANDOFF_PHASES:
            for status in ("open", "assumption"):
                with self.subTest(phase=phase, status=status):
                    self.contract["decision_register"] = [decision(status="confirmed", blocks=[], resolution="Chosen")]
                    self.register()
                    self.invoke("prepare-handoff", phase)
                    self.contract["decision_register"] = [decision(
                        status=status, blocks=[phase],
                        resolution="Temporary rationale" if status == "assumption" else None)]
                    self.register()
                    with self.assertRaisesRegex(ValueError, "D-1 \\(" + status + "\\) blocks " + phase):
                        self.invoke("dispatch")
                    self.assertFalse(self.state["dispatches"])
                    (self.project / "packet.json").unlink()
                    self.state["prepared_handoffs"].clear()

    def test_unregistered_contract_change_rejected_before_dispatch(self):
        self.register()
        self.invoke("prepare-handoff", "research")
        self.contract["decision_register"] = [decision(blocks=["research"])]
        self.record()
        with self.assertRaisesRegex(ValueError, "Reviewed contract is missing or changed"):
            self.invoke("dispatch")
        self.assertFalse(self.state["dispatches"])

    def test_legacy_contract_prepares_and_dispatches(self):
        self.register()
        self.invoke("prepare-handoff", "research")
        self.assertEqual(json.loads((self.project / "packet.json").read_text())["decision_register"], [])
        self.invoke("dispatch")
        self.assertEqual(len(self.state["dispatches"]), 1)


if __name__ == "__main__":
    unittest.main()
