#!/usr/bin/env python3
"""Write API bridge — GitHub Issues in, deterministic tenant out.

The read API is static JSON on GitHub Pages. Writes arrive as GitHub
Issues carrying a fenced ```json command in the SAME field shapes the
read API serves. This processor validates the command, mutates
``data/source.json`` (the authored truth), and recomputes the derived
``data/schema.json`` expected counts. The workflow then reruns
``build.py`` (deterministic expansion), runs the test suites, commits,
and Pages redeploys — so a write becomes globally readable in about a
minute. Near-real-time CRUD with no server.

Command shape (issue body, inside a ```json fence):

    {
      "schema": "sd365-write/1.0",
      "operation": "create",              // create | update | delete
      "entity": "incidents",              // accounts | contacts | incidents
      "record": {
        "title": "Refrigeration unit alarm on aisle 4",
        "customeridname": "Harbor Lights Grocery",
        "prioritycode": 1,                // 1 High, 2 Normal, 3 Low
        "caseorigincode": 3,              // 1 Phone, 2 Email, 3 Web
        "casetypecode": 2,                // 1 Question, 2 Problem, 3 Request
        "statecode": 0                    // 0 Active, 1 Resolved, 2 Canceled
      }
    }

Addressing for update/delete: incidents by ``ticketnumber`` (CAS-xxxxxx).

Simulator policy (v1):
  * create: accounts (must embed a ``primarycontact``), contacts, incidents
  * update: incidents (title, prioritycode, caseorigincode, casetypecode,
    statecode)
  * delete: incidents only, and only records outside the field-service
    window (source index >= 18) — the original service history is
    load-bearing for work orders and assets, so it is retained.
  * accounts/contacts are create-only: their source indexes are identity
    (UUIDv5 keys), so removal would rewrite history.

Usage:
  python3 scripts/process_write_issue.py --event-path "$GITHUB_EVENT_PATH"
  python3 scripts/process_write_issue.py --test '{"schema": ...}'
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_PATH = ROOT / "data" / "source.json"
SCHEMA_PATH = ROOT / "data" / "schema.json"

WRITE_SCHEMA = "sd365-write/1.0"
PROTECTED_INCIDENT_ROWS = 18  # indexes paired with work orders / assets
OPTION_FIELDS = {
    "prioritycode": {1, 2, 3},
    "caseorigincode": {1, 2, 3},
    "casetypecode": {1, 2, 3},
}
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,'&()\-]{1,79}$")


class WriteError(ValueError):
    pass


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def extract_command(body: str) -> dict:
    match = re.search(r"```json\s*\n(.*?)```", body or "", re.DOTALL)
    if not match:
        raise WriteError("No ```json fenced command found in the issue body")
    try:
        command = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise WriteError(f"Command is not valid JSON: {exc}") from exc
    if not isinstance(command, dict) or command.get("schema") != WRITE_SCHEMA:
        raise WriteError(f"Command schema must be '{WRITE_SCHEMA}'")
    return command


def require_name(value, label: str) -> str:
    if not isinstance(value, str) or not NAME_RE.match(value.strip()):
        raise WriteError(
            f"{label} must be 2-80 chars of letters, digits, spaces, "
            "or . , ' & ( ) -"
        )
    return value.strip()


def domain_for(name: str, source: dict) -> str:
    stem = re.sub(r"[^a-z0-9]", "", name.lower())[:24] or "tenantwrite"
    domain = f"{stem}.example"
    taken = {row[1] for row in source["accounts"]}
    suffix = 2
    while domain in taken:
        domain = f"{stem}{suffix}.example"
        suffix += 1
    return domain


def account_index(source: dict, customer_name: str) -> int:
    for index, row in enumerate(source["accounts"]):
        if row[0].casefold() == customer_name.casefold():
            return index
    raise WriteError(
        f"Unknown account '{customer_name}'. Create it first or use one of: "
        + ", ".join(row[0] for row in source["accounts"][:8])
        + ", ..."
    )


def contact_index_for_account(source: dict, acct_index: int) -> int:
    for index, row in enumerate(source["contacts"]):
        if row[2] == acct_index:
            return index
    raise WriteError("Account has no contact on record")


def option_value(record: dict, field: str, default: int) -> int:
    value = record.get(field, default)
    if value not in OPTION_FIELDS[field]:
        raise WriteError(
            f"{field} must be one of {sorted(OPTION_FIELDS[field])}"
        )
    return value


def create_account(source: dict, record: dict) -> dict:
    name = require_name(record.get("name"), "name")
    if any(row[0].casefold() == name.casefold() for row in source["accounts"]):
        raise WriteError(f"Account '{name}' already exists")
    primary = record.get("primarycontact")
    if not isinstance(primary, dict):
        raise WriteError(
            "Account create requires a 'primarycontact' object with "
            "firstname, lastname, jobtitle (every account must have a "
            "contact — same rule as the real tenant)"
        )
    first = require_name(primary.get("firstname"), "primarycontact.firstname")
    last = require_name(primary.get("lastname"), "primarycontact.lastname")
    job = require_name(primary.get("jobtitle"), "primarycontact.jobtitle")
    city = require_name(record.get("address1_city", "Springfield"), "address1_city")
    region = require_name(record.get("address1_stateorprovince", "IL"), "address1_stateorprovince")
    postal = str(record.get("address1_postalcode", "62701")).strip()
    if not re.fullmatch(r"[0-9]{5}", postal):
        raise WriteError("address1_postalcode must be a 5-digit ZIP")
    industry = require_name(record.get("industrycode", "General"), "industrycode")

    acct_index = len(source["accounts"])
    source["accounts"].append(
        [name, domain_for(name, source), city, region, postal, industry]
    )
    source["contacts"].append([first, last, acct_index, job])
    return {
        "entity": "accounts",
        "operation": "create",
        "name": name,
        "accountnumber": f"AST-{1001 + acct_index:04d}",
        "accountid": record_guid(source, "accounts", acct_index),
        "primary_contact": f"{first} {last}",
    }


def create_contact(source: dict, record: dict) -> dict:
    first = require_name(record.get("firstname"), "firstname")
    last = require_name(record.get("lastname"), "lastname")
    job = require_name(record.get("jobtitle", "Contact"), "jobtitle")
    acct_index = account_index(
        source, require_name(record.get("parentcustomeridname"), "parentcustomeridname")
    )
    fullname = f"{first} {last}".casefold()
    if any(
        f"{row[0]} {row[1]}".casefold() == fullname and row[2] == acct_index
        for row in source["contacts"]
    ):
        raise WriteError(f"Contact '{first} {last}' already exists on that account")
    contact_idx = len(source["contacts"])
    source["contacts"].append([first, last, acct_index, job])
    return {
        "entity": "contacts",
        "operation": "create",
        "fullname": f"{first} {last}",
        "contactid": record_guid(source, "contacts", contact_idx),
        "account": source["accounts"][acct_index][0],
    }


def create_incident(source: dict, record: dict) -> dict:
    title = require_name(record.get("title"), "title")
    if any(row[0].casefold() == title.casefold() for row in source["cases"]):
        raise WriteError(f"A case titled '{title}' already exists")
    acct_index = account_index(
        source, require_name(record.get("customeridname"), "customeridname")
    )
    contact_idx = contact_index_for_account(source, acct_index)
    priority = option_value(record, "prioritycode", 2)
    origin = option_value(record, "caseorigincode", 3)
    case_type = option_value(record, "casetypecode", 2)
    state = record.get("statecode", 0)
    if state not in {0, 1, 2}:
        raise WriteError("statecode must be 0 (Active), 1 (Resolved), or 2 (Canceled)")
    case_index = len(source["cases"])
    source["cases"].append(
        [title, acct_index, contact_idx, priority - 1, origin - 1, case_type - 1, state]
    )
    return {
        "entity": "incidents",
        "operation": "create",
        "title": title,
        "ticketnumber": f"CAS-{260100 + case_index:06d}",
        "incidentid": record_guid(source, "incidents", case_index),
        "account": source["accounts"][acct_index][0],
    }


def locate_incident(source: dict, ticketnumber: str) -> int:
    match = re.fullmatch(r"CAS-(\d{6})", str(ticketnumber or "").strip())
    if not match:
        raise WriteError("update/delete address incidents by ticketnumber (CAS-xxxxxx)")
    index = int(match.group(1)) - 260100
    if not (0 <= index < len(source["cases"])):
        raise WriteError(f"No case with ticketnumber {ticketnumber}")
    return index


def update_incident(source: dict, record: dict) -> dict:
    index = locate_incident(source, record.get("ticketnumber"))
    row = source["cases"][index]
    changed = []
    if "title" in record:
        retitled = require_name(record["title"], "title")
        if any(
            i != index and r[0].casefold() == retitled.casefold()
            for i, r in enumerate(source["cases"])
        ):
            raise WriteError(f"A case titled '{retitled}' already exists")
        row[0] = retitled
        changed.append("title")
    for field, position in (("prioritycode", 3), ("caseorigincode", 4), ("casetypecode", 5)):
        if field in record:
            row[position] = option_value(record, field, row[position] + 1) - 1
            changed.append(field)
    if "statecode" in record:
        if record["statecode"] not in {0, 1, 2}:
            raise WriteError("statecode must be 0, 1, or 2")
        row[6] = record["statecode"]
        changed.append("statecode")
    if not changed:
        raise WriteError(
            "Nothing to update — send one of: title, prioritycode, "
            "caseorigincode, casetypecode, statecode"
        )
    return {
        "entity": "incidents",
        "operation": "update",
        "ticketnumber": record["ticketnumber"],
        "changed": changed,
        "title": row[0],
    }


def delete_incident(source: dict, record: dict) -> dict:
    index = locate_incident(source, record.get("ticketnumber"))
    if index < PROTECTED_INCIDENT_ROWS:
        raise WriteError(
            "Simulator policy: the original service history (cases paired "
            "with work orders and assets) is retained — only later cases "
            "can be deleted"
        )
    removed = source["cases"].pop(index)
    return {
        "entity": "incidents",
        "operation": "delete",
        "ticketnumber": record["ticketnumber"],
        "title": removed[0],
        "note": (
            "Later case ticket numbers shift down by one — ticketnumber is "
            "positional in this simulator"
        ),
    }


def record_guid(source: dict, entity: str, index: int) -> str:
    namespace = uuid.UUID(source["namespace"])
    return str(uuid.uuid5(namespace, f"static-dynamics-365/{entity}/{index}"))


def refresh_schema_counts(source: dict) -> None:
    schema = load_json(SCHEMA_PATH)
    entities = schema["entities"]
    entities["accounts"]["expectedCount"] = len(source["accounts"])
    entities["contacts"]["expectedCount"] = len(source["contacts"])
    entities["incidents"]["expectedCount"] = len(source["cases"])
    entities["incidentresolutions"]["expectedCount"] = sum(
        1 for row in source["cases"] if row[6] == 1
    )
    save_json(SCHEMA_PATH, schema)


HANDLERS = {
    ("create", "accounts"): create_account,
    ("create", "contacts"): create_contact,
    ("create", "incidents"): create_incident,
    ("update", "incidents"): update_incident,
    ("delete", "incidents"): delete_incident,
}


def process(command: dict) -> dict:
    operation = command.get("operation")
    entity = command.get("entity")
    record = command.get("record")
    if not isinstance(record, dict):
        raise WriteError("'record' must be an object")
    handler = HANDLERS.get((operation, entity))
    if handler is None:
        supported = ", ".join(f"{op} {ent}" for op, ent in sorted(HANDLERS))
        raise WriteError(
            f"Unsupported operation '{operation} {entity}'. "
            f"Supported: {supported}"
        )
    source = load_json(SOURCE_PATH)
    receipt = handler(source, record)
    save_json(SOURCE_PATH, source)
    refresh_schema_counts(source)
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in repository:
        owner, name = repository.split("/", 1)
        receipt["read_url"] = (
            f"https://{owner}.github.io/{name}/api/data/v9.2/"
            f"{receipt['entity']}.json"
        )
    else:
        receipt["read_url"] = f"api/data/v9.2/{receipt['entity']}.json"
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--event-path")
    parser.add_argument("--test")
    args = parser.parse_args()

    try:
        if args.test:
            command = json.loads(args.test)
        else:
            event = load_json(Path(args.event_path or os.environ["GITHUB_EVENT_PATH"]))
            issue = event.get("issue", {})
            title = issue.get("title", "")
            if not title.startswith("[SD365]"):
                print(json.dumps({"skipped": "title lacks [SD365] prefix"}))
                return 0
            command = extract_command(issue.get("body", ""))
        receipt = process(command)
    except (WriteError, KeyError, json.JSONDecodeError) as exc:
        error = {"ok": False, "error": str(exc)}
        print(json.dumps(error, indent=2))
        output = os.environ.get("GITHUB_OUTPUT")
        if output:
            with open(output, "a", encoding="utf-8") as fh:
                fh.write("ok=false\n")
                fh.write(f"receipt={json.dumps(error)}\n")
        return 1

    receipt["ok"] = True
    print(json.dumps(receipt, indent=2))
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as fh:
            fh.write("ok=true\n")
            fh.write(f"receipt={json.dumps(receipt)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
