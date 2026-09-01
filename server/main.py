from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path

TZ = timezone(timedelta(hours=5))


def now() -> datetime:
    return datetime.now(TZ)


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


class AuthIn(BaseModel):
    barcode: str


class StartZoneIn(BaseModel):
    zoneId: str
    userId: str
    sessionNum: int = 0


class ScanItemIn(BaseModel):
    barcode: str
    zoneId: str
    qty: float
    userId: str
    sessionNum: int
    deviceId: str = "TSD-UNKNOWN"


class FinishZoneIn(BaseModel):
    zoneId: str
    userId: str
    sessionNum: int


class RecheckIn(BaseModel):
    zoneId: str


class SaleIn(BaseModel):
    sku: str
    qty: float = 1


class TransitIn(BaseModel):
    document: str


EMPLOYEES = {
    "EMP-1001": {"id": "u-ivanov", "name": "Иванов И.И."},
    "EMP-1002": {"id": "u-sidorov", "name": "Сидоров П.П."},
    "EMP-1003": {"id": "u-petrova", "name": "Петрова А.А."},
}

PRODUCTS = {
    "4600000000017": {
        "sku": "DRL-18",
        "name": "Дрель ударная 800 Вт",
        "group": "Инструмент",
        "price": 8900,
        "main": "DRL-18",
        "homeZone": "S-01",
    },
    "4600000000024": {
        "sku": "CMT-50",
        "name": "Цемент М500 50 кг",
        "group": "Сухие смеси",
        "price": 450,
        "main": "CMT-50",
        "homeZone": "P-01",
        "bulk": True,
    },
    "4600000000031": {
        "sku": "SCR-35",
        "name": "Саморез 3.5×35 белый",
        "group": "Крепеж",
        "price": 12,
        "main": "SCR-35",
        "homeZone": "S-02",
    },
    "4600000000048": {
        "sku": "SCR-35-DUP",
        "name": "Саморез 3,5*35 бел.",
        "group": "Крепеж",
        "price": 12,
        "main": "SCR-35",
        "homeZone": "S-02",
        "duplicate": True,
    },
    "4600000000055": {
        "sku": "SCR-45",
        "name": "Саморез 4.5×45 белый",
        "group": "Крепеж",
        "price": 12,
        "main": "SCR-45",
        "homeZone": "S-02",
    },
    "4600000000062": {
        "sku": "BRK-1",
        "name": "Кирпич строительный полнотелый",
        "group": "Кладочные",
        "price": 28,
        "main": "BRK-1",
        "homeZone": "P-02",
        "bulk": True,
    },
}

SKU_META = {p["sku"]: p for p in PRODUCTS.values() if not p.get("duplicate")}

PLAN_STOCK = {
    "DRL-18": 10,
    "CMT-50": 800,
    "SCR-35": 120,
    "SCR-45": 100,
    "BRK-1": 2000,
}

ZONES = [
    {"zoneId": "S-01", "name": "Стеллаж 1 — инструмент"},
    {"zoneId": "S-02", "name": "Стеллаж 2 — крепеж"},
    {"zoneId": "S-03", "name": "Стеллаж 3 — смеси"},
    {"zoneId": "P-01", "name": "Паллета P-01 цемент", "freezeSku": "CMT-50"},
    {"zoneId": "P-02", "name": "Паллета P-02 кирпич", "freezeSku": "BRK-1"},
    {"zoneId": "S-04", "name": "Стеллаж 4 — краски"},
    {"zoneId": "S-05", "name": "Стеллаж 5 — сантехника"},
    {"zoneId": "S-06", "name": "Стеллаж 6 — электрика"},
    {"zoneId": "Q-RC", "name": "Карантин РЦ (cut-off)", "quarantine": True},
]


def empty_zone_state(z: dict) -> dict:
    return {
        **z,
        "status": "idle",
        "color": "gray",
        "userId": None,
        "userName": None,
        "sessionNum": 0,
        "startTime": None,
        "finishTime": None,
        "blockedUserId": None,
    }


def fresh_db() -> dict[str, Any]:
    return {
        "zones": {z["zoneId"]: empty_zone_state(z) for z in ZONES},
        "scans": [],
        "sales": [],
        "sessions": [],
        "freezes": {},
        "offsets": [],
        "finalized": False,
        "acts": [],
        "transit_docs": [
            {
                "id": "RC-4412",
                "document": "Заказ на перемещение РЦ №4412",
                "sku": "CMT-50",
                "qty": 200,
                "posted": False,
                "days_ago": 2,
            },
            {
                "id": "RC-4413",
                "document": "Перемещение РЦ №4413 (машина ещё в пути)",
                "sku": "BRK-1",
                "qty": 500,
                "posted": True,
                "days_ago": 1,
            },
        ],
    }


