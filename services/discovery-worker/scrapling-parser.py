#!/usr/bin/env python3
"""Scrapling parser-only adapter for already-captured AXIVESTRA evidence.

This process reads one HTML snapshot from stdin and emits bounded table-cell
observations. It does not perform HTTP requests, browser automation, proxy
rotation, CAPTCHA handling, anti-bot bypass, link discovery, or crawling.
"""
from __future__ import annotations

import json
import sys
import re
from scrapling.parser import Selector

MAX_HTML_BYTES = 5_000_000
MAX_OBSERVATIONS = 20_000
MAX_TEXT_CHARS = 20_000


def text_of(node: Selector) -> str:
    try:
        fragments = node.xpath(".//text()").getall()
    except Exception:
        fragments = []
    return " ".join(str(part).strip() for part in fragments if str(part).strip()).strip()


def normalise_key(value: str) -> str:
    return re.sub(r"^_+|_+$", "", re.sub(r"[^\w]+", "_", str(value).strip().lower(), flags=re.UNICODE))


def extract_table_observations(html: str, field_schema: dict) -> list[dict]:
    page = Selector(html, adaptive=False)
    aliases = set()
    for field, config in (field_schema or {}).items():
        aliases.add(normalise_key(field))
        if isinstance(config, dict):
            aliases.update(normalise_key(alias) for alias in config.get("aliases", []) if isinstance(alias, str))

    observations: list[dict] = []
    for table_index, table in enumerate(page.css("table")):
        rows = table.css("tr")
        if not rows:
            continue
        first_cells = rows[0].css("th,td")
        first_texts = [text_of(cell)[:MAX_TEXT_CHARS] for cell in first_cells]
        matched = sum(1 for value in first_texts if value and normalise_key(value) in aliases)
        header_marked = any(bool(cell.xpath("self::th").get()) for cell in first_cells)
        schema_header = len(first_cells) > 1 and matched >= 2 and matched >= (len(first_texts) + 1) // 2
        is_header = header_marked or schema_header

        if is_header:
            headers = first_texts
            data_rows = rows[1:]
            row_start = 2
            for row_offset, row in enumerate(data_rows):
                cells = row.css("th,td")
                row_number = row_start + row_offset
                for column_index, cell in enumerate(cells):
                    if len(observations) >= MAX_OBSERVATIONS:
                        return observations
                    if column_index >= len(headers):
                        continue
                    key = headers[column_index]
                    value = text_of(cell)
                    if not key or not value or len(value) > MAX_TEXT_CHARS:
                        continue
                    observations.append({
                        "key": key[:160],
                        "value": value,
                        "span": {
                            "kind": "scrapling-table-cell",
                            "locator": f"table:nth-of-type({table_index + 1}) tr:nth-of-type({row_number}) cell:nth-of-type({column_index + 1})",
                            "row": row_number,
                            "column": column_index + 1,
                            "header": key[:160],
                        },
                        "confidence": 0.92,
                    })
        else:
            for row_index, row in enumerate(rows):
                cells = row.css("th,td")
                if len(cells) < 2:
                    continue
                key = text_of(cells[0])
                if not key:
                    continue
                for column_index, cell in enumerate(cells[1:], start=2):
                    if len(observations) >= MAX_OBSERVATIONS:
                        return observations
                    value = text_of(cell)
                    if not value or len(value) > MAX_TEXT_CHARS:
                        continue
                    observations.append({
                        "key": key[:160],
                        "value": value,
                        "span": {
                            "kind": "scrapling-key-value-cell",
                            "locator": f"table:nth-of-type({table_index + 1}) tr:nth-of-type({row_index + 1}) cell:nth-of-type({column_index})",
                            "row": row_index + 1,
                            "column": column_index,
                        },
                        "confidence": 0.90,
                    })
    return observations


def main() -> int:
    payload = json.load(sys.stdin)
    html = payload.get("html")
    schema = payload.get("fieldSchema", {})
    if not isinstance(html, str):
        raise ValueError("Scrapling parser requires HTML text.")
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError("Scrapling parser input exceeds the 5 MB evidence limit.")
    if not isinstance(schema, dict):
        raise ValueError("Scrapling parser field schema must be an object.")
    observations = extract_table_observations(html, schema)
    json.dump({"observations": observations}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        # Never emit source HTML or extracted values on stderr.
        sys.stderr.write("AXIVESTRA Scrapling parser failed: " + type(error).__name__ + "\n")
        raise SystemExit(1)
