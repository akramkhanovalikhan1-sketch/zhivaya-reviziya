import { useEffect, useMemo, useRef, useState } from "react";
import { api, connectionHint, normalizeBaseUrl, type ScanLine, type StartZoneOk } from "./api";
import { beepAlarm, beepOk } from "./audio";
import { enqueueScan, flushQueue, readQueue } from "./queue";
import { setScanHandler } from "./scanner";
import AuthScreen from "./screens/AuthScreen";
import ScanScreen from "./screens/ScanScreen";
import ZoneScreen from "./screens/ZoneScreen";

export type Session = {
  userId: string;
  userName: string;
  zoneId: string;
  zoneName: string;
  sessionNum: number;
  startTime: string;
};

type Persisted = {
  step: "auth" | "zone" | "scan";
  userId: string;
  userName: string;
  zoneInput: string;
  session: Session | null;
};

const STATE_KEY = "tsdState";

const DEVICE_ID = localStorage.getItem("tsdDeviceId") || (() => {
  const id = "TSD-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  localStorage.setItem("tsdDeviceId", id);
  return id;
})();

function defaultBase() {
  const saved = normalizeBaseUrl(localStorage.getItem("tsdServer") || "");
  if (saved) return saved;
  if (location.port === "5173" || location.pathname.startsWith("/tsd")) return "";
  return `${location.protocol}//${location.hostname}:8000`;
}

