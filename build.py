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
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
SOURCE_PATH = ROOT / "data" / "source.json"
API_ROOT = ROOT / "site" / "api" / "data" / "v9.2"
EXPECTED_COUNTS = {
    "accounts": 12,
    "contacts": 30,
    "incidents": 24,
    "tasks": 36,
    "emails": 60,
    "connections": 40,
}
ID_FIELDS = {
    "accounts": "accountid",
    "contacts": "contactid",
    "incidents": "incidentid",
    "tasks": "activityid",
    "emails": "activityid",
    "connections": "connectionid",
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
}
UTC_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?"
    r"(?:Z|[+-]\d{2}:\d{2})$"
)
GUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
MAX_SAFE_INTEGER = 9_007_199_254_740_991
CASE_STATUS_REASONS = {
    0: {1: "In Progress", 2: "On Hold", 3: "Waiting for Details", 4: "Researching"},
    1: {5: "Problem Solved", 1000: "Information Provided"},
    2: {6: "Canceled", 2000: "Merged"},
}
STATUS_PAIRS = {
    "accounts": {(0, 1), (1, 2)},
    "contacts": {(0, 1), (1, 2)},
    "incidents": {
        (state, reason)
        for state, reasons in CASE_STATUS_REASONS.items()
        for reason in reasons
    },
    "tasks": {(0, 2), (0, 3), (1, 5), (2, 6)},
    "emails": {(1, 3), (1, 4)},
    "connections": {(0, 1), (1, 2)},
}
REQUIRED = {
    "accounts": {"accountid", "name", "accountnumber", "statecode", "statuscode"},
    "contacts": {"contactid", "firstname", "lastname", "fullname", "statecode", "statuscode"},
    "incidents": {
        "incidentid",
        "ticketnumber",
        "title",
        "customerid",
        "statecode",
        "statuscode",
    },
    "tasks": {"activityid", "subject", "scheduledend", "statecode", "statuscode"},
    "emails": {
        "activityid",
        "subject",
        "directioncode",
        "statecode",
        "statuscode",
    },
    "connections": {
        "connectionid",
        "connectionpairid",
        "record1id",
        "record2id",
        "record1type",
        "record2type",
        "statecode",
        "statuscode",
    },
}


