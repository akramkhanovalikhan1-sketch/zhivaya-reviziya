import type { ScanLine } from "../api";

export type ZoneDone = {
  zoneId: string;
  zoneName: string;
  sessionNum: number;
  message: string;
  lines: ScanLine[];
  closedZones?: number;
  totalZones?: number;
  coveragePercent?: number;
};

type Props = {
  done: ZoneDone;
  armHref: string;
  onNextZone: () => void;
};

export default function DoneScreen({ done, armHref, onNextZone }: Props) {
  const counted = done.lines.reduce((sum, row) => sum + row.qty, 0);
  const cover =
    done.totalZones && done.closedZones != null
      ? `Закрыто зон: ${done.closedZones} из ${done.totalZones} (${done.coveragePercent ?? 0}%).`
      : "";

  return (
    <div className="screen">
      <p className="product" style={{ minHeight: 0 }}>
        Зона закрыта
      </p>
      <p className="meta-line">
        {done.zoneName} · сессия {done.sessionNum}
      </p>
      <p className="hint">{done.message}</p>

      {done.lines.length === 0 ? (
        <div className="warn">В этой зоне ничего не считали — ушла как пустая.</div>
      ) : (
        <div className="lines">
          {done.lines.map((row) => (
            <div className="line-row" key={row.sku}>
              <span>{row.name}</span>
              <b>{row.qty}</b>
            </div>
          ))}
          <div className="line-row">
            <span>Итого по зоне</span>
            <b>{counted}</b>
          </div>
        </div>
      )}

      {cover ? <p className="hint">{cover}</p> : null}
      <p className="hint">
        Это итог вашей зоны. Сверка с учётом, продажи ККМ и финальные акты — у товароведа на АРМ.
      </p>
      <a className="btn btn-dark" href={armHref} target="_blank" rel="noreferrer">
        Открыть АРМ товароведа
      </a>
      <button className="btn btn-green huge" type="button" onClick={onNextZone}>
        Следующая зона
      </button>
    </div>
  );
}
