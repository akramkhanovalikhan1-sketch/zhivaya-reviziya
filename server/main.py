from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pathlib import Path

MSK = timezone(timedelta(hours=5))  # Asia/Almaty / магазин


def now() -> datetime:
    return datetime.now(MSK)


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


ZoneStatus = Literal["idle", "active", "closed", "recheck"]


EMPLOYEES = {
    "EMP-1001": {"id": "u-ivanov", "name": "Иванов И.И."},
    "EMP-1002": {"id": "u-sidorov", "name": "Сидоров П.П."},
    "EMP-1003": {"id": "u-petrova", "name": "Петрова А.А."},
}

# Основной товар + дубль (кросс-код)
PRODUCTS = {
    "4600000000017": {
        "sku": "DRL-18",
        "name": "Дрель ударная 800 Вт",
        "group": "Инструмент",
        "price": 8900,
        "main": "DRL-18",
    },
    "4600000000024": {
        "sku": "CMT-50",
        "name": "Цемент М500 50 кг",
        "group": "Сухие смеси",
        "price": 450,
        "main": "CMT-50",
    },
    "4600000000031": {
        "sku": "SCR-35",
        "name": "Саморез 3.5×35 белый",
        "group": "Крепеж",
        "price": 12,
        "main": "SCR-35",
    },
    "4600000000048": {
        "sku": "SCR-35-DUP",
        "name": "Саморез 3,5*35 бел.",
        "group": "Крепеж",
        "price": 12,
        "main": "SCR-35",
        "duplicate": True,
    },
    "4600000000055": {
        "sku": "SCR-45",
        "name": "Саморез 4.5×45 белый",
        "group": "Крепеж",
        "price": 12,
        "main": "SCR-45",
    },
    "4600000000062": {
        "sku": "BRK-1",
        "name": "Кирпич строительный полнотелый",
        "group": "Кладочные",
        "price": 28,
        "main": "BRK-1",
    },
}

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
    {"zoneId": "P-01", "name": "Паллета P-01 цемент"},
    {"zoneId": "P-02", "name": "Паллета P-02 кирпич"},
    {"zoneId": "S-04", "name": "Стеллаж 4 — краски"},
    {"zoneId": "S-05", "name": "Стеллаж 5 — сантехника"},
    {"zoneId": "S-06", "name": "Стеллаж 6 — электрика"},
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


