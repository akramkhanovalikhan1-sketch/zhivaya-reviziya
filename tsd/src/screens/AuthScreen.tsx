import { FormEvent } from "react";

type Props = {
  baseUrl: string;
  onBaseUrl: (v: string) => void;
  busy: boolean;
  error: string;
  onSubmit: (barcode: string) => void;
};

export default function AuthScreen({ baseUrl, onBaseUrl, busy, error, onSubmit }: Props) {
  function onForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const code = String(data.get("badge") || "").trim();
    if (code) onSubmit(code);
  }

  return (
    <form className="screen" onSubmit={onForm}>
      <p className="hint">Отсканируйте штрихкод бейджа. Пароль не нужен.</p>
      <input
        name="badge"
        className="field"
        autoComplete="off"
        placeholder="Скан бейджа"
      />
      <button className="btn btn-green" disabled={busy} type="submit">
        {busy ? "Проверка…" : "Войти"}
      </button>
      {error && <div className="err">{error}</div>}
      <label className="mini">
        Сервер 1С / mock
        <input
          className="field small"
          value={baseUrl}
          onChange={(e) => onBaseUrl(e.target.value)}
          placeholder="пусто = прокси Vite"
        />
      </label>
      <p className="demo">
        Демо-бейджи:{" "}
        {["EMP-1001", "EMP-1002", "EMP-1003"].map((c) => (
          <button key={c} type="button" className="chip" onClick={() => onSubmit(c)}>
            {c}
          </button>
        ))}
      </p>
    </form>
  );
}