db = fresh_db()

app = FastAPI(title="Живая ревизия mock 1С")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC = Path(__file__).parent / "static"
if STATIC.exists():
    app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def root():
    index = STATIC / "arm.html"
    if index.exists():
        return FileResponse(index)
    return {"service": "zhivaya-reviziya-mock", "docs": "/docs"}


def employee_by_id(user_id: str) -> dict | None:
    for emp in EMPLOYEES.values():
        if emp["id"] == user_id:
            return emp
    return None


def resolve_product(barcode: str) -> tuple[dict | None, bool]:
    p = PRODUCTS.get(barcode.strip())
    if not p:
        return None, False
    if p.get("duplicate"):
        main = next(x for x in PRODUCTS.values() if x["sku"] == p["main"])
        return {**main, "duplicate_from": p["name"]}, True
    return p, False


def archive_session(zone: dict) -> None:
    if not zone.get("sessionNum") or not zone.get("startTime"):
        return
    key = (zone["zoneId"], zone["sessionNum"])
    if any((s["zoneId"], s["sessionNum"]) == key for s in db["sessions"]):
        return
    fact = {}
    for scan in db["scans"]:
        if scan["zoneId"] == zone["zoneId"] and scan["sessionNum"] == zone["sessionNum"]:
            fact[scan["sku"]] = fact.get(scan["sku"], 0) + scan["qty"]
    db["sessions"].append(
        {
            "zoneId": zone["zoneId"],
            "sessionNum": zone["sessionNum"],
            "userId": zone["userId"],
            "userName": zone["userName"],
            "startTime": zone["startTime"],
            "finishTime": zone.get("finishTime"),
            "fact": fact,
        }
    )


def freeze_sku(sku: str, minutes: int = 5) -> str:
    until = now() + timedelta(minutes=minutes)
    db["freezes"][sku] = until.isoformat(timespec="seconds")
    return db["freezes"][sku]


def active_freeze(sku: str) -> str | None:
    raw = db["freezes"].get(sku)
    if not raw:
        return None
    until = parse_dt(raw)
    if until and until > now():
        return raw
    db["freezes"].pop(sku, None)
    return None


def sales_before(sku: str, ts: datetime) -> float:
    return sum(s["qty"] for s in db["sales"] if s["sku"] == sku and parse_dt(s["time"]) and parse_dt(s["time"]) <= ts)


def sales_after(sku: str, ts: datetime) -> float:
    return sum(s["qty"] for s in db["sales"] if s["sku"] == sku and parse_dt(s["time"]) and parse_dt(s["time"]) > ts)


def transit_cut(sku: str) -> float:
    scanned = {s["sku"] for s in db["scans"]}
    cut = 0.0
    for doc in db["transit_docs"]:
        if doc["sku"] == sku and doc["posted"] and doc["sku"] not in scanned:
            cut += doc["qty"]
    return cut


def home_zone_for(sku: str) -> dict | None:
    meta = SKU_META.get(sku)
    if not meta:
        return None
    return db["zones"].get(meta.get("homeZone"))


@app.post("/hs/tsd/auth")
def auth(body: AuthIn):
    emp = EMPLOYEES.get(body.barcode.strip())
    if not emp:
        return {
            "ok": False,
            "error": "unknown_badge",
            "message": "Бейдж не найден. Обратитесь к товароведу.",
        }
    return {"ok": True, "userId": emp["id"], "userName": emp["name"]}


