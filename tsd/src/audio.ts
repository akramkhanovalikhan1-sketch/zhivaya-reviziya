let ctx: AudioContext | null = null;

function audio() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function beepOk() {
  const a = audio();
  const o = a.createOscillator();
  const g = a.createGain();
  o.frequency.value = 880;
  o.type = "square";
  g.gain.value = 0.04;
  o.connect(g);
  g.connect(a.destination);
  o.start();
  o.stop(a.currentTime + 0.08);
}

export function beepAlarm() {
  const a = audio();
  const o = a.createOscillator();
  const g = a.createGain();
  o.frequency.value = 220;
  o.type = "sawtooth";
  g.gain.value = 0.08;
  o.connect(g);
  g.connect(a.destination);
  o.start();
  o.stop(a.currentTime + 0.35);
}
