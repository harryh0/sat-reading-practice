"""Shared, source-validated extraction for the uploaded reading and writing PDFs."""

import hashlib
import html
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
FLAGS = pymupdf.TEXTFLAGS_DICT | pymupdf.TEXT_IGNORE_ACTUALTEXT | pymupdf.TEXT_COLLECT_STYLES


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


def load_layout(number):
    layouts = json.loads((Path(__file__).with_name("import_layouts.json")).read_text(encoding="utf-8"))
    if str(number) not in layouts:
        raise ValueError(f"No reviewed import layout for Practice Test {number}.")
    return layouts[str(number)]


def verify_cover(document, number, kind):
    cover = clean(document[0].get_text(flags=FLAGS))
    numbered_title = re.search(rf"Test\s*#?\s*{number}\b", cover, re.I)
    separated_number = re.search(r"Test\s*#", cover, re.I) and re.search(rf"(?m)^\s*{number}\s*$", cover)
    if not numbered_title and not separated_number:
        raise ValueError(f"The supplied {kind} PDF cover does not identify Practice Test {number}.")


def discover_question_modules(document, expected):
    headers = []
    math_start = None
    for index, page in enumerate(document):
        text = clean(page.get_text(flags=FLAGS))
        count = re.search(r"(\d+)\s+QUESTIONS\b", text)
        if count and re.search(r"(?m)^\s*Math\s*$", text):
            math_start = index
            break
        if count and "Reading and Writing" in text:
            headers.append((index, int(count[1])))
    if [count for _, count in headers] != expected or math_start is None:
        raise ValueError(f"Unexpected Reading and Writing module headers: {headers}; expected {expected}.")
    return [
        (module + 1, start, headers[module + 1][0] if module + 1 < len(headers) else math_start, count)
        for module, (start, count) in enumerate(headers)
    ]


def discover_answer_modules(document, expected):
    modules = {}
    for index, page in enumerate(document):
        header = clean(page.get_text(clip=pymupdf.Rect(0, 0, page.rect.width, 70), flags=FLAGS))
        match = re.search(r"READING\s+AND\s+WRITING\s*:\s*MODULE\s*(\d+)", header, re.I)
        if match:
            modules.setdefault(int(match[1]), []).append(index)
    if sorted(modules) != list(range(1, len(expected) + 1)):
        raise ValueError(f"Unexpected answer-reference module headers: {list(modules)}.")
    return modules


def all_page_lines(page):
    result = []
    for block in page.get_text("dict", flags=FLAGS)["blocks"]:
        for line in block.get("lines", []):
            result.append(Line(line["spans"], tuple(line["bbox"]), page.number + 1, int(line["bbox"][0] >= 306)))
    return result


def question_badges(lines, column):
    grouped = {}
    for line in lines:
        for span in line.spans:
            text = span["text"].strip()
            x, y, _, _ = span["bbox"]
            if not (
                100 < y < 720
                and (30 < x < 80 if column == 0 else 310 < x < 352)
                and span["color"] == 16777215
                and "Minion" in span["font"]
                and re.fullmatch(r"\d[\d\s]*", text)
            ):
                continue
            key = round(span["origin"][1], 1)
            group = grouped.setdefault(key, [])
            if not any(other["bbox"] == span["bbox"] and other["text"] == span["text"] for other in group):
                group.append(span)
    badges = []
    for spans in grouped.values():
        spans.sort(key=lambda span: span["bbox"][0])
        number = int("".join(span["text"] for span in spans).replace(" ", "").strip())
        bbox = pymupdf.Rect()
        for span in spans:
            bbox |= pymupdf.Rect(span["bbox"])
        badges.append((number, tuple(bbox)))
    return sorted(badges, key=lambda badge: badge[1][1])


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
    return re.sub(r"(</span>)\s+(?=[:;,.!?—])", r"\1", "".join(parts).strip())


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


def verify_rendered_text(lines, rendered, context):
    source = " ".join(re.sub(r"^\s*[A-D]\)\s*", "", line.text) for line in lines)
    expected, actual = canonical(source), canonical(rendered)
    if expected != actual:
        index = next((i for i, (a, b) in enumerate(zip(expected, actual)) if a != b), min(len(expected), len(actual)))
        raise ValueError(
            f"{context}: rendered text differs from the source at character {index}: "
            f"{expected[max(0, index-35):index+70]!r} versus {actual[max(0, index-35):index+70]!r}."
        )


