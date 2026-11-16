"""
Regression tests of REVIEW ROUND 5 (backend): replenishment IP snapshot at the review date, clock review counting
(day-0 review), stable policy keys / insight codes for client-side i18n, 10-day window coverage wording.
"""
import unittest

from app.api.v1.endpoints.clock import _clock_response
from app.api.v1.endpoints.reports import get_policy_comparison_benchmark
from app.models.inventory import Inventory
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sim_clock import SimClock
from app.schemas.reports import AccuracyMetricItem
from app.services import coverage_service
from app.services.pipeline_service import pipeline_service
from app.services.replenishment_service import replenishment_service
from app.services.simulation_service import simulation_service
from app.services.simulator_service import simulator_service
from tests.artifact_marks import requires_c3ok_results
from tests.test_review4_fixes import ITEM, START, _db


class TestReplenishmentIpAtReview(unittest.TestCase):
    def test_ip_is_the_review_snapshot_and_its_parts_are_returned(self):
        Session, db = _db(on_hand=3.0)  # IP 3 < s 20 -> proposal q = S - IP = 34
        self.assertEqual(replenishment_service.generate_recommendations(db, "CA_1", review_date=START), 1)
        rec = db.query(ReplenishmentRecommendation).one()
        self.assertEqual((rec.on_hand_at_review, rec.on_order_at_review, rec.inventory_position), (3.0, 0.0, 3.0))
        self.assertEqual(rec.recommended_qty, 34.0)
        # the live stock moves on after the review (e.g. a delivery): IP stays the review-date value
        inv = db.query(Inventory).filter(Inventory.item_id == ITEM).one()
        inv.on_hand, inv.on_order = 37.0, 0.0
        db.commit()
        item = replenishment_service.list_recommendations(db, store_id="CA_1").items[0]
        self.assertEqual(item.on_hand, 37.0)  # current
        self.assertEqual(item.inventory_position, 3.0)  # at review
        self.assertEqual(item.on_hand_at_review + item.on_order_at_review, item.inventory_position)
        self.assertEqual(item.review_date, START)

    def test_simulator_orders_carry_the_snapshot(self):
        Session, db = _db(demand=5.0)  # 37 at start, 5/day -> below s at the day-7 review
        simulator_service.initialise_baseline(db, "CA_1")
        pipeline_service.advance_sim_clock(db, "CA_1", days=14)
        recs = db.query(ReplenishmentRecommendation).filter(ReplenishmentRecommendation.decided_by == "simulator").all()
        self.assertTrue(recs)
        for r in recs:
            self.assertIsNotNone(r.on_hand_at_review)
            self.assertAlmostEqual(r.on_hand_at_review + r.on_order_at_review, r.inventory_position)
            self.assertAlmostEqual(r.recommended_qty, max(1.0, round(r.order_up_to_S - r.inventory_position, 0)))

    def test_csv_export_has_review_date_columns(self):
        Session, db = _db(on_hand=3.0)
        replenishment_service.generate_recommendations(db, "CA_1", review_date=START)
        content = replenishment_service.export_recommendations_csv(db, store_id="CA_1")
        self.assertIn("IP Tại Ngày Review", content)
        self.assertIn("Tồn Kho Hiện Tại (On-hand)", content)


class TestClockReviewCount(unittest.TestCase):
    def test_clock_and_advance_count_reviews_the_same_way(self):
        Session, db = _db()
        simulator_service.initialise_baseline(db, "CA_1")
        clock = db.query(SimClock).filter(SimClock.store_id == "CA_1").one()
        before = _clock_response(db, clock)
        self.assertEqual((before.reviews_elapsed, before.reviews_executed_total), (0, 0))
        r = pipeline_service.advance_sim_clock(db, "CA_1", days=7)
        self.assertEqual(r["reviews_executed"], 2)
        self.assertTrue(r["day0_review_executed"])
        db.refresh(clock)
        after = _clock_response(db, clock)
        self.assertEqual(after.days_elapsed, 7)
        self.assertEqual(after.reviews_elapsed, 1)  # index k of the latest review
        self.assertEqual(after.reviews_executed_total, r["reviews_executed"])  # incl. day-0 review: 2
        r2 = pipeline_service.advance_sim_clock(db, "CA_1", days=7)
        self.assertFalse(r2["day0_review_executed"])
        db.refresh(clock)
        self.assertEqual(_clock_response(db, clock).reviews_executed_total, r["reviews_executed"] + r2["reviews_executed"])

    def test_advance_response_schema_accepts_the_flag(self):
        from app.schemas.clock import ClockAdvanceResponse
        Session, db = _db()
        r = pipeline_service.advance_sim_clock(db, "CA_1", days=3)
        self.assertTrue(ClockAdvanceResponse(**r).day0_review_executed)


@requires_c3ok_results
class TestStablePolicyCodes(unittest.TestCase):
    def test_compare_policies_has_policy_keys_and_insight_codes(self):
        Session, db = _db()
        res = simulation_service.compare_policies(db, "CA_1", horizon_days=90, target_service_level=0.96)
        keys = {p.policy_id: p.policy_key for p in res.policies}
        self.assertEqual(keys, {"B0_raw_quantile": "B0", "B2_frozen_critical_ratio": "B2",
                                "PCR_c3out_cost_optimal": "PCR", "P6_c3out_closed_loop": "P6"})
        self.assertEqual(res.recommended_policy_key, "PCR")
        codes = [d.code for d in res.insight_details]
        self.assertEqual(codes, ["recommend_feasible", "pcr_vs_p6", "b0_vs_p6", "artifact_source"])
        self.assertEqual(len(res.insight_details), len(res.insights))
        first = res.insight_details[0].params
        self.assertEqual(first["policy_key"], "PCR")
        self.assertEqual(first["target_pct"], 96.0)
        self.assertIn(res.insight_details[1].params["direction"], ("lower", "higher"))
        self.assertEqual(res.insight_details[3].params["artifact_n_skus"], 25950)
        self.assertTrue(all(p.stockouts_reason_code == "artifact_no_units" for p in res.policies))

    def test_infeasible_target_uses_its_own_code(self):
        Session, db = _db()
        res = simulation_service.compare_policies(db, "CA_1", target_service_level=0.999)
        self.assertEqual(res.insight_details[0].code, "recommend_infeasible")

    def test_policy_comparison_report_has_policy_key(self):
        Session, db = _db()
        d = get_policy_comparison_benchmark(db=db, current_user=None)
        for key, row in d["policies"].items():
            self.assertEqual(row["policy_key"], key)
            self.assertTrue(row["description"])


class TestCoverageWording(unittest.TestCase):
    def test_coverage_is_documented_as_10_day_window_coverage(self):
        doc = coverage_service.__doc__ or ""
        self.assertIn("10-day", doc)
        self.assertNotIn("per (series, day)", doc)
        desc = AccuracyMetricItem.model_fields["coverage_q95"].description or ""
        self.assertIn("10-day", desc)


if __name__ == "__main__":
    unittest.main()

