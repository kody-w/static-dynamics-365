from __future__ import annotations

import importlib.util
import json
import unittest
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("multi_app_build", ROOT / "build.py")
assert SPEC and SPEC.loader
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


class MultiAppBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(
            (ROOT / "data" / "schema.json").read_text(encoding="utf-8")
        )
        cls.seed = json.loads(
            (ROOT / "data" / "seed.json").read_text(encoding="utf-8")
        )
        cls.entities = cls.seed["entities"]

    def test_schema_explicitly_declares_every_identity_and_behavioral_axis(self) -> None:
        self.assertEqual(self.schema["schemaVersion"], 3)
        self.assertEqual(
            self.schema["formatVersions"], {"schema": 3, "seed": 3, "replay": 3}
        )
        for entity_set, definition in self.schema["entities"].items():
            self.assertEqual(definition["entitySet"], entity_set)
            for key in (
                "logicalName",
                "key",
                "primaryName",
                "deletePolicy",
                "mutable",
                "appScopes",
                "statusPairs",
            ):
                self.assertIn(key, definition, (entity_set, key))
            self.assertIn(definition["key"], definition["fields"])
            self.assertIn(definition["primaryName"], definition["fields"])
            for field, contract in definition["fields"].items():
                self.assertIn("edmType", contract, (entity_set, field))
                self.assertIn("nullable", contract, (entity_set, field))
                self.assertIn("mutable", contract, (entity_set, field))
                if contract["edmType"] == "Edm.Decimal":
                    self.assertIn("scale", contract, (entity_set, field))

    def test_requested_fixture_profile_counts_are_exact(self) -> None:
        expected = {
            "businessunits": 1,
            "systemusers": 10,
            "transactioncurrencies": 4,
            "uomschedules": 1,
            "uoms": 1,
            "products": 12,
            "pricelevels": 4,
            "productpricelevels": 48,
            "leads": 24,
            "opportunities": 15,
            "opportunityproducts": 36,
            "quotes": 12,
            "quotedetails": 30,
            "salesorders": 6,
            "salesorderdetails": 15,
            "invoices": 5,
            "invoicedetails": 12,
            "msdyn_customerassets": 18,
            "msdyn_workorders": 15,
            "msdyn_workorderservicetasks": 45,
            "msdyn_workorderproducts": 20,
            "msdyn_resourcerequirements": 15,
            "bookableresources": 4,
            "bookableresourcebookings": 13,
        }
        for entity, count in expected.items():
            self.assertEqual(len(self.entities[entity]), count, entity)

    def test_metadata_profiles_actions_navigation_and_schema_are_generated(self) -> None:
        metadata = self.seed["metadata"]
        self.assertEqual(metadata["schemaVersion"], 3)
        self.assertEqual(
            metadata["compatibilityProfile"]["sourceDate"], "2026-07-12"
        )
        self.assertEqual(len(metadata["entitySets"]), len(self.schema["entities"]))
        self.assertEqual(
            {action["name"] for action in metadata["actions"]},
            {action["name"] for action in self.schema["actions"]},
        )
        for entity in metadata["entitySets"]:
            source = self.schema["entities"][entity["name"]]
            self.assertEqual(entity["logicalName"], source["logicalName"])
            self.assertEqual(entity["primaryName"], source["primaryName"])
            self.assertEqual(entity["statusPairs"], source["statusPairs"])
            self.assertEqual(entity["appScopes"], source["appScopes"])

    def test_sales_totals_use_exact_decimal_arithmetic(self) -> None:
        contracts = (
            ("opportunities", "opportunityproducts", "opportunityid"),
            ("quotes", "quotedetails", "quoteid"),
            ("salesorders", "salesorderdetails", "salesorderid"),
            ("invoices", "invoicedetails", "invoiceid"),
        )
        for parent_entity, line_entity, parent_field in contracts:
            key = self.schema["entities"][parent_entity]["key"]
            for parent in self.entities[parent_entity]:
                lines = [
                    line
                    for line in self.entities[line_entity]
                    if line[parent_field] == parent[key]
                ]
                base = sum(
                    (Decimal(line["baseamount"]) for line in lines), Decimal(0)
                )
                discounts = sum(
                    (
                        Decimal(line["manualdiscountamount"])
                        for line in lines
                    ),
                    Decimal(0),
                )
                tax = sum((Decimal(line["tax"]) for line in lines), Decimal(0))
                header_discount = Decimal(parent.get("discountamount", "0.00"))
                freight = Decimal(parent.get("freightamount", "0.00"))
                self.assertEqual(
                    Decimal(parent["totalamount"]),
                    base - discounts - header_discount + tax + freight,
                    parent[key],
                )

    def test_cross_app_fixture_chains_resolve_and_share_customers(self) -> None:
        chains = {item["sourceKey"]: item for item in self.seed["fixtureChains"]}
        sales = chains["anchor.sales.primary"]
        quote = next(
            item for item in self.entities["quotes"] if item["quoteid"] == sales["quote"]
        )
        order = next(
            item
            for item in self.entities["salesorders"]
            if item["salesorderid"] == sales["salesorder"]
        )
        invoice = next(
            item
            for item in self.entities["invoices"]
            if item["invoiceid"] == sales["invoice"]
        )
        self.assertEqual(quote["customerid"], order["customerid"])
        self.assertEqual(order["customerid"], invoice["customerid"])
        self.assertTrue(sales["invoicedetails"])
        self.assertTrue(sales["customerassets"])

        field = chains["anchor.field-service.primary"]
        workorder = next(
            item
            for item in self.entities["msdyn_workorders"]
            if item["msdyn_workorderid"] == field["workorder"]
        )
        self.assertEqual(workorder["msdyn_servicerequest"], field["incident"])
        self.assertEqual(workorder["msdyn_customerasset"], field["customerasset"])
        self.assertTrue(field["bookings"])
        self.assertTrue(field["serviceTasks"])

    def test_booking_intervals_are_half_open_and_nonoverlapping(self) -> None:
        by_resource: dict[str, list[tuple[object, object]]] = {}
        canceled = {
            item["bookingstatusid"]
            for item in self.entities["bookingstatuses"]
            if item["msdyn_fieldservicestatus"] == 690970004
        }
        for booking in self.entities["bookableresourcebookings"]:
            if booking["bookingstatus"] in canceled:
                continue
            by_resource.setdefault(booking["resource"], []).append(
                (
                    build.parse_utc(booking["starttime"]),
                    build.parse_utc(booking["endtime"]),
                )
            )
        for intervals in by_resource.values():
            intervals.sort()
            for previous, current in zip(intervals, intervals[1:]):
                self.assertLessEqual(previous[1], current[0])
        requirements = {
            item["msdyn_resourcerequirementid"]: item
            for item in self.entities["msdyn_resourcerequirements"]
        }
        resources = {
            item["bookableresourceid"]: item
            for item in self.entities["bookableresources"]
        }
        for requirement in requirements.values():
            self.assertLess(
                build.parse_utc(requirement["msdyn_fromdate"]),
                build.parse_utc(requirement["msdyn_todate"]),
            )
        for booking in self.entities["bookableresourcebookings"]:
            requirement = requirements[booking["msdyn_resourcerequirement"]]
            self.assertEqual(
                requirement["msdyn_workorder"], booking["msdyn_workorder"]
            )
            self.assertLessEqual(
                build.parse_utc(requirement["msdyn_fromdate"]),
                build.parse_utc(booking["starttime"]),
            )
            self.assertLessEqual(
                build.parse_utc(booking["endtime"]),
                build.parse_utc(requirement["msdyn_todate"]),
            )
            if booking["statecode"] == 0:
                self.assertEqual(requirement["statecode"], 0)
                self.assertEqual(resources[booking["resource"]]["statecode"], 0)

    def test_whoami_resolves_to_stored_user_and_business_unit(self) -> None:
        user = next(
            item
            for item in self.entities["systemusers"]
            if item["systemuserid"] == self.seed["identity"]["UserId"]
        )
        business_unit = next(
            item
            for item in self.entities["businessunits"]
            if item["businessunitid"] == self.seed["identity"]["BusinessUnitId"]
        )
        self.assertEqual(user["businessunitid"], business_unit["businessunitid"])
        self.assertEqual(user["fullname"], self.seed["identity"]["FullName"])

    def test_every_registry_collection_path_exists(self) -> None:
        registry = json.loads((ROOT / "registry.json").read_text(encoding="utf-8"))
        collection_paths = {
            entry["path"]
            for entry in registry["files"]
            if entry["count"] is not None
        }
        self.assertEqual(
            collection_paths,
            {
                f"site/api/data/v9.2/{entity}.json"
                for entity in self.schema["entities"]
            },
        )
        self.assertTrue((ROOT / "site" / "tenant-schema.mjs").is_file())
        self.assertTrue((ROOT / "site" / "data" / "schema.json").is_file())

    def test_public_schema_oracle_is_explicit_and_independent(self) -> None:
        details_without_lifecycle = {
            "opportunityproducts",
            "quotedetails",
            "salesorderdetails",
            "invoicedetails",
            "productpricelevels",
        }
        for entity in details_without_lifecycle:
            fields = self.schema["entities"][entity]["fields"]
            self.assertNotIn("statecode", fields, entity)
            self.assertNotIn("statuscode", fields, entity)
            self.assertEqual(self.schema["entities"][entity]["statusPairs"], [])

        quote_fields = self.schema["entities"]["quotes"]["fields"]
        self.assertIn("effectivefrom", quote_fields)
        self.assertIn("effectiveto", quote_fields)
        self.assertNotIn("effectivestart", quote_fields)
        self.assertNotIn("effectiveend", quote_fields)
        for entity in ("salesorders", "invoices"):
            self.assertTrue(
                {"effectivefrom", "effectiveto", "effectivestart", "effectiveend"}
                .isdisjoint(self.schema["entities"][entity]["fields"]),
                entity,
            )

        workorder_fields = self.schema["entities"]["msdyn_workorders"]["fields"]
        for field in (
            "msdyn_servicerequest",
            "msdyn_firstarrivedon",
            "msdyn_completedon",
            "msdyn_customerasset",
        ):
            self.assertIn(field, workorder_fields)
        for field in (
            "msdyn_case",
            "msdyn_workorderarrivaltime",
            "msdyn_workordercompletiontime",
        ):
            self.assertNotIn(field, workorder_fields)
        self.assertNotIn(
            "msdyn_customerasset", self.schema["entities"]["incidents"]["fields"]
        )

        activity_targets = [
            "accounts",
            "contacts",
            "incidents",
            "leads",
            "opportunities",
            "quotes",
            "salesorders",
            "invoices",
            "msdyn_customerassets",
            "msdyn_workorders",
        ]
        for entity in ("tasks", "emails"):
            fields = self.schema["entities"][entity]["fields"]
            self.assertEqual(
                fields["regardingobjectid"]["lookup"]["targets"], activity_targets
            )
            self.assertEqual(
                fields["regardingobjectidtype"]["discriminator"], activity_targets
            )
        self.assertIn(
            "defaultuomscheduleid",
            self.schema["entities"]["products"]["ui"]["form"],
        )

    def test_nonnegative_numeric_contracts_and_exchange_snapshots_are_generated(
        self,
    ) -> None:
        for entity, definition in self.schema["entities"].items():
            for field, contract in definition["fields"].items():
                if contract["edmType"] == "Edm.Decimal":
                    self.assertEqual(contract.get("minimum"), 0, (entity, field))
        for entity, definition in self.schema["entities"].items():
            if (
                entity != "transactioncurrencies"
                and "transactioncurrencyid" in definition["fields"]
            ):
                self.assertIn("exchangerate", definition["fields"], entity)
                currency_by_id = {
                    item["transactioncurrencyid"]: item
                    for item in self.entities["transactioncurrencies"]
                }
                for record in self.entities[entity]:
                    self.assertEqual(
                        record["exchangerate"],
                        currency_by_id[record["transactioncurrencyid"]][
                            "exchangerate"
                        ],
                        entity,
                    )

    def test_action_metadata_uses_binding_and_output_contracts(self) -> None:
        expected = {
            "GenerateQuote": ("opportunities", "quotes"),
            "ConvertQuoteToSalesOrder": ("quotes", "salesorders"),
            "ConvertSalesOrderToInvoice": ("salesorders", "invoices"),
            "CreateWorkOrder": ("incidents", "msdyn_workorders"),
            "ScheduleWorkOrder": ("msdyn_workorders", "msdyn_workorders"),
        }
        metadata_actions = {
            action["name"]: action for action in self.seed["metadata"]["actions"]
        }
        for action in self.schema["actions"]:
            self.assertNotIn("entitySet", action)
            self.assertIn(action["bindingEntitySet"], self.schema["entities"])
            self.assertIn(action["outputEntitySet"], self.schema["entities"])
            self.assertEqual(metadata_actions[action["name"]], action)
            self.assertTrue(action["targetParameters"])
            self.assertTrue(action["parameters"])
        for name, pair in expected.items():
            action = metadata_actions[name]
            self.assertEqual(
                (action["bindingEntitySet"], action["outputEntitySet"]), pair
            )

    def test_identity_source_shape_fails_closed_before_generation(self) -> None:
        source = json.loads(
            (ROOT / "data" / "source.json").read_text(encoding="utf-8")
        )
        vectors = []
        one_identity = json.loads(json.dumps(source))
        one_identity["identities"] = one_identity["identities"][:1]
        vectors.append(one_identity)
        single_token = json.loads(json.dumps(source))
        single_token["identities"][0]["name"] = "Jordan"
        vectors.append(single_token)
        three_tokens = json.loads(json.dumps(source))
        three_tokens["identities"][0]["name"] = "Jordan Avery Lee"
        vectors.append(three_tokens)
        missing_role = json.loads(json.dumps(source))
        del missing_role["identities"][0]["role"]
        vectors.append(missing_role)
        wrong_role = json.loads(json.dumps(source))
        wrong_role["identities"][6]["role"] = "Sales Representative"
        vectors.append(wrong_role)
        for candidate in vectors:
            with self.subTest(candidate=candidate["identities"][0]):
                with self.assertRaises(build.BuildError):
                    build.build_outputs(candidate)


if __name__ == "__main__":
    unittest.main()
