#!/usr/bin/env python3
"""Validate coastal data structure and summarize freshness without inventing values.

Upstream reporting delays and genuinely empty observations are reported as
degraded coverage, not as malformed data. Structural contradictions and
implausible timestamps fail the publishing workflow.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

UTC = dt.timezone.utc
THRESHOLDS = {"minor": 12.0, "moderate": 13.0, "major": 14.0}
MAX_FUTURE = dt.timedelta(minutes=10)


def parse_time(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(UTC)
    except (TypeError, ValueError):
        return None


class Health:
    def __init__(self, now):
        self.now = now
        self.errors = []
        self.warnings = []
        self.ok = []

    def fail(self, message):
        self.errors.append(message)

    def warn(self, message):
        self.warnings.append(message)

    def timestamp(self, value, label, max_age=None):
        parsed = parse_time(value)
        if parsed is None:
            self.fail(f"{label}: missing or malformed timestamp")
            return None
        age = self.now - parsed
        if age < -MAX_FUTURE:
            self.fail(f"{label}: timestamp is more than 10 minutes in the future")
        elif max_age is not None and age > max_age:
            if age >= dt.timedelta(days=2):
                description = f"{int(age.total_seconds() // 86400)} days old"
            else:
                description = f"{int(age.total_seconds() // 60)} minutes old"
            self.warn(f"{label}: stale ({description})")
        return parsed


def _load(path, health):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        health.fail(f"{path.name}: required data file is missing")
    except (OSError, json.JSONDecodeError):
        health.fail(f"{path.name}: data file cannot be read as valid JSON")
    return None


def inspect_history_file(path, health, label="Durable history branch"):
    doc = _load(Path(path), health)
    if not isinstance(doc, dict):
        return
    if doc.get("schema_version") != 2 or doc.get("thresholds_ft_mllw") != THRESHOLDS:
        health.fail(f"{label}: schema or Portland threshold contract is invalid")
    snapshots = doc.get("snapshots")
    _inspect_snapshots(snapshots, label, health)
    parsed = [parse_time(row.get("snapshot_at") or row.get("generated_at")) for row in snapshots or [] if isinstance(row, dict)] if isinstance(snapshots, list) else []
    valid = [stamp for stamp in parsed if stamp]
    if valid:
        age = health.now - valid[-1]
        if age > dt.timedelta(minutes=60):
            health.warn(f"{label}: newest capture is {int(age.total_seconds() // 60)} minutes old; inspect the scheduled capture run")
        recent_cutoff = health.now - dt.timedelta(hours=48)
        recent = [stamp for stamp in valid if stamp >= recent_cutoff]
        gaps = [(b - a).total_seconds() / 60 for a, b in zip(recent, recent[1:])]
        largest = max(gaps, default=0)
        if largest > 90:
            health.warn(f"{label}: a {int(largest)}-minute capture gap is present; no records were reconstructed")
    else:
        health.fail(f"{label}: no valid timestamped snapshots exist")


def _finite(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


def inspect(data_dir, history_path, now=None):
    health = Health(now or dt.datetime.now(UTC))
    data_dir = Path(data_dir)
    docs = {name: _load(data_dir / filename, health) for name, filename in {
        "wind": "wind.json",
        "coastal_alerts": "coastal-alerts.json",
        "hazards": "hazards.json",
        "briefing": "coastal-briefing.json",
        "history": "coastal-history.json",
    }.items()}

    wind = docs["wind"]
    if isinstance(wind, dict):
        health.timestamp(wind.get("generated_at"), "NDBC collection", dt.timedelta(minutes=45))
        stations = wind.get("stations")
        if not isinstance(stations, dict) or not stations:
            health.fail("NDBC collection: stations must be an object with station results")
        else:
            source_health = wind.get("source_health") or {}
            if not isinstance(source_health, dict):
                health.fail("NDBC collection: source_health must be an object")
                source_health = {}
            for station in ("44007", "WEXM1"):
                row = stations.get(station)
                status_doc = source_health.get(station) if isinstance(source_health.get(station), dict) else {}
                status = status_doc.get("status")
                if status is not None and status not in ("available", "missing", "malformed", "unavailable"):
                    health.fail(f"NDBC {station}: unknown source-health status")
                if status_doc.get("checked_at"):
                    health.timestamp(status_doc["checked_at"], f"NDBC {station} source check", dt.timedelta(minutes=45))
                if row is None:
                    if status == "missing":
                        health.warn(f"NDBC {station}: the feed responded but reported no usable observation")
                    elif status == "malformed":
                        health.warn(f"NDBC {station}: the response did not match the expected NDBC format")
                    else:
                        health.warn(f"NDBC {station}: request failed or no observation was published")
                    continue
                if not isinstance(row, dict):
                    health.fail(f"NDBC {station}: observation must be an object or null")
                    continue
                if status and status != "available":
                    health.fail(f"NDBC {station}: source-health status conflicts with the published observation")
                observed = health.timestamp(row.get("observed_at"), f"NDBC {station} wind observation", dt.timedelta(hours=3))
                reported_observed = parse_time(status_doc.get("observed_at")) if status_doc.get("observed_at") else observed
                if observed and reported_observed and abs((observed - reported_observed).total_seconds()) > 1:
                    health.fail(f"NDBC {station}: source-health and observation timestamps disagree")
                if observed and observed > health.now + MAX_FUTURE:
                    continue
                wave_at = row.get("wave_observed_at")
                if row.get("wave_height_ft") is not None:
                    health.timestamp(wave_at, f"NDBC {station} wave observation", dt.timedelta(hours=4))
                for field, low, high in (("speed_mph", 0, 202), ("gust_mph", 0, 202), ("wave_height_ft", 0, 100), ("direction_deg", 0, 360), ("wave_direction_deg", 0, 360)):
                    value = row.get(field)
                    if value is not None and (not _finite(value) or not low <= float(value) <= high):
                        health.fail(f"NDBC {station}: {field} is outside its valid range")

    alerts = docs["coastal_alerts"]
    if isinstance(alerts, dict):
        health.timestamp(alerts.get("generatedAt"), "NWS coastal-alert collection", dt.timedelta(minutes=45))
        if not isinstance(alerts.get("features"), list):
            health.fail("NWS coastal alerts: features must be a list (an empty list is valid)")
        elif alerts.get("error"):
            health.warn("NWS coastal alerts: provider request failed; no active-alert conclusion is inferred")
        else:
            health.ok.append(f"NWS coastal alerts: request succeeded ({len(alerts['features'])} active features)")

    hazards = docs["hazards"]
    if isinstance(hazards, dict):
        health.timestamp(hazards.get("generated_at"), "NWS/NHC hazard collection", dt.timedelta(minutes=45))
        if hazards.get("schema_version") != 1:
            health.fail("NWS/NHC hazards: unsupported schema version")
        for key in ("active_modes", "alerts", "marine_alerts", "hourly", "hourly_full", "errors"):
            expected = dict if key == "errors" else list
            if not isinstance(hazards.get(key), expected):
                health.fail(f"NWS/NHC hazards: {key} has an invalid shape")
        errors = hazards.get("errors") if isinstance(hazards.get("errors"), dict) else {}
        for source in sorted(errors):
            health.warn(f"NWS/NHC {source}: source request unavailable or unreadable; unaffected feeds remain usable")
        rows = hazards.get("hourly") if isinstance(hazards.get("hourly"), list) else []
        starts = []
        for index, row in enumerate(rows):
            stamp = parse_time(row.get("start")) if isinstance(row, dict) else None
            if stamp is None:
                health.fail(f"NWS hourly forecast: period {index + 1} has a missing or malformed start time")
                continue
            if stamp > health.now + dt.timedelta(hours=74):
                health.fail(f"NWS hourly forecast: period {index + 1} is outside the 72-hour forecast horizon")
            starts.append(stamp)
        if not starts:
            health.warn("NWS hourly forecast: no usable forecast periods were published")
        elif max(starts) < health.now + dt.timedelta(hours=12):
            health.warn("NWS hourly forecast: available forecast horizon is shorter than 12 hours")

    briefing = docs["briefing"]
    if isinstance(briefing, dict):
        health.timestamp(briefing.get("generated_at"), "Coastal Briefing", dt.timedelta(minutes=45))
        if briefing.get("schema_version") != 2:
            health.fail("Coastal Briefing: unsupported schema version")
        current = briefing.get("current_snapshot")
        if not isinstance(current, dict):
            health.fail("Coastal Briefing: current source snapshot is missing")
        else:
            if not isinstance(current.get("water"), dict):
                health.fail("Coastal Briefing: Portland water-level record must be an object, even when readings are unavailable")
            water = current.get("water") if isinstance(current.get("water"), dict) else {}
            if water.get("station") not in (None, "8418150"):
                health.fail("NOAA Portland water: station identifier is not the Portland 8418150 gauge")
            obs_time = water.get("latest_observed_at")
            if water.get("latest_observed_ft") is None:
                health.warn("NOAA Portland observation: no reading is available; this is not treated as zero or an all-clear")
            else:
                health.timestamp(obs_time, "NOAA Portland observation", dt.timedelta(minutes=90))
            for key in ("observed_24h_max_ft", "latest_observed_ft", "forecast_peak_24h_ft", "forecast_peak_72h_ft"):
                value = water.get(key)
                if value is not None and (not _finite(value) or not -30 <= float(value) <= 40):
                    health.fail(f"NOAA Portland water: {key} is outside the supported sanity range")
            peak24, peak72 = water.get("forecast_peak_24h_ft"), water.get("forecast_peak_72h_ft")
            if _finite(peak24) and _finite(peak72) and float(peak24) > float(peak72) + 0.02:
                health.fail("NOAA Portland water: 24-hour forecast peak exceeds the 72-hour forecast maximum")
            observed_max, latest = water.get("observed_24h_max_ft"), water.get("latest_observed_ft")
            if _finite(observed_max) and _finite(latest) and float(latest) > float(observed_max) + 0.02:
                health.fail("NOAA Portland water: latest observation exceeds the reported 24-hour observed maximum")
            margins = water.get("threshold_margins_ft")
            if _finite(peak72):
                if not isinstance(margins, dict):
                    health.fail("NOAA Portland water: forecast threshold margins are missing")
                else:
                    for name, threshold in THRESHOLDS.items():
                        expected = round(threshold - float(peak72), 2)
                        actual = margins.get(name)
                        if not _finite(actual) or abs(float(actual) - expected) > 0.02:
                            health.fail(f"NOAA Portland water: {name} threshold margin does not match the forecast peak")
            source_errors = water.get("source_errors") or {}
            if not isinstance(source_errors, dict):
                health.fail("NOAA Portland water: source_errors must be an object")
                source_errors = {}
            for source, error in source_errors.items():
                if error:
                    health.warn(f"NOAA Portland {source}: source request failed or returned unreadable data")
            hazards_in_briefing = current.get("hazards") if isinstance(current.get("hazards"), dict) else {}
            for source in sorted(hazards_in_briefing.get("errors") or {}):
                health.warn(f"Hazard source {source}: unavailable or unreadable; no unsupported value is substituted")

    history = docs["history"]
    if isinstance(history, dict):
        health.timestamp(history.get("generated_at"), "Published history asset", dt.timedelta(minutes=45))
        if history.get("schema_version") != 2:
            health.fail("Published history: unsupported schema version")
        if history.get("thresholds_ft_mllw") != THRESHOLDS:
            health.fail("Published history: Portland flood thresholds or datum contract changed")
        _inspect_snapshots(history.get("snapshots"), "Published history", health)

    if history_path:
        inspect_history_file(history_path, health)
    return health


def _inspect_snapshots(snapshots, label, health):
    if not isinstance(snapshots, list) or not snapshots:
        health.fail(f"{label}: at least one timestamped snapshot is required")
        return
    previous = None
    seen = set()
    for index, row in enumerate(snapshots):
        if not isinstance(row, dict):
            health.fail(f"{label}: snapshot {index + 1} is not an object")
            continue
        stamp = parse_time(row.get("snapshot_at") or row.get("generated_at"))
        if stamp is None:
            health.fail(f"{label}: snapshot {index + 1} has a missing or malformed timestamp")
            continue
        if stamp > health.now + MAX_FUTURE:
            health.fail(f"{label}: snapshot {index + 1} is implausibly future-dated")
        key = (row.get("snapshot_kind") or "realtime", stamp)
        if key in seen:
            health.fail(f"{label}: duplicate snapshot timestamp {stamp.isoformat()}")
        if previous and stamp < previous:
            health.fail(f"{label}: snapshots are not ordered by timestamp")
        previous = stamp
        seen.add(key)


def write_summary(health, path):
    lines = ["## SacoCast production data health", "", f"Checked at {health.now.isoformat()}.", ""]
    lines.extend(f"- ✅ {item}" for item in health.ok)
    lines.extend(f"- ⚠️ {item}" for item in health.warnings)
    lines.extend(f"- ❌ {item}" for item in health.errors)
    if not health.warnings and not health.errors:
        lines.append("- ✅ Critical feeds and durable history passed structural and freshness checks.")
    text = "\n".join(lines) + "\n"
    if path:
        with Path(path).open("a", encoding="utf-8") as summary:
            summary.write(text)
    print(text, end="")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--durable-history", type=Path)
    parser.add_argument("--history-only", action="store_true")
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args()
    if args.history_only:
        if not args.durable_history:
            parser.error("--history-only requires --durable-history")
        health = Health(dt.datetime.now(UTC))
        inspect_history_file(args.durable_history, health)
    elif args.data_dir:
        health = inspect(args.data_dir, args.durable_history)
    else:
        parser.error("--data-dir is required unless --history-only is used")
    write_summary(health, args.summary)
    if health.errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
