import json
from scrapling.parser import Selector
from scrapling_parser import extract_table_observations

HTML = """
<html><body>
<table>
  <thead><tr><th>Sr. No.</th><th>Name of the Bank</th><th>Website</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>Example Bank Limited</td><td>https://bank.example.in</td></tr>
  </tbody>
</table>
</body></html>
"""
SCHEMA = {
    "institution_name": {"type": "string", "aliases": ["Name of the Bank"], "entityKind": "organization"},
    "official_website_url": {"type": "url", "aliases": ["Website"]},
}


def run() -> None:
    # Parser-only smoke: prove the library consumes a supplied snapshot.
    assert Selector(HTML, adaptive=False).css("table")
    observations = extract_table_observations(HTML, SCHEMA)
    assert any(item["key"] == "Name of the Bank" and item["value"] == "Example Bank Limited" for item in observations)
    assert any(item["key"] == "Website" and item["value"] == "https://bank.example.in" for item in observations)
    assert all(item["span"]["kind"].startswith("scrapling") for item in observations)
    print(json.dumps({"ok": True, "observations": len(observations)}))


if __name__ == "__main__":
    run()