function loadState(): Persisted | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const restored = useMemo(() => loadState(), []);
  const [baseUrl, setBaseUrl] = useState(defaultBase);
  const [step, setStep] = useState<"auth" | "zone" | "scan">(
    restored?.step === "scan" && !restored.session ? "zone" : restored?.step || "auth",
  );
  const [userId, setUserId] = useState(restored?.userId || "");
  const [userName, setUserName] = useState(restored?.userName || "");
  const [zoneInput, setZoneInput] = useState(restored?.zoneInput || "");
  const [session, setSession] = useState<Session | null>(restored?.session || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alarm, setAlarm] = useState(false);
  const [notice, setNotice] = useState("");
  const [lastName, setLastName] = useState("Ожидание скана");
  const [lastQty, setLastQty] = useState(0);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const [qtyInput, setQtyInput] = useState("1");
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(() => readQueue().length);
  const [lines, setLines] = useState<ScanLine[]>([]);

  const trapRef = useRef<HTMLInputElement>(null);

  function applyLines(next: ScanLine[] | undefined) {
    if (!next) return;
    setLines(next);
    const last = next[next.length - 1];
    if (last) {
      setLastName(last.name);
      setLastQty(last.qty);
      setLastBarcode(last.lastBarcode || null);
    } else {
      setLastName("Сканируйте товар");
      setLastQty(0);
      setLastBarcode(null);
    }
  }

  function dropBrokenSession(message: string) {
    flash("alarm");
    setSession(null);
    setLines([]);
    setStep("zone");
    setError(message);
  }

  const flash = (kind: "ok" | "alarm") => {
    if (kind === "alarm") {
      setAlarm(true);
      beepAlarm();
      setTimeout(() => setAlarm(false), 450);
    } else {
      beepOk();
    }
  };

  async function onAuthScan(barcode: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.auth(baseUrl, barcode);
      if (!res.ok) {
        flash("alarm");
        setError(res.message || "Бейдж не распознан");
        return;
      }
      flash("ok");
      setUserId(res.userId);
      setUserName(res.userName);
      setStep("zone");
    } catch {
      flash("alarm");
      setError(connectionHint(baseUrl));
    } finally {
      setBusy(false);
    }
  }

  function applyStartedZone(res: StartZoneOk) {
    flash("ok");
    setSession({
      userId,
      userName,
      zoneId: res.zoneId,
      zoneName: res.zoneName,
      sessionNum: res.sessionNum,
      startTime: res.startTime,
    });
    setLastName("Сканируйте товар");
    setLastQty(0);
    setLastBarcode(null);
    setLines([]);
    setQtyInput("1");
    setNotice(res.freezeUntil && res.message && !res.recheck ? res.message : "");
    setOnline(true);
    setStep("scan");
  }

  async function resetDemo() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.resetDemo(baseUrl);
      if (!res.ok) {
        setError("Не удалось сбросить демо");
        return;
      }
      setNotice("");
      setLines([]);
    } catch {
      setError("Сброс есть только в mock. На АРМ откройте :8000 и нажмите «Сбросить демо».");
    } finally {
      setBusy(false);
    }
  }

  async function startZone(zoneId: string) {
    if (busy || !zoneId.trim()) return;
    setBusy(true);
    setError("");
    try {
      const first = await api.startZone(baseUrl, zoneId.trim(), userId, 0, false);
      if (!first.ok) {
        flash("alarm");
        setError(first.message || "Не удалось стартовать зону");
        return;
      }
      if (first.needsConfirm || (first.recheck && first.message)) {
        const ok = window.confirm(first.message || "Начать перепроверку?");
        if (!ok) return;
        const confirmed = await api.startZone(baseUrl, zoneId.trim(), userId, 0, true);
        if (!confirmed.ok) {
          flash("alarm");
          setError(confirmed.message || "Не удалось стартовать зону");
          return;
        }
        applyStartedZone(confirmed);
        return;
      }
      applyStartedZone(first);
    } catch {
      flash("alarm");
      setOnline(false);
      setError(connectionHint(baseUrl));
    } finally {
      setBusy(false);
    }
  }

  async function sendScan(barcode: string, qty: number) {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api.scanItem(baseUrl, {
        barcode,
        zoneId: session.zoneId,
        qty,
        userId: session.userId,
        sessionNum: session.sessionNum,
        deviceId: DEVICE_ID,
      });
      if (!res.ok || res.alarm) {
        const code = "error" in res ? res.error : "";
        if (code === "session_mismatch" || code === "zone_not_started") {
          dropBrokenSession(("message" in res && res.message) || "Сессия зоны устарела");
          return;
        }
        flash("alarm");
        setError(("message" in res && res.message) || "Ошибка сканирования");
        return;
      }
      flash("ok");
      setOnline(true);
      setLastName(res.name);
      setLastQty((prev) => (lastBarcode === barcode ? prev + res.qty : res.qty));
      setLastBarcode(barcode);
      setQtyInput("1");
      if (res.lines) applyLines(res.lines);
      if (res.warning === "duplicate_card" && res.message) setNotice(res.message);
      const flushed = await flushQueue(baseUrl);
      if (flushed.sent) setQueued(flushed.left);
    } catch {
      enqueueScan({
        barcode,
        qty,
        zoneId: session.zoneId,
        userId: session.userId,
        sessionNum: session.sessionNum,
        deviceId: DEVICE_ID,
      });
      setQueued(readQueue().length);
      setOnline(false);
      setLastName(barcode);
      setLastQty((prev) => (lastBarcode === barcode ? prev + qty : qty));
      setLastBarcode(barcode);
      setNotice("Нет связи. Скан сохранён в очередь и уйдёт сам, когда сеть вернётся.");
    } finally {
      setBusy(false);
    }
  }

  async function applyMultiplier(total: number) {
    if (lastBarcode && lastQty > 0 && total > lastQty) {
      await sendScan(lastBarcode, total - lastQty);
      return;
    }
    setQtyInput(String(total));
  }

  async function finishZone() {
    if (!session || busy) return;
    if (!window.confirm("Закрыть зону? Повторный вход — только через перепроверку.")) return;
    setBusy(true);
    try {
      const res = await api.finishZone(baseUrl, session.zoneId, session.userId, session.sessionNum);
      if (!res.ok) {
        flash("alarm");
        setError(res.message || "Не удалось закрыть зону");
        return;
      }
      flash("ok");
      setSession(null);
      setLines([]);
      setZoneInput("");
      setStep("zone");
      setLastName("Ожидание скана");
      setNotice("");
      setError("");
    } catch {
      flash("alarm");
      setError(connectionHint(baseUrl));
    } finally {
      setBusy(false);
    }
  }

  async function undoLast() {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.undoLast(baseUrl, session.zoneId, session.userId, session.sessionNum);
      if (!res.ok) {
        flash("alarm");
        setError(res.message || "Нечего отменять");
        return;
      }
      flash("ok");
      applyLines(res.lines || []);
    } catch {
      flash("alarm");
      setOnline(false);
      setError(connectionHint(baseUrl));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const clean = normalizeBaseUrl(baseUrl);
    if (clean !== baseUrl) {
      setBaseUrl(clean);
      return;
    }
    localStorage.setItem("tsdServer", clean);
  }, [baseUrl]);

  useEffect(() => {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ step, userId, userName, zoneInput, session } satisfies Persisted),
    );
  }, [step, userId, userName, zoneInput, session]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop || busy) return;
      try {
        await api.ping(baseUrl);
        if (!stop) setOnline(true);
      } catch {
        if (!stop) setOnline(false);
        return;
      }
      if (!session) return;
      const flushed = await flushQueue(baseUrl);
      if (flushed.sent || flushed.left !== queued) setQueued(flushed.left);
      if (flushed.sent) {
        const fresh = await api.sessionLines(baseUrl, session.zoneId, session.sessionNum);
        if (fresh.ok) applyLines(fresh.lines);
      } else if (flushed.lastName) setLastName(flushed.lastName);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [baseUrl, session, busy, queued]);

  useEffect(() => {
    if (!session || step !== "scan") return;
    let stop = false;
    void api.sessionLines(baseUrl, session.zoneId, session.sessionNum).then((res) => {
      if (stop) return;
      if (!res.ok) {
        dropBrokenSession(res.message || "Сессия зоны устарела");
        return;
      }
      applyLines(res.lines);
    }).catch(() => setOnline(false));
    return () => {
      stop = true;
    };
  }, [baseUrl, session?.zoneId, session?.sessionNum, step]);

  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<unknown> } };
    if (!nav.wakeLock) return;
    let released = false;
    nav.wakeLock.request("screen").catch(() => undefined);
    return () => {
      released = true;
      void released;
    };
  }, [step]);

  useEffect(() => {
    trapRef.current?.focus();
  }, [step]);

  useEffect(() => {
    setScanHandler((code) => {
      if (busy) return;
      if (step === "auth") void onAuthScan(code);
      else if (step === "zone") setZoneInput(code);
      else if (step === "scan") {
        const qty = Number(qtyInput.replace(",", ".")) || 1;
        void sendScan(code, qty);
      }
    });
    return () => setScanHandler(null);
  });

  const header = useMemo(() => {
    if (step === "auth") return "Авторизация";
    if (step === "zone") return userName;
    return `${userName} · ${session?.zoneId}`;
  }, [step, userName, session]);

  return (
    <div className={"app" + (alarm ? " alarm" : "")}>
      <input
        ref={trapRef}
        className="scan-trap sr"
        autoFocus
        aria-label="Сканер"
        onBlur={() => {
          window.setTimeout(() => {
            const el = document.activeElement;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
            trapRef.current?.focus();
          }, 50);
        }}
      />
      <header className="top">
        <div>
          <div className="brand">Живая ревизия</div>
          <div className="who">{header}</div>
        </div>
        <div className="dev">
          <span className={online ? "dot-on" : "dot-off"}>{online ? "онлайн" : "оффлайн"}</span>
          {queued > 0 ? ` · очередь ${queued}` : ""}
          <br />
          {DEVICE_ID}
        </div>
      </header>

      {step === "auth" && (
        <AuthScreen
          baseUrl={baseUrl}
          onBaseUrl={setBaseUrl}
          busy={busy}
          error={error}
          onSubmit={onAuthScan}
        />
      )}
      {step === "zone" && (
        <ZoneScreen
          baseUrl={baseUrl}
          zone={zoneInput}
          onZone={setZoneInput}
          busy={busy}
          error={error}
          onStart={startZone}
          onResetDemo={resetDemo}
          onLogout={() => {
            setStep("auth");
            setUserId("");
            setUserName("");
            setError("");
          }}
        />
      )}
      {step === "scan" && session && (
        <ScanScreen
          session={session}
          lastName={lastName}
          lastQty={lastQty}
          qtyInput={qtyInput}
          onQty={setQtyInput}
          busy={busy}
          error={error}
          notice={notice}
          queued={queued}
          lines={lines}
          onApplyMultiplier={applyMultiplier}
          onSendScan={sendScan}
          onUndo={undoLast}
          onFinish={finishZone}
        />
      )}
    </div>
  );
}
