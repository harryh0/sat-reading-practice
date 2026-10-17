"""Import a reviewed practice-test PDF pair without publishing either original PDF."""

import argparse
import json
import sys
from pathlib import Path

from pdf_importer import ROOT, import_test


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("test_pdf", type=Path)
    parser.add_argument("answers_pdf", type=Path)
    parser.add_argument("--test-number", type=int, default=11)
    parser.add_argument("--check", action="store_true", help="Rebuild and compare without modifying derived files.")
    parser.add_argument("--audit", type=Path, help="Optional local audit-report output; do not supply a source-PDF path.")
    args = parser.parse_args()
    if args.audit and args.audit.resolve() in {args.test_pdf.resolve(), args.answers_pdf.resolve()}:
        parser.error("The audit output cannot overwrite either supplied source PDF.")
    result, audit = import_test(args.test_number, args.test_pdf, args.answers_pdf, write_assets=not args.check)
    output = ROOT / "src" / "data" / f"practice-test-{args.test_number}.json"
    if args.check:
        if not output.exists() or json.loads(output.read_text(encoding="utf-8")) != result:
            raise ValueError(f"{output.name} differs from the supplied PDF extraction.")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(".json.tmp")
        try:
            temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            temporary.replace(output)
        finally:
            if temporary.exists():
                temporary.unlink()
    if args.audit:
        args.audit.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Practice Test {args.test_number}: {audit['moduleQuestionCounts']} Reading and Writing questions; "
          f"{audit['choices']} complete choices; {audit['explanations']} mapped explanations; "
          f"{audit['figures']} original figures. {'Verified' if args.check else 'Saved'} {output.name}.")


if __name__ == "__main__":
    main()
