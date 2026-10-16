"""Import the two user-provided, nondigital-format Practice Test 11 PDFs."""

import argparse
import hashlib
import html
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
FLAGS = (
    pymupdf.TEXTFLAGS_DICT
    | pymupdf.TEXT_IGNORE_ACTUALTEXT
    | pymupdf.TEXT_COLLECT_STYLES
)
MODULE_PAGES = {1: range(3, 16), 2: range(17, 30)}
ANSWER_PAGES = {1: range(1, 17), 2: range(17, 33)}
FIGURES = {
    (1, 15): {
        "rect": (53, 130, 280, 346),
        "alt": "Energy Density of Four Fuels. Bar graph with fuels gasoline, ethanol, POP biofuel, and jet fuel on the horizontal axis, and energy density from 0 to 45 megajoules per liter on the vertical axis.",
        "table": {
            "caption": "Values read from the graph (approximately, in MJ/L)",
            "headers": ["Fuel", "Energy density"],
            "rows": [["Gasoline", "36"], ["Ethanol", "23"], ["POP biofuel", "40"], ["Jet fuel", "34"]],
        },
    },
    (2, 11): {
        "rect": (53, 130, 281, 382),
        "alt": "Census Data for Four Canadian Cities, 1871-1901. Line graph of population in thousands for Halifax, Montreal, Quebec City, and Toronto, with a key identifying each line.",
        "table": {
            "caption": "Populations read from the graph (approximately, in thousands)",
            "headers": ["City", "1871", "1881", "1891", "1901"],
            "rows": [
                ["Halifax", "30", "40", "40", "40"],
                ["Montréal", "105", "140", "220", "270"],
                ["Québec City", "60", "60", "65", "70"],
                ["Toronto", "55", "85", "180", "210"],
            ],
        },
    },
    (2, 12): {
        "rect": (332, 130, 560, 365),
        "alt": "Percent of Drawings Containing an Example of Each Animal Group. Bar graph with mammals, birds, and insects on the horizontal axis, and percent of drawings from 0 to 90 on the vertical axis.",
        "table": {
            "caption": "Percentages read from the graph (approximately)",
            "headers": ["Animal group", "Percent of drawings"],
            "rows": [["Mammals", "80"], ["Birds", "68"], ["Insects", "54"]],
        },
    },
    (2, 13): {
        "rect": (71, 130, 297, 361),
        "alt": "Percentage of US Congress Members Who Self-Identified as Veterans, 1953-2023. Line graph for the House of Representatives and Senate, with percent on the vertical axis and years on the horizontal axis.",
        "table": {
            "caption": "Percentages read from the graph (approximately)",
            "headers": ["Year", "House of Representatives", "Senate"],
            "rows": [
                ["1953", "62", "74"],
                ["1973", "74", "79"],
                ["1993", "40", "63"],
                ["2003", "23", "35"],
                ["2013", "17", "18"],
                ["2023", "19", "17"],
            ],
        },
    },
}


@dataclass
class Line:
    spans: list
    bbox: tuple
    page: int
    column: int

    @property
    def text(self):
        return "".join(span["text"] for span in self.spans)


def clean(text):
    return unicodedata.normalize("NFKC", text).replace("\u00ad", "").replace("\u00a0", " ")


def page_lines(page, column):
    result = []
    for block in page.get_text("dict", flags=FLAGS)["blocks"]:
        for line in block.get("lines", []):
            if (line["bbox"][0] >= 306) != bool(column):
                continue
            result.append(Line(line["spans"], tuple(line["bbox"]), page.number + 1, column))
    return sorted(result, key=lambda line: (round(line.bbox[1], 1), line.bbox[0]))


def is_badge(line):
    return (
        100 < line.bbox[1] < 720
        and re.fullmatch(r"\d{1,2}", line.text.strip())
        and all(span["font"] == "MinionPro-Regular" and span["color"] == 16777215 for span in line.spans)
    )


def render_line(line, remove_prefix=0):
    parts = []
    blank = False
    skip = remove_prefix
    for span in line.spans:
        text = clean(span["text"])
        if skip:
            remaining = max(0, skip - len(text))
            text = text[skip:]
            skip = remaining
        if not text:
            continue
        if span["color"] == 16777215:
            if not blank:
                parts.append('<span class="blank" aria-label="blank">______</span>')
            blank = True
            continue
        blank = False
        value = html.escape(text.replace("\t", " "))
        if span["flags"] & pymupdf.TEXT_FONT_ITALIC:
            value = f"<em>{value}</em>"
        if span["flags"] & pymupdf.TEXT_FONT_BOLD:
            value = f"<strong>{value}</strong>"
        if span["char_flags"] & 2 and text.strip():
            value = f"<u>{value}</u>"
        if span["flags"] & pymupdf.TEXT_FONT_SUPERSCRIPT:
            value = f"<sup>{value}</sup>"
        parts.append(value)
    result = "".join(parts).strip()
    result = re.sub(r"(</span>)\s+(?=[:;,.!?—])", r"\1", result)
    return result


