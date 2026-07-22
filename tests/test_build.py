from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
import math
import re
import subprocess
import sys
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("static_build", ROOT / "build.py")
assert SPEC and SPEC.loader
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.seed = json.loads((ROOT / "data" / "seed.json").read_text(encoding="utf-8"))
        cls.entities = cls.seed["entities"]

    def test_two_builds_are_byte_identical(self) -> None:
        source = build.load_source()
        first = build.build_outputs(source)
        second = build.build_outputs(source)
        self.assertEqual(first, second)
        for payload in first.values():
            self.assertTrue(payload.endswith(b"\n"))

    def test_check_matches_every_committed_output(self) -> None:
        result = subprocess.run(
            [sys.executable, "build.py", "--check"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            f"verified {len(build.build_outputs(build.load_source()))} deterministic generated files",
            result.stdout,
        )

    def test_exact_counts_and_distributions(self) -> None:
        self.assertEqual(
            {name: len(records) for name, records in self.entities.items()},
            build.EXPECTED_COUNTS,
        )
        incidents = self.entities["incidents"]
        # Derived from the authored source so Write API commits (which
        # append cases) keep this invariant meaningful without re-pinning.
        source_cases = build.load_source()["cases"]
        self.assertEqual(
            {state: sum(item["statecode"] == state for item in incidents) for state in range(3)},
            {state: sum(row[6] == state for row in source_cases) for state in range(3)},
        )
        self.assertEqual(
            {priority: sum(item["prioritycode"] == priority for item in incidents) for priority in range(1, 4)},
            {priority: sum(row[3] + 1 == priority for row in source_cases) for priority in range(1, 4)},
        )
        tasks = self.entities["tasks"]
        self.assertEqual(
            {state: sum(item["statecode"] == state for item in tasks) for state in range(3)},
            {0: 18, 1: 12, 2: 6},
        )
        self.assertEqual(sum(item["directioncode"] for item in self.entities["emails"]), 30)

    def test_guid_and_etag_vectors(self) -> None:
        # Pin the algorithm via a stable logical record (output order is
        # id-sorted, so positions shift as the tenant grows).
        first = next(
            row for row in self.entities["accounts"]
            if row["accountnumber"] == "AST-1010"
        )
        self.assertEqual(first["accountid"], "207fee26-8125-54c4-a95a-bb16c9d7d820")
        self.assertEqual(first["@odata.etag"], 'W/"63be617758126299309cf21b"')
        guid = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        )
        seen: set[str] = set()
        for entity, records in self.entities.items():
            id_field = build.ID_FIELDS[entity]
            for record in records:
                self.assertRegex(record[id_field], guid)
                self.assertNotIn(record[id_field], seen)
                seen.add(record[id_field])
                self.assertEqual(record["@odata.etag"], build.weak_etag(record))

    def test_metadata_and_registry_derive_from_outputs(self) -> None:
        metadata = json.loads(
            (ROOT / "site" / "api" / "data" / "v9.2" / "$metadata.json").read_text(
                encoding="utf-8"
            )
        )
        counts = {item["name"]: item["count"] for item in metadata["entitySets"]}
        self.assertEqual(counts, {name: len(value) for name, value in self.entities.items()})
        registry = json.loads((ROOT / "registry.json").read_text(encoding="utf-8"))
        self.assertEqual(registry["counts"], counts)
        for entry in registry["files"]:
            payload = (ROOT / entry["path"]).read_bytes()
            self.assertEqual(entry["bytes"], len(payload))
            self.assertEqual(entry["sha256"], hashlib.sha256(payload).hexdigest())

    def test_metadata_uses_explicit_types_even_for_nullable_and_all_null_fields(self) -> None:
        metadata = self.seed["metadata"]
        properties = {
            (entity["name"], prop["name"]): prop
            for entity in metadata["entitySets"]
            for prop in entity["properties"]
        }
        expected = {
            ("connections", "effectiveend"): ("Edm.DateTimeOffset", True),
            ("incidents", "resolvedon"): ("Edm.DateTimeOffset", True),
            ("accounts", "primarycontactid"): ("Edm.Guid", True),
            ("incidents", "prioritycode"): ("Edm.Int32", False),
            ("emails", "directioncode"): ("Edm.Boolean", False),
            ("contacts", "contactid"): ("Edm.Guid", False),
            ("tasks", "scheduledend"): ("Edm.DateTimeOffset", False),
        }
        for key, (edm_type, nullable) in expected.items():
            self.assertEqual(properties[key]["type"], edm_type, key)
            self.assertEqual(properties[key]["nullable"], nullable, key)
        self.assertTrue(
            all(item["effectiveend"] is None for item in self.entities["connections"])
        )

    def test_seed_contains_exact_static_identity_and_metadata_contracts(self) -> None:
        api_root = ROOT / "site" / "api" / "data" / "v9.2"
        static_identity = json.loads((api_root / "WhoAmI.json").read_text(encoding="utf-8"))
        static_metadata = json.loads((api_root / "$metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(self.seed["identity"], static_identity)
        self.assertEqual(self.seed["metadata"], static_metadata)

    def test_collection_envelopes_match_seed(self) -> None:
        api_root = ROOT / "site" / "api" / "data" / "v9.2"
        for entity, records in self.entities.items():
            envelope = json.loads((api_root / f"{entity}.json").read_text(encoding="utf-8"))
            self.assertEqual(envelope["@odata.count"], len(records))
            self.assertEqual(envelope["value"], records)
            self.assertTrue(envelope["@odata.context"].endswith(f"#{entity}"))

    def test_dates_status_pairs_and_lookups_are_valid(self) -> None:
        identities = {item["systemuserid"] for item in self.seed["identities"]}
        ids = {
            entity: {record[build.ID_FIELDS[entity]] for record in records}
            for entity, records in self.entities.items()
        }
        explicit = re.compile(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$"
        )
        for entity, records in self.entities.items():
            for record in records:
                if build.STATUS_PAIRS[entity]:
                    self.assertIn(
                        (record["statecode"], record["statuscode"]),
                        build.STATUS_PAIRS[entity],
                    )
                for field in build.DATE_FIELDS:
                    if field in record and record[field] is not None:
                        self.assertRegex(record[field], explicit)
                if "ownerid" in record:
                    self.assertIn(record["ownerid"], identities)
        for contact in self.entities["contacts"]:
            self.assertIn(contact["parentcustomerid"], ids["accounts"])
        for incident in self.entities["incidents"]:
            target = ids[incident["customeridtype"]]
            self.assertIn(incident["customerid"], target)
            self.assertIn(incident["primarycontactid"], ids["contacts"])
        for task in self.entities["tasks"]:
            self.assertIn(task["regardingobjectid"], ids["incidents"])
        for email in self.entities["emails"]:
            self.assertIn(email["regardingobjectid"], ids["incidents"])
            for prefix in ("sender", "recipient"):
                target = identities if email[f"{prefix}idtype"] == "systemusers" else ids["contacts"]
                self.assertIn(email[f"{prefix}id"], target)
            expected = (
                (1, 3, "systemusers", "contacts")
                if email["directioncode"]
                else (1, 4, "contacts", "systemusers")
            )
            self.assertEqual(
                (
                    email["statecode"],
                    email["statuscode"],
                    email["senderidtype"],
                    email["recipientidtype"],
                ),
                expected,
            )
        vectors = {
            (
                item["record1id"],
                item["record2id"],
                item["record1roleidname"],
                item["record2roleidname"],
            )
            for item in self.entities["connections"]
        }
        for item in self.entities["connections"]:
            self.assertIn(
                (
                    item["record2id"],
                    item["record1id"],
                    item["record2roleidname"],
                    item["record1roleidname"],
                ),
                vectors,
            )

    def test_connection_fixture_contains_twenty_exact_reciprocal_pairs(self) -> None:
        pairs: dict[str, list[dict[str, object]]] = {}
        for connection in self.entities["connections"]:
            pairs.setdefault(connection["connectionpairid"], []).append(connection)
        self.assertEqual(len(self.entities["connections"]), 40)
        self.assertEqual(len(pairs), 20)
        self.assertTrue(all(len(pair) == 2 for pair in pairs.values()))

    def test_case_lifecycle_vectors_are_independently_explicit(self) -> None:
        expected = {
            (0, 1),
            (0, 2),
            (0, 3),
            (0, 4),
            (1, 5),
            (1, 1000),
            (2, 6),
            (2, 2000),
        }
        self.assertEqual(build.STATUS_PAIRS["incidents"], expected)
        generated = {
            (record["statecode"], record["statuscode"])
            for record in self.entities["incidents"]
        }
        self.assertEqual(
            generated,
            {(0, 1), (1, 5), (1, 1000), (2, 6), (2, 2000)},
        )
        labels = {
            item["value"]: item["label"]
            for entity in self.seed["metadata"]["entitySets"]
            if entity["name"] == "incidents"
            for item in next(
                prop for prop in entity["properties"] if prop["name"] == "statuscode"
            )["options"]
        }
        self.assertEqual(
            labels,
            {
                1: "In Progress",
                2: "On Hold",
                3: "Waiting for Details",
                4: "Researching",
                5: "Problem Solved",
                1000: "Information Provided",
                6: "Canceled",
                2000: "Merged",
            },
        )

    def test_fixture_uses_reserved_synthetic_contact_data(self) -> None:
        for account in self.entities["accounts"]:
            self.assertTrue(account["emailaddress1"].endswith(".example"))
            self.assertTrue(account["websiteurl"].split("/", 3)[2].endswith(".example"))
            self.assertRegex(account["telephone1"], r"^\+1-202-555-01\d{2}$")
        for contact in self.entities["contacts"]:
            self.assertTrue(contact["emailaddress1"].endswith(".example"))
            self.assertRegex(contact["telephone1"], r"^\+1-202-555-01\d{2}$")
        for email in self.entities["emails"]:
            self.assertTrue(email["fromaddress"].endswith(".example"))
            self.assertTrue(email["toaddress"].endswith(".example"))

    def test_invalid_source_is_rejected_before_output_construction(self) -> None:
        source = build.load_source()
        source["contacts"][0][2] = 999
        with self.assertRaises(build.BuildError):
            build.build_outputs(source)

    def test_every_source_field_is_typed_and_non_json_values_are_rejected(self) -> None:
        mutations = [
            lambda source: source["accounts"][0].__setitem__(0, 123),
            lambda source: source["identities"][0].__setitem__("name", 123),
            lambda source: source["contacts"][0].__setitem__(2, True),
            lambda source: source["cases"][0].__setitem__(3, 3),
            lambda source: source["tenant"].__setitem__("organizationVersion", 9.2),
            lambda source: source["accounts"][0].__setitem__(0, math.nan),
            lambda source: source["accounts"][0].__setitem__(0, math.inf),
            lambda source: source.__setitem__("identities", tuple(source["identities"])),
        ]
        pristine = build.load_source()
        for mutate in mutations:
            source = copy.deepcopy(pristine)
            mutate(source)
            with self.subTest(source=source):
                with self.assertRaises(build.BuildError):
                    build.build_outputs(source)

    def test_invalid_input_fails_before_any_generated_file_replacement(self) -> None:
        valid_outputs = build.build_outputs(build.load_source())
        before = {path: path.read_bytes() for path in valid_outputs}
        invalid = build.load_source()
        invalid["accounts"][0][0] = math.nan
        with (
            mock.patch.object(build, "load_source", return_value=invalid),
            redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(build.main([]), 2)
        self.assertEqual({path: path.read_bytes() for path in valid_outputs}, before)

    def assert_publication_rolls_back(self, failure_index: int) -> None:
        outputs = build.build_outputs(build.load_source())
        before = {path: path.read_bytes() for path in outputs}
        changed = {path: payload + b"simulated publication change\n" for path, payload in outputs.items()}
        replace = build.os.replace
        calls = 0

        def fail_once(source: Path, destination: Path) -> None:
            nonlocal calls
            calls += 1
            if calls == failure_index:
                raise OSError(f"simulated replacement failure {failure_index}")
            replace(source, destination)

        with (
            mock.patch.object(build.os, "replace", side_effect=fail_once),
            self.assertRaises(OSError),
        ):
            build.write_outputs(changed)
        self.assertEqual({path: path.read_bytes() for path in outputs}, before)
        self.assertFalse((ROOT / ".build-staging").exists())

    def test_second_generated_replacement_failure_restores_every_output(self) -> None:
        self.assert_publication_rolls_back(2)

    def test_middle_generated_replacement_failure_restores_every_output(self) -> None:
        outputs = build.build_outputs(build.load_source())
        self.assert_publication_rolls_back(len(outputs) // 2)

    def test_final_generated_replacement_failure_restores_every_output(self) -> None:
        outputs = build.build_outputs(build.load_source())
        self.assert_publication_rolls_back(len(outputs))

    def test_staging_write_failure_changes_no_generated_output(self) -> None:
        outputs = build.build_outputs(build.load_source())
        before = {path: path.read_bytes() for path in outputs}
        write_bytes = Path.write_bytes
        calls = 0

        def fail_second(path: Path, payload: bytes) -> int:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated staging write failure")
            return write_bytes(path, payload)

        with (
            mock.patch.object(Path, "write_bytes", autospec=True, side_effect=fail_second),
            self.assertRaises(OSError),
        ):
            build.write_outputs(outputs)
        self.assertEqual({path: path.read_bytes() for path in outputs}, before)
        self.assertFalse((ROOT / ".build-staging").exists())

    def test_check_mode_performs_no_write_or_replace(self) -> None:
        with (
            mock.patch.object(
                Path,
                "write_bytes",
                side_effect=AssertionError("--check attempted a write"),
            ),
            mock.patch.object(
                build.os,
                "replace",
                side_effect=AssertionError("--check attempted a replacement"),
            ),
        ):
            self.assertEqual(build.main(["--check"]), 0)

    def test_json_serializers_and_dates_fail_closed(self) -> None:
        with self.assertRaises(ValueError):
            build.canonical_json({"number": math.nan})
        with self.assertRaises(ValueError):
            build.compact_canonical({"number": math.inf})
        with self.assertRaises(build.BuildError):
            build.parse_utc("2026-02-30T12:00:00.000Z")


if __name__ == "__main__":
    unittest.main()