def property_schema(
    edm_type: str,
    nullable: bool = False,
    options: dict[int, str] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {"type": edm_type, "nullable": nullable}
    if options is not None:
        result["options"] = [
            {"value": value, "label": label} for value, label in options.items()
        ]
    return result


COMMON_PROPERTY_SCHEMA = {
    "ownerid": property_schema("Edm.Guid"),
    "owneridname": property_schema("Edm.String"),
    "createdon": property_schema("Edm.DateTimeOffset"),
    "modifiedon": property_schema("Edm.DateTimeOffset"),
    "statecode": property_schema("Edm.Int32"),
    "statuscode": property_schema("Edm.Int32"),
}
PROPERTY_SCHEMAS: dict[str, dict[str, dict[str, Any]]] = {
    "accounts": {
        "accountid": property_schema("Edm.Guid"),
        "name": property_schema("Edm.String"),
        "accountnumber": property_schema("Edm.String"),
        "telephone1": property_schema("Edm.String", True),
        "emailaddress1": property_schema("Edm.String", True),
        "websiteurl": property_schema("Edm.String", True),
        "address1_line1": property_schema("Edm.String", True),
        "address1_city": property_schema("Edm.String", True),
        "address1_stateorprovince": property_schema("Edm.String", True),
        "address1_postalcode": property_schema("Edm.String", True),
        "address1_country": property_schema("Edm.String", True),
        "industrycode": property_schema("Edm.String", True),
        "description": property_schema("Edm.String", True),
        "primarycontactid": property_schema("Edm.Guid", True),
        "primarycontactidname": property_schema("Edm.String", True),
        **COMMON_PROPERTY_SCHEMA,
    },
    "contacts": {
        "contactid": property_schema("Edm.Guid"),
        "firstname": property_schema("Edm.String"),
        "lastname": property_schema("Edm.String"),
        "fullname": property_schema("Edm.String"),
        "emailaddress1": property_schema("Edm.String", True),
        "telephone1": property_schema("Edm.String", True),
        "jobtitle": property_schema("Edm.String", True),
        "parentcustomerid": property_schema("Edm.Guid"),
        "parentcustomeridname": property_schema("Edm.String"),
        "address1_city": property_schema("Edm.String", True),
        "address1_stateorprovince": property_schema("Edm.String", True),
        "preferredcontactmethodcode": property_schema("Edm.Int32"),
        **COMMON_PROPERTY_SCHEMA,
    },
    "incidents": {
        "incidentid": property_schema("Edm.Guid"),
        "ticketnumber": property_schema("Edm.String"),
        "title": property_schema("Edm.String"),
        "description": property_schema("Edm.String", True),
        "customerid": property_schema("Edm.Guid"),
        "customeridname": property_schema("Edm.String"),
        "customeridtype": property_schema("Edm.String"),
        "primarycontactid": property_schema("Edm.Guid"),
        "primarycontactidname": property_schema("Edm.String"),
        "prioritycode": property_schema(
            "Edm.Int32", options={1: "High", 2: "Normal", 3: "Low"}
        ),
        "caseorigincode": property_schema(
            "Edm.Int32", options={1: "Phone", 2: "Email", 3: "Web"}
        ),
        "casetypecode": property_schema(
            "Edm.Int32", options={1: "Question", 2: "Problem", 3: "Request"}
        ),
        "resolveby": property_schema("Edm.DateTimeOffset", True),
        "firstresponsesenton": property_schema("Edm.DateTimeOffset", True),
        "resolvedon": property_schema("Edm.DateTimeOffset", True),
        **COMMON_PROPERTY_SCHEMA,
    },
    "tasks": {
        "activityid": property_schema("Edm.Guid"),
        "subject": property_schema("Edm.String"),
        "description": property_schema("Edm.String", True),
        "regardingobjectid": property_schema("Edm.Guid"),
        "regardingobjectidname": property_schema("Edm.String"),
        "regardingobjectidtype": property_schema("Edm.String"),
        "scheduledend": property_schema("Edm.DateTimeOffset"),
        "actualend": property_schema("Edm.DateTimeOffset", True),
        "prioritycode": property_schema("Edm.Int32"),
        "percentcomplete": property_schema("Edm.Int32"),
        **COMMON_PROPERTY_SCHEMA,
    },
    "emails": {
        "activityid": property_schema("Edm.Guid"),
        "subject": property_schema("Edm.String"),
        "description": property_schema("Edm.String", True),
        "directioncode": property_schema("Edm.Boolean"),
        "fromaddress": property_schema("Edm.String"),
        "fromname": property_schema("Edm.String"),
        "toaddress": property_schema("Edm.String"),
        "toname": property_schema("Edm.String"),
        "senderid": property_schema("Edm.Guid"),
        "senderidname": property_schema("Edm.String"),
        "senderidtype": property_schema("Edm.String"),
        "recipientid": property_schema("Edm.Guid"),
        "recipientidname": property_schema("Edm.String"),
        "recipientidtype": property_schema("Edm.String"),
        "regardingobjectid": property_schema("Edm.Guid"),
        "regardingobjectidname": property_schema("Edm.String"),
        "regardingobjectidtype": property_schema("Edm.String"),
        "scheduledstart": property_schema("Edm.DateTimeOffset", True),
        "senton": property_schema("Edm.DateTimeOffset", True),
        **COMMON_PROPERTY_SCHEMA,
    },
    "connections": {
        "connectionid": property_schema("Edm.Guid"),
        "connectionpairid": property_schema("Edm.Guid"),
        "record1id": property_schema("Edm.Guid"),
        "record1idname": property_schema("Edm.String"),
        "record1type": property_schema("Edm.String"),
        "record2id": property_schema("Edm.Guid"),
        "record2idname": property_schema("Edm.String"),
        "record2type": property_schema("Edm.String"),
        "record1roleidname": property_schema("Edm.String", True),
        "record2roleidname": property_schema("Edm.String", True),
        "description": property_schema("Edm.String", True),
        "effectivestart": property_schema("Edm.DateTimeOffset", True),
        "effectiveend": property_schema("Edm.DateTimeOffset", True),
        **COMMON_PROPERTY_SCHEMA,
    },
}
PROPERTY_SCHEMAS["incidents"]["statecode"] = property_schema(
    "Edm.Int32", options={0: "Active", 1: "Resolved", 2: "Canceled"}
)
PROPERTY_SCHEMAS["incidents"]["statuscode"] = property_schema(
    "Edm.Int32",
    options={
        reason: label
        for reasons in CASE_STATUS_REASONS.values()
        for reason, label in reasons.items()
    },
)


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
    if not isinstance(identities, list) or len(identities) < 1:
        raise BuildError("at least one simulation identity is required")
    identity_names: set[str] = set()
    for index, value in enumerate(identities):
        item = require_object(value, f"source.identities[{index}]", {"name", "role"})
        identity_name = require_string(item["name"], f"source.identities[{index}].name")
        require_string(item["role"], f"source.identities[{index}].role")
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

    accounts: list[dict[str, Any]] = []
    for index, (name, domain, city, region, postal, industry) in enumerate(source["accounts"]):
        owner = identity_records[index % len(identity_records)]
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
        owner = identity_records[(index + 1) % len(identity_records)]
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
        owner = identity_records[index % len(identity_records)]
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
        owner = identity_records[(index + 2) % len(identity_records)]
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
        owner = identity_records[index % len(identity_records)]
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
                "ownerid": identity_records[pair_index % len(identity_records)]["systemuserid"],
                "owneridname": identity_records[pair_index % len(identity_records)]["fullname"],
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
    for entity, records in entities.items():
        id_field = ID_FIELDS[entity]
        for record in records:
            record["@odata.etag"] = weak_etag(record)
        records.sort(key=lambda item: item[id_field])
    return entities, identity_records


def validate_records(
    entities: dict[str, list[dict[str, Any]]], identities: list[dict[str, Any]]
) -> None:
    validate_json_value({"entities": entities, "identities": identities}, "generated")
    if set(entities) != set(EXPECTED_COUNTS):
        raise BuildError("generated entity sets do not match the entity contract")
    all_ids: set[str] = set()
    ids_by_entity: dict[str, set[str]] = {}
    for entity, records in entities.items():
        if len(records) != EXPECTED_COUNTS[entity]:
            raise BuildError(
                f"{entity} count is {len(records)}, expected {EXPECTED_COUNTS[entity]}"
            )
        id_field = ID_FIELDS[entity]
        entity_ids: set[str] = set()
        previous = ""
        for record in records:
            missing = REQUIRED[entity] - set(record)
            if missing:
                raise BuildError(f"{entity} record is missing fields: {sorted(missing)}")
            actual_properties = {
                key for key in record if not key.startswith("@") and "@" not in key
            }
            expected_properties = set(PROPERTY_SCHEMAS[entity])
            if actual_properties != expected_properties:
                raise BuildError(
                    f"{entity} properties differ from explicit schema: "
                    f"missing={sorted(expected_properties - actual_properties)}, "
                    f"extra={sorted(actual_properties - expected_properties)}"
                )
            for field, definition in PROPERTY_SCHEMAS[entity].items():
                value = record[field]
                if value is None:
                    if not definition["nullable"]:
                        raise BuildError(f"{entity}.{field} cannot be null")
                    continue
                edm_type = definition["type"]
                valid = (
                    (edm_type == "Edm.String" and isinstance(value, str))
                    or (edm_type == "Edm.Boolean" and type(value) is bool)
                    or (
                        edm_type == "Edm.Int32"
                        and type(value) is int
                        and -(2**31) <= value < 2**31
                    )
                    or (
                        edm_type == "Edm.Guid"
                        and isinstance(value, str)
                        and GUID_PATTERN.fullmatch(value) is not None
                    )
                    or (
                        edm_type == "Edm.DateTimeOffset"
                        and isinstance(value, str)
                        and UTC_PATTERN.fullmatch(value) is not None
                    )
                )
                if not valid:
                    raise BuildError(
                        f"{entity}.{field} does not match explicit type {edm_type}"
                    )
                if edm_type == "Edm.DateTimeOffset":
                    parse_utc(value)
            record_id = record[id_field]
            if not isinstance(record_id, str) or not GUID_PATTERN.fullmatch(record_id):
                raise BuildError(f"{entity} has an invalid GUID: {record_id!r}")
            if record_id in all_ids:
                raise BuildError(f"duplicate GUID across entity sets: {record_id}")
            if record_id < previous:
                raise BuildError(f"{entity} output is not sorted by {id_field}")
            previous = record_id
            entity_ids.add(record_id)
            all_ids.add(record_id)
            pair = (record["statecode"], record["statuscode"])
            if pair not in STATUS_PAIRS[entity]:
                raise BuildError(f"{entity} has invalid state/status pair: {pair}")
            for key, value in record.items():
                if key in DATE_FIELDS:
                    if value is not None:
                        parse_utc(value)
            if record.get("@odata.etag") != weak_etag(record):
                raise BuildError(f"{entity} has a non-content-derived ETag")
        ids_by_entity[entity] = entity_ids

    identity_ids = {item["systemuserid"] for item in identities}
    contact_ids = ids_by_entity["contacts"]
    account_ids = ids_by_entity["accounts"]
    incident_ids = ids_by_entity["incidents"]
    for account in entities["accounts"]:
        if account["ownerid"] not in identity_ids:
            raise BuildError("account owner lookup does not resolve")
        if account["primarycontactid"] not in contact_ids:
            raise BuildError("account primary contact lookup does not resolve")
    for contact in entities["contacts"]:
        if contact["parentcustomerid"] not in account_ids:
            raise BuildError("contact parent lookup does not resolve")
        if contact["ownerid"] not in identity_ids:
            raise BuildError("contact owner lookup does not resolve")
    for incident in entities["incidents"]:
        customer_set = contact_ids if incident["customeridtype"] == "contacts" else account_ids
        if incident["customerid"] not in customer_set:
            raise BuildError("case customer lookup does not resolve")
        if incident["primarycontactid"] not in contact_ids:
            raise BuildError("case primary contact lookup does not resolve")
        if incident["ownerid"] not in identity_ids:
            raise BuildError("case owner lookup does not resolve")
    for task in entities["tasks"]:
        if task["regardingobjectid"] not in incident_ids:
            raise BuildError("task regarding lookup does not resolve")
        if task["ownerid"] not in identity_ids:
            raise BuildError("task owner lookup does not resolve")
    for email in entities["emails"]:
        if email["regardingobjectid"] not in incident_ids:
            raise BuildError("email regarding lookup does not resolve")
        for prefix in ("sender", "recipient"):
            lookup_set = (
                contact_ids if email[f"{prefix}idtype"] == "contacts" else identity_ids
            )
            if email[f"{prefix}id"] not in lookup_set:
                raise BuildError(f"email {prefix} lookup does not resolve")
        if email["ownerid"] not in identity_ids:
            raise BuildError("email owner lookup does not resolve")
    connections_by_pair: dict[str, list[dict[str, Any]]] = {}
    for item in entities["connections"]:
        if item["record1id"] not in contact_ids or item["record2id"] not in contact_ids:
            raise BuildError("connection lookup does not resolve")
        pair_id = item["connectionpairid"]
        if not GUID_PATTERN.fullmatch(pair_id):
            raise BuildError("connection pair id is not a GUID")
        connections_by_pair.setdefault(pair_id, []).append(item)
    for pair_id, pair in connections_by_pair.items():
        if len(pair) != 2:
            raise BuildError(f"connection pair {pair_id} must contain exactly two rows")
        left, right = pair
        reciprocal_fields = (
            left["record1id"] == right["record2id"],
            left["record2id"] == right["record1id"],
            left["record1roleidname"] == right["record2roleidname"],
            left["record2roleidname"] == right["record1roleidname"],
        )
        if not all(reciprocal_fields):
            raise BuildError("connection does not have an exact reciprocal relationship")


def build_metadata(
    tenant: dict[str, Any], entities: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    entity_sets = []
    for entity in sorted(entities):
        records = entities[entity]
        properties = [
            {"name": field, **json.loads(compact_canonical(definition))}
            for field, definition in sorted(PROPERTY_SCHEMAS[entity].items())
        ]
        entity_sets.append(
            {
                "name": entity,
                "entityType": f"StaticDynamics365.{entity[:-1] if entity.endswith('s') else entity}",
                "key": ID_FIELDS[entity],
                "count": len(records),
                "properties": properties,
            }
        )
    return {
        "@odata.context": f"{tenant['organizationUrl']}/api/data/v9.2/$metadata",
        "namespace": "StaticDynamics365",
        "version": "9.2",
        "entitySets": entity_sets,
    }


def build_outputs(source: dict[str, Any]) -> dict[Path, bytes]:
    validate_source(source)
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
        "schemaVersion": 2,
        "epoch": source["epoch"],
        "tenant": tenant,
        "identities": identities,
        "identity": whoami,
        "metadata": metadata,
        "entities": entities,
    }
    seed_bytes = canonical_json(seed).encode("utf-8")
    outputs[ROOT / "data" / "seed.json"] = seed_bytes
    outputs[ROOT / "site" / "data" / "seed.json"] = seed_bytes

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
        "schemaVersion": 1,
        "generatedFrom": "data/source.json",
        "epoch": source["epoch"],
        "counts": {entity: len(records) for entity, records in sorted(entities.items())},
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
