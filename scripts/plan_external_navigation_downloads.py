"""
Print the external dataset download plan for the navigation model.

This deliberately does not auto-download multi-GB/gated datasets. Most strong
sources for this project require account login or license acceptance, and those
steps should be explicit for a research paper.
"""

from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "dataset_sources" / "navigation_sources.yaml"


def main() -> None:
    manifest = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    sources = manifest.get("sources", [])

    print("External Navigation Dataset Plan")
    print(f"Manifest: {MANIFEST}")
    print("\nRecommended order:")

    for index, source in enumerate(sources, start=1):
        useful = ", ".join(source.get("useful_for", []))
        print(f"\n{index}. {source['name']} [{source['id']}]")
        print(f"   Priority: {source.get('priority', 'unknown')}")
        print(f"   Task: {source.get('task', 'unknown')}")
        print(f"   Access: {source.get('access', 'unknown')}")
        print(f"   Size: {source.get('size', 'unknown')}")
        print(f"   URL: {source.get('url')}")
        if source.get("mirror"):
            print(f"   Mirror: {source['mirror']}")
        print(f"   Useful for: {useful}")
        print(f"   Action: {source.get('action', '')}")
        print(f"   Notes: {source.get('notes', '')}")

    print("\nFirst practical download:")
    print("  IDD Lite -> dataset/external/idd_lite")
    print("  Then run a converter/visual QA before any training merge.")


if __name__ == "__main__":
    main()