@app.post("/hs/tsd/startZone")
def start_zone(body: StartZoneIn):
    if db["finalized"]:
        return {"ok": False, "error": "finalized", "message": "Ревизия уже закрыта актами"}

    zid = body.zoneId.strip().upper()
    zone = db["zones"].get(zid) or db["zones"].get(body.zoneId.strip())
    if zone is None:
        zone = empty_zone_state({"zoneId": zid, "name": f"Зона {zid}"})
        db["zones"][zid] = zone

    if zone.get("quarantine"):
        return {
            "ok": False,
            "error": "quarantine",
            "message": "Зона карантина РЦ. ТСД сюда не заходят до конца ревизии (правило cut-off).",
        }

    user = employee_by_id(body.userId)
    if not user:
        return {"ok": False, "error": "unknown_user", "message": "Сотрудник не найден"}

    if zone["status"] == "active" and zone["userId"] != body.userId:
        return {
            "ok": False,
            "error": "zone_busy",
            "message": f"Зону уже считает {zone['userName']}",
        }

    if zone.get("blockedUserId") and zone["blockedUserId"] == body.userId:
        return {
            "ok": False,
            "error": "recheck_blocked",
            "message": "Первичный сотрудник заблокирован от этой зоны. Нужен другой ревизор.",
        }

    recheck = zone["status"] in ("recheck", "closed")
    prev_name = zone.get("userName")
    if zone["sessionNum"]:
        archive_session(zone)

    session = body.sessionNum if body.sessionNum else (zone["sessionNum"] or 0) + 1
    if session < 1:
        session = 1

    zone["status"] = "active"
    zone["color"] = "yellow"
    zone["userId"] = body.userId
    zone["userName"] = user["name"]
    zone["sessionNum"] = session
    zone["startTime"] = now().isoformat(timespec="milliseconds")
    zone["finishTime"] = None

    freeze_until = None
    freeze_sku_code = zone.get("freezeSku")
    if freeze_sku_code:
        freeze_until = freeze_sku(freeze_sku_code, 5)

    msg = None
    if recheck:
        msg = (
            f"Внимание, перепроверка! Аннулировать первый подсчет"
            f"{' (' + prev_name + ')' if prev_name else ''}?"
        )
    elif freeze_until:
        name = SKU_META[freeze_sku_code]["name"]
        msg = f"Зона заморожена на 5 мин: {name}. Выписка на кассах заблокирована."

    return {
        "ok": True,
        "zoneId": zone["zoneId"],
        "zoneName": zone["name"],
        "sessionNum": session,
        "startTime": zone["startTime"],
        "recheck": recheck,
        "previousUserName": prev_name,
        "freezeSku": freeze_sku_code,
        "freezeUntil": freeze_until,
        "message": msg,
    }


@app.post("/hs/tsd/scanItem")
def scan_item(body: ScanItemIn):
    zone = db["zones"].get(body.zoneId)
    if not zone or zone["status"] != "active":
        return {
            "ok": False,
            "alarm": True,
            "error": "zone_not_started",
            "message": "Сначала нажмите НАЧАТЬ ПОДСЧЕТ",
        }
    if zone["sessionNum"] != body.sessionNum:
        return {
            "ok": False,
            "alarm": True,
            "error": "session_mismatch",
            "message": "Сессия зоны устарела",
        }

    product, is_dup = resolve_product(body.barcode)
    if product is None:
        return {
            "ok": False,
            "alarm": True,
            "error": "unknown_barcode",
            "message": "Штрихкод неизвестен",
        }

    db["scans"].append(
        {
            "id": str(uuid4()),
            "period": now().isoformat(timespec="milliseconds"),
            "deviceId": body.deviceId,
            "userId": body.userId,
            "zoneId": body.zoneId,
            "sessionNum": body.sessionNum,
            "sku": product["sku"],
            "qty": body.qty,
            "barcode": body.barcode,
        }
    )

    extra = ""
    if product.get("bulk"):
        extra = " Крупногабарит: лучше калькулятор рядов."

    if is_dup:
        return {
            "ok": True,
            "alarm": False,
            "name": product["name"],
            "sku": product["sku"],
            "qty": body.qty,
            "warning": "duplicate_card",
            "message": f"Это дубликат. Считаем в общую кучу к основному товару: {product['name']}",
        }

    return {
        "ok": True,
        "alarm": False,
        "name": product["name"],
        "sku": product["sku"],
        "qty": body.qty,
        "warning": None,
        "message": extra.strip() or None,
    }


@app.post("/hs/tsd/finishZone")
def finish_zone(body: FinishZoneIn):
    zone = db["zones"].get(body.zoneId)
    if not zone:
        return {"ok": False, "error": "unknown_zone", "message": "Зона не найдена"}
    if zone["status"] != "active":
        return {"ok": False, "error": "not_active", "message": "Зона не в работе"}
    if zone["userId"] != body.userId or zone["sessionNum"] != body.sessionNum:
        return {"ok": False, "error": "session_mismatch", "message": "Чужая сессия"}

    zone["status"] = "closed"
    zone["color"] = "green"
    zone["finishTime"] = now().isoformat(timespec="milliseconds")
    archive_session(zone)
    return {"ok": True, "message": f"Зона {zone['name']} закрыта. Виртуальный замок включён."}