def joined_html(lines, first_prefix=0, preserve_lines=False):
    result = ""
    previous = ""
    for index, line in enumerate(lines):
        value = render_line(line, first_prefix if index == 0 else 0)
        separator = "<br>" if preserve_lines else ("" if previous.rstrip().endswith("-") else " ")
        result += (separator if result else "") + value
        previous = line.text
    return re.sub(r"\s+", " ", result).strip()


def canonical(text):
    text = html.unescape(re.sub(r"<[^>]*>", "", text))
    text = re.sub(r"\bb\s+l\s+a\s+n\s+k\b", "______", clean(text))
    return re.sub(r"\s|•", "", text)


def verify_rendered_text(lines, rendered, question_id):
    source = " ".join(re.sub(r"^\s*[A-D]\)\s*", "", line.text) for line in lines)
    if canonical(source) != canonical(rendered):
        raise ValueError(f"Rendered content does not preserve every source character: {question_id}")


def groups(lines):
    result = []
    for line in lines:
        previous = result[-1][-1] if result else None
        heading = bool(re.fullmatch(r"Text [12]", line.text.strip()))
        bullet = line.text.lstrip().startswith("•")
        boundary = (
            previous is None
            or previous.page != line.page
            or previous.column != line.column
            or line.bbox[1] - previous.bbox[1] > 16
            or heading
            or bool(re.fullmatch(r"Text [12]", previous.text.strip()))
            or bullet
        )
        if boundary:
            result.append([])
        result[-1].append(line)
    return result


def render_passage(paragraphs):
    result = []
    in_list = False
    introduction = " ".join(line.text for line in paragraphs[0]) if paragraphs else ""
    has_poem = "poem" in introduction.lower() and "following text" in introduction.lower()
    for index, paragraph in enumerate(paragraphs):
        first = paragraph[0]
        bullet = first.text.lstrip().startswith("•")
        if in_list and not bullet:
            result.append("</ul>")
            in_list = False
        if bullet:
            if not in_list:
                result.append('<ul class="source-notes">')
                in_list = True
            prefix = first.text.index("•") + 1
            result.append(f"<li>{joined_html(paragraph, prefix)}</li>")
        elif re.fullmatch(r"Text [12]", first.text.strip()):
            result.append(f'<h3 class="text-label">{joined_html(paragraph)}</h3>')
        elif first.text.lstrip().startswith("©"):
            result.append(f'<p class="source-credit">{joined_html(paragraph)}</p>')
        elif has_poem and index > 0:
            result.append(f'<blockquote class="verse">{joined_html(paragraph, preserve_lines=True)}</blockquote>')
        else:
            result.append(f"<p>{joined_html(paragraph)}</p>")
    if in_list:
        result.append("</ul>")
    return "".join(result)


def import_questions(document):
    modules = []
    for module, pages in MODULE_PAGES.items():
        questions = []
        current = None
        for page_index in pages:
            page = document[page_index]
            for column in (0, 1):
                lines = page_lines(page, column)
                badges = [line for line in lines if is_badge(line)]
                for line in lines:
                    if is_badge(line):
                        current = {
                            "id": f"m{module}-q{int(line.text)}",
                            "module": module,
                            "number": int(line.text),
                            "lines": [],
                            "sourcePage": page_index + 1,
                        }
                        questions.append(current)
                    elif current is not None and 100 < line.bbox[1] < 730:
                        if badges and line.bbox[1] < badges[0].bbox[1]:
                            continue
                        if not any(span["font"].startswith("MinionPro") for span in line.spans):
                            if not line.text.lstrip().startswith("©"):
                                continue
                        figure = FIGURES.get((module, current["number"]))
                        if figure:
                            rect = pymupdf.Rect(figure["rect"])
                            if rect.contains(pymupdf.Point(line.bbox[0] + 1, line.bbox[1] + 1)):
                                continue
                        current["lines"].append(line)
        if [question["number"] for question in questions] != list(range(1, 34)):
            raise ValueError(f"Module {module} must contain the 33 ordered source questions.")
        for question in questions:
            lines = question.pop("lines")
            option_start = next(i for i, line in enumerate(lines) if re.match(r"^A\)\s*", line.text.lstrip()))
            paragraphs = groups(lines[:option_start])
            if len(paragraphs) < 2:
                raise ValueError(f"Passage/prompt boundary missing: {question['id']}")
            question["passageHtml"] = render_passage(paragraphs[:-1])
            question["promptHtml"] = joined_html(paragraphs[-1])
            choices = []
            for line in lines[option_start:]:
                match = re.match(r"^\s*([A-D])\)\s*", line.text)
                if match:
                    choices.append({"id": match[1], "lines": [], "prefix": match.end()})
                if not choices:
                    raise ValueError(f"Option boundary missing: {question['id']}")
                choices[-1]["lines"].append(line)
            question["choices"] = [
                {"id": choice["id"], "html": joined_html(choice["lines"], choice["prefix"])}
                for choice in choices
            ]
            verify_rendered_text(
                lines,
                question["passageHtml"] + question["promptHtml"] + "".join(choice["html"] for choice in question["choices"]),
                question["id"],
            )
            if [choice["id"] for choice in question["choices"]] != list("ABCD"):
                raise ValueError(f"Exactly four complete choices required: {question['id']}")
            if not all(choice["html"] for choice in question["choices"]):
                raise ValueError(f"Empty option: {question['id']}")
            figure = FIGURES.get((module, question["number"]))
            question["figure"] = None
            if figure:
                name = f"{question['id']}.png"
                path = ROOT / "public" / "figures" / name
                path.parent.mkdir(parents=True, exist_ok=True)
                document[question["sourcePage"] - 1].get_pixmap(
                    matrix=pymupdf.Matrix(3, 3),
                    clip=pymupdf.Rect(figure["rect"]),
                    alpha=False,
                ).save(path)
                question["figure"] = {"src": f"/figures/{name}", "alt": figure["alt"], "table": figure["table"]}
        modules.append({"number": module, "title": f"Module {module}", "questions": questions})
    return modules