def groups(lines, separate_credits=True):
    result = []
    for line in lines:
        previous = result[-1][-1] if result else None
        heading = bool(re.fullmatch(r"Text [12]", line.text.strip()))
        boundary = (
            previous is None
            or previous.page != line.page
            or previous.column != line.column
            or line.bbox[1] - previous.bbox[1] > 16
            or heading
            or bool(re.fullmatch(r"Text [12]", previous.text.strip()))
            or line.text.lstrip().startswith("•")
            or (separate_credits and line.text.lstrip().startswith("©") and not previous.text.lstrip().startswith("©"))
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
            result.append(f"<li>{joined_html(paragraph, first.text.index('•') + 1)}</li>")
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


def split_prompt(lines, context):
    starter = re.compile(r"^\s*(?:Which|What|Based on|According to|As used|How|In the text|It can most|The student (?:wants|needs)|A student (?:wants|needs))\b")
    candidates = [index for index, line in enumerate(lines) if starter.match(line.text)]
    if not candidates:
        raise ValueError(f"{context}: no unambiguous source prompt boundary.")
    start = candidates[-1]
    last_note = max((index for index, line in enumerate(lines) if line.text.lstrip().startswith("•")), default=-1)
    goals = [index for index, line in enumerate(lines) if index > last_note and re.match(r"^\s*(?:The|A) student (?:wants|needs)\b", line.text)]
    if last_note >= 0 and goals:
        start = goals[-1]
    return lines[:start], lines[start:]


def known_question_furniture(line):
    text = clean(line.text).strip()
    return bool(
        re.fullmatch(r"STOP|CONTINUE|No Test Material On This Page", text, re.I)
        or text.startswith("If you finish before time is called")
        or text.startswith("Do not turn to any other module")
        or (line.bbox[1] > 720 and text.isdecimal() and all("Myriad" in span["font"] for span in line.spans))
    )


def line_key(line):
    return line.page, tuple(round(value, 3) for value in line.bbox), line.text


def append_region(question, lines, top, bottom, layout):
    figure = layout["figures"].get(question["id"])
    for line in lines:
        if not top <= line.bbox[1] < bottom or not line.text.strip():
            continue
        if figure and line.page == figure.get("page", question["sourcePage"]):
            rect = pymupdf.Rect(figure["rect"])
            if rect.contains(pymupdf.Point(line.bbox[0] + 1, line.bbox[1] + 1)):
                continue
        if known_question_furniture(line):
            continue
        if any("Minion" in span["font"] for span in line.spans):
            question["_lines"].append(line)
        elif line.text.lstrip().startswith("©"):
            question["_lines"].append(line)
        elif all("Myriad" in span["font"] for span in line.spans):
            question["_lines"].append(line)
        elif re.fullmatch(r"[\s.\-–—_~|•·:,'`…=+\\/<>\"()\[\]{}]+", line.text):
            continue
        else:
            raise ValueError(f"{question['id']}, PDF page {line.page}: unclassified visible content {line.text!r}; review its layout rather than dropping it.")


def import_questions(document, layout, write_assets):
    expected = layout["moduleQuestionCounts"]
    sections = discover_question_modules(document, expected)
    modules = []
    audit = []
    figures_seen = set()
    for module, first, end, count in sections:
        questions = []
        current = None
        source_lines = []
        for page_index in range(first, end):
            page = document[page_index]
            all_lines = all_page_lines(page)
            source_lines.extend(all_lines)
            for column in (0, 1):
                lines = sorted(
                    [line for line in all_lines if line.column == column and 100 < line.bbox[1] < 730],
                    key=lambda line: (round(line.bbox[1], 1), line.bbox[0]),
                )
                badges = question_badges(all_lines, column)
                if current and (not badges or not (page_index == first and badges[0][1][1] > 250)):
                    append_region(current, lines, 100, badges[0][1][1] - 1 if badges else 730, layout)
                for index, (number, bbox) in enumerate(badges):
                    current = {"id": f"m{module}-q{number}", "module": module, "number": number, "sourcePage": page_index + 1, "_lines": []}
                    questions.append(current)
                    append_region(current, lines, bbox[3] + 1, badges[index + 1][1][1] - 1 if index + 1 < len(badges) else 730, layout)
        if [question["number"] for question in questions] != list(range(1, count + 1)):
            raise ValueError(f"Module {module}: source question badges are {[q['number'] for q in questions]}, expected 1 through {count}.")
        covered = {line_key(line) for question in questions for line in question["_lines"]}
        for line in source_lines:
            if not 100 < line.bbox[1] < 742 or not line.text.strip() or known_question_furniture(line):
                continue
            if not any("Minion" in span["font"] for span in line.spans) and not line.text.lstrip().startswith("©"):
                continue
            if any(span["color"] == 16777215 and re.fullmatch(r"\s*\d[\d\s]*", span["text"]) for span in line.spans):
                continue
            if any(
                line.page == figure.get("page", question["sourcePage"])
                and pymupdf.Rect(figure["rect"]).contains(pymupdf.Point(line.bbox[0] + 1, line.bbox[1] + 1))
                for question in questions
                if (figure := layout["figures"].get(question["id"]))
            ):
                continue
            if line_key(line) not in covered:
                raise ValueError(f"Module {module}, PDF page {line.page}: unassigned source body text {line.text!r}.")
        for question in questions:
            lines = question.pop("_lines")
            try:
                option_start = next(i for i, line in enumerate(lines) if re.match(r"^\s*A\)\s*", line.text))
            except StopIteration as error:
                raise ValueError(f"{question['id']}: no source option A boundary.") from error
            before_options = lines[:option_start]
            if not before_options:
                raise ValueError(f"{question['id']}: no source passage/prompt.")
            passage_lines, prompt_lines = split_prompt(before_options, question["id"])
            question["passageHtml"] = render_passage(groups(passage_lines, layout.get("separateCredits", True)))
            question["promptHtml"] = joined_html(prompt_lines)
            choices = []
            for line in lines[option_start:]:
                match = re.match(r"^\s*([A-D])\)\s*", line.text)
                if match:
                    choices.append({"id": match[1], "lines": [], "prefix": match.end()})
                if not choices:
                    raise ValueError(f"{question['id']}: missing option boundary.")
                choices[-1]["lines"].append(line)
            question["choices"] = [{"id": choice["id"], "html": joined_html(choice["lines"], choice["prefix"])} for choice in choices]
            if [choice["id"] for choice in choices] != list("ABCD") or not all(choice["html"] for choice in question["choices"]):
                raise ValueError(f"{question['id']}: four complete ordered source options are required.")
            rendered = question["passageHtml"] + question["promptHtml"] + "".join(choice["html"] for choice in question["choices"])
            verify_rendered_text(lines, rendered, question["id"])
            figure = layout["figures"].get(question["id"])
            question["figure"] = None
            if figure:
                figure_page = figure.get("page", question["sourcePage"])
                rect = pymupdf.Rect(figure["rect"])
                if not document[figure_page - 1].rect.contains(rect) or rect.is_empty:
                    raise ValueError(f"{question['id']}: figure bounds fall outside its source page.")
                namespace = layout.get("figureNamespace", f"test-{layout['number']}")
                relative = "/".join(part for part in ["figures", namespace, f"{question['id']}.png"] if part)
                output = ROOT / "public" / Path(relative)
                pixmap = document[figure_page - 1].get_pixmap(matrix=pymupdf.Matrix(3, 3), clip=rect, alpha=False)
                image = pixmap.tobytes("png")
                if write_assets:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(image)
                elif not output.exists() or output.read_bytes() != image:
                    raise ValueError(f"{question['id']}: derived figure does not match the supplied source crop.")
                question["figure"] = {"src": f"/{relative}", "alt": figure["alt"], "table": figure.get("table")}
                if figure.get("placement"):
                    question["figure"]["placement"] = figure["placement"]
                figures_seen.add(question["id"])
            if not question["passageHtml"] and not figure:
                raise ValueError(f"{question['id']}: prose is missing and no source graphic supplies the passage.")
            audit.append({
                "id": question["id"],
                "sourcePage": question["sourcePage"],
                "sourceTextSha256": hashlib.sha256(canonical(" ".join(line.text for line in lines)).encode()).hexdigest(),
                "sourceLineCount": len(lines),
                "sourceUnderlineSpans": sum(bool(span["char_flags"] & 2) and bool(span["text"].strip()) for line in lines for span in line.spans if span["color"] != 16777215),
                "figure": bool(figure),
            })
        modules.append({"number": module, "title": f"Module {module}", "questions": questions})
    if figures_seen != set(layout["figures"]):
        raise ValueError(f"Figure configuration does not match actual questions: {sorted(set(layout['figures']) - figures_seen)}.")
    return modules, audit


def import_answers(document, expected):
    answers = {}
    section_pages = discover_answer_modules(document, expected)
    for module, pages in section_pages.items():
        current = None
        numbers = []
        for page_index in pages:
            page = document[page_index]
            page_lines = all_page_lines(page)
            footer_rows = [
                line.bbox[1] for line in page_lines
                if re.search(r"SAT\s+PRACTICE\s+TEST\s*#\s*\d+\s+ANSWER\s+EXPLANATIONS", clean(line.text))
            ]
            lines = []
            for line in page_lines:
                text = clean(line.text).strip()
                if not text or re.match(r"SAT\s+ANSWER\s+EXPLANATIONS", text):
                    continue
                if re.search(r"SAT\s+PRACTICE\s+TEST\s*#\s*\d+\s+ANSWER\s+EXPLANATIONS", text):
                    continue
                if text == str(page_index + 1) and any(abs(line.bbox[1] - row) < 6 for row in footer_rows):
                    continue
                line.column = 0
                lines.append(line)
            lines.sort(key=lambda line: (line.bbox[1], line.bbox[0]))
            for line in lines:
                match = re.fullmatch(r"QUESTION\s+(\d+)", line.text.strip())
                if match:
                    current = f"m{module}-q{int(match[1])}"
                    numbers.append(int(match[1]))
                    if current in answers:
                        raise ValueError(f"Duplicate source explanation: {current}.")
                    answers[current] = {"lines": [], "pages": []}
                elif current:
                    answers[current]["lines"].append(line)
                    if line.page not in answers[current]["pages"]:
                        answers[current]["pages"].append(line.page)
        if numbers != list(range(1, expected[module - 1] + 1)):
            raise ValueError(f"Module {module}: explanation headings {numbers} do not match the source questions.")
    for key, answer in answers.items():
        source_lines = answer.pop("lines")
        merged = []
        for paragraph in groups(source_lines):
            if merged and merged[-1][-1].page != paragraph[0].page and not re.match(r"Choice [A-D]", paragraph[0].text):
                merged[-1].extend(paragraph)
            else:
                merged.append(paragraph)
        plain = clean(" ".join(line.text for paragraph in merged for line in paragraph))
        correct = re.match(r"\s*Choice\s+([A-D]) is the best answer", plain)
        if not correct:
            raise ValueError(f"{key}: no unambiguous correct-answer statement in the supplied answer PDF.")
        answer["correctAnswer"] = correct[1]
        answer["explanationHtml"] = "".join(f"<p>{joined_html(paragraph)}</p>" for paragraph in merged)
        verify_rendered_text(source_lines, answer["explanationHtml"], f"{key} explanation")
    return answers, section_pages


def import_test(number, test_path, answers_path, write_assets=True):
    layout = load_layout(number)
    with pymupdf.open(test_path) as test, pymupdf.open(answers_path) as reference:
        verify_cover(test, number, "question")
        verify_cover(reference, number, "answer")
        modules, audit = import_questions(test, layout, write_assets)
        answers, answer_pages = import_answers(reference, layout["moduleQuestionCounts"])
        for module in modules:
            for question in module["questions"]:
                answer = answers[question["id"]]
                question.update({key: value for key, value in answer.items() if key != "pages"})
                question["answerPages"] = answer["pages"]
        source_pages = [[min(q["sourcePage"] for q in module["questions"]), max(q["sourcePage"] for q in module["questions"])] for module in modules]
        result = {
            "id": layout["id"],
            "title": layout.get("title", f"Practice Test {number}"),
            "section": "Reading and Writing",
            "questionCount": sum(len(module["questions"]) for module in modules),
            "sources": {
                "test": f"https://satsuite.collegeboard.org/media/pdf/sat-practice-test-{number}-digital.pdf",
                "answers": f"https://satsuite.collegeboard.org/media/pdf/sat-practice-test-{number}-answers-digital.pdf",
                "testSha256": hashlib.sha256(Path(test_path).read_bytes()).hexdigest(),
                "answersSha256": hashlib.sha256(Path(answers_path).read_bytes()).hexdigest(),
                "testPdfPages": source_pages,
                "answerPdfPages": [[min(pages) + 1, max(pages) + 1] for pages in answer_pages.values()],
                "note": layout.get("note", "Imported locally from the supplied PDF pair. Only Reading and Writing modules are included; Math is excluded."),
            },
            "modules": modules,
        }
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    for invalid in ["Start referenced", "ContentStart", "\ufffd", "b l a n k"]:
        if invalid in serialized:
            raise ValueError(f"Practice Test {number}: unresolved extraction artifact {invalid!r}.")
    report = {
        "testNumber": number,
        "moduleQuestionCounts": [len(module["questions"]) for module in modules],
        "questions": result["questionCount"],
        "choices": result["questionCount"] * 4,
        "explanations": len(answers),
        "figures": len(layout["figures"]),
        "sourceHashes": {key: result["sources"][key] for key in ["testSha256", "answersSha256"]},
        "questionChecks": audit,
    }
    return result, report