@app.post("/hs/tsd/arm/recheck")
def recheck(body: RecheckIn):
    zone = db["zones"].get(body.zoneId)
    if not zone:
        return {"ok": False, "error": "unknown_zone"}
    if zone["status"] != "closed":
        return {"ok": False, "error": "not_closed", "message": "Перепроверка только для закрытой зоны"}
    archive_session(zone)
    zone["status"] = "recheck"
    zone["color"] = "orange"
    zone["blockedUserId"] = zone["userId"]
    return {"ok": True, "message": f"Зона {zone['zoneId']} направлена на перепроверку"}


def fact_by_sku() -> dict[str, dict]:
    result: dict[str, dict] = {}
    for sku, plan in PLAN_STOCK.items():
        result[sku] = {
            "sku": sku,
            "name": SKU_META[sku]["name"],
            "plan": float(plan),
            "factTsd": 0.0,
            "soldAfterStart": 0.0,
            "transitCut": 0.0,
            "accountingAtStart": float(plan),
        }

    for scan in db["scans"]:
        zone = db["zones"].get(scan["zoneId"])
        if not zone or scan["sessionNum"] != zone["sessionNum"]:
            continue
        sku = scan["sku"]
        if sku not in result:
            result[sku] = {
                "sku": sku,
                "name": SKU_META.get(sku, {}).get("name", sku),
                "plan": 0.0,
                "factTsd": 0.0,
                "soldAfterStart": 0.0,
                "transitCut": 0.0,
                "accountingAtStart": 0.0,
            }
        result[sku]["factTsd"] += scan["qty"]

    for sku, row in result.items():
        zone = home_zone_for(sku)
        start = parse_dt(zone["startTime"]) if zone and zone.get("startTime") else None
        cut = transit_cut(sku)
        row["transitCut"] = cut
        if start:
            row["accountingAtStart"] = max(0.0, row["plan"] - sales_before(sku, start) - cut)
            if zone["status"] in ("active", "closed", "recheck"):
                row["soldAfterStart"] = sales_after(sku, start)
        else:
            row["accountingAtStart"] = max(0.0, row["plan"] - sum(s["qty"] for s in db["sales"] if s["sku"] == sku) - cut)
            row["soldAfterStart"] = 0.0

        offset = sum(o["qty"] for o in db["offsets"] if o["plusSku"] == sku) - sum(
            o["qty"] for o in db["offsets"] if o["minusSku"] == sku
        )
        row["offset"] = offset
        row["adjustedFact"] = row["factTsd"] + row["soldAfterStart"] + offset
        row["deviation"] = row["adjustedFact"] - row["accountingAtStart"]
        row["plan"] = row["accountingAtStart"]
    return result


def resorting_pairs(lines: list[dict]) -> tuple[list[dict], list[dict]]:
    auto: list[dict] = []
    manual: list[dict] = []
    by_group: dict[str, list] = {}
    for row in lines:
        meta = SKU_META.get(row["sku"])
        if meta:
            by_group.setdefault(meta["group"], []).append((row, meta))
    used: set[tuple[str, str]] = set()
    for group, items in by_group.items():
        minus = [x for x in items if x[0]["deviation"] < 0]
        plus = [x for x in items if x[0]["deviation"] > 0]
        for m, mm in minus:
            for p, pm in plus:
                key = (m["sku"], p["sku"])
                if key in used:
                    continue
                qty = min(-m["deviation"], p["deviation"])
                if qty <= 0:
                    continue
                item = {
                    "minusSku": m["sku"],
                    "plusSku": p["sku"],
                    "a": m["name"],
                    "b": p["name"],
                    "qty": qty,
                    "auto": mm["price"] == pm["price"],
                    "reason": (
                        f"Автозачет, группа «{group}», цена {mm['price']} ₸"
                        if mm["price"] == pm["price"]
                        else f"Разная цена {mm['price']} / {pm['price']} ₸, разницу на издержки"
                    ),
                }
                used.add(key)
                (auto if item["auto"] else manual).append(item)
    return auto, manual


def comparison_report() -> list[dict]:
    by_zone: dict[str, list] = {}
    for s in db["sessions"]:
        by_zone.setdefault(s["zoneId"], []).append(s)
    rows = []
    for zone_id, sessions in by_zone.items():
        if len(sessions) < 2:
            continue
        first, last = sessions[0], sessions[-1]
        skus = set(first["fact"]) | set(last["fact"])
        for sku in sorted(skus):
            rows.append(
                {
                    "zoneId": zone_id,
                    "sku": sku,
                    "name": SKU_META.get(sku, {}).get("name", sku),
                    "firstUser": first["userName"],
                    "firstQty": first["fact"].get(sku, 0),
                    "secondUser": last["userName"],
                    "secondQty": last["fact"].get(sku, 0),
                    "delta": last["fact"].get(sku, 0) - first["fact"].get(sku, 0),
                }
            )
    return rows


