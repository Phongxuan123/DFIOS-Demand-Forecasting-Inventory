"""P0 label honesty: policy table naming, c3ok source note, RMSSE (1 series) wording."""
from pathlib import Path

FE_I18N = Path(__file__).resolve().parents[2] / "FE" / "src" / "i18n"


def _read(rel: str) -> str:
    return (FE_I18N / rel).read_text(encoding="utf-8")


def test_baseline_row_is_not_called_teacher_b0():
    for lang in ("en", "vi"):
        txt = _read(f"{lang}/reports.ts")
        assert "RAW-0.95 - Raw quantile" in txt
        assert "B0 - Raw quantile" not in txt


def test_policy_note_in_both_languages():
    assert "c3ok" in _read("en/reports.ts") and "Table 17" in _read("en/reports.ts")
    assert "c3ok" in _read("vi/reports.ts") and "Bảng 17" in _read("vi/reports.ts")


def test_b2_and_pcr_labels_match_artifact():
    for lang in ("en", "vi"):
        txt = _read(f"{lang}/reports.ts")
        assert "0.9615" in txt
        assert "b/(b+h·H)" not in txt  # critical ratio uses the review period R
        assert "critical ratio (τ*" not in txt.replace("not the critical ratio", "")


def test_single_series_metric_is_rmsse():
    assert "RMSSE (1 series)" in _read("en/models.ts")
    assert "RMSSE (1 chuỗi)" in _read("vi/models.ts")
