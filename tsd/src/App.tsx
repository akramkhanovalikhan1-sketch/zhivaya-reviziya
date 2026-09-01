import { useEffect, useMemo, useRef, useState } from "react";
import { api, type StartZoneOk } from "./api";
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
  const saved = localStorage.getItem("tsdServer");
  if (saved) return saved;
  if (location.port === "5173") return "";
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

  const trapRef = useRef<HTMLInputElement>(null);

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
      setError("Нет связи с сервером 1С");
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
    setQtyInput("1");
    setNotice(res.freezeUntil && res.message && !res.recheck ? res.message : "");
    setOnline(true);
    setStep("scan");
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
      setError("Нет связи с сервером 1С");
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
      setZoneInput("");
      setStep("zone");
      setLastName("Ожидание скана");
      setNotice("");
      setError("");
    } catch {
      flash("alarm");
      setError("Нет связи с сервером 1С");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    localStorage.setItem("tsdServer", baseUrl);
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
    if (!session || !online) return;
    let stop = false;
    const tick = async () => {
      if (stop || busy) return;
      const flushed = await flushQueue(baseUrl);
      if (flushed.sent || flushed.left !== queued) setQueued(flushed.left);
      if (flushed.lastName) setLastName(flushed.lastName);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [baseUrl, session, online, busy, queued]);

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
          zone={zoneInput}
          onZone={setZoneInput}
          busy={busy}
          error={error}
          onStart={startZone}
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
          onApplyMultiplier={applyMultiplier}
          onSendScan={sendScan}
          onFinish={finishZone}
        />
      )}
    </div>
  );
}