@app.get("/hs/tsd/arm/dashboard")
def dashboard():
    work_zones = [z for z in db["zones"].values() if not z.get("quarantine")]
    closed = sum(1 for z in work_zones if z["status"] == "closed")
    total = len(work_zones)
    lines = list(fact_by_sku().values())
    auto, manual = resorting_pairs(lines)

    transit = []
    scanned = {s["sku"] for s in db["scans"]}
    for doc in db["transit_docs"]:
        if not doc["posted"]:
            transit.append(
                {
                    "document": doc["document"],
                    "id": doc["id"],
                    "sku": doc["sku"],
                    "action": "post",
                    "message": f"Найден товар перемещения {doc['document']}. Провести документ?",
                }
            )
        elif doc["sku"] not in scanned:
            transit.append(
                {
                    "document": doc["document"],
                    "id": doc["id"],
                    "sku": doc["sku"],
                    "action": "cut",
                    "message": f"{doc['document']}: ни одной позиции не сосканировано. Груз помечен как транзитный, {doc['qty']} шт вырезаны из остатка.",
                }
            )

    freezes = []
    for sku, until in list(db["freezes"].items()):
        if active_freeze(sku):
            freezes.append({"sku": sku, "name": SKU_META[sku]["name"], "until": until})

    return {
        "canFinalize": closed == total and total > 0 and not db["finalized"],
        "finalized": db["finalized"],
        "acts": db["acts"],
        "coveragePercent": round(100 * closed / total, 1) if total else 0,
        "zones": [
            {
                "zoneId": z["zoneId"],
                "name": z["name"],
                "status": z["status"],
                "color": "gray" if z.get("quarantine") and z["status"] == "idle" else z["color"],
                "userName": z["userName"],
                "sessionNum": z["sessionNum"],
                "startTime": z["startTime"],
                "finishTime": z["finishTime"],
                "quarantine": bool(z.get("quarantine")),
            }
            for z in db["zones"].values()
        ],
        "lines": lines,
        "candidates": manual,
        "autoOffset": auto,
        "offsets": db["offsets"],
        "transitWarnings": transit,
        "comparison": comparison_report(),
        "freezes": freezes,
        "sales": db["sales"][-8:],
    }


@app.post("/hs/tsd/arm/sale")
def sale(body: SaleIn):
    sku = body.sku.strip().upper()
    if sku not in SKU_META:
        return {"ok": False, "error": "unknown_sku", "message": "Нет такого SKU"}
    frozen = active_freeze(sku)
    if frozen:
        return {
            "ok": False,
            "error": "frozen",
            "message": f"Товар заморожен до {frozen}. Касса не выписывает, пока ревизор не зафиксирует паллету.",
        }
    rec = {
        "id": str(uuid4())[:8],
        "sku": sku,
        "name": SKU_META[sku]["name"],
        "qty": body.qty,
        "time": now().isoformat(timespec="milliseconds"),
    }
    db["sales"].append(rec)
    return {"ok": True, "sale": rec}


@app.post("/hs/tsd/arm/postTransit")
def post_transit(body: TransitIn):
    for doc in db["transit_docs"]:
        if doc["id"] == body.document or doc["document"] == body.document:
            doc["posted"] = True
            return {"ok": True, "message": f"{doc['document']} проведён"}
    return {"ok": False, "error": "not_found"}


@app.post("/hs/tsd/arm/applyOffset")
def apply_offset():
    lines = list(fact_by_sku().values())
    auto, _ = resorting_pairs(lines)
    applied = 0
    for item in auto:
        db["offsets"].append(item)
        applied += 1
    return {"ok": True, "applied": applied, "message": f"Автозачет пересортицы: {applied} пар"}


@app.post("/hs/tsd/arm/finalize")
def finalize():
    dash = dashboard()
    if not dash["canFinalize"]:
        return {"ok": False, "error": "not_ready", "message": "Акты закрыты, пока не зелёные все рабочие зоны"}
    acts = []
    for row in dash["lines"]:
        if abs(row["deviation"]) < 0.001:
            continue
        kind = "списание" if row["deviation"] < 0 else "оприходование"
        acts.append(
            {
                "kind": kind,
                "sku": row["sku"],
                "name": row["name"],
                "qty": abs(row["deviation"]),
            }
        )
    db["acts"] = acts
    db["finalized"] = True
    return {"ok": True, "acts": acts, "message": f"Сформировано актов: {len(acts)}"}


@app.post("/hs/tsd/arm/reset")
def reset_demo():
    global db
    db = fresh_db()
    return {"ok": True}