def import_answers(document):
    answers = {}
    for module, pages in ANSWER_PAGES.items():
        current = None
        for page_index in pages:
            page = document[page_index]
            lines = []
            for block in page.get_text("dict", flags=FLAGS)["blocks"]:
                for line in block.get("lines", []):
                    if 65 < line["bbox"][1] < 730:
                        lines.append(Line(line["spans"], tuple(line["bbox"]), page_index + 1, 0))
            for line in sorted(lines, key=lambda item: (item.bbox[1], item.bbox[0])):
                match = re.fullmatch(r"QUESTION (\d+)", line.text.strip())
                if match:
                    current = f"m{module}-q{int(match[1])}"
                    if current in answers:
                        raise ValueError(f"Duplicate answer: {current}")
                    answers[current] = {"lines": [], "pages": []}
                elif current:
                    answers[current]["lines"].append(line)
                    if page_index + 1 not in answers[current]["pages"]:
                        answers[current]["pages"].append(page_index + 1)
        expected = {f"m{module}-q{number}" for number in range(1, 34)}
        if not expected.issubset(answers):
            raise ValueError(f"Answer explanations missing in module {module}.")
    for key, answer in answers.items():
        source_lines = answer.pop("lines")
        paragraphs = groups(source_lines)
        merged = []
        for paragraph in paragraphs:
            if merged and merged[-1][-1].page != paragraph[0].page and not re.match(r"Choice [A-D]", paragraph[0].text):
                merged[-1].extend(paragraph)
            else:
                merged.append(paragraph)
        plain = " ".join(line.text for paragraph in merged for line in paragraph)
        correct = re.match(r"\s*Choice ([A-D]) is the best answer", plain)
        if not correct:
            raise ValueError(f"No unambiguous best answer in supplied explanation: {key}")
        answer["correctAnswer"] = correct[1]
        answer["explanationHtml"] = "".join(f"<p>{joined_html(paragraph)}</p>" for paragraph in merged)
        verify_rendered_text(source_lines, answer["explanationHtml"], key + " explanation")
    return answers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("test_pdf", type=Path)
    parser.add_argument("answers_pdf", type=Path)
    args = parser.parse_args()
    modules = import_questions(pymupdf.open(args.test_pdf))
    answers = import_answers(pymupdf.open(args.answers_pdf))
    for module in modules:
        for question in module["questions"]:
            answer = answers[question["id"]]
            question.update({key: value for key, value in answer.items() if key != "pages"})
            question["answerPages"] = answer["pages"]
    result = {
        "id": "sat-practice-test-11-rw-2026",
        "title": "SAT Practice Test 11",
        "section": "Reading and Writing",
        "questionCount": 66,
        "sources": {
            "test": "https://satsuite.collegeboard.org/media/pdf/sat-practice-test-11-digital.pdf",
            "answers": "https://satsuite.collegeboard.org/media/pdf/sat-practice-test-11-answers-digital.pdf",
            "testSha256": hashlib.sha256(args.test_pdf.read_bytes()).hexdigest(),
            "answersSha256": hashlib.sha256(args.answers_pdf.read_bytes()).hexdigest(),
            "testPdfPages": [[4, 16], [18, 30]],
            "answerPdfPages": [[2, 17], [18, 33]],
            "note": "Imported locally from the two user-provided PDFs. Nondigital-format test: two modules of 33 questions. Math excluded.",
        },
        "modules": modules,
    }
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    for invalid in ["Start referenced", "ContentStart", "\ufffd", "b l a n k"]:
        if invalid in serialized:
            raise ValueError(f"Unresolved PDF extraction artifact: {invalid}")
    output = ROOT / "src" / "data" / "practice-test-11.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(serialized, encoding="utf-8")
    print(f"Imported {sum(len(module['questions']) for module in modules)} Reading and Writing questions, 66 official explanations, and {len(FIGURES)} original figures.")
    print(f"Saved {output}")


if __name__ == "__main__":
    main()
