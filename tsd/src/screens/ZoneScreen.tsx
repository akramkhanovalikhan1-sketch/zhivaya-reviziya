import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

type Zone = { zoneId: string; name: string; status: string; quarantine?: boolean };

type Props = {
  baseUrl: string;
  zone: string;
  onZone: (v: string) => void;
  busy: boolean;
  error: string;
  onStart: (zoneId: string) => void;
  onLogout: () => void;
};

export default function ZoneScreen({ baseUrl, zone, onZone, busy, error, onStart, onLogout }: Props) {
  const [zones, setZones] = useState<Zone[]>([]);

  useEffect(() => {
    let stop = false;
    void api.zones(baseUrl).then((res) => {
      if (!stop && res.ok) setZones(res.zones);
    }).catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [baseUrl]);

  function onForm(e: FormEvent) {
    e.preventDefault();
    onStart(zone);
  }

  const chips: Zone[] = zones.length
    ? zones
    : ["S-01", "S-02", "S-03", "P-01", "P-02", "Q-RC"].map((id) => ({
        zoneId: id,
        name: id,
        status: "idle",
        quarantine: id === "Q-RC",
      }));

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
        Зоны с сервера:{" "}
        {chips.map((z) => (
          <button
            key={z.zoneId}
            type="button"
            className="chip"
            onClick={() => onZone(z.zoneId)}
            title={z.name}
          >
            {z.zoneId}
            {z.quarantine ? " · cut-off" : ""}
          </button>
        ))}
      </p>
      <button className="btn btn-ghost" type="button" onClick={onLogout}>
        Сменить сотрудника
      </button>
    </form>
  );
}
