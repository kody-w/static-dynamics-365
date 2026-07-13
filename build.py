#!/usr/bin/env python3
"""Build deterministic static Dataverse-shaped fixtures using only Python stdlib."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
SOURCE_PATH = ROOT / "data" / "source.json"
SCHEMA_PATH = ROOT / "data" / "schema.json"
API_ROOT = ROOT / "site" / "api" / "data" / "v9.2"
LEGACY_COUNTS = {
    "accounts": 12,
    "contacts": 30,
    "incidents": 24,
    "tasks": 36,
    "emails": 60,
    "connections": 40,
}
with SCHEMA_PATH.open("r", encoding="utf-8") as schema_handle:
    CANONICAL_SCHEMA = json.load(schema_handle)
EXPECTED_COUNTS = {
    name: definition["expectedCount"]
    for name, definition in CANONICAL_SCHEMA["entities"].items()
}
ID_FIELDS = {
    name: definition["key"]
    for name, definition in CANONICAL_SCHEMA["entities"].items()
}
DATE_FIELDS = {
    "createdon",
    "modifiedon",
    "resolveby",
    "firstresponsesenton",
    "scheduledend",
    "actualend",
    "scheduledstart",
    "senton",
    "resolvedon",
    "effectivestart",
    "effectiveend",
    "effectivefrom",
    "effectiveto",
}
for entity_definition in CANONICAL_SCHEMA["entities"].values():
    DATE_FIELDS.update(
        field_name
        for field_name, field_definition in entity_definition["fields"].items()
        if field_definition["edmType"] == "Edm.DateTimeOffset"
    )
UTC_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?"
    r"(?:Z|[+-]\d{2}:\d{2})$"
)
GUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
MAX_SAFE_INTEGER = 9_007_199_254_740_991
EXPECTED_IDENTITY_ROLES = (
    "Customer Service Representative",
    "Customer Service Manager",
    "Support Specialist",
    "Sales Manager",
    "Account Executive",
    "Sales Representative",
    "Field Service Technician",
    "Field Service Technician",
    "Field Service Technician",
    "Field Service Technician",
)
_case_status_labels = {
    option["value"]: option["label"]
    for option in CANONICAL_SCHEMA["entities"]["incidents"]["fields"]["statuscode"][
        "options"
    ]
}
CASE_STATUS_REASONS: dict[int, dict[int, str]] = {}
for _pair in CANONICAL_SCHEMA["entities"]["incidents"]["statusPairs"]:
    CASE_STATUS_REASONS.setdefault(_pair["statecode"], {})[_pair["statuscode"]] = (
        _case_status_labels[_pair["statuscode"]]
    )
STATUS_PAIRS = {
    name: {
        (pair["statecode"], pair["statuscode"])
        for pair in definition["statusPairs"]
    }
    for name, definition in CANONICAL_SCHEMA["entities"].items()
}
REQUIRED = {
    name: {definition["key"], *definition["requiredOnCreate"]}
    for name, definition in CANONICAL_SCHEMA["entities"].items()
}
PROPERTY_SCHEMAS: dict[str, dict[str, dict[str, Any]]] = {
    name: {
        field_name: {
            "type": field_definition["edmType"],
            "nullable": field_definition["nullable"],
            **(
                {"scale": field_definition["scale"]}
                if "scale" in field_definition
                else {}
            ),
            **(
                {"options": field_definition["options"]}
                if "options" in field_definition
                else {}
            ),
        }
        for field_name, field_definition in definition["fields"].items()
    }
    for name, definition in CANONICAL_SCHEMA["entities"].items()
}


class BuildError(ValueError):
    """Raised when deterministic source or generated data is invalid."""


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
        separators=(",", ": "),
    ) + "\n"


def compact_canonical(value: Any) -> str:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def digest(value: Any) -> str:
    payload = value if isinstance(value, bytes) else compact_canonical(value).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def weak_etag(record: dict[str, Any]) -> str:
    clean = {key: value for key, value in record.items() if key != "@odata.etag"}
    return f'W/"{digest(clean)[:24]}"'


def parse_utc(value: str) -> datetime:
    if not isinstance(value, str) or not UTC_PATTERN.fullmatch(value):
        raise BuildError(f"datetime must include an explicit UTC offset: {value!r}")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise BuildError(f"datetime is not a real calendar value: {value!r}") from error
    if parsed.tzinfo is None:
        raise BuildError(f"datetime has no offset: {value!r}")
    return parsed.astimezone(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def record_guid(namespace: uuid.UUID, entity: str, logical_key: str) -> str:
    return str(uuid.uuid5(namespace, f"static-dynamics-365/{entity}/{logical_key}"))


def annotation(field: str) -> str:
    return f"{field}@OData.Community.Display.V1.FormattedValue"


def validate_json_value(value: Any, path: str = "$", seen: set[int] | None = None) -> None:
    if value is None or isinstance(value, (str, bool)):
        return
    if type(value) is int:
        if abs(value) > MAX_SAFE_INTEGER:
            raise BuildError(f"{path} exceeds the JSON safe-integer range")
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise BuildError(f"{path} must be a finite JSON number")
        return
    if seen is None:
        seen = set()
    if isinstance(value, list):
        identity = id(value)
        if identity in seen:
            raise BuildError(f"{path} contains a recursive list")
        seen.add(identity)
        for index, item in enumerate(value):
            validate_json_value(item, f"{path}[{index}]", seen)
        seen.remove(identity)
        return
    if isinstance(value, dict):
        identity = id(value)
        if identity in seen:
            raise BuildError(f"{path} contains a recursive object")
        seen.add(identity)
        for key, item in value.items():
            if not isinstance(key, str):
                raise BuildError(f"{path} contains a non-string object key")
            validate_json_value(item, f"{path}.{key}", seen)
        seen.remove(identity)
        return
    raise BuildError(f"{path} contains non-JSON value of type {type(value).__name__}")


def require_object(
    value: Any, path: str, fields: set[str]
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        raise BuildError(f"{path} fields do not match the source contract")
    return value


def require_string(value: Any, path: str, *, maximum: int = 200) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise BuildError(f"{path} must be a non-empty trimmed string")
    if len(value) > maximum:
        raise BuildError(f"{path} is longer than {maximum} characters")
    return value


def require_index(value: Any, path: str, size: int) -> int:
    if type(value) is not int or not 0 <= value < size:
        raise BuildError(f"{path} must be an integer index from 0 through {size - 1}")
    return value


def validate_source(source: dict[str, Any]) -> None:
    validate_json_value(source)
    require_object(
        source,
        "source",
        {"epoch", "namespace", "tenant", "identities", "accounts", "contacts", "cases"},
    )
    require_string(source["epoch"], "source.epoch", maximum=40)
    epoch = parse_utc(source["epoch"])
    if iso(epoch) != source["epoch"]:
        raise BuildError("epoch must be canonical UTC with millisecond precision")
    namespace = require_string(source["namespace"], "source.namespace", maximum=36)
    try:
        parsed_namespace = uuid.UUID(namespace)
    except (ValueError, AttributeError) as error:
        raise BuildError("namespace must be a UUID") from error
    if str(parsed_namespace) != namespace:
        raise BuildError("namespace must be a canonical lowercase UUID")
    tenant = require_object(
        source["tenant"],
        "source.tenant",
        {"name", "organizationUrl", "organizationVersion"},
    )
    name = require_string(tenant["name"], "source.tenant.name")
    organization_url = require_string(
        tenant["organizationUrl"], "source.tenant.organizationUrl"
    )
    version = require_string(
        tenant["organizationVersion"], "source.tenant.organizationVersion", maximum=40
    )
    if name != "Aster Lane Office Systems":
        raise BuildError("tenant name does not match the public fixture contract")
    if organization_url != "https://crm.asterlane.example":
        raise BuildError("organization URL does not match the public fixture contract")
    if not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", version):
        raise BuildError("organization version must contain four numeric components")
    identities = source["identities"]
    if not isinstance(identities, list) or len(identities) != len(
        EXPECTED_IDENTITY_ROLES
    ):
        raise BuildError(
            "source must define exactly 10 identities: 3 service owners, "
            "3 sellers, and 4 technicians"
        )
    identity_names: set[str] = set()
    for index, value in enumerate(identities):
        item = require_object(value, f"source.identities[{index}]", {"name", "role"})
        identity_name = require_string(item["name"], f"source.identities[{index}].name")
        if not re.fullmatch(r"[^\s]+ [^\s]+", identity_name):
            raise BuildError(
                f"source.identities[{index}].name must contain exactly two tokens"
            )
        role = require_string(item["role"], f"source.identities[{index}].role")
        if role != EXPECTED_IDENTITY_ROLES[index]:
            raise BuildError(
                f"source.identities[{index}].role must be "
                f"{EXPECTED_IDENTITY_ROLES[index]!r}"
            )
        if identity_name in identity_names:
            raise BuildError(f"duplicate identity name: {identity_name}")
        identity_names.add(identity_name)
    accounts = source["accounts"]
    contacts = source["contacts"]
    cases = source["cases"]
    if not isinstance(accounts, list) or len(accounts) != EXPECTED_COUNTS["accounts"]:
        raise BuildError("source must define exactly 12 accounts")
    if not isinstance(contacts, list) or len(contacts) != EXPECTED_COUNTS["contacts"]:
        raise BuildError("source must define exactly 30 contacts")
    if not isinstance(cases, list) or len(cases) != EXPECTED_COUNTS["incidents"]:
        raise BuildError("source must define exactly 24 cases")
    domains: set[str] = set()
    for index, row in enumerate(accounts):
        if not isinstance(row, list) or len(row) != 6:
            raise BuildError(f"account source row {index} is malformed")
        name, domain, city, region, postal, industry = row
        require_string(name, f"source.accounts[{index}][0]")
        require_string(domain, f"source.accounts[{index}][1]", maximum=253)
        require_string(city, f"source.accounts[{index}][2]")
        require_string(region, f"source.accounts[{index}][3]", maximum=2)
        require_string(postal, f"source.accounts[{index}][4]", maximum=10)
        require_string(industry, f"source.accounts[{index}][5]")
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.example", domain):
            raise BuildError(f"account source domain must end in .example: {domain!r}")
        if not re.fullmatch(r"[A-Z]{2}", region):
            raise BuildError(f"account source region is invalid at row {index}")
        if not re.fullmatch(r"\d{5}", postal):
            raise BuildError(f"account source postal code is invalid at row {index}")
        if domain in domains:
            raise BuildError(f"duplicate account domain: {domain}")
        domains.add(domain)
    for index, row in enumerate(contacts):
        if not isinstance(row, list) or len(row) != 4:
            raise BuildError(f"contact source row {index} is malformed")
        require_string(row[0], f"source.contacts[{index}][0]", maximum=80)
        require_string(row[1], f"source.contacts[{index}][1]", maximum=80)
        require_index(row[2], f"source.contacts[{index}][2]", len(accounts))
        require_string(row[3], f"source.contacts[{index}][3]")
    for index, row in enumerate(cases):
        if not isinstance(row, list) or len(row) != 7:
            raise BuildError(f"case source row {index} is malformed")
        require_string(row[0], f"source.cases[{index}][0]")
        require_index(row[1], f"source.cases[{index}][1]", len(accounts))
        require_index(row[2], f"source.cases[{index}][2]", len(contacts))
        if any(type(row[position]) is not int for position in range(3, 7)):
            raise BuildError(f"case source numeric values must be integers at row {index}")
        if row[3] not in {0, 1, 2} or row[4] not in {0, 1, 2} or row[5] not in {0, 1, 2}:
            raise BuildError(f"case source option value is invalid at row {index}")
        if row[6] not in {0, 1, 2}:
            raise BuildError(f"case source state is invalid at row {index}")
    forbidden = [
        "ra" + "pp" + "terbook",
        "ra" + "pp" + "-static-apis",
        "zi" + "on",
        "ko" + "dy" + "-w",
        "new" + "_",
        "state" + "_io",
        "ra" + "pp" + "terbook.ai",
        "service" + "Worker",
    ]
    lowered = compact_canonical(source).lower()
    leaked = [term for term in forbidden if term.lower() in lowered]
    if leaked:
        raise BuildError(f"source contains forbidden source-specific terms: {', '.join(leaked)}")


def build_records(source: dict[str, Any]) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    namespace = uuid.UUID(source["namespace"])
    epoch = parse_utc(source["epoch"])
    identity_records = [
        {
            "systemuserid": record_guid(namespace, "systemusers", str(index)),
            "fullname": item["name"],
            "title": item["role"],
        }
        for index, item in enumerate(source["identities"])
    ]
    service_identities = identity_records[:3]

    accounts: list[dict[str, Any]] = []
    for index, (name, domain, city, region, postal, industry) in enumerate(source["accounts"]):
        owner = service_identities[index % len(service_identities)]
        account_id = record_guid(namespace, "accounts", str(index))
        created = epoch - timedelta(days=500 - index * 17, hours=index % 5)
        modified = created + timedelta(days=80 + index * 3)
        record = {
            "accountid": account_id,
            "name": name,
            "accountnumber": f"AST-{1001 + index:04d}",
            "telephone1": f"+1-202-555-{100 + index:04d}",
            "emailaddress1": f"hello@{domain}",
            "websiteurl": f"https://www.{domain}",
            "address1_line1": f"{120 + index * 37} Market Street",
            "address1_city": city,
            "address1_stateorprovince": region,
            "address1_postalcode": postal,
            "address1_country": "United States",
            "industrycode": industry,
            "description": f"{name} is a synthetic customer organization used for product evaluation.",
            "statecode": 0,
            "statuscode": 1,
            "ownerid": owner["systemuserid"],
            "owneridname": owner["fullname"],
            "createdon": iso(created),
            "modifiedon": iso(modified),
        }
        record[annotation("ownerid")] = owner["fullname"]
        accounts.append(record)

    contacts: list[dict[str, Any]] = []
    for index, (first, last, account_index, job_title) in enumerate(source["contacts"]):
        owner = service_identities[(index + 1) % len(service_identities)]
        account = accounts[account_index]
        domain = source["accounts"][account_index][1]
        created = epoch - timedelta(days=420 - index * 7, hours=index % 9)
        modified = created + timedelta(days=35 + index)
        record = {
            "contactid": record_guid(namespace, "contacts", str(index)),
            "firstname": first,
            "lastname": last,
            "fullname": f"{first} {last}",
            "emailaddress1": f"{first.lower()}.{last.lower()}@{domain}",
            "telephone1": f"+1-202-555-{120 + index:04d}",
            "jobtitle": job_title,
            "parentcustomerid": account["accountid"],
            "parentcustomeridname": account["name"],
            "address1_city": account["address1_city"],
            "address1_stateorprovince": account["address1_stateorprovince"],
            "preferredcontactmethodcode": 2 if index % 3 else 3,
            "statecode": 0 if index not in {11, 23} else 1,
            "statuscode": 1 if index not in {11, 23} else 2,
            "ownerid": owner["systemuserid"],
            "owneridname": owner["fullname"],
            "createdon": iso(created),
            "modifiedon": iso(modified),
        }
        record[annotation("parentcustomerid")] = account["name"]
        record[annotation("ownerid")] = owner["fullname"]
        contacts.append(record)

    for account in accounts:
        primary_contact = next(
            contact
            for contact in contacts
            if contact["parentcustomerid"] == account["accountid"]
        )
        account["primarycontactid"] = primary_contact["contactid"]
        account["primarycontactidname"] = primary_contact["fullname"]
        account[annotation("primarycontactid")] = primary_contact["fullname"]

    priority_labels = {1: "High", 2: "Normal", 3: "Low"}
    origin_labels = {1: "Phone", 2: "Email", 3: "Web"}
    type_labels = {1: "Question", 2: "Problem", 3: "Request"}
    case_state_labels = {0: "Active", 1: "Resolved", 2: "Canceled"}
    incidents: list[dict[str, Any]] = []
    for index, (title, account_index, contact_index, priority, origin, case_type, state) in enumerate(source["cases"]):
        account = accounts[account_index]
        contact = contacts[contact_index]
        owner = service_identities[index % len(service_identities)]
        created = epoch - timedelta(days=44 - index, hours=index % 8)
        if state == 0:
            statecode, statuscode = 0, 1
            resolved_on = None
        elif state == 1:
            statecode, statuscode = 1, 1000 if index % 2 else 5
            resolved_on = iso(created + timedelta(days=2, hours=4))
        else:
            statecode, statuscode = 2, 2000 if index % 2 else 6
            resolved_on = iso(created + timedelta(days=1, hours=2))
        customer_is_contact = index % 4 == 3
        customer_id = contact["contactid"] if customer_is_contact else account["accountid"]
        customer_name = contact["fullname"] if customer_is_contact else account["name"]
        customer_type = "contacts" if customer_is_contact else "accounts"
        priority_code = priority + 1
        origin_code = origin + 1
        type_code = case_type + 1
        record = {
            "incidentid": record_guid(namespace, "incidents", str(index)),
            "ticketnumber": f"CAS-{260100 + index:06d}",
            "title": title,
            "description": f"Customer reported: {title.lower()}. Follow-up details are entirely synthetic.",
            "customerid": customer_id,
            "customeridname": customer_name,
            "customeridtype": customer_type,
            "primarycontactid": contact["contactid"],
            "primarycontactidname": contact["fullname"],
            "prioritycode": priority_code,
            "caseorigincode": origin_code,
            "casetypecode": type_code,
            "statecode": statecode,
            "statuscode": statuscode,
            "ownerid": owner["systemuserid"],
            "owneridname": owner["fullname"],
            "createdon": iso(created),
            "modifiedon": resolved_on or iso(created + timedelta(hours=5 + index % 7)),
            "resolveby": iso(created + timedelta(days=3 if priority_code == 1 else 6)),
            "firstresponsesenton": iso(created + timedelta(hours=2 + index % 6)),
            "resolvedon": resolved_on,
        }
        for field, value in (
            ("customerid", customer_name),
            ("primarycontactid", contact["fullname"]),
            ("ownerid", owner["fullname"]),
            ("prioritycode", priority_labels[priority_code]),
            ("caseorigincode", origin_labels[origin_code]),
            ("casetypecode", type_labels[type_code]),
            ("statecode", case_state_labels[statecode]),
            ("statuscode", CASE_STATUS_REASONS[statecode][statuscode]),
        ):
            record[annotation(field)] = value
        incidents.append(record)

    tasks: list[dict[str, Any]] = []
    task_subjects = (
        "Confirm customer availability",
        "Review service notes",
        "Prepare follow-up summary",
        "Verify replacement inventory",
        "Call customer with update",
        "Document resolution steps",
    )
    for index in range(EXPECTED_COUNTS["tasks"]):
        incident = incidents[index % len(incidents)]
        owner = service_identities[(index + 2) % len(service_identities)]
        created = epoch - timedelta(days=25 - index // 2, hours=index % 10)
        due = epoch + timedelta(days=index - 17, hours=(index % 5) - 2)
        mode = index % 6
        if mode in {2, 4}:
            statecode, statuscode = 1, 5
            actual_end = iso(min(due, epoch - timedelta(hours=index % 8)))
        elif mode == 5:
            statecode, statuscode = 2, 6
            actual_end = iso(created + timedelta(hours=3))
        else:
            statecode, statuscode = 0, 3 if mode == 1 else 2
            actual_end = None
        record = {
            "activityid": record_guid(namespace, "tasks", str(index)),
            "subject": f"{task_subjects[index % len(task_subjects)]} — {incident['ticketnumber']}",
            "description": "Synthetic service follow-up activity.",
            "regardingobjectid": incident["incidentid"],
            "regardingobjectidname": incident["title"],
            "regardingobjectidtype": "incidents",
            "scheduledend": iso(due),
            "actualend": actual_end,
            "prioritycode": 1 if index % 7 == 0 else 2,
            "percentcomplete": 100 if statecode == 1 else 0,
            "statecode": statecode,
            "statuscode": statuscode,
            "ownerid": owner["systemuserid"],
            "owneridname": owner["fullname"],
            "createdon": iso(created),
            "modifiedon": actual_end or iso(created + timedelta(hours=2)),
        }
        record[annotation("regardingobjectid")] = incident["title"]
        record[annotation("ownerid")] = owner["fullname"]
        tasks.append(record)

    emails: list[dict[str, Any]] = []
    email_topics = (
        "Service request received",
        "Additional details",
        "Scheduling confirmation",
        "Progress update",
        "Replacement dispatch notice",
        "Resolution summary",
    )
    support_address = "support@crm.asterlane.example"
    for index in range(EXPECTED_COUNTS["emails"]):
        incident = incidents[index % len(incidents)]
        contact = contacts[source["cases"][index % len(incidents)][2]]
        owner = service_identities[index % len(service_identities)]
        sent = index % 2 == 0
        occurred = epoch - timedelta(days=30 - index // 2, hours=index % 12)
        sender_id = owner["systemuserid"] if sent else contact["contactid"]
        sender_name = owner["fullname"] if sent else contact["fullname"]
        sender_type = "systemusers" if sent else "contacts"
        recipient_id = contact["contactid"] if sent else owner["systemuserid"]
        recipient_name = contact["fullname"] if sent else owner["fullname"]
        recipient_type = "contacts" if sent else "systemusers"
        record = {
            "activityid": record_guid(namespace, "emails", str(index)),
            "subject": f"{email_topics[index % len(email_topics)]}: {incident['ticketnumber']}",
            "description": "Synthetic message body for deterministic customer service testing.",
            "directioncode": sent,
            "fromaddress": support_address if sent else contact["emailaddress1"],
            "fromname": sender_name,
            "toaddress": contact["emailaddress1"] if sent else support_address,
            "toname": recipient_name,
            "senderid": sender_id,
            "senderidname": sender_name,
            "senderidtype": sender_type,
            "recipientid": recipient_id,
            "recipientidname": recipient_name,
            "recipientidtype": recipient_type,
            "regardingobjectid": incident["incidentid"],
            "regardingobjectidname": incident["title"],
            "regardingobjectidtype": "incidents",
            "scheduledstart": iso(occurred - timedelta(minutes=8)),
            "senton": iso(occurred),
            "statecode": 1,
            "statuscode": 3 if sent else 4,
            "ownerid": owner["systemuserid"],
            "owneridname": owner["fullname"],
            "createdon": iso(occurred - timedelta(minutes=10)),
            "modifiedon": iso(occurred),
        }
        for field, value in (
            ("senderid", sender_name),
            ("recipientid", recipient_name),
            ("regardingobjectid", incident["title"]),
            ("ownerid", owner["fullname"]),
        ):
            record[annotation(field)] = value
        emails.append(record)

    connections: list[dict[str, Any]] = []
    roles = (
        ("Colleague", "Colleague"),
        ("Mentor", "Associate"),
        ("Project partner", "Project partner"),
        ("Service liaison", "Customer contact"),
    )
    for pair_index in range(20):
        left_index = pair_index % len(contacts)
        right_index = (pair_index * 7 + 5) % len(contacts)
        if left_index == right_index:
            right_index = (right_index + 1) % len(contacts)
        left, right = contacts[left_index], contacts[right_index]
        left_role, right_role = roles[pair_index % len(roles)]
        started = epoch - timedelta(days=240 - pair_index * 5)
        pair_id = record_guid(namespace, "connectionpairs", str(pair_index))
        for direction, (record1, record2, role1, role2) in enumerate(
            ((left, right, left_role, right_role), (right, left, right_role, left_role))
        ):
            record = {
                "connectionid": record_guid(
                    namespace, "connections", f"{pair_index}-{direction}"
                ),
                "connectionpairid": pair_id,
                "record1id": record1["contactid"],
                "record1idname": record1["fullname"],
                "record1type": "contacts",
                "record2id": record2["contactid"],
                "record2idname": record2["fullname"],
                "record2type": "contacts",
                "record1roleidname": role1,
                "record2roleidname": role2,
                "description": "Synthetic professional relationship.",
                "effectivestart": iso(started),
                "effectiveend": None,
                "statecode": 0,
                "statuscode": 1,
                "ownerid": service_identities[pair_index % len(service_identities)]["systemuserid"],
                "owneridname": service_identities[pair_index % len(service_identities)]["fullname"],
                "createdon": iso(started),
                "modifiedon": iso(started),
            }
            record[annotation("record1id")] = record1["fullname"]
            record[annotation("record2id")] = record2["fullname"]
            record[annotation("ownerid")] = record["owneridname"]
            connections.append(record)

    entities = {
        "accounts": accounts,
        "contacts": contacts,
        "incidents": incidents,
        "tasks": tasks,
        "emails": emails,
        "connections": connections,
    }
    entities.update(build_expanded_records(source, entities, identity_records))
    finalize_records(entities)
    return entities, identity_records


MONEY_QUANTUM = Decimal("0.01")


def decimal_text(value: Decimal | str | int, scale: int = 2) -> str:
    quantum = Decimal(1).scaleb(-scale)
    return format(Decimal(value).quantize(quantum, rounding=ROUND_HALF_UP), f".{scale}f")


def line_amounts(
    quantity: str, price: str, discount: str = "0.00", tax: str = "0.00"
) -> tuple[str, str]:
    base = (Decimal(quantity) * Decimal(price)).quantize(
        MONEY_QUANTUM, rounding=ROUND_HALF_UP
    )
    extended = (base - Decimal(discount) + Decimal(tax)).quantize(
        MONEY_QUANTUM, rounding=ROUND_HALF_UP
    )
    return decimal_text(base), decimal_text(extended)


def seeded_base(
    entity: str,
    namespace: uuid.UUID,
    epoch: datetime,
    owner: dict[str, Any],
    index: int,
    *,
    statecode: int = 0,
    statuscode: int = 1,
) -> dict[str, Any]:
    definition = CANONICAL_SCHEMA["entities"][entity]
    fields = definition["fields"]
    created = epoch - timedelta(days=180 - index % 120, hours=index % 11)
    record: dict[str, Any] = {
        definition["key"]: record_guid(namespace, entity, str(index))
    }
    if "ownerid" in fields:
        record["ownerid"] = owner["systemuserid"]
        record["owneridname"] = owner["fullname"]
    if "createdon" in fields:
        record["createdon"] = iso(created)
    if "modifiedon" in fields:
        record["modifiedon"] = iso(created + timedelta(hours=2 + index % 7))
    if "statecode" in fields:
        record["statecode"] = statecode
    if "statuscode" in fields:
        record["statuscode"] = statuscode
    return record


def build_expanded_records(
    source: dict[str, Any],
    legacy: dict[str, list[dict[str, Any]]],
    identities: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    namespace = uuid.UUID(source["namespace"])
    epoch = parse_utc(source["epoch"])
    service_users = identities[:3]
    sellers = identities[3:6]
    technicians = identities[6:10]
    business_unit_id = record_guid(namespace, "businessunits", "aster-lane")
    organization_id = record_guid(namespace, "organizations", "aster-lane")
    expanded: dict[str, list[dict[str, Any]]] = {}

    businessunits = [
        {
            "businessunitid": business_unit_id,
            "name": "Aster Lane Office Systems",
            "parentbusinessunitid": None,
            "parentbusinessunitidname": None,
            "isdisabled": False,
            "createdon": iso(epoch - timedelta(days=900)),
            "modifiedon": iso(epoch - timedelta(days=90)),
        }
    ]
    expanded["businessunits"] = businessunits

    systemusers = []
    for index, (identity, source_identity) in enumerate(
        zip(identities, source["identities"])
    ):
        first, last = source_identity["name"].split(" ", 1)
        created = epoch - timedelta(days=700 - index * 19)
        systemusers.append(
            {
                "systemuserid": identity["systemuserid"],
                "fullname": identity["fullname"],
                "firstname": first,
                "lastname": last,
                "title": identity["title"],
                "internalemailaddress": (
                    f"{first.lower()}.{last.lower()}@crm.asterlane.example"
                ),
                "businessunitid": business_unit_id,
                "businessunitidname": source["tenant"]["name"],
                "isdisabled": False,
                "accessmode": 4 if index == 2 else 0,
                "createdon": iso(created),
                "modifiedon": iso(created + timedelta(days=20)),
            }
        )
    expanded["systemusers"] = systemusers

    currency_rows = (
        ("US Dollar", "USD", "$", "1.000000", 0, 1),
        ("Canadian Dollar", "CAD", "C$", "1.348500", 0, 1),
        ("Euro", "EUR", "€", "0.918400", 0, 1),
        ("Legacy US Dollar", "USD", "$", "1.000000", 1, 2),
    )
    currencies = []
    for index, (name, code, symbol, rate, state, status) in enumerate(currency_rows):
        record = seeded_base(
            "transactioncurrencies",
            namespace,
            epoch,
            service_users[0],
            index,
            statecode=state,
            statuscode=status,
        )
        record.update(
            currencyname=name,
            isocurrencycode=code,
            currencysymbol=symbol,
            currencyprecision=2,
            exchangerate=rate,
        )
        currencies.append(record)
    expanded["transactioncurrencies"] = currencies
    usd = currencies[0]

    schedules = []
    schedule = seeded_base(
        "uomschedules", namespace, epoch, service_users[0], 0
    )
    schedule.update(name="Default Unit", description="Synthetic default unit group.")
    schedules.append(schedule)
    expanded["uomschedules"] = schedules
    uoms = []
    unit = seeded_base("uoms", namespace, epoch, service_users[0], 0)
    unit.update(
        name="Primary Unit",
        uomscheduleid=schedule["uomscheduleid"],
        uomscheduleidname=schedule["name"],
        quantity="1.00",
        baseuom=None,
        baseuomidname=None,
    )
    uoms.append(unit)
    expanded["uoms"] = uoms

    product_rows = (
        ("AsterPrint M420", "AST-PRN-420", "Network monochrome printer", 1, "849.00", "510.00"),
        ("AsterPrint C620", "AST-PRN-620", "Network color printer", 1, "1299.00", "780.00"),
        ("ScanDock S12", "AST-SCN-012", "Desktop document scanner", 1, "459.00", "275.00"),
        ("Mobile Cart M8", "AST-CRT-008", "Secure mobile workstation cart", 1, "725.00", "435.00"),
        ("Sensor Kit K4", "AST-SEN-004", "Office environment sensor kit", 1, "389.00", "225.00"),
        ("Finisher F2", "AST-FIN-002", "Printer finishing module", 1, "549.00", "330.00"),
        ("Toner Pack Black", "AST-TNR-BLK", "High-yield black toner", 1, "119.00", "70.00"),
        ("Toner Pack Color", "AST-TNR-CLR", "Color toner multipack", 1, "289.00", "170.00"),
        ("On-site Diagnosis", "AST-SVC-DIA", "On-site diagnostic service", 3, "175.00", "90.00"),
        ("Preventive Maintenance", "AST-SVC-PM", "Preventive maintenance visit", 3, "245.00", "125.00"),
        ("Installation Service", "AST-SVC-INS", "Equipment installation service", 3, "325.00", "170.00"),
        ("Remote Configuration", "AST-SVC-REM", "Remote configuration session", 3, "135.00", "65.00"),
    )
    products = []
    for index, (name, number, description, product_type, price, cost) in enumerate(
        product_rows
    ):
        record = seeded_base("products", namespace, epoch, sellers[index % 3], index)
        record.update(
            name=name,
            productnumber=number,
            description=description,
            defaultuomid=unit["uomid"],
            defaultuomidname=unit["name"],
            defaultuomscheduleid=schedule["uomscheduleid"],
            defaultuomscheduleidname=schedule["name"],
            quantitydecimal=2,
            productstructure=1,
            producttypecode=product_type,
            currentcost=cost,
            price=price,
            transactioncurrencyid=usd["transactioncurrencyid"],
            transactioncurrencyidname=usd["currencyname"],
        )
        products.append(record)
    expanded["products"] = products

    price_list_rows = (
        ("US Standard Price List", 0, 1, 0),
        ("US Preferred Customer Price List", 0, 1, 0),
        ("Canadian Standard Price List", 0, 1, 1),
        ("Legacy Price List", 1, 2, 3),
    )
    pricelevels = []
    for index, (name, state, status, currency_index) in enumerate(price_list_rows):
        record = seeded_base(
            "pricelevels",
            namespace,
            epoch,
            sellers[index % 3],
            index,
            statecode=state,
            statuscode=status,
        )
        currency = currencies[currency_index]
        record.update(
            name=name,
            begindate=iso(epoch - timedelta(days=365)),
            enddate=None if state == 0 else iso(epoch - timedelta(days=30)),
            description="Deterministic synthetic catalog price list.",
            transactioncurrencyid=currency["transactioncurrencyid"],
            transactioncurrencyidname=currency["currencyname"],
        )
        pricelevels.append(record)
    expanded["pricelevels"] = pricelevels

    product_prices = []
    for price_index, price_list in enumerate(pricelevels):
        currency = currencies[price_list_rows[price_index][3]]
        for product_index, product in enumerate(products):
            base = Decimal(product["price"])
            multiplier = (Decimal("1.00"), Decimal("0.92"), Decimal("1.35"), Decimal("0.88"))[
                price_index
            ]
            record = seeded_base(
                "productpricelevels",
                namespace,
                epoch,
                sellers[product_index % 3],
                price_index * len(products) + product_index,
                statecode=price_list["statecode"],
                statuscode=price_list["statuscode"],
            )
            record.update(
                productid=product["productid"],
                productidname=product["name"],
                pricelevelid=price_list["pricelevelid"],
                pricelevelidname=price_list["name"],
                uomid=unit["uomid"],
                uomidname=unit["name"],
                amount=decimal_text(base * multiplier),
                pricingmethodcode=1,
                quantitysellingcode=3,
                roundingpolicycode=0,
                transactioncurrencyid=currency["transactioncurrencyid"],
                transactioncurrencyidname=currency["currencyname"],
            )
            product_prices.append(record)
    expanded["productpricelevels"] = product_prices

    accounts = legacy["accounts"]
    contacts = legacy["contacts"]
    lead_topics = (
        "Managed print fleet refresh",
        "Document capture modernization",
        "Mobile workstation expansion",
        "Preventive maintenance program",
        "Secure print rollout",
        "Office sensor deployment",
    )
    leads = []
    for index in range(24):
        account = accounts[index % len(accounts)]
        contact = contacts[(index * 2) % len(contacts)]
        if index < 15:
            state, status = 1, 3
        elif index < 20:
            state, status = 0, 1 if index % 2 else 2
        else:
            state, status = 2, 4 + (index % 4)
        record = seeded_base(
            "leads",
            namespace,
            epoch,
            sellers[index % 3],
            index,
            statecode=state,
            statuscode=status,
        )
        record.update(
            subject=lead_topics[index % len(lead_topics)],
            firstname=contact["firstname"],
            lastname=contact["lastname"],
            fullname=contact["fullname"],
            companyname=account["name"],
            emailaddress1=contact["emailaddress1"],
            telephone1=contact["telephone1"],
            description="Synthetic Sales Hub prospect fixture.",
            parentaccountid=account["accountid"],
            parentaccountidname=account["name"],
            parentcontactid=contact["contactid"],
            parentcontactidname=contact["fullname"],
            qualifyingopportunityid=None,
            qualifyingopportunityidname=None,
            estimatedamount=decimal_text(Decimal(4200 + index * 375)),
            estimatedclosedate=iso(epoch + timedelta(days=14 + index * 3)),
            leadqualitycode=1 + index % 3,
            transactioncurrencyid=usd["transactioncurrencyid"],
            transactioncurrencyidname=usd["currencyname"],
        )
        leads.append(record)
    expanded["leads"] = leads

    opportunities = []
    for index in range(15):
        account = accounts[index % len(accounts)]
        contact = contacts[(index * 2) % len(contacts)]
        if index < 7:
            state, status, actual_value, actual_close = 0, (1 if index % 3 else 2), None, None
        elif index < 11:
            state, status = 1, 3
            actual_value = decimal_text(Decimal(7500 + index * 600))
            actual_close = iso(epoch - timedelta(days=18 - index))
        else:
            state, status = 2, 4 if index % 2 else 5
            actual_value = decimal_text(0)
            actual_close = iso(epoch - timedelta(days=16 - index))
        record = seeded_base(
            "opportunities",
            namespace,
            epoch,
            sellers[index % 3],
            index,
            statecode=state,
            statuscode=status,
        )
        record.update(
            name=f"{account['name']} — {lead_topics[index % len(lead_topics)]}",
            description="Qualified synthetic sales opportunity.",
            customerid=account["accountid"],
            customeridname=account["name"],
            customeridtype="accounts",
            parentaccountid=account["accountid"],
            parentaccountidname=account["name"],
            parentcontactid=contact["contactid"],
            parentcontactidname=contact["fullname"],
            originatingleadid=leads[index]["leadid"],
            originatingleadidname=leads[index]["fullname"],
            pricelevelid=pricelevels[index % 2]["pricelevelid"],
            pricelevelidname=pricelevels[index % 2]["name"],
            transactioncurrencyid=usd["transactioncurrencyid"],
            transactioncurrencyidname=usd["currencyname"],
            estimatedvalue=leads[index]["estimatedamount"],
            actualvalue=actual_value,
            estimatedclosedate=leads[index]["estimatedclosedate"],
            actualclosedate=actual_close,
            closeprobability=(30 + index * 5) if state == 0 else (100 if state == 1 else 0),
            salesstagecode=min(4, 1 + index % 4),
            stepname=("Qualify", "Develop", "Propose", "Close")[index % 4],
            totallineitemamount="0.00",
            totaldiscountamount="0.00",
            totaltax="0.00",
            totalamount="0.00",
        )
        opportunities.append(record)
        leads[index]["qualifyingopportunityid"] = record["opportunityid"]
        leads[index]["qualifyingopportunityidname"] = record["name"]
    expanded["opportunities"] = opportunities

    opportunityproducts = []
    line_ordinal = 0
    for opportunity_index, opportunity in enumerate(opportunities):
        line_count = 3 if opportunity_index % 5 in {0, 2} else 2
        for local_index in range(line_count):
            product = products[(opportunity_index + local_index) % 8]
            quantity_value = decimal_text(1 + (opportunity_index + local_index) % 3)
            preferred = opportunity_index % 2
            price = product_prices[preferred * len(products) + products.index(product)]["amount"]
            discount = decimal_text(
                Decimal("25.00") if local_index == 1 and opportunity_index % 3 == 0 else 0
            )
            tax = decimal_text(Decimal("0.00"))
            base_amount, extended = line_amounts(quantity_value, price, discount, tax)
            record = seeded_base(
                "opportunityproducts",
                namespace,
                epoch,
                sellers[opportunity_index % 3],
                line_ordinal,
            )
            record.update(
                opportunityid=opportunity["opportunityid"],
                opportunityidname=opportunity["name"],
                productid=product["productid"],
                productidname=product["name"],
                uomid=unit["uomid"],
                uomidname=unit["name"],
                quantity=quantity_value,
                priceperunit=price,
                baseamount=base_amount,
                manualdiscountamount=discount,
                tax=tax,
                extendedamount=extended,
                ispriceoverridden=False,
                lineitemnumber=local_index + 1,
                description=product["description"],
                transactioncurrencyid=usd["transactioncurrencyid"],
                transactioncurrencyidname=usd["currencyname"],
            )
            opportunityproducts.append(record)
            line_ordinal += 1
    if len(opportunityproducts) != EXPECTED_COUNTS["opportunityproducts"]:
        raise BuildError("opportunity product distribution is not exactly 36")
    expanded["opportunityproducts"] = opportunityproducts
    rollup_document_totals(opportunities, opportunityproducts, "opportunityid")

    quotes = []
    quote_states = (
        (2, 3),
        (3, 6),
        (1, 2),
        (1, 2),
        (0, 1),
        (0, 1),
        (2, 3),
        (3, 4),
        (1, 2),
        (0, 1),
        (3, 5),
        (0, 1),
    )
    for index, opportunity in enumerate(opportunities[:12]):
        record = seeded_base(
            "quotes",
            namespace,
            epoch,
            sellers[index % 3],
            index,
            statecode=quote_states[index][0],
            statuscode=quote_states[index][1],
        )
        record.update(
            name=f"Proposal for {opportunity['customeridname']}",
            quotenumber=f"QUO-{260100 + index:06d}",
            customerid=opportunity["customerid"],
            customeridname=opportunity["customeridname"],
            customeridtype=opportunity["customeridtype"],
            pricelevelid=opportunity["pricelevelid"],
            pricelevelidname=opportunity["pricelevelidname"],
            transactioncurrencyid=opportunity["transactioncurrencyid"],
            transactioncurrencyidname=opportunity["transactioncurrencyidname"],
            description="Deterministic proposal snapshot.",
            freightamount=decimal_text(45 if index % 3 == 0 else 0),
            discountamount=decimal_text(100 if index % 4 == 0 else 0),
            totallineitemamount="0.00",
            totaldiscountamount="0.00",
            totaltax="0.00",
            totalamount="0.00",
            effectivefrom=iso(epoch - timedelta(days=12 - index)),
            effectiveto=iso(epoch + timedelta(days=18 + index)),
            opportunityid=opportunity["opportunityid"],
            opportunityidname=opportunity["name"],
            revisionnumber=1,
        )
        quotes.append(record)
    expanded["quotes"] = quotes

    quotedetails = []
    quote_line_counts = (3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2)
    line_ordinal = 0
    for quote_index, (quote, line_count) in enumerate(zip(quotes, quote_line_counts)):
        source_lines = [
            row
            for row in opportunityproducts
            if row["opportunityid"] == quote["opportunityid"]
        ]
        for local_index in range(line_count):
            source_line = source_lines[local_index % len(source_lines)]
            record = seeded_base(
                "quotedetails",
                namespace,
                epoch,
                sellers[quote_index % 3],
                line_ordinal,
            )
            record.update(
                quoteid=quote["quoteid"],
                quoteidname=quote["name"],
                productid=source_line["productid"],
                productidname=source_line["productidname"],
                uomid=source_line["uomid"],
                uomidname=source_line["uomidname"],
                quantity=source_line["quantity"],
                priceperunit=source_line["priceperunit"],
                baseamount=source_line["baseamount"],
                manualdiscountamount=source_line["manualdiscountamount"],
                tax=source_line["tax"],
                extendedamount=source_line["extendedamount"],
                ispriceoverridden=source_line["ispriceoverridden"],
                lineitemnumber=local_index + 1,
                description=source_line["description"],
                transactioncurrencyid=quote["transactioncurrencyid"],
                transactioncurrencyidname=quote["transactioncurrencyidname"],
            )
            quotedetails.append(record)
            line_ordinal += 1
    expanded["quotedetails"] = quotedetails
    rollup_document_totals(quotes, quotedetails, "quoteid")

    salesorders = []
    order_states = ((3, 6), (3, 6), (1, 4), (0, 3), (0, 2), (2, 5))
    for index, quote in enumerate(quotes[:6]):
        opportunity = opportunities[index]
        state, status = order_states[index]
        record = seeded_base(
            "salesorders",
            namespace,
            epoch,
            sellers[index % 3],
            index,
            statecode=state,
            statuscode=status,
        )
        record.update(
            name=f"Order for {quote['customeridname']}",
            ordernumber=f"ORD-{260100 + index:06d}",
            customerid=quote["customerid"],
            customeridname=quote["customeridname"],
            customeridtype=quote["customeridtype"],
            pricelevelid=quote["pricelevelid"],
            pricelevelidname=quote["pricelevelidname"],
            transactioncurrencyid=quote["transactioncurrencyid"],
            transactioncurrencyidname=quote["transactioncurrencyidname"],
            description="Converted quote pricing snapshot.",
            freightamount=quote["freightamount"],
            discountamount=quote["discountamount"],
            totallineitemamount="0.00",
            totaldiscountamount="0.00",
            totaltax="0.00",
            totalamount="0.00",
            quoteid=quote["quoteid"],
            quoteidname=quote["name"],
            opportunityid=opportunity["opportunityid"],
            opportunityidname=opportunity["name"],
            datefulfilled=iso(epoch - timedelta(days=3 - index)) if state == 3 else None,
            requestdeliveryby=iso(epoch + timedelta(days=7 + index)),
        )
        salesorders.append(record)
    expanded["salesorders"] = salesorders

    orderdetails = []
    line_ordinal = 0
    for order_index, order in enumerate(salesorders):
        source_lines = [row for row in quotedetails if row["quoteid"] == order["quoteid"]]
        for local_index, source_line in enumerate(source_lines):
            record = seeded_base(
                "salesorderdetails",
                namespace,
                epoch,
                sellers[order_index % 3],
                line_ordinal,
            )
            shipped = (
                source_line["quantity"]
                if order["statecode"] == 3
                else decimal_text(0)
            )
            canceled = (
                source_line["quantity"]
                if order["statecode"] == 2
                else decimal_text(0)
            )
            record.update(
                salesorderid=order["salesorderid"],
                salesorderidname=order["name"],
                quotedetailid=source_line["quotedetailid"],
                quotedetailidname=source_line["productidname"],
                productid=source_line["productid"],
                productidname=source_line["productidname"],
                uomid=source_line["uomid"],
                uomidname=source_line["uomidname"],
                quantity=source_line["quantity"],
                quantityshipped=shipped,
                quantitycancelled=canceled,
                priceperunit=source_line["priceperunit"],
                baseamount=source_line["baseamount"],
                manualdiscountamount=source_line["manualdiscountamount"],
                tax=source_line["tax"],
                extendedamount=source_line["extendedamount"],
                lineitemnumber=local_index + 1,
                description=source_line["description"],
                transactioncurrencyid=order["transactioncurrencyid"],
                transactioncurrencyidname=order["transactioncurrencyidname"],
            )
            orderdetails.append(record)
            line_ordinal += 1
    expanded["salesorderdetails"] = orderdetails
    rollup_document_totals(salesorders, orderdetails, "salesorderid")

    invoices = []
    invoice_states = ((1, 5), (1, 5), (0, 2), (0, 1), (2, 4))
    for index, order in enumerate(salesorders[:5]):
        record = seeded_base(
            "invoices",
            namespace,
            epoch,
            sellers[index % 3],
            index,
            statecode=invoice_states[index][0],
            statuscode=invoice_states[index][1],
        )
        record.update(
            name=f"Invoice for {order['customeridname']}",
            invoicenumber=f"INV-{260100 + index:06d}",
            customerid=order["customerid"],
            customeridname=order["customeridname"],
            customeridtype=order["customeridtype"],
            pricelevelid=order["pricelevelid"],
            pricelevelidname=order["pricelevelidname"],
            transactioncurrencyid=order["transactioncurrencyid"],
            transactioncurrencyidname=order["transactioncurrencyidname"],
            description="Converted order pricing snapshot.",
            freightamount=order["freightamount"],
            discountamount=order["discountamount"],
            totallineitemamount="0.00",
            totaldiscountamount="0.00",
            totaltax="0.00",
            totalamount="0.00",
            salesorderid=order["salesorderid"],
            salesorderidname=order["name"],
            opportunityid=order["opportunityid"],
            opportunityidname=order["opportunityidname"],
            datedelivered=order["datefulfilled"],
            duedate=iso(epoch + timedelta(days=30 + index)),
        )
        invoices.append(record)
    expanded["invoices"] = invoices

    invoicedetails = []
    invoice_line_counts = (3, 2, 3, 2, 2)
    line_ordinal = 0
    for invoice_index, (invoice, line_count) in enumerate(
        zip(invoices, invoice_line_counts)
    ):
        source_lines = [
            row
            for row in orderdetails
            if row["salesorderid"] == invoice["salesorderid"]
        ][:line_count]
        for local_index, source_line in enumerate(source_lines):
            record = seeded_base(
                "invoicedetails",
                namespace,
                epoch,
                sellers[invoice_index % 3],
                line_ordinal,
            )
            record.update(
                invoiceid=invoice["invoiceid"],
                invoiceidname=invoice["name"],
                salesorderdetailid=source_line["salesorderdetailid"],
                salesorderdetailidname=source_line["productidname"],
                productid=source_line["productid"],
                productidname=source_line["productidname"],
                uomid=source_line["uomid"],
                uomidname=source_line["uomidname"],
                quantity=source_line["quantity"],
                priceperunit=source_line["priceperunit"],
                baseamount=source_line["baseamount"],
                manualdiscountamount=source_line["manualdiscountamount"],
                tax=source_line["tax"],
                extendedamount=source_line["extendedamount"],
                lineitemnumber=local_index + 1,
                description=source_line["description"],
                transactioncurrencyid=invoice["transactioncurrencyid"],
                transactioncurrencyidname=invoice["transactioncurrencyidname"],
            )
            invoicedetails.append(record)
            line_ordinal += 1
    expanded["invoicedetails"] = invoicedetails
    rollup_document_totals(invoices, invoicedetails, "invoiceid")

    opportunitycloses = []
    closed_opportunities = [row for row in opportunities if row["statecode"] != 0]
    for index, opportunity in enumerate(closed_opportunities):
        record = seeded_base(
            "opportunitycloses",
            namespace,
            epoch,
            sellers[index % 3],
            index,
            statecode=1,
            statuscode=2,
        )
        record.update(
            subject=(
                f"Won: {opportunity['name']}"
                if opportunity["statecode"] == 1
                else f"Lost: {opportunity['name']}"
            ),
            opportunityid=opportunity["opportunityid"],
            opportunityidname=opportunity["name"],
            actualrevenue=opportunity["actualvalue"],
            competitoridname=None,
            description="Synthetic opportunity close record.",
            actualend=opportunity["actualclosedate"],
        )
        opportunitycloses.append(record)
    expanded["opportunitycloses"] = opportunitycloses

    def reference_rows(entity: str, rows: tuple[tuple[Any, ...], ...]) -> list[dict[str, Any]]:
        records = []
        for index, row in enumerate(rows):
            record = seeded_base(entity, namespace, epoch, service_users[1], index)
            record["msdyn_name"] = row[0]
            record["msdyn_description"] = row[1]
            if entity in {"msdyn_incidenttypes", "msdyn_servicetasktypes"}:
                record["msdyn_estimatedduration"] = row[2]
            if entity == "msdyn_priorities":
                record["msdyn_levelofimportance"] = row[2]
            records.append(record)
        return records

    workordertypes = reference_rows(
        "msdyn_workordertypes",
        (
            ("Break/Fix", "Corrective equipment service"),
            ("Preventive Maintenance", "Scheduled maintenance"),
            ("Installation", "New equipment installation"),
        ),
    )
    incidenttypes = reference_rows(
        "msdyn_incidenttypes",
        (
            ("Printer fault", "Diagnose and restore printer", 90),
            ("Scanner fault", "Diagnose document scanner", 75),
            ("Preventive maintenance", "Routine equipment service", 120),
            ("Installation", "Install and configure equipment", 150),
        ),
    )
    tasktypes = reference_rows(
        "msdyn_servicetasktypes",
        (
            ("Safety check", "Verify safe work area", 10),
            ("Run diagnostics", "Collect deterministic diagnostic result", 25),
            ("Inspect equipment", "Inspect serviceable components", 30),
            ("Perform repair", "Complete approved repair", 60),
            ("Functional test", "Confirm expected operation", 20),
            ("Customer sign-off", "Review completion with customer", 10),
        ),
    )
    priorities = reference_rows(
        "msdyn_priorities",
        (
            ("High", "Service interruption", 1),
            ("Normal", "Standard service priority", 5),
            ("Low", "Non-urgent request", 9),
        ),
    )
    expanded["msdyn_workordertypes"] = workordertypes
    expanded["msdyn_incidenttypes"] = incidenttypes
    expanded["msdyn_servicetasktypes"] = tasktypes
    expanded["msdyn_priorities"] = priorities

    booking_status_rows = (
        ("Scheduled", 2, 690970000, False),
        ("Traveling", 2, 690970001, False),
        ("In Progress", 2, 690970002, False),
        ("Completed", 2, 690970003, True),
        ("Canceled", 3, 690970004, True),
    )
    bookingstatuses = []
    for index, (name, status, fs_status, completes) in enumerate(booking_status_rows):
        created = epoch - timedelta(days=600 - index)
        bookingstatuses.append(
            {
                "bookingstatusid": record_guid(namespace, "bookingstatuses", str(index)),
                "name": name,
                "status": status,
                "msdyn_fieldservicestatus": fs_status,
                "msdyn_statuscompletesworkorder": completes,
                "statecode": 0,
                "statuscode": 1,
                "createdon": iso(created),
                "modifiedon": iso(created),
            }
        )
    expanded["bookingstatuses"] = bookingstatuses

    resources = []
    for index, technician in enumerate(technicians):
        created = epoch - timedelta(days=500 - index * 10)
        resources.append(
            {
                "bookableresourceid": record_guid(
                    namespace, "bookableresources", str(index)
                ),
                "name": technician["fullname"],
                "resourcetype": 3,
                "userid": technician["systemuserid"],
                "useridname": technician["fullname"],
                "timezone": 35,
                "statecode": 0,
                "statuscode": 1,
                "createdon": iso(created),
                "modifiedon": iso(created),
            }
        )
    expanded["bookableresources"] = resources

    assets = []
    for index in range(18):
        account = accounts[index % len(accounts)]
        account_contacts = [
            row for row in contacts if row["parentcustomerid"] == account["accountid"]
        ]
        contact = account_contacts[index % len(account_contacts)]
        product = products[index % 8]
        record = seeded_base(
            "msdyn_customerassets", namespace, epoch, service_users[index % 3], index
        )
        record.update(
            msdyn_name=f"{account['name']} {product['name']} {index + 1:02d}",
            msdyn_account=account["accountid"],
            msdyn_accountname=account["name"],
            msdyn_contact=contact["contactid"],
            msdyn_contactname=contact["fullname"],
            msdyn_product=product["productid"],
            msdyn_productname=product["name"],
            msdyn_parentasset=None,
            msdyn_parentassetname=None,
            msdyn_serialnumber=f"AST-SYN-{260000 + index:06d}",
            msdyn_registrationdate=iso(epoch - timedelta(days=320 - index * 9)),
            msdyn_systemstatus=690970000,
        )
        assets.append(record)
    expanded["msdyn_customerassets"] = assets

    workorders = []
    system_statuses = (
        [690970000] * 2
        + [690970001] * 3
        + [690970002] * 3
        + [690970003] * 4
        + [690970005] * 3
    )
    for index, system_status in enumerate(system_statuses):
        incident = legacy["incidents"][index]
        asset = assets[index]
        account = next(
            row for row in accounts if row["accountid"] == asset["msdyn_account"]
        )
        contact = next(
            row for row in contacts if row["contactid"] == asset["msdyn_contact"]
        )
        state = 1 if system_status in {690970003, 690970005} else 0
        status = 2 if state else 1
        promised = epoch + timedelta(days=index // 2, hours=8 + index % 4)
        record = seeded_base(
            "msdyn_workorders",
            namespace,
            epoch,
            service_users[index % 3],
            index,
            statecode=state,
            statuscode=status,
        )
        record.update(
            msdyn_name=f"WO-{260100 + index:06d}",
            msdyn_serviceaccount=account["accountid"],
            msdyn_serviceaccountname=account["name"],
            msdyn_billingaccount=account["accountid"],
            msdyn_billingaccountname=account["name"],
            msdyn_reportedbycontact=contact["contactid"],
            msdyn_reportedbycontactname=contact["fullname"],
            msdyn_servicerequest=incident["incidentid"],
            msdyn_servicerequestname=incident["title"],
            msdyn_customerasset=asset["msdyn_customerassetid"],
            msdyn_customerassetname=asset["msdyn_name"],
            msdyn_workordertype=workordertypes[index % len(workordertypes)][
                "msdyn_workordertypeid"
            ],
            msdyn_workordertypename=workordertypes[index % len(workordertypes)][
                "msdyn_name"
            ],
            msdyn_primaryincidenttype=incidenttypes[index % len(incidenttypes)][
                "msdyn_incidenttypeid"
            ],
            msdyn_primaryincidenttypename=incidenttypes[index % len(incidenttypes)][
                "msdyn_name"
            ],
            msdyn_priority=priorities[index % len(priorities)]["msdyn_priorityid"],
            msdyn_priorityname=priorities[index % len(priorities)]["msdyn_name"],
            msdyn_systemstatus=system_status,
            msdyn_address1=account["address1_line1"],
            msdyn_city=account["address1_city"],
            msdyn_stateorprovince=account["address1_stateorprovince"],
            msdyn_postalcode=account["address1_postalcode"],
            msdyn_country=account["address1_country"],
            msdyn_instructions="Contact the named representative before beginning synthetic service.",
            msdyn_datewindowstart=iso(promised - timedelta(hours=1)),
            msdyn_datewindowend=iso(promised + timedelta(hours=3)),
            msdyn_timefrompromised=iso(promised),
            msdyn_timetopromised=iso(promised + timedelta(hours=2)),
            msdyn_firstarrivedon=(
                iso(promised) if system_status in {690970002, 690970003} else None
            ),
            msdyn_completedon=(
                iso(promised + timedelta(hours=1, minutes=30))
                if system_status == 690970003
                else None
            ),
        )
        workorders.append(record)
    expanded["msdyn_workorders"] = workorders

    workorderincidents = []
    requirements = []
    service_tasks = []
    workorder_products = []
    workorder_services = []
    product_ordinal = 0
    for index, workorder in enumerate(workorders):
        asset = assets[index]
        incident_type = incidenttypes[index % len(incidenttypes)]
        terminal = workorder["msdyn_systemstatus"] in {690970003, 690970005}
        incident_record = seeded_base(
            "msdyn_workorderincidents",
            namespace,
            epoch,
            service_users[index % 3],
            index,
            statecode=1 if terminal else 0,
            statuscode=2 if terminal else 1,
        )
        incident_record.update(
            msdyn_name=f"{workorder['msdyn_name']} incident",
            msdyn_workorder=workorder["msdyn_workorderid"],
            msdyn_workordername=workorder["msdyn_name"],
            msdyn_incidenttype=incident_type["msdyn_incidenttypeid"],
            msdyn_incidenttypename=incident_type["msdyn_name"],
            msdyn_customerasset=asset["msdyn_customerassetid"],
            msdyn_customerassetname=asset["msdyn_name"],
            msdyn_estimatedduration=incident_type["msdyn_estimatedduration"],
        )
        workorderincidents.append(incident_record)

        start = parse_utc(workorder["msdyn_timefrompromised"])
        requirement = seeded_base(
            "msdyn_resourcerequirements",
            namespace,
            epoch,
            service_users[index % 3],
            index,
            statecode=0 if workorder["statecode"] == 0 else 1,
            statuscode=1 if workorder["statecode"] == 0 else 2,
        )
        requirement.update(
            msdyn_name=f"Primary requirement for {workorder['msdyn_name']}",
            msdyn_workorder=workorder["msdyn_workorderid"],
            msdyn_workordername=workorder["msdyn_name"],
            msdyn_fromdate=iso(start),
            msdyn_todate=iso(start + timedelta(hours=4)),
            msdyn_duration=120,
            msdyn_isprimary=True,
        )
        requirements.append(requirement)

        for task_index in range(3):
            task_type = tasktypes[(index * 3 + task_index) % len(tasktypes)]
            task = seeded_base(
                "msdyn_workorderservicetasks",
                namespace,
                epoch,
                service_users[index % 3],
                index * 3 + task_index,
                statecode=1 if terminal else 0,
                statuscode=2 if terminal else 1,
            )
            task.update(
                msdyn_name=f"{task_type['msdyn_name']} — {workorder['msdyn_name']}",
                msdyn_workorder=workorder["msdyn_workorderid"],
                msdyn_workordername=workorder["msdyn_name"],
                msdyn_tasktype=task_type["msdyn_servicetasktypeid"],
                msdyn_tasktypename=task_type["msdyn_name"],
                msdyn_description=task_type["msdyn_description"],
                msdyn_percentcomplete=100 if terminal else (50 if index % 3 == 0 else 0),
                msdyn_inspectiontaskresult=(
                    "Synthetic check complete" if terminal else None
                ),
            )
            service_tasks.append(task)

        service_product = products[8 + index % 4]
        service = seeded_base(
            "msdyn_workorderservices",
            namespace,
            epoch,
            service_users[index % 3],
            index,
            statecode=1 if terminal else 0,
            statuscode=2 if terminal else 1,
        )
        service.update(
            msdyn_name=f"{service_product['name']} — {workorder['msdyn_name']}",
            msdyn_workorder=workorder["msdyn_workorderid"],
            msdyn_workordername=workorder["msdyn_name"],
            msdyn_service=service_product["productid"],
            msdyn_servicename=service_product["name"],
            msdyn_duration=incident_type["msdyn_estimatedduration"],
            msdyn_unitamount=service_product["price"],
            msdyn_totalamount=service_product["price"],
            transactioncurrencyid=usd["transactioncurrencyid"],
            transactioncurrencyidname=usd["currencyname"],
        )
        workorder_services.append(service)

        count = 2 if index < 5 else 1
        for local_index in range(count):
            product = products[(index + local_index + 5) % 8]
            quantity_value = decimal_text(1 + (index + local_index) % 2)
            total, _ = line_amounts(quantity_value, product["price"])
            product_record = seeded_base(
                "msdyn_workorderproducts",
                namespace,
                epoch,
                service_users[index % 3],
                product_ordinal,
                statecode=1 if terminal else 0,
                statuscode=2 if terminal else 1,
            )
            product_record.update(
                msdyn_name=f"{product['name']} — {workorder['msdyn_name']}",
                msdyn_workorder=workorder["msdyn_workorderid"],
                msdyn_workordername=workorder["msdyn_name"],
                msdyn_product=product["productid"],
                msdyn_productname=product["name"],
                msdyn_unit=unit["uomid"],
                msdyn_unitname=unit["name"],
                msdyn_quantity=quantity_value,
                msdyn_unitamount=product["price"],
                msdyn_totalamount=total,
                msdyn_lineorder=local_index + 1,
                transactioncurrencyid=usd["transactioncurrencyid"],
                transactioncurrencyidname=usd["currencyname"],
            )
            workorder_products.append(product_record)
            product_ordinal += 1
    expanded["msdyn_workorderincidents"] = workorderincidents
    expanded["msdyn_resourcerequirements"] = requirements
    expanded["msdyn_workorderservicetasks"] = service_tasks
    expanded["msdyn_workorderproducts"] = workorder_products
    expanded["msdyn_workorderservices"] = workorder_services

    bookings = []
    for booking_index, workorder_index in enumerate(range(2, 15)):
        workorder = workorders[workorder_index]
        requirement = requirements[workorder_index]
        resource = resources[booking_index % len(resources)]
        start = parse_utc(requirement["msdyn_fromdate"])
        end = start + timedelta(hours=2)
        system_status = workorder["msdyn_systemstatus"]
        status_index = (
            3
            if system_status == 690970003
            else 4
            if system_status == 690970005
            else 2
            if system_status == 690970002
            else 0
        )
        booking_status = bookingstatuses[status_index]
        terminal = status_index in {3, 4}
        record = seeded_base(
            "bookableresourcebookings",
            namespace,
            epoch,
            technicians[booking_index % 4],
            booking_index,
            statecode=1 if terminal else 0,
            statuscode=2 if terminal else 1,
        )
        record.update(
            name=f"{workorder['msdyn_name']} — {resource['name']}",
            resource=resource["bookableresourceid"],
            resourcename=resource["name"],
            bookingstatus=booking_status["bookingstatusid"],
            bookingstatusname=booking_status["name"],
            starttime=iso(start),
            endtime=iso(end),
            duration=120,
            msdyn_workorder=workorder["msdyn_workorderid"],
            msdyn_workordername=workorder["msdyn_name"],
            msdyn_resourcerequirement=requirement[
                "msdyn_resourcerequirementid"
            ],
            msdyn_resourcerequirementname=requirement["msdyn_name"],
        )
        bookings.append(record)
    expanded["bookableresourcebookings"] = bookings

    resolutions = []
    resolved_cases = [row for row in legacy["incidents"] if row["statecode"] == 1]
    for index, incident in enumerate(resolved_cases):
        record = seeded_base(
            "incidentresolutions",
            namespace,
            epoch,
            service_users[index % 3],
            index,
            statecode=1,
            statuscode=2,
        )
        record.update(
            subject=f"Resolution for {incident['ticketnumber']}",
            incidentid=incident["incidentid"],
            incidentidname=incident["title"],
            description="Synthetic case resolution captured through CloseIncident policy.",
            actualdurationminutes=30 + index * 5,
            actualend=incident["resolvedon"],
        )
        resolutions.append(record)
    expanded["incidentresolutions"] = resolutions

    expanded["_fixtureChains"] = [
        {
            "lead": leads[0]["leadid"],
            "opportunity": opportunities[0]["opportunityid"],
            "quote": quotes[0]["quoteid"],
            "salesorder": salesorders[0]["salesorderid"],
            "invoice": invoices[0]["invoiceid"],
            "invoicedetails": [
                row["invoicedetailid"]
                for row in invoicedetails
                if row["invoiceid"] == invoices[0]["invoiceid"]
            ],
            "customerassets": [
                asset["msdyn_customerassetid"] for asset in assets[:3]
            ],
        },
        {
            "incident": legacy["incidents"][0]["incidentid"],
            "customerasset": assets[0]["msdyn_customerassetid"],
            "workorder": workorders[0]["msdyn_workorderid"],
            "requirement": requirements[0]["msdyn_resourcerequirementid"],
            "bookings": [],
        },
    ]
    return expanded


def rollup_document_totals(
    parents: list[dict[str, Any]],
    lines: list[dict[str, Any]],
    parent_field: str,
) -> None:
    key = parent_field
    for parent in parents:
        children = [line for line in lines if line[parent_field] == parent[key]]
        line_total = sum((Decimal(line["baseamount"]) for line in children), Decimal(0))
        line_discount = sum(
            (Decimal(line["manualdiscountamount"]) for line in children), Decimal(0)
        )
        taxes = sum((Decimal(line["tax"]) for line in children), Decimal(0))
        header_discount = Decimal(parent.get("discountamount", "0.00"))
        freight = Decimal(parent.get("freightamount", "0.00"))
        total = line_total - line_discount - header_discount + taxes + freight
        if min(
            line_total,
            line_discount,
            taxes,
            header_discount,
            freight,
            total,
        ) < 0:
            raise BuildError("document money and derived totals must be non-negative")
        parent["totallineitemamount"] = decimal_text(line_total)
        parent["totaldiscountamount"] = decimal_text(line_discount + header_discount)
        parent["totaltax"] = decimal_text(taxes)
        parent["totalamount"] = decimal_text(total)


def finalize_records(entities: dict[str, list[dict[str, Any]]]) -> None:
    entities.pop("_fixtureChains", None)
    definitions = CANONICAL_SCHEMA["entities"]
    if set(entities) != set(definitions):
        missing = sorted(set(definitions) - set(entities))
        extra = sorted(set(entities) - set(definitions))
        raise BuildError(f"generated entity sets differ from schema: missing={missing}, extra={extra}")
    by_id: dict[str, dict[str, dict[str, Any]]] = {}
    for entity, records in entities.items():
        key_field = definitions[entity]["key"]
        by_id[entity] = {record[key_field]: record for record in records}
    for entity, records in entities.items():
        definition = definitions[entity]
        schema_fields = definition["fields"]
        for record in records:
            if "exchangerate" in schema_fields:
                currency = by_id["transactioncurrencies"].get(
                    record.get("transactioncurrencyid")
                )
                if currency is None:
                    raise BuildError(
                        f"{entity}.transactioncurrencyid does not resolve"
                    )
                record["exchangerate"] = currency["exchangerate"]
            for field_name, field_definition in schema_fields.items():
                if field_name not in record:
                    if field_definition["nullable"]:
                        record[field_name] = None
                    else:
                        raise BuildError(f"{entity}.{field_name} was not generated")
            unexpected = {
                key
                for key in record
                if not key.startswith("@") and "@" not in key and key not in schema_fields
            }
            if unexpected:
                raise BuildError(f"{entity} contains undeclared fields: {sorted(unexpected)}")
            for field_name, field_definition in schema_fields.items():
                value = record[field_name]
                lookup_definition = field_definition.get("lookup")
                if lookup_definition and value is not None:
                    discriminator = lookup_definition.get("discriminator")
                    target = (
                        record[discriminator]
                        if discriminator
                        else lookup_definition["targets"][0]
                    )
                    target_record = by_id.get(target, {}).get(value)
                    if target_record is None:
                        raise BuildError(
                            f"{entity}.{field_name} lookup {target}({value}) does not resolve"
                        )
                    primary = definitions[target]["primaryName"]
                    display_field = lookup_definition["displayField"]
                    display_value = target_record[primary]
                    record[display_field] = display_value
                    record[annotation(field_name)] = display_value
                elif lookup_definition:
                    record[lookup_definition["displayField"]] = None
                    record.pop(annotation(field_name), None)
                options = field_definition.get("options")
                if options and value is not None and field_definition.get("formatted"):
                    labels = {item["value"]: item["label"] for item in options}
                    if value not in labels:
                        raise BuildError(f"{entity}.{field_name} has undeclared option {value}")
                    record[annotation(field_name)] = labels[value]
            record["@odata.etag"] = weak_etag(record)
        records.sort(key=lambda item: item[definition["key"]])


def validate_records(
    entities: dict[str, list[dict[str, Any]]], identities: list[dict[str, Any]]
) -> None:
    validate_json_value({"entities": entities, "identities": identities}, "generated")
    definitions = CANONICAL_SCHEMA["entities"]
    if set(entities) != set(definitions):
        raise BuildError("generated entity sets do not match the canonical schema")
    ids_by_entity: dict[str, set[str]] = {}
    all_ids: set[str] = set()
    records_by_entity: dict[str, dict[str, dict[str, Any]]] = {}
    decimal_pattern_cache: dict[int, re.Pattern[str]] = {}

    for entity, definition in definitions.items():
        records = entities[entity]
        if len(records) != definition["expectedCount"]:
            raise BuildError(
                f"{entity} count is {len(records)}, expected {definition['expectedCount']}"
            )
        key_field = definition["key"]
        entity_ids: set[str] = set()
        previous = ""
        for record in records:
            actual_properties = {
                key for key in record if not key.startswith("@") and "@" not in key
            }
            expected_properties = set(definition["fields"])
            if actual_properties != expected_properties:
                raise BuildError(
                    f"{entity} properties differ from canonical schema: "
                    f"missing={sorted(expected_properties - actual_properties)}, "
                    f"extra={sorted(actual_properties - expected_properties)}"
                )
            for field_name, field_definition in definition["fields"].items():
                value = record[field_name]
                if value is None:
                    if not field_definition["nullable"]:
                        raise BuildError(f"{entity}.{field_name} cannot be null")
                    continue
                edm_type = field_definition["edmType"]
                valid = False
                if edm_type == "Edm.String":
                    valid = isinstance(value, str)
                elif edm_type == "Edm.Boolean":
                    valid = type(value) is bool
                elif edm_type == "Edm.Int32":
                    valid = type(value) is int and -(2**31) <= value < 2**31
                elif edm_type == "Edm.Int64":
                    valid = type(value) is int and abs(value) <= MAX_SAFE_INTEGER
                elif edm_type == "Edm.Guid":
                    valid = isinstance(value, str) and GUID_PATTERN.fullmatch(value) is not None
                elif edm_type == "Edm.DateTimeOffset":
                    valid = isinstance(value, str) and UTC_PATTERN.fullmatch(value) is not None
                    if valid:
                        parse_utc(value)
                elif edm_type == "Edm.Decimal":
                    scale = field_definition["scale"]
                    pattern = decimal_pattern_cache.setdefault(
                        scale, re.compile(rf"^-?(?:0|[1-9]\d*)\.\d{{{scale}}}$")
                    )
                    valid = isinstance(value, str) and pattern.fullmatch(value) is not None
                    if valid:
                        Decimal(value)
                if not valid:
                    raise BuildError(
                        f"{entity}.{field_name} does not match {edm_type}"
                    )
                comparable = Decimal(value) if edm_type == "Edm.Decimal" else value
                if "minimum" in field_definition:
                    minimum = (
                        Decimal(str(field_definition["minimum"]))
                        if edm_type == "Edm.Decimal"
                        else field_definition["minimum"]
                    )
                    if comparable < minimum:
                        raise BuildError(f"{entity}.{field_name} is below its minimum")
                if "maximum" in field_definition:
                    maximum = (
                        Decimal(str(field_definition["maximum"]))
                        if edm_type == "Edm.Decimal"
                        else field_definition["maximum"]
                    )
                    if comparable > maximum:
                        raise BuildError(f"{entity}.{field_name} exceeds its maximum")
                if "discriminator" in field_definition and value not in field_definition["discriminator"]:
                    raise BuildError(f"{entity}.{field_name} has an invalid discriminator")
                options = field_definition.get("options")
                if options and value not in {item["value"] for item in options}:
                    raise BuildError(f"{entity}.{field_name} has an invalid option")
            record_id = record[key_field]
            if record_id in all_ids:
                raise BuildError(f"duplicate GUID across entity sets: {record_id}")
            if record_id < previous:
                raise BuildError(f"{entity} output is not sorted by {key_field}")
            previous = record_id
            entity_ids.add(record_id)
            all_ids.add(record_id)
            for required in definition["requiredOnCreate"]:
                value = record[required]
                if value is None or (isinstance(value, str) and not value.strip()):
                    raise BuildError(f"{entity}.{required} is required")
            pairs = STATUS_PAIRS[entity]
            if pairs and (record["statecode"], record["statuscode"]) not in pairs:
                raise BuildError(f"{entity} has invalid state/status pair")
            if record.get("@odata.etag") != weak_etag(record):
                raise BuildError(f"{entity} has a non-content-derived ETag")
        ids_by_entity[entity] = entity_ids
        records_by_entity[entity] = {record[key_field]: record for record in records}

    for entity, definition in definitions.items():
        for record in entities[entity]:
            for field_name, field_definition in definition["fields"].items():
                lookup = field_definition.get("lookup")
                if not lookup or record[field_name] is None:
                    continue
                discriminator = lookup.get("discriminator")
                target = record[discriminator] if discriminator else lookup["targets"][0]
                if target not in lookup["targets"]:
                    raise BuildError(f"{entity}.{field_name} discriminator is not allowed")
                target_record = records_by_entity[target].get(record[field_name])
                if target_record is None:
                    raise BuildError(f"{entity}.{field_name} lookup does not resolve")
                target_name = target_record[definitions[target]["primaryName"]]
                if record[lookup["displayField"]] != target_name:
                    raise BuildError(f"{entity}.{field_name} display name is stale")
                if record.get(annotation(field_name)) != target_name:
                    raise BuildError(f"{entity}.{field_name} annotation is stale")
            if "exchangerate" in definition["fields"]:
                currency = records_by_entity["transactioncurrencies"][
                    record["transactioncurrencyid"]
                ]
                if (
                    record["exchangerate"] != currency["exchangerate"]
                    or Decimal(currency["exchangerate"]) <= 0
                ):
                    raise BuildError(
                        f"{entity} exchange rate differs from its transaction currency"
                    )
    if any(
        Decimal(currency["exchangerate"]) <= 0
        for currency in entities["transactioncurrencies"]
    ):
        raise BuildError("transaction currency exchange rates must be positive")

    connections_by_pair: dict[str, list[dict[str, Any]]] = {}
    for item in entities["connections"]:
        connections_by_pair.setdefault(item["connectionpairid"], []).append(item)
    if len(connections_by_pair) * 2 != len(entities["connections"]):
        raise BuildError("connections must contain exact reciprocal pairs")
    for pair in connections_by_pair.values():
        if len(pair) != 2:
            raise BuildError("connection pair must contain two rows")
        left, right = pair
        if not all(
            (
                left["record1id"] == right["record2id"],
                left["record2id"] == right["record1id"],
                left["record1roleidname"] == right["record2roleidname"],
                left["record2roleidname"] == right["record1roleidname"],
            )
        ):
            raise BuildError("connection reciprocal pair is inconsistent")

    line_contracts = (
        ("opportunities", "opportunityproducts", "opportunityid"),
        ("quotes", "quotedetails", "quoteid"),
        ("salesorders", "salesorderdetails", "salesorderid"),
        ("invoices", "invoicedetails", "invoiceid"),
    )
    for parent_entity, line_entity, parent_field in line_contracts:
        parent_key = definitions[parent_entity]["key"]
        for parent in entities[parent_entity]:
            price_list = records_by_entity["pricelevels"][parent["pricelevelid"]]
            currency = records_by_entity["transactioncurrencies"][
                parent["transactioncurrencyid"]
            ]
            if (
                price_list["statecode"] != 0
                or currency["statecode"] != 0
                or price_list["transactioncurrencyid"]
                != parent["transactioncurrencyid"]
            ):
                raise BuildError(
                    f"{parent_entity} price list and currency are not active and coherent"
                )
            lines = [
                row for row in entities[line_entity]
                if row[parent_field] == parent[parent_key]
            ]
            base = sum((Decimal(row["baseamount"]) for row in lines), Decimal(0))
            line_discount = sum(
                (Decimal(row["manualdiscountamount"]) for row in lines), Decimal(0)
            )
            tax = sum((Decimal(row["tax"]) for row in lines), Decimal(0))
            header_discount = Decimal(parent.get("discountamount", "0.00"))
            freight = Decimal(parent.get("freightamount", "0.00"))
            expected_total = base - line_discount - header_discount + tax + freight
            expected = {
                "totallineitemamount": decimal_text(base),
                "totaldiscountamount": decimal_text(line_discount + header_discount),
                "totaltax": decimal_text(tax),
                "totalamount": decimal_text(expected_total),
            }
            if any(parent[field] != value for field, value in expected.items()):
                raise BuildError(f"{parent_entity} totals do not match line arithmetic")
            for line in lines:
                line_base, line_extended = line_amounts(
                    line["quantity"], line["priceperunit"],
                    line["manualdiscountamount"], line["tax"]
                )
                if line["baseamount"] != line_base or line["extendedamount"] != line_extended:
                    raise BuildError(f"{line_entity} has invalid fixed-point arithmetic")
                if line["transactioncurrencyid"] != parent["transactioncurrencyid"]:
                    raise BuildError(f"{line_entity} currency differs from its parent")
                if not any(
                    price["productid"] == line["productid"]
                    and price["pricelevelid"] == parent["pricelevelid"]
                    and price["uomid"] == line["uomid"]
                    and price["transactioncurrencyid"] == parent["transactioncurrencyid"]
                    for price in entities["productpricelevels"]
                ):
                    raise BuildError(
                        f"{line_entity} has no coherent product price level"
                    )

    for price in entities["productpricelevels"]:
        price_list = records_by_entity["pricelevels"][price["pricelevelid"]]
        if price["transactioncurrencyid"] != price_list["transactioncurrencyid"]:
            raise BuildError("product price currency differs from its price list")
        product = records_by_entity["products"][price["productid"]]
        unit = records_by_entity["uoms"][price["uomid"]]
        if unit["uomscheduleid"] != product["defaultuomscheduleid"]:
            raise BuildError("product price UOM is outside the product unit group")

    for product in entities["products"]:
        unit = records_by_entity["uoms"][product["defaultuomid"]]
        if unit["uomscheduleid"] != product["defaultuomscheduleid"]:
            raise BuildError("product default UOM is outside its default unit group")

    account_for_contact = {
        row["contactid"]: row["parentcustomerid"] for row in entities["contacts"]
    }

    requirements_by_workorder: dict[str, list[dict[str, Any]]] = {}
    for requirement in entities["msdyn_resourcerequirements"]:
        start = parse_utc(requirement["msdyn_fromdate"])
        end = parse_utc(requirement["msdyn_todate"])
        if start >= end:
            raise BuildError("resource requirement window must have a positive interval")
        requirements_by_workorder.setdefault(requirement["msdyn_workorder"], []).append(requirement)
    bookings_by_workorder: dict[str, list[dict[str, Any]]] = {}
    intervals_by_resource: dict[str, list[tuple[datetime, datetime, str]]] = {}
    canceled_status = next(
        item["bookingstatusid"] for item in entities["bookingstatuses"]
        if item["msdyn_fieldservicestatus"] == 690970004
    )
    terminal_booking_statuses = {
        item["bookingstatusid"] for item in entities["bookingstatuses"]
        if item["msdyn_statuscompletesworkorder"]
    }
    for booking in entities["bookableresourcebookings"]:
        start = parse_utc(booking["starttime"])
        end = parse_utc(booking["endtime"])
        if start >= end or int((end - start).total_seconds() // 60) != booking["duration"]:
            raise BuildError("booking interval or duration is invalid")
        bookings_by_workorder.setdefault(booking["msdyn_workorder"], []).append(booking)
        requirement = records_by_entity["msdyn_resourcerequirements"][
            booking["msdyn_resourcerequirement"]
        ]
        resource = records_by_entity["bookableresources"][booking["resource"]]
        if (
            requirement["msdyn_workorder"] != booking["msdyn_workorder"]
            or start < parse_utc(requirement["msdyn_fromdate"])
            or end > parse_utc(requirement["msdyn_todate"])
        ):
            raise BuildError("booking is outside its requirement window")
        if booking["statecode"] == 0 and (
            requirement["statecode"] != 0 or resource["statecode"] != 0
        ):
            raise BuildError("active booking requires an active requirement and resource")
        if booking["bookingstatus"] != canceled_status:
            intervals_by_resource.setdefault(booking["resource"], []).append(
                (start, end, booking["bookableresourcebookingid"])
            )
    for intervals in intervals_by_resource.values():
        intervals.sort()
        for previous, current in zip(intervals, intervals[1:]):
            if previous[1] > current[0]:
                raise BuildError("resource bookings overlap under half-open interval policy")

    tasks_by_workorder: dict[str, list[dict[str, Any]]] = {}
    for task in entities["msdyn_workorderservicetasks"]:
        if task["statecode"] == 1 and task["msdyn_percentcomplete"] != 100:
            raise BuildError("inactive work order service task is incomplete")
        tasks_by_workorder.setdefault(task["msdyn_workorder"], []).append(task)
    for item in entities["msdyn_workorderproducts"]:
        product = records_by_entity["products"][item["msdyn_product"]]
        unit = records_by_entity["uoms"][item["msdyn_unit"]]
        if (
            product["producttypecode"] == 3
            or unit["uomscheduleid"] != product["defaultuomscheduleid"]
            or item["transactioncurrencyid"] != product["transactioncurrencyid"]
        ):
            raise BuildError("work order product catalog values are inconsistent")
    for item in entities["msdyn_workorderservices"]:
        service = records_by_entity["products"][item["msdyn_service"]]
        if (
            service["producttypecode"] != 3
            or item["transactioncurrencyid"] != service["transactioncurrencyid"]
        ):
            raise BuildError("work order service catalog values are inconsistent")
    for item in entities["msdyn_workorderincidents"]:
        workorder = records_by_entity["msdyn_workorders"][item["msdyn_workorder"]]
        if (
            item["msdyn_customerasset"]
            and item["msdyn_customerasset"] != workorder["msdyn_customerasset"]
        ):
            raise BuildError("work order incident asset differs from its parent")
    for workorder in entities["msdyn_workorders"]:
        workorder_id = workorder["msdyn_workorderid"]
        requirements = requirements_by_workorder.get(workorder_id, [])
        primary_requirements = [
            requirement for requirement in requirements
            if requirement["msdyn_isprimary"]
        ]
        if len(primary_requirements) != 1:
            raise BuildError("work order must have exactly one primary requirement")
        asset = records_by_entity["msdyn_customerassets"][workorder["msdyn_customerasset"]]
        case = records_by_entity["incidents"][workorder["msdyn_servicerequest"]]
        case_account = (
            case["customerid"]
            if case["customeridtype"] == "accounts"
            else account_for_contact[case["customerid"]]
        )
        if not (
            workorder["msdyn_serviceaccount"] == asset["msdyn_account"] == case_account
        ):
            raise BuildError("work order asset, case, and service account are inconsistent")
        if workorder["msdyn_systemstatus"] in {690970003, 690970005}:
            if any(
                booking["bookingstatus"] not in terminal_booking_statuses
                for booking in bookings_by_workorder.get(workorder_id, [])
            ):
                raise BuildError("terminal work order has a nonterminal booking")
            if any(
                task["msdyn_percentcomplete"] != 100
                for task in tasks_by_workorder.get(workorder_id, [])
            ):
                raise BuildError("terminal work order has incomplete service tasks")
            child_sets = (
                "msdyn_resourcerequirements",
                "msdyn_workorderservicetasks",
                "msdyn_workorderproducts",
                "msdyn_workorderservices",
                "msdyn_workorderincidents",
            )
            if any(
                child["statecode"] == 0
                for entity in child_sets
                for child in entities[entity]
                if child["msdyn_workorder"] == workorder_id
            ):
                raise BuildError("terminal work order has active child records")

    who_user = records_by_entity["systemusers"].get(identities[0]["systemuserid"])
    if who_user is None or who_user["businessunitid"] not in ids_by_entity["businessunits"]:
        raise BuildError("WhoAmI user or business unit does not resolve")


def validate_canonical_schema(schema: dict[str, Any]) -> None:
    validate_json_value(schema, "schema")
    if schema.get("schemaVersion") != 3 or schema.get("formatVersions") != {
        "schema": 3,
        "seed": 3,
        "replay": 3,
    }:
        raise BuildError("canonical schema format versions must all be 3")
    entities = schema.get("entities")
    if not isinstance(entities, dict) or not entities:
        raise BuildError("canonical schema must declare entity sets")
    supported_edm = {
        "Edm.Boolean", "Edm.DateTimeOffset", "Edm.Decimal", "Edm.Guid",
        "Edm.Int32", "Edm.Int64", "Edm.String",
    }
    for entity_set, definition in entities.items():
        if definition.get("entitySet") != entity_set:
            raise BuildError(f"{entity_set} must explicitly repeat its entity set name")
        for required in (
            "logicalName", "entityType", "key", "primaryName", "expectedCount",
            "mutable", "deletePolicy", "appScopes", "requiredOnCreate",
            "statusPairs", "activeStatusPairs", "fields",
        ):
            if required not in definition:
                raise BuildError(f"{entity_set} is missing schema attribute {required}")
        if definition["key"] not in definition["fields"]:
            raise BuildError(f"{entity_set} key is not a declared field")
        if definition["primaryName"] not in definition["fields"]:
            raise BuildError(f"{entity_set} primary name is not a declared field")
        if definition["fields"][definition["key"]]["edmType"] != "Edm.Guid":
            raise BuildError(f"{entity_set} key must be Edm.Guid")
        if not isinstance(definition["expectedCount"], int) or definition["expectedCount"] < 0:
            raise BuildError(f"{entity_set} expected count is invalid")
        fields = definition["fields"]
        for field_name, field_definition in fields.items():
            if field_name.startswith("new" + "_"):
                raise BuildError("custom publisher-prefixed fields are prohibited")
            if field_definition.get("edmType") not in supported_edm:
                raise BuildError(f"{entity_set}.{field_name} has unsupported EDM type")
            if not isinstance(field_definition.get("nullable"), bool):
                raise BuildError(f"{entity_set}.{field_name} must declare nullability")
            if not isinstance(field_definition.get("mutable"), bool):
                raise BuildError(f"{entity_set}.{field_name} must declare mutability")
            if field_definition["edmType"] == "Edm.Decimal":
                scale = field_definition.get("scale")
                if not isinstance(scale, int) or not 0 <= scale <= 6:
                    raise BuildError(f"{entity_set}.{field_name} must declare decimal scale")
            lookup = field_definition.get("lookup")
            if lookup:
                if not lookup.get("targets") or any(
                    target not in entities for target in lookup["targets"]
                ):
                    raise BuildError(f"{entity_set}.{field_name} lookup target is invalid")
                display_field = lookup.get("displayField")
                if display_field not in fields:
                    raise BuildError(f"{entity_set}.{field_name} display field is absent")
                if fields[display_field]["mutable"]:
                    raise BuildError(f"{entity_set}.{display_field} must be read-only")
                discriminator = lookup.get("discriminator")
                if discriminator and discriminator not in fields:
                    raise BuildError(f"{entity_set}.{field_name} discriminator is absent")
        for required in definition["requiredOnCreate"]:
            if required not in fields or (
                definition["mutable"] and not fields[required]["mutable"]
            ):
                raise BuildError(f"{entity_set}.{required} is an invalid create requirement")
        option_values = {
            field_name: {item["value"] for item in field.get("options", [])}
            for field_name, field in fields.items()
        }
        for pair in definition["statusPairs"]:
            if pair["statecode"] not in option_values.get("statecode", set()):
                raise BuildError(f"{entity_set} status vector has unknown statecode")
            if pair["statuscode"] not in option_values.get("statuscode", set()):
                raise BuildError(f"{entity_set} status vector has unknown statuscode")
        status_pairs = {
            (pair["statecode"], pair["statuscode"])
            for pair in definition["statusPairs"]
        }
        active_pairs = {
            (pair["statecode"], pair["statuscode"])
            for pair in definition["activeStatusPairs"]
        }
        if not active_pairs <= status_pairs:
            raise BuildError(
                f"{entity_set} active status vectors must be declared status vectors"
            )
    action_names = [item["name"] for item in schema.get("actions", [])]
    if len(action_names) != len(set(action_names)):
        raise BuildError("canonical action names must be unique")
    for action in schema.get("actions", []):
        if set(action) != {
            "name",
            "scope",
            "bindingEntitySet",
            "outputEntitySet",
            "targetParameters",
            "parameters",
        }:
            raise BuildError(
                f"action {action.get('name')} descriptor fields are incomplete"
            )
        if (
            action["bindingEntitySet"] not in entities
            or action["outputEntitySet"] not in entities
        ):
            raise BuildError(f"action {action['name']} references an unknown entity set")
        parameters = action["parameters"]
        parameter_names = [parameter["name"] for parameter in parameters]
        if (
            len(parameter_names) != len(set(parameter_names))
            or not set(action["targetParameters"]) <= set(parameter_names)
        ):
            raise BuildError(f"action {action['name']} parameter names are invalid")
        for parameter in parameters:
            if parameter.get("type") not in {
                "boolean", "datetime", "decimal", "guid", "integer", "string"
            }:
                raise BuildError(
                    f"action {action['name']} parameter {parameter.get('name')} "
                    "has an unsupported type"
                )
            if parameter["type"] == "decimal" and not isinstance(
                parameter.get("scale"), int
            ):
                raise BuildError(
                    f"action {action['name']} decimal parameters must declare scale"
                )
    for app_id, app in schema.get("apps", {}).items():
        if app.get("id") != app_id or not app.get("prefix"):
            raise BuildError(f"app {app_id} identity is invalid")


def build_metadata(
    tenant: dict[str, Any], entities: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    entity_sets = []
    for entity_set, definition in sorted(CANONICAL_SCHEMA["entities"].items()):
        properties = []
        navigation = []
        for field_name, field_definition in sorted(definition["fields"].items()):
            prop = {
                "name": field_name,
                "type": field_definition["edmType"],
                "nullable": field_definition["nullable"],
                "mutable": field_definition["mutable"],
                "readOnly": not field_definition["mutable"],
            }
            for attribute in (
                "scale", "options", "calculated", "minimum", "maximum", "discriminator", "formatted"
            ):
                if attribute in field_definition:
                    prop[attribute] = field_definition[attribute]
            if "lookup" in field_definition:
                prop["lookup"] = field_definition["lookup"]
                navigation.append(
                    {
                        "name": field_name,
                        "targets": field_definition["lookup"]["targets"],
                        "displayField": field_definition["lookup"]["displayField"],
                        "discriminator": field_definition["lookup"].get("discriminator"),
                        "deletePolicy": field_definition["lookup"]["onDelete"],
                    }
                )
            properties.append(prop)
        entity_sets.append(
            {
                "name": entity_set,
                "logicalName": definition["logicalName"],
                "entityType": definition["entityType"],
                "key": definition["key"],
                "primaryName": definition["primaryName"],
                "count": len(entities[entity_set]),
                "mutable": definition["mutable"],
                "deletePolicy": definition["deletePolicy"],
                "appScopes": definition["appScopes"],
                "properties": properties,
                "navigationProperties": navigation,
                "statusPairs": definition["statusPairs"],
                "activeStatusPairs": definition["activeStatusPairs"],
            }
        )
    return {
        "@odata.context": f"{tenant['organizationUrl']}/api/data/v9.2/$metadata",
        "namespace": CANONICAL_SCHEMA["namespace"],
        "version": "9.2",
        "schemaVersion": CANONICAL_SCHEMA["schemaVersion"],
        "schemaDigest": digest(CANONICAL_SCHEMA),
        "compatibilityProfile": CANONICAL_SCHEMA["compatibilityProfile"],
        "simulatorPolicies": CANONICAL_SCHEMA["simulatorPolicies"],
        "apps": list(CANONICAL_SCHEMA["apps"].values()),
        "actions": CANONICAL_SCHEMA["actions"],
        "entitySets": entity_sets,
    }


def build_fixture_chains(entities: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    def one(entity: str, field: str, value: Any) -> dict[str, Any]:
        return next(record for record in entities[entity] if record[field] == value)

    quote = one("quotes", "quotenumber", "QUO-260100")
    opportunity = one("opportunities", "opportunityid", quote["opportunityid"])
    lead = one("leads", "leadid", opportunity["originatingleadid"])
    order = one("salesorders", "quoteid", quote["quoteid"])
    invoice = one("invoices", "salesorderid", order["salesorderid"])
    invoice_lines = [
        row for row in entities["invoicedetails"] if row["invoiceid"] == invoice["invoiceid"]
    ]
    assets = [
        row for row in entities["msdyn_customerassets"]
        if row["msdyn_account"] == invoice["customerid"]
        and row["msdyn_product"] in {line["productid"] for line in invoice_lines}
    ]

    incident = one("incidents", "ticketnumber", "CAS-260102")
    workorder = one(
        "msdyn_workorders", "msdyn_servicerequest", incident["incidentid"]
    )
    requirement = one(
        "msdyn_resourcerequirements", "msdyn_workorder", workorder["msdyn_workorderid"]
    )
    bookings = [
        row for row in entities["bookableresourcebookings"]
        if row["msdyn_workorder"] == workorder["msdyn_workorderid"]
    ]
    return [
        {
            "sourceKey": "anchor.sales.primary",
            "lead": lead["leadid"],
            "opportunity": opportunity["opportunityid"],
            "quote": quote["quoteid"],
            "salesorder": order["salesorderid"],
            "invoice": invoice["invoiceid"],
            "invoicedetails": [row["invoicedetailid"] for row in invoice_lines],
            "customerassets": [row["msdyn_customerassetid"] for row in assets],
        },
        {
            "sourceKey": "anchor.field-service.primary",
            "incident": incident["incidentid"],
            "customerasset": workorder["msdyn_customerasset"],
            "workorder": workorder["msdyn_workorderid"],
            "requirement": requirement["msdyn_resourcerequirementid"],
            "bookings": [row["bookableresourcebookingid"] for row in bookings],
            "serviceTasks": [
                row["msdyn_workorderservicetaskid"]
                for row in entities["msdyn_workorderservicetasks"]
                if row["msdyn_workorder"] == workorder["msdyn_workorderid"]
            ],
            "products": [
                row["msdyn_workorderproductid"]
                for row in entities["msdyn_workorderproducts"]
                if row["msdyn_workorder"] == workorder["msdyn_workorderid"]
            ],
        },
    ]


def schema_module_bytes(source: dict[str, Any]) -> bytes:
    schema_json = compact_canonical(CANONICAL_SCHEMA)
    tenant = source["tenant"]
    config = {
        "epoch": source["epoch"],
        "tenant": tenant,
        "identity": {
            "@odata.context": (
                f"{tenant['organizationUrl']}/api/data/v9.2/$metadata"
                "#Microsoft.Dynamics.CRM.WhoAmIResponse"
            ),
            "BusinessUnitId": record_guid(
                uuid.UUID(source["namespace"]), "businessunits", "aster-lane"
            ),
            "OrganizationId": record_guid(
                uuid.UUID(source["namespace"]), "organizations", "aster-lane"
            ),
            "UserId": record_guid(
                uuid.UUID(source["namespace"]), "systemusers", "0"
            ),
            "FullName": source["identities"][0]["name"],
            "OrganizationUrl": tenant["organizationUrl"],
            "Version": tenant["organizationVersion"],
        },
        "identities": [
            {
                "systemuserid": record_guid(
                    uuid.UUID(source["namespace"]), "systemusers", str(index)
                ),
                "fullname": item["name"],
                "title": item["role"],
            }
            for index, item in enumerate(source["identities"])
        ],
        "metadata": {
            "context": f"{tenant['organizationUrl']}/api/data/v9.2/$metadata",
            "namespace": CANONICAL_SCHEMA["namespace"],
            "version": "9.2",
            "schemaVersion": CANONICAL_SCHEMA["schemaVersion"],
            "schemaDigest": digest(CANONICAL_SCHEMA),
        },
        "formatVersions": CANONICAL_SCHEMA["formatVersions"],
    }
    source = (
        "// Generated by build.py from data/schema.json. Do not edit.\n"
        "function deepFreeze(value) {\n"
        "  if (value && typeof value === \"object\" && !Object.isFrozen(value)) {\n"
        "    Object.freeze(value);\n"
        "    for (const child of Object.values(value)) deepFreeze(child);\n"
        "  }\n"
        "  return value;\n"
        "}\n"
        f"export const TENANT_SCHEMA = deepFreeze({schema_json});\n"
        f"export const TENANT_CONFIG = deepFreeze({compact_canonical(config)});\n"
        "export const SCHEMA_ENTITIES = TENANT_SCHEMA.entities;\n"
        "export const APP_DEFINITIONS = TENANT_SCHEMA.apps;\n"
    )
    return source.encode("utf-8")


def build_outputs(source: dict[str, Any]) -> dict[Path, bytes]:
    validate_source(source)
    validate_canonical_schema(CANONICAL_SCHEMA)
    entities, identities = build_records(source)
    validate_records(entities, identities)
    tenant = source["tenant"]
    context_root = f"{tenant['organizationUrl']}/api/data/v9.2/$metadata"
    outputs: dict[Path, bytes] = {}

    metadata = build_metadata(tenant, entities)
    whoami = {
        "@odata.context": f"{context_root}#Microsoft.Dynamics.CRM.WhoAmIResponse",
        "BusinessUnitId": record_guid(
            uuid.UUID(source["namespace"]), "businessunits", "aster-lane"
        ),
        "OrganizationId": record_guid(
            uuid.UUID(source["namespace"]), "organizations", "aster-lane"
        ),
        "UserId": identities[0]["systemuserid"],
        "FullName": identities[0]["fullname"],
        "OrganizationUrl": tenant["organizationUrl"],
        "Version": tenant["organizationVersion"],
    }
    seed = {
        "schemaVersion": 3,
        "epoch": source["epoch"],
        "tenant": tenant,
        "identities": identities,
        "identity": whoami,
        "compatibilityProfile": CANONICAL_SCHEMA["compatibilityProfile"],
        "simulatorPolicies": CANONICAL_SCHEMA["simulatorPolicies"],
        "schemaDigest": digest(CANONICAL_SCHEMA),
        "schema": CANONICAL_SCHEMA,
        "metadata": metadata,
        "fixtureChains": build_fixture_chains(entities),
        "entities": entities,
    }
    seed_bytes = canonical_json(seed).encode("utf-8")
    outputs[ROOT / "data" / "seed.json"] = seed_bytes
    outputs[ROOT / "site" / "data" / "seed.json"] = seed_bytes
    outputs[ROOT / "site" / "data" / "schema.json"] = canonical_json(
        CANONICAL_SCHEMA
    ).encode("utf-8")
    outputs[ROOT / "site" / "tenant-schema.mjs"] = schema_module_bytes(source)

    for entity, records in entities.items():
        envelope = {
            "@odata.context": f"{context_root}#{entity}",
            "@odata.count": len(records),
            "value": records,
        }
        outputs[API_ROOT / f"{entity}.json"] = canonical_json(envelope).encode("utf-8")

    outputs[API_ROOT / "$metadata.json"] = canonical_json(metadata).encode("utf-8")
    outputs[API_ROOT / "WhoAmI.json"] = canonical_json(whoami).encode("utf-8")

    registry_entries = []
    for path, payload in sorted(outputs.items(), key=lambda item: item[0].as_posix()):
        relative = path.relative_to(ROOT).as_posix()
        count = None
        if path.parent == API_ROOT and path.stem in entities:
            count = len(entities[path.stem])
        registry_entries.append(
            {
                "path": relative,
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "count": count,
            }
        )
    registry = {
        "schemaVersion": 2,
        "seedVersion": 3,
        "replayVersion": 3,
        "generatedFrom": ["data/source.json", "data/schema.json"],
        "schemaDigest": digest(CANONICAL_SCHEMA),
        "compatibilityProfile": CANONICAL_SCHEMA["compatibilityProfile"],
        "epoch": source["epoch"],
        "counts": {entity: len(records) for entity, records in sorted(entities.items())},
        "actions": [item["name"] for item in CANONICAL_SCHEMA["actions"]],
        "files": registry_entries,
    }
    outputs[ROOT / "registry.json"] = canonical_json(registry).encode("utf-8")
    site_registry = {
        **registry,
        "files": [
            {**entry, "path": entry["path"].removeprefix("site/")}
            for entry in registry_entries
            if entry["path"].startswith("site/")
        ],
    }
    outputs[ROOT / "site" / "registry.json"] = canonical_json(site_registry).encode("utf-8")
    return outputs


def load_source() -> dict[str, Any]:
    try:
        with SOURCE_PATH.open("r", encoding="utf-8") as handle:
            source = json.load(
                handle,
                parse_constant=lambda value: (_ for _ in ()).throw(
                    BuildError(f"source contains non-finite JSON number {value}")
                ),
            )
    except BuildError:
        raise
    except (OSError, json.JSONDecodeError) as error:
        raise BuildError(f"cannot load {SOURCE_PATH.relative_to(ROOT)}: {error}") from error
    if not isinstance(source, dict):
        raise BuildError("source root must be an object")
    return source


def check_outputs(outputs: dict[Path, bytes]) -> list[str]:
    drift: list[str] = []
    for path, expected in sorted(outputs.items(), key=lambda item: item[0].as_posix()):
        try:
            actual = path.read_bytes()
        except FileNotFoundError:
            drift.append(f"missing: {path.relative_to(ROOT)}")
            continue
        if actual != expected:
            drift.append(f"drift: {path.relative_to(ROOT)}")
    expected_api = {
        path.resolve()
        for path in outputs
        if path.parent == API_ROOT and path.suffix == ".json"
    }
    for path in sorted(API_ROOT.glob("*.json")):
        if path.resolve() not in expected_api:
            drift.append(f"stale: {path.relative_to(ROOT)}")
    return drift


def write_outputs(outputs: dict[Path, bytes]) -> None:
    staging = ROOT / ".build-staging"
    if staging.is_symlink() or staging.is_file():
        staging.unlink()
    elif staging.exists():
        shutil.rmtree(staging)
    staged: list[tuple[Path, Path, Path | None]] = []
    originals: dict[Path, bytes | None] = {}
    attempted: list[Path] = []
    try:
        for destination, payload in sorted(outputs.items(), key=lambda item: item[0].as_posix()):
            relative = destination.relative_to(ROOT)
            original = destination.read_bytes() if destination.exists() else None
            originals[destination] = original
            temporary = staging / "next" / relative
            temporary.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_bytes(payload)
            backup = None
            if original is not None:
                backup = staging / "previous" / relative
                backup.parent.mkdir(parents=True, exist_ok=True)
                backup.write_bytes(original)
            staged.append((temporary, destination, backup))
        for temporary, destination, _backup in staged:
            destination.parent.mkdir(parents=True, exist_ok=True)
            attempted.append(destination)
            os.replace(temporary, destination)
    except Exception as error:
        rollback_errors: list[OSError] = []
        for destination in reversed(attempted):
            original = originals[destination]
            try:
                if original is None:
                    destination.unlink(missing_ok=True)
                else:
                    backup = staging / "previous" / destination.relative_to(ROOT)
                    os.replace(backup, destination)
            except OSError as rollback_error:
                try:
                    if original is None:
                        destination.unlink(missing_ok=True)
                    else:
                        destination.write_bytes(original)
                except OSError as fallback_error:
                    rollback_errors.extend((rollback_error, fallback_error))
        if rollback_errors:
            raise BuildError(
                f"generated output publication failed and rollback could not restore "
                f"{len(rollback_errors) // 2} destination(s)"
            ) from error
        raise
    finally:
        if staging.is_symlink() or staging.is_file():
            staging.unlink()
        elif staging.exists():
            shutil.rmtree(staging)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare generated bytes with committed outputs without writing",
    )
    args = parser.parse_args(argv)
    try:
        outputs = build_outputs(load_source())
    except BuildError as error:
        print(f"build error: {error}", file=sys.stderr)
        return 2
    if args.check:
        drift = check_outputs(outputs)
        if drift:
            print("\n".join(drift), file=sys.stderr)
            return 1
        print(f"verified {len(outputs)} deterministic generated files")
        return 0
    write_outputs(outputs)
    print(f"wrote {len(outputs)} deterministic generated files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
