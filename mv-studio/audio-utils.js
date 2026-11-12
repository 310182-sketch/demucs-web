export const SAMPLE_RATE = 44100;
export const TRACKS = ['drums', 'bass', 'other', 'vocals'];
export function mixStems(stems, gains) {
  const n = stems.drums.left.length, left = new Float32Array(n), right = new Float32Array(n);
  for (const key of TRACKS) for (let i = 0; i < n; i++) {
    left[i] += stems[key].left[i] * gains[key]; right[i] += stems[key].right[i] * gains[key];
  }
  let peak = 1;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  if (peak > 1) for (let i = 0; i < n; i++) { left[i] /= peak; right[i] /= peak; }
  return { left, right, peak };
}
export function wavBlob(left, right, rate = SAMPLE_RATE) {
  const n = left.length, bytes = new ArrayBuffer(44 + n * 4), v = new DataView(bytes);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 2; ch++) {
    const sample = Math.max(-1, Math.min(1, ch ? right[i] : left[i]));
    v.setInt16(44 + i * 4 + ch * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
