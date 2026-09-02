"""Validate every plan-runner schema against its valid and invalid example fixtures.

Exit 0 on success. Exit 1 if any valid example fails or any invalid example passes.
"""

import json
import sys
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS_DIR = ROOT / "schemas"
EXAMPLES_DIR = SCHEMAS_DIR / "examples"

CASES = [
    ("wave-plan.schema.json", "wave-plan-valid.json", "wave-plan-invalid.json"),
    ("dev-return.schema.json", "dev-return-valid.json", "dev-return-invalid.json"),
    ("manifest.schema.json", "manifest-valid.json", "manifest-invalid.json"),
    ("manifest.schema.json", "manifest-model-policy-valid.json", "manifest-model-policy-invalid.json"),
    ("manifest.schema.json", "manifest-agent-source-valid.json", "manifest-agent-source-invalid.json"),
    ("manifest.schema.json", "manifest-http-usage-valid.json", "manifest-http-usage-invalid.json"),
    ("run-state.schema.json", "run-state.valid.json", "run-state.invalid.json"),
    ("run-state.schema.json", "run-state-model-policy-valid.json", "run-state-model-policy-invalid.json"),
    ("run-state.schema.json", "run-state-model-policy-subst-valid.json", "run-state-model-policy-subst-invalid.json"),
    ("run-state.schema.json", "run-state-endpoint-dispatch-valid.json", "run-state-endpoint-dispatch-invalid.json"),
    ("bug-report.schema.json", "bug-report-valid.json", "bug-report-invalid.json"),
    ("task-graph.schema.json", "task-graph-valid.json", "task-graph-invalid.json"),
    ("task-event.schema.json", "task-event-valid.json", "task-event-invalid.json"),
]


def load(p: Path):
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def validate_task_event_lifecycle_examples(schema, example: dict) -> None:
    """Validate the reservation and release event examples embedded in the fixture."""
    lifecycle_examples = example.get("lifecycle_event_examples", [])
    expected_types = {"paths_reserved", "paths_released"}
    actual_types = {event.get("event_type") for event in lifecycle_examples}
    if actual_types != expected_types:
        raise jsonschema.ValidationError(
            "task-event valid fixture must include paths_reserved and paths_released examples"
        )
    for event in lifecycle_examples:
        jsonschema.validate(event, schema)


def main() -> int:
    failures = []
    for schema_name, valid_name, invalid_name in CASES:
        schema_path = SCHEMAS_DIR / schema_name
        if not schema_path.exists():
            print(f"SKIP: {schema_name} not yet written")
            continue
        schema = load(schema_path)
        try:
            valid_example = load(EXAMPLES_DIR / valid_name)
            jsonschema.validate(valid_example, schema)
            if schema_name == "task-event.schema.json":
                validate_task_event_lifecycle_examples(schema, valid_example)
            print(f"PASS: {valid_name} validates against {schema_name}")
        except jsonschema.ValidationError as e:
            failures.append(f"FAIL: {valid_name} should validate: {e.message}")
        try:
            jsonschema.validate(load(EXAMPLES_DIR / invalid_name), schema)
            failures.append(f"FAIL: {invalid_name} should NOT validate")
        except jsonschema.ValidationError:
            print(f"PASS: {invalid_name} correctly rejected by {schema_name}")
    if failures:
        for f in failures:
            print(f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
