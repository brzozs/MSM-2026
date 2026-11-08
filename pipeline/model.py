"""Pure vectorcast-heuristic-v1 calculations, never calibrated probabilities."""

import math
from datetime import date, datetime, timezone

MODEL_VERSION = "vectorcast-heuristic-v1"
MINIMUM_VALID_WEATHER_HOURS = 18


def validated_number(value, field_name, minimum=None, maximum=None):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field_name} must be a finite number or null")
    if minimum is not None and value < minimum:
        raise ValueError(f"{field_name} is below its permitted range")
    if maximum is not None and value > maximum:
        raise ValueError(f"{field_name} exceeds its permitted range")
    return float(value)


def clip_unit_interval(value):
    return min(1.0, max(0.0, value))


def calculate_hourly_questing(weather_hour):
    soil_temperature = validated_number(weather_hour.get("soil_temperature_c"), "soil_temperature_c")
    relative_humidity = validated_number(weather_hour.get("relative_humidity_percent"), "relative_humidity_percent", 0, 100)
    vapour_pressure_deficit = validated_number(weather_hour.get("vapour_pressure_deficit_kpa"), "vapour_pressure_deficit_kpa", 0)
    soil_moisture = validated_number(weather_hour.get("soil_moisture_fraction"), "soil_moisture_fraction", 0, 1)
    factors = {
        "temperature_factor": None if soil_temperature is None else min(
            clip_unit_interval((soil_temperature - 7) / 8), clip_unit_interval((35 - soil_temperature) / 10)),
        "humidity_factor": None if relative_humidity is None else clip_unit_interval((relative_humidity - 60) / 22),
        "vapour_pressure_deficit_factor": None if vapour_pressure_deficit is None else clip_unit_interval((1.2 - vapour_pressure_deficit) / 1.2),
        "soil_moisture_factor": None if soil_moisture is None else clip_unit_interval(soil_moisture / 0.3),
    }
    missing_inputs = [field_name for field_name in (
        "soil_temperature_c", "relative_humidity_percent", "vapour_pressure_deficit_kpa", "soil_moisture_fraction"
    ) if weather_hour.get(field_name) is None]
    return {
        **factors,
        "questing_suitability": None if missing_inputs else math.prod(factors.values()),
        "example_questing_trigger": None if soil_temperature is None or relative_humidity is None else soil_temperature > 7 and relative_humidity > 82,
        "missing_inputs": missing_inputs,
    }


def parse_utc_hour(timestamp):
    if not isinstance(timestamp, str):
        raise ValueError("Weather time must be an offset-aware ISO timestamp")
    try:
        parsed_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Weather time must be an offset-aware ISO timestamp") from None
    if parsed_time.tzinfo is None or parsed_time.utcoffset() is None:
        raise ValueError("Weather time must include an explicit UTC offset")
    utc_time = parsed_time.astimezone(timezone.utc)
    if utc_time.minute or utc_time.second or utc_time.microsecond:
        raise ValueError("Weather records must represent exact hourly timestamps")
    return utc_time


