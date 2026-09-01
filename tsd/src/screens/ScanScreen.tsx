import { useState } from "react";
import type { Session } from "../App";

type Props = {
  session: Session;
  lastName: string;
  lastQty: number;
  qtyInput: string;
  onQty: (v: string) => void;
  busy: boolean;
  error: string;
  notice: string;
  onApplyMultiplier: (total: number) => void;
  onSendScan: (barcode: string, qty: number) => void;
  onFinish: () => void;
};

export default function ScanScreen({
  session,
  lastName,
  lastQty,
  qtyInput,
  onQty,
  busy,
  error,
  notice,
  onApplyMultiplier,
  onSendScan,
  onFinish,
}: Props) {
  const [calc, setCalc] = useState(false);
  const [w, setW] = useState("4");
  const [l, setL] = useState("5");
  const [h, setH] = useState("40");
  const [mult, setMult] = useState(false);
  const [multVal, setMultVal] = useState("250");
  const [manual, setManual] = useState("");

  const product = Math.max(0, Number(w) || 0) * Math.max(0, Number(l) || 0) * Math.max(0, Number(h) || 0);

  return (
    <div className="screen scan">
      <div className="meta-line">
        {session.zoneName} · сессия {session.sessionNum}
      </div>
      <div className="product">{lastName}</div>
      <div className="qty-big">{lastQty || qtyInput}</div>

      <div className="row">
        <label className="qty-lab">
          Кол-во
          <input className="field" value={qtyInput} onChange={(e) => onQty(e.target.value)} inputMode="decimal" />
        </label>
        <button className="btn btn-dark" type="button" onClick={() => setMult(true)}>
          ×
        </button>
      </div>

      <button className="btn btn-dark" type="button" onClick={() => setCalc(true)}>
        Калькулятор рядов
      </button>

      <form
        className="manual"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            onSendScan(manual.trim(), Number(qtyInput.replace(",", ".")) || 1);
            setManual("");
          }
        }}
      >
        <input
          className="field"
          placeholder="Или введите штрихкод вручную"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
      </form>

      <p className="demo">
        Демо-скан:{" "}
        {[
          ["4600000000017", "Дрель"],
          ["4600000000024", "Цемент"],
          ["4600000000048", "Дубль"],
          ["000", "Неизвестный"],
        ].map(([code, label]) => (
          <button key={code} type="button" className="chip" onClick={() => onSendScan(code, Number(qtyInput.replace(",", ".")) || 1)}>
            {label}
          </button>
        ))}
      </p>
      {notice && <div className="warn">{notice}</div>}
      {error && <div className="err">{error}</div>}

      <button className="btn btn-red huge" type="button" disabled={busy} onClick={onFinish}>
        ЗАВЕРШИТЬ И ЗАКРЫТЬ ЗОНУ
      </button>

      {mult && (
        <div className="modal">
          <div className="sheet">
            <h3>Множитель</h3>
            <p className="hint">Сосканировали 1 шт → введите фактический объём. Сервер допишет разницу.</p>
            <input className="field" value={multVal} onChange={(e) => setMultVal(e.target.value)} inputMode="numeric" />
            <button
              className="btn btn-green"
              type="button"
              onClick={() => {
                onApplyMultiplier(Number(multVal.replace(",", ".")) || 1);
                setMult(false);
              }}
            >
              Применить ×{multVal}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setMult(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {calc && (
        <div className="modal">
          <div className="sheet">
            <h3>Калькулятор рядов</h3>
            <div className="calc-grid">
              <label>
                Ширина
                <input className="field" value={w} onChange={(e) => setW(e.target.value)} inputMode="numeric" />
              </label>
              <label>
                Длина
                <input className="field" value={l} onChange={(e) => setL(e.target.value)} inputMode="numeric" />
              </label>
              <label>
                Ряды
                <input className="field" value={h} onChange={(e) => setH(e.target.value)} inputMode="numeric" />
              </label>
            </div>
            <p className="product" style={{ fontSize: 28 }}>
              {w} × {l} × {h} = {product} шт
            </p>
            <button
              className="btn btn-green"
              type="button"
              onClick={() => {
                onQty(String(product));
                setCalc(false);
              }}
            >
              Подставить {product}
            </button>
            <p className="hint">Затем сканируйте один мешок — уйдёт итоговая сумма одной строкой.</p>
            <button className="btn btn-ghost" type="button" onClick={() => setCalc(false)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
