"""Audiencias de logística, traslados desde el manifiesto y validación de filas
de cronograma. Todo funciones puras: sin red ni base."""
import unittest

from fastapi import HTTPException

from api._lib.logistics_audiences import (
    AUDIENCES, apply_default_category, audience_of, categories_for,
)
from api._lib.routers.logistics import CATEGORIES
from api._lib.routers.logistics_schedules import clean_row, date_range_warning, schedule_view
from api._lib.routers.transport import plan_movement_trips


class AudiencesTest(unittest.TestCase):
    def test_every_category_belongs_to_exactly_one_audience(self):
        covered = [c for categories in AUDIENCES.values() for c in categories]
        self.assertEqual(sorted(CATEGORIES), sorted(covered))

    def test_no_audience_means_no_filter(self):
        self.assertIsNone(categories_for(None))
        self.assertIsNone(categories_for(""))
        self.assertEqual(("vip", "guest"), categories_for("vip"))

    def test_unknown_audience_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            categories_for("referees")
        self.assertEqual(400, raised.exception.status_code)

    def test_audience_of(self):
        self.assertEqual("delegation", audience_of("team"))
        self.assertEqual("vip", audience_of("guest"))
        self.assertEqual("staff", audience_of("fiba_staff"))

    def test_default_category_only_touches_unclassified_rows(self):
        rows = [
            {"category": "official", "match": {"status": "new"}},       # sin señal → equipo
            {"category": "official", "match": {"status": "matched"}},   # es un TD del padrón
            {"category": "vip", "match": {"status": "new"}},            # la planilla ya lo dijo
        ]
        apply_default_category(rows, "delegation")
        self.assertEqual(["team", "official", "vip"], [r["category"] for r in rows])

    def test_staff_and_no_audience_leave_rows_alone(self):
        for audience in ("staff", None):
            rows = [{"category": "official", "match": {"status": "new"}}]
            apply_default_category(rows, audience)
            self.assertEqual("official", rows[0]["category"])


def group(date, airport, legs):
    return {"date": date, "airport": airport, "legs": legs}


def leg(leg_id, trip_id=None, pax=1):
    return {"id": leg_id, "trip_id": trip_id, "pax": pax}


def item(**overrides):
    base = {
        "direction": "arrival", "date": "2026-11-11", "airport": "MDE", "vehicle_id": "van-1",
        "departure_time": "14:30", "origin": "MDE", "destination": "Hotel Dann",
    }
    return {**base, **overrides}


class MovementTripsTest(unittest.TestCase):
    def setUp(self):
        self.groups = {
            "arrival": [group("2026-11-11", "MDE", [leg("a"), leg("b", pax=17)])],
            "departure": [group("2026-11-16", "MDE", [leg("c", trip_id="t-9")])],
        }
        self.counter = {}

    def next_number(self, vehicle_id, day):
        self.counter[(vehicle_id, day)] = self.counter.get((vehicle_id, day), 3) + 1
        return self.counter[(vehicle_id, day)]

    def plan(self, items):
        return plan_movement_trips(items, self.groups, {"van-1"}, self.next_number)

    def test_one_transfer_per_group_covering_its_legs(self):
        planned, skipped = self.plan([item()])
        self.assertEqual([], skipped)
        self.assertEqual(["a", "b"], planned[0]["leg_ids"])
        trip = planned[0]["trip"]
        self.assertEqual(("transfer", 4, "14:30", "MDE", "Hotel Dann"),
                         (trip["trip_type"], trip["trip_number"], trip["departure_time"],
                          trip["origin"], trip["destination"]))
        self.assertEqual("18 pax", trip["notes"])

    def test_group_already_covered_is_skipped_not_duplicated(self):
        planned, skipped = self.plan([item(direction="departure", date="2026-11-16")])
        self.assertEqual([], planned)
        self.assertEqual([{"direction": "departure", "date": "2026-11-16", "airport": "MDE"}], skipped)

    def test_only_uncovered_legs_get_the_new_trip(self):
        self.groups["arrival"][0]["legs"][0]["trip_id"] = "t-1"
        planned, _ = self.plan([item()])
        self.assertEqual(["b"], planned[0]["leg_ids"])
        self.assertEqual("17 pax", planned[0]["trip"]["notes"])

    def test_vehicle_of_another_competition_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            self.plan([item(vehicle_id="van-of-someone-else")])
        self.assertEqual(400, raised.exception.status_code)

    def test_unreadable_time_and_missing_places_are_rejected(self):
        for bad in (item(departure_time="temprano"), item(origin=" "), item(destination="")):
            with self.assertRaises(HTTPException) as raised:
                self.plan([bad])
            self.assertEqual(400, raised.exception.status_code)

    def test_unknown_group_is_rejected(self):
        with self.assertRaises(HTTPException):
            self.plan([item(airport="BOG")])

    def test_trip_numbers_do_not_collide_within_one_request(self):
        self.groups["arrival"].append(group("2026-11-11", "EOH", [leg("d")]))
        planned, _ = self.plan([item(), item(airport="EOH", origin="EOH")])
        self.assertEqual([4, 5], [p["trip"]["trip_number"] for p in planned])


class ScheduleRowsTest(unittest.TestCase):
    def test_clean_row_normalizes_times_and_blanks(self):
        row = clean_row({"date": "2026-11-13", "kind": "training", "pickup_time": "8:10",
                         "return_time": "", "team": "  Boca Juniors ", "snack": "TAKE AWAY", "notes": " "})
        self.assertEqual(("08:10", None, "Boca Juniors", "TAKE AWAY", None),
                         (row["pickup_time"], row["return_time"], row["team"], row["snack"], row["notes"]))

    def test_unreadable_time_is_400_not_null(self):
        with self.assertRaises(HTTPException) as raised:
            clean_row({"pickup_time": "a la tarde"})
        self.assertEqual(400, raised.exception.status_code)

    def test_bad_date_and_kind_are_rejected(self):
        for bad in ({"date": "13/11/2026"}, {"kind": "meeting"}):
            with self.assertRaises(HTTPException):
                clean_row(bad)

    def test_meals_are_free_text(self):
        self.assertEqual("15:30 al IN", clean_row({"lunch": "15:30 al IN"})["lunch"])

    def test_view_hides_storage_path_and_uploader(self):
        view = schedule_view({
            "id": "s1", "competition_id": "c1", "section": "meals", "audience": "delegation",
            "file_path": "storage://nominations/logistics/schedules/c1/x.xlsx", "file_name": "x.xlsx",
            "uploaded_by": "user-1", "days": None,
        }, [{"date": "2026-11-13", "position": 1}, {"date": "2026-11-13", "position": 0}])
        self.assertNotIn("file_path", view)
        self.assertNotIn("uploaded_by", view)
        self.assertTrue(view["has_file"])
        self.assertEqual([0, 1], [r["position"] for r in view["rows"]])
        self.assertEqual([], view["days"])

    def test_date_range_warning_only_when_nothing_is_near(self):
        competition = {"start_date": "2026-11-13", "end_date": "2026-11-15"}
        near = [{"date": "2026-11-11"}, {"date": "2026-11-15"}]
        far = [{"date": "2026-03-01"}, {"date": "2026-03-03"}]
        self.assertIsNone(date_range_warning(competition, near))
        self.assertEqual("date", date_range_warning(competition, far)["field"])
        self.assertIsNone(date_range_warning({"start_date": None, "end_date": None}, far))


if __name__ == "__main__":
    unittest.main()
