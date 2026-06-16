"""Idempotent ClickHouse migration runner.

Applies every NNN_*.sql in this directory, in order, exactly once. Applied
migrations are recorded in `_meta.schema_migrations` (checksum-verified), so
re-running is safe and a changed-after-apply file fails loudly.

Usage:
    python run_migrations.py                 # apply pending
    python run_migrations.py --status        # show applied/pending
    CLICKHOUSE_URL=http://ch:8123 python run_migrations.py
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

import clickhouse_connect  # pip install clickhouse-connect

MIG_DIR = Path(__file__).parent
NAME_RE = re.compile(r"^(\d{3})_.+\.sql$")


def client():
    return clickhouse_connect.get_client(
        host=os.getenv("CLICKHOUSE_HOST", "localhost"),
        port=int(os.getenv("CLICKHOUSE_PORT", "8123")),
        username=os.getenv("CLICKHOUSE_USER", "default"),
        password=os.getenv("CLICKHOUSE_PASSWORD", ""),
    )


def ensure_meta(ch):
    ch.command("CREATE DATABASE IF NOT EXISTS _meta")
    ch.command(
        """
        CREATE TABLE IF NOT EXISTS _meta.schema_migrations (
            version String, checksum String, applied_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(applied_at) ORDER BY version
        """
    )


def discover():
    files = sorted(p for p in MIG_DIR.glob("*.sql") if NAME_RE.match(p.name))
    return [(NAME_RE.match(p.name).group(1), p) for p in files]


def applied(ch) -> dict[str, str]:
    rows = ch.query("SELECT version, checksum FROM _meta.schema_migrations FINAL").result_rows
    return {v: c for v, c in rows}


def split_statements(sql: str) -> list[str]:
    # ClickHouse HTTP runs one statement per call; split on ';' at line ends.
    stmts, buf = [], []
    for line in sql.splitlines():
        if line.strip().startswith("--"):
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            stmt = "\n".join(buf).strip().rstrip(";").strip()
            if stmt:
                stmts.append(stmt)
            buf = []
    tail = "\n".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    ch = client()
    ensure_meta(ch)
    done = applied(ch)

    if args.status:
        for ver, path in discover():
            mark = "✓" if ver in done else "·"
            print(f" {mark} {ver}  {path.name}")
        return

    for ver, path in discover():
        sql = path.read_text()
        checksum = hashlib.sha256(sql.encode()).hexdigest()[:16]
        if ver in done:
            if done[ver] != checksum:
                sys.exit(f"ERROR: {path.name} changed after being applied "
                         f"(was {done[ver]}, now {checksum}). Add a new migration.")
            continue
        print(f"applying {path.name} ...")
        for stmt in split_statements(sql):
            ch.command(stmt)
        ch.insert("_meta.schema_migrations", [[ver, checksum]],
                  column_names=["version", "checksum"])
        print(f"  done {path.name}")
    print("migrations up to date.")


if __name__ == "__main__":
    main()