db = {
    "zones": {z["zoneId"]: empty_zone_state(z) for z in ZONES},
    "scans": [],  # history
    "sales": [
        # Чек ПОСЛЕ старта зоны — для демо формулы «временного сдвига»
        # заполняется динамически при необходимости
    ],
    "transit_docs": [
        {
            "document": "Заказ на перемещение РЦ №4412",
            "sku": "CMT-50",
            "posted": False,
            "days_ago": 2,
        }
    ],
}


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
        main_sku = p["main"]
        main = next(x for x in PRODUCTS.values() if x["sku"] == main_sku)
        return {**main, "duplicate_from": p["name"]}, True
    return p, False


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
    zone = db["zones"].get(body.zoneId.strip().upper()) or db["zones"].get(body.zoneId.strip())
    if zone is None:
        # неизвестная зона — создаём на лету (пластиковый маркер P-xx)
        zid = body.zoneId.strip().upper()
        zone = empty_zone_state({"zoneId": zid, "name": f"Зона {zid}"})
        db["zones"][zid] = zone

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

    msg = None
    if recheck:
        msg = (
            f"Внимание, перепроверка! Аннулировать первый подсчет"
            f"{' (' + prev_name + ')' if prev_name else ''}?"
        )

    return {
        "ok": True,
        "zoneId": zone["zoneId"],
        "zoneName": zone["name"],
        "sessionNum": session,
        "startTime": zone["startTime"],
        "recheck": recheck,
        "previousUserName": prev_name,
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
        "message": None,
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
    return {"ok": True, "message": f"Зона {zone['name']} закрыта"}


@app.post("/hs/tsd/arm/recheck")
def recheck(body: RecheckIn):
    zone = db["zones"].get(body.zoneId)
    if not zone:
        return {"ok": False, "error": "unknown_zone"}
    if zone["status"] != "closed":
        return {"ok": False, "error": "not_closed", "message": "Перепроверка только для закрытой зоны"}
    zone["status"] = "recheck"
    zone["color"] = "orange"
    zone["blockedUserId"] = zone["userId"]
    return {"ok": True, "message": f"Зона {zone['zoneId']} направлена на перепроверку"}


def fact_by_sku() -> dict[str, dict]:
    """Факт ТСД по актуальной сессии каждой зоны + продажи после старта."""
    # актуальная сессия зоны = текущий sessionNum
    result: dict[str, dict] = {}
    for sku, plan in PLAN_STOCK.items():
        result[sku] = {
            "sku": sku,
            "name": next(p["name"] for p in PRODUCTS.values() if p["sku"] == sku),
            "plan": plan,
            "factTsd": 0.0,
            "soldAfterStart": 0.0,
        }

    for scan in db["scans"]:
        zone = db["zones"].get(scan["zoneId"])
        if not zone:
            continue
        if scan["sessionNum"] != zone["sessionNum"]:
            continue  # старые сессии — только аналитика, не в итог
        sku = scan["sku"]
        if sku not in result:
            result[sku] = {
                "sku": sku,
                "name": sku,
                "plan": 0,
                "factTsd": 0.0,
                "soldAfterStart": 0.0,
            }
        result[sku]["factTsd"] += scan["qty"]

    # демо-продажа дрели: если зона инструмента закрыта/активна — +1 после старта
    tool_zone = db["zones"].get("S-01")
    if tool_zone and tool_zone["startTime"] and "DRL-18" in result:
        result["DRL-18"]["soldAfterStart"] = 1.0

    for row in result.values():
        row["adjustedFact"] = row["factTsd"] + row["soldAfterStart"]
        row["deviation"] = row["adjustedFact"] - row["plan"]
    return result


@app.get("/hs/tsd/arm/dashboard")
def dashboard():
    zones = list(db["zones"].values())
    closed = sum(1 for z in zones if z["status"] == "closed")
    total = len(zones)
    lines = list(fact_by_sku().values())

    # автозачет: одинаковая цена + группа, зеркальные отклонения
    candidates = []
    by_group: dict[str, list] = {}
    sku_meta = {p["sku"]: p for p in PRODUCTS.values() if not p.get("duplicate")}
    for row in lines:
        meta = sku_meta.get(row["sku"])
        if not meta:
            continue
        by_group.setdefault(meta["group"], []).append((row, meta))
    for group, items in by_group.items():
        minus = [x for x in items if x[0]["deviation"] < 0]
        plus = [x for x in items if x[0]["deviation"] > 0]
        for m, mm in minus:
            for p, pm in plus:
                if mm["price"] == pm["price"]:
                    qty = min(-m["deviation"], p["deviation"])
                    if qty > 0:
                        candidates.append(
                            {
                                "a": m["name"],
                                "b": p["name"],
                                "qty": qty,
                                "reason": f"Пересортица, группа «{group}», цена {mm['price']} ₸",
                            }
                        )

    transit = []
    for doc in db["transit_docs"]:
        fact = fact_by_sku().get(doc["sku"], {})
        if fact.get("factTsd", 0) == 0:
            transit.append(
                {
                    "document": doc["document"],
                    "sku": doc["sku"],
                    "message": f"Найден товар перемещения {doc['document']}. Провести документ?",
                }
            )

    return {
        "canFinalize": closed == total and total > 0,
        "coveragePercent": round(100 * closed / total, 1) if total else 0,
        "zones": [
            {
                "zoneId": z["zoneId"],
                "name": z["name"],
                "status": z["status"],
                "color": z["color"],
                "userName": z["userName"],
                "sessionNum": z["sessionNum"],
                "startTime": z["startTime"],
                "finishTime": z["finishTime"],
            }
            for z in zones
        ],
        "lines": lines,
        "candidates": candidates,
        "transitWarnings": transit,
    }


@app.post("/hs/tsd/arm/reset")
def reset_demo():
    db["zones"] = {z["zoneId"]: empty_zone_state(z) for z in ZONES}
    db["scans"] = []
    return {"ok": True}