def summarize_weather_day(weather_hours, target_date):
    selected_date = date.fromisoformat(target_date)
    seen_hours = set()
    valid_hours = []
    nighttime_weather_factors = []
    questing_trigger_hours = 0
    for weather_hour in weather_hours:
        utc_time = parse_utc_hour(weather_hour.get("time"))
        if utc_time.date() != selected_date:
            continue
        if utc_time in seen_hours:
            raise ValueError("Duplicate UTC weather hour")
        seen_hours.add(utc_time)
        hourly_result = calculate_hourly_questing(weather_hour)
        if hourly_result["questing_suitability"] is not None:
            valid_hours.append((utc_time, weather_hour, hourly_result))
        if hourly_result["example_questing_trigger"]:
            questing_trigger_hours += 1
        precipitation = validated_number(weather_hour.get("precipitation_mm"), "precipitation_mm", 0)
        cloud_cover = validated_number(weather_hour.get("low_cloud_cover_percent"), "low_cloud_cover_percent", 0, 100)
        is_day = weather_hour.get("is_day")
        if is_day is not None and (type(is_day) is not int or is_day not in (0, 1)):
            raise ValueError("is_day must be 0, 1 or null")
        if is_day == 0 and precipitation is not None and cloud_cover is not None:
            nighttime_weather_factors.append(0.6 * clip_unit_interval(precipitation / 2) + 0.4 * cloud_cover / 100)
    valid_hours.sort(key=lambda record: record[0])
    adequate_hours = len(valid_hours) >= MINIMUM_VALID_WEATHER_HOURS
    peak = max(valid_hours, key=lambda record: record[2]["questing_suitability"]) if adequate_hours else None
    missing_inputs = []
    if not adequate_hours:
        missing_inputs.append("at_least_18_valid_utc_weather_hours")
    if not nighttime_weather_factors:
        missing_inputs.append("nighttime_precipitation_and_low_cloud_cover")
    return {
        "date": selected_date.isoformat(),
        "questing_suitability": peak[2]["questing_suitability"] if peak else None,
        "questing_index_0_to_100": 100 * peak[2]["questing_suitability"] if peak else None,
        "valid_weather_hours": len(valid_hours),
        "questing_trigger_hours": questing_trigger_hours,
        "stopover_weather_proxy": max(nighttime_weather_factors) if nighttime_weather_factors else None,
        "conditions_at_peak": {**peak[1], "time": peak[0].isoformat().replace("+00:00", "Z")} if peak else None,
        "factors_at_peak": peak[2] if peak else None,
        "missing_inputs": missing_inputs,
    }


def calculate_activity_components(questing_suitability, stopover_weather_proxy, bird_reports_72h,
                                  bird_window_complete, tick_reports_7d, tick_window_complete,
                                  habitat_suitability):
    questing_suitability = validated_number(questing_suitability, "questing_suitability", 0, 1)
    stopover_weather_proxy = validated_number(stopover_weather_proxy, "stopover_weather_proxy", 0, 1)
    habitat_suitability = validated_number(habitat_suitability, "habitat_suitability", 0, 1)
    for count_name, report_count in (("bird_reports_72h", bird_reports_72h), ("tick_reports_7d", tick_reports_7d)):
        if report_count is not None and (type(report_count) is not int or report_count < 0):
            raise ValueError(f"{count_name} must be a non-negative integer or null")
    if type(bird_window_complete) is not bool or type(tick_window_complete) is not bool:
        raise ValueError("Report-window completeness must be explicit booleans")
    bird_activity = clip_unit_interval(math.log1p(bird_reports_72h) / math.log(21)) if bird_window_complete and bird_reports_72h is not None else None
    tick_reporting = clip_unit_interval(math.log1p(tick_reports_7d) / math.log(11)) if tick_window_complete and tick_reports_7d is not None else None
    stopover_potential = bird_activity * stopover_weather_proxy * habitat_suitability if all(
        value is not None for value in (bird_activity, stopover_weather_proxy, habitat_suitability)) else None
    ecological_activity = questing_suitability * (0.5 * tick_reporting + 0.5 * stopover_potential) if all(
        value is not None for value in (questing_suitability, tick_reporting, stopover_potential)) else None
    return {
        "questing_suitability": questing_suitability,
        "avian_activity_proxy": bird_activity,
        "tick_reporting_intensity": tick_reporting,
        "stopover_potential": stopover_potential,
        "ecological_activity_index": ecological_activity,
        "missing_inputs": [field_name for field_name, value in (
            ("questing_suitability", questing_suitability),
            ("stopover_weather_proxy", stopover_weather_proxy),
            ("complete_bird_report_window_72h", bird_activity),
            ("complete_tick_report_window_7d", tick_reporting),
            ("habitat_suitability", habitat_suitability),
        ) if value is None],
    }
