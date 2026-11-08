import math
import unittest

from pipeline.model import (
    calculate_activity_components,
    calculate_hourly_questing,
    summarize_weather_day,
)


def weather_hour(hour=0, **changes):
    record = {
        "time": f"2026-11-07T{hour:02d}:00:00Z",
        "soil_temperature_c": 18.0,
        "relative_humidity_percent": 90.0,
        "vapour_pressure_deficit_kpa": 0.0,
        "soil_moisture_fraction": 0.3,
        "precipitation_mm": 2.0,
        "low_cloud_cover_percent": 100.0,
        "is_day": 0,
    }
    return {**record, **changes}


class QuestingCalculationTests(unittest.TestCase):
    def test_favorable_conditions_reach_one_and_dry_conditions_reach_zero(self):
        favorable = calculate_hourly_questing(weather_hour())
        self.assertEqual(favorable["questing_suitability"], 1.0)
        self.assertTrue(favorable["example_questing_trigger"])
        self.assertEqual(calculate_hourly_questing(weather_hour(relative_humidity_percent=60))["questing_suitability"], 0)
        self.assertEqual(calculate_hourly_questing(weather_hour(soil_moisture_fraction=0))["questing_suitability"], 0)

    def test_temperature_and_vpd_limits_are_bounded(self):
        for temperature in [-10, 7, 35, 45]:
            with self.subTest(temperature=temperature):
                self.assertEqual(calculate_hourly_questing(weather_hour(soil_temperature_c=temperature))["questing_suitability"], 0)
        self.assertEqual(calculate_hourly_questing(weather_hour(vapour_pressure_deficit_kpa=1.2))["questing_suitability"], 0)
        self.assertFalse(calculate_hourly_questing(weather_hour(soil_temperature_c=7, relative_humidity_percent=82))["example_questing_trigger"])

    def test_missing_dependency_is_unknown_instead_of_zero(self):
        result = calculate_hourly_questing(weather_hour(soil_moisture_fraction=None))
        self.assertIsNone(result["questing_suitability"])
        self.assertIn("soil_moisture_fraction", result["missing_inputs"])

    def test_invalid_physical_values_fail_explicitly(self):
        for changes in [
            {"relative_humidity_percent": 101}, {"soil_moisture_fraction": -0.1},
            {"soil_moisture_fraction": 1.01}, {"soil_temperature_c": math.nan},
            {"vapour_pressure_deficit_kpa": math.inf}, {"vapour_pressure_deficit_kpa": -0.1},
            {"relative_humidity_percent": True},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                calculate_hourly_questing(weather_hour(**changes))

    def test_day_requires_eighteen_distinct_valid_utc_hours(self):
        self.assertIsNone(summarize_weather_day([weather_hour(hour) for hour in range(17)], "2026-11-07")["questing_suitability"])
        result = summarize_weather_day([weather_hour(hour) for hour in range(18)], "2026-11-07")
        self.assertEqual(result["valid_weather_hours"], 18)
        self.assertEqual(result["questing_suitability"], 1)
        self.assertEqual(result["conditions_at_peak"]["time"], "2026-11-07T00:00:00Z")
        with self.assertRaises(ValueError):
            summarize_weather_day([weather_hour(0)] * 18, "2026-11-07")

    def test_other_days_and_missing_hours_cannot_fill_the_daily_gate(self):
        records = [weather_hour(hour) for hour in range(17)]
        records += [weather_hour(18, time="2026-11-08T18:00:00Z")]
        records += [weather_hour(19, soil_temperature_c=None)]
        result = summarize_weather_day(records, "2026-11-07")
        self.assertEqual(result["valid_weather_hours"], 17)
        self.assertIsNone(result["questing_suitability"])
        with self.assertRaises(ValueError):
            summarize_weather_day([weather_hour(time="2026-11-07T01:00:00")], "2026-11-07")

    def test_stopover_weather_uses_only_actual_nighttime_hours(self):
        hours = [weather_hour(hour, is_day=1) for hour in range(24)]
        self.assertIsNone(summarize_weather_day(hours, "2026-11-07")["stopover_weather_proxy"])
        hours[0] = weather_hour(0, precipitation_mm=1, low_cloud_cover_percent=50)
        self.assertAlmostEqual(summarize_weather_day(hours, "2026-11-07")["stopover_weather_proxy"], 0.5)

    def test_report_proxies_require_complete_windows_and_preserve_zero(self):
        known_zero = calculate_activity_components(1, 1, 0, True, 0, True, 1)
        self.assertEqual(known_zero["avian_activity_proxy"], 0)
        self.assertEqual(known_zero["tick_reporting_intensity"], 0)
        self.assertEqual(known_zero["ecological_activity_index"], 0)
        unknown = calculate_activity_components(1, 1, 20, False, None, False, None)
        for key in ["avian_activity_proxy", "tick_reporting_intensity", "stopover_potential", "ecological_activity_index"]:
            self.assertIsNone(unknown[key])
        self.assertTrue(unknown["missing_inputs"])

    def test_complete_inputs_calculate_the_versioned_ecological_components(self):
        result = calculate_activity_components(0.8, 0.5, 20, True, 10, True, 0.6)
        self.assertEqual(result["avian_activity_proxy"], 1)
        self.assertEqual(result["tick_reporting_intensity"], 1)
        self.assertAlmostEqual(result["stopover_potential"], 0.3)
        self.assertAlmostEqual(result["ecological_activity_index"], 0.52)
        with self.assertRaises(ValueError):
            calculate_activity_components(1, 1, -1, True, 0, True, 1)


if __name__ == "__main__":
    unittest.main()
