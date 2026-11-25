"""demo.md §6.2 Forecast Explorer: Ensemble vs Seasonal Naive / Holt-Winters / LightGBM on the selected SKU."""
import unittest

import numpy as np

from app.services.forecast_explorer_service import window_error_stats
from app.services.holt_winters import holt_winters_paths


class TestHoltWinters(unittest.TestCase):
    def test_weekly_pattern_is_forecast_back(self):
        week = np.array([5.0, 3, 3, 4, 6, 9, 10])
        y = np.tile(week, 120)[None, :]  # 840 days of a pure weekly season
        o = 700
        paths, _ = holt_winters_paths(y, 600, [o], 14)
        expect = week[(o + np.arange(14)) % 7]
        np.testing.assert_allclose(paths[o][0], expect, atol=0.05)

    def test_causal_the_path_ignores_days_from_the_origin_on(self):
        rng = np.random.default_rng(0)
        y = rng.poisson(5, size=(1, 800)).astype(float)
        o = 700
        a, _ = holt_winters_paths(y, 600, [o], 10)
        y2 = y.copy()
        y2[0, o:] = 500.0
        b, _ = holt_winters_paths(y2, 600, [o], 10)
        np.testing.assert_allclose(a[o], b[o])


class TestWindowErrorStatsExtra(unittest.TestCase):
    def _run(self, extra):
        H, first = 10, 0
        y = np.full(600, 4.0)
        origins = [500, 507, 514, 521, 528]
        model = {o: 40.0 for o in origins}
        return window_error_stats(y, first, origins, model, H, 560, 182, extra=extra)

    def test_methods_are_scored_on_the_same_windows(self):
        st = self._run({"lgbm": {500: 44.0, 507: 44.0, 514: 44.0}, "holt_winters": {o: 40.0 for o in (500, 507, 514, 521, 528)}})
        self.assertEqual(st.n_windows, 3)  # windows without a LightGBM value are left out for EVERY method
        by = {m.method: m for m in st.methods}
        self.assertEqual(by["lgbm"].mae, 4.0)
        self.assertEqual(by["model"].n_windows, by["holt_winters"].n_windows)

    def test_a_method_without_any_value_is_not_reported(self):
        st = self._run({"lgbm": {}, "holt_winters": {}})
        self.assertEqual(st.n_windows, 5)
        self.assertEqual([m.method for m in st.methods], ["model", "snaive", "naive", "ma28"])


if __name__ == "__main__":
    unittest.main()
