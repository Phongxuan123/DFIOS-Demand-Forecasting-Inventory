"""Shared skip markers for tests that need the (git-ignored) c3ok artifacts. On a clean clone they SKIP with a
clear reason instead of failing; run ``python scripts/check_artifacts.py`` to see what is missing."""
import pytest

from app.services.policy_artifact import find_artifact

REASON = "c3ok artifacts not found (not in git; see scripts/check_artifacts.py / artifacts_manifest.json)"

requires_c3ok_results = pytest.mark.skipif(find_artifact("c3ok_results.csv") is None, reason=REASON)
requires_c3ok_calibration = pytest.mark.skipif(
    find_artifact("c3ok_forecast_calibration.csv") is None, reason=REASON)
