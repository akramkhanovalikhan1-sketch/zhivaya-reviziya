import { FormEvent } from "react";

type Props = {
  zone: string;
  onZone: (v: string) => void;
  busy: boolean;
  error: string;
  onStart: (zoneId: string) => void;
  onLogout: () => void;
};

export default function ZoneScreen({ zone, onZone, busy, error, onStart, onLogout }: Props) {
  function onForm(e: FormEvent) {
    e.preventDefault();
    onStart(zone);
  }

  return (
    <form className="screen" onSubmit={onForm}>
      <p className="hint">
        Сканируйте номер зоны (стеллаж / паллета). Лазер товаров заблокирован, пока не нажата кнопка старта.
      </p>
      <input
        className="field"
        placeholder="Номер зоны, например S-01"
        value={zone}
        onChange={(e) => onZone(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      <button className="btn btn-green huge" disabled={busy || !zone.trim()} type="submit">
        {busy ? "СТАРТ…" : "НАЧАТЬ ПОДСЧЕТ"}
      </button>
      {error && <div className="err">{error}</div>}
      <p className="demo">
        Демо-зоны:{" "}
        {["S-01", "S-02", "S-03", "P-01", "P-02"].map((z) => (
          <button key={z} type="button" className="chip" onClick={() => onZone(z)}>
            {z}
          </button>
        ))}
      </p>
      <button className="btn btn-ghost" type="button" onClick={onLogout}>
        Сменить сотрудника
      </button>
    </form>
  );
}
