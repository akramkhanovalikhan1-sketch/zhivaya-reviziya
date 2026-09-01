"""Полный контур mock: auth → скан → undo → finish → closeIdle → акты."""
from __future__ import annotations

import json
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000/hs/tsd"


def post(path: str, body: dict | None = None) -> dict:
    data = json.dumps(body or {}).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> None:
    post("/arm/reset")
    auth = post("/auth", {"barcode": "EMP-1001"})
    assert auth["ok"], auth
    start = post("/startZone", {"zoneId": "S-01", "userId": auth["userId"]})
    assert start["ok"] and not start.get("needsConfirm"), start
    scan = post(
        "/scanItem",
        {
            "barcode": "4600000000017",
            "zoneId": "S-01",
            "qty": 2,
            "userId": auth["userId"],
            "sessionNum": start["sessionNum"],
            "deviceId": "TSD-AUTO",
        },
    )
    assert scan["ok"] and scan["lines"], scan
    lines = get(f"/sessionLines?zoneId=S-01&sessionNum={start['sessionNum']}")
    assert lines["ok"] and lines["lines"][0]["qty"] == 2, lines
    undo = post(
        "/undoLast",
        {"zoneId": "S-01", "userId": auth["userId"], "sessionNum": start["sessionNum"]},
    )
    assert undo["ok"] and undo["lines"] == [], undo
    post(
        "/scanItem",
        {
            "barcode": "4600000000017",
            "zoneId": "S-01",
            "qty": 1,
            "userId": auth["userId"],
            "sessionNum": start["sessionNum"],
            "deviceId": "TSD-AUTO",
        },
    )
    fin = post(
        "/finishZone",
        {"zoneId": "S-01", "userId": auth["userId"], "sessionNum": start["sessionNum"]},
    )
    assert fin["ok"], fin
    preview = post("/startZone", {"zoneId": "S-01", "userId": auth["userId"], "confirmRecheck": False})
    assert preview.get("needsConfirm"), preview
    idle = post("/arm/closeIdle", {})
    assert idle["ok"] and idle["closed"] >= 1, idle
    q = post("/startZone", {"zoneId": "Q-RC", "userId": auth["userId"]})
    assert not q["ok"] and q["error"] == "quarantine", q
    dash = get("/arm/dashboard")
    assert dash["canFinalize"] and dash["coveragePercent"] == 100, dash
    acts = post("/arm/finalize")
    assert acts["ok"] and acts["acts"], acts
    print("OK: full revision flow")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as exc:
        raise SystemExit(f"Server is down: {exc}") from exc
