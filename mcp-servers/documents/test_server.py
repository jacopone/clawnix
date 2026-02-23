import json
import os
import tempfile
import pytest
from server import create_presentation, create_spreadsheet, create_pdf

_create_presentation = create_presentation.fn
_create_spreadsheet = create_spreadsheet.fn
_create_pdf = create_pdf.fn


@pytest.fixture
def output_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAWNIX_DOCUMENTS_DIR", str(tmp_path))
    return tmp_path


def test_create_presentation(output_dir):
    result = _create_presentation(
        title="Test Deck",
        slides=[
            {"title": "Slide 1", "content": "Hello world"},
            {"title": "Slide 2", "content": "Second slide content"},
        ],
    )
    parsed = json.loads(result)
    assert parsed["status"] == "created"
    assert parsed["file"].endswith(".pptx")
    assert os.path.exists(parsed["file"])


def test_create_presentation_empty_slides(output_dir):
    result = _create_presentation(title="Empty", slides=[])
    parsed = json.loads(result)
    assert parsed["status"] == "created"


def test_create_spreadsheet(output_dir):
    result = _create_spreadsheet(
        name="test_data",
        sheets={
            "Sales": [
                ["Product", "Revenue"],
                ["Widget A", 1500],
                ["Widget B", 2300],
            ],
        },
    )
    parsed = json.loads(result)
    assert parsed["status"] == "created"
    assert parsed["file"].endswith(".xlsx")
    assert os.path.exists(parsed["file"])


def test_create_spreadsheet_multiple_sheets(output_dir):
    result = _create_spreadsheet(
        name="multi",
        sheets={
            "Sheet1": [["A", "B"], [1, 2]],
            "Sheet2": [["C", "D"], [3, 4]],
        },
    )
    parsed = json.loads(result)
    assert parsed["sheets"] == 2


def test_create_pdf(output_dir):
    result = _create_pdf(
        title="Test Document",
        content="This is the body of the PDF document.\n\nIt has multiple paragraphs.",
    )
    parsed = json.loads(result)
    assert parsed["status"] == "created"
    assert parsed["file"].endswith(".pdf")
    assert os.path.exists(parsed["file"])
