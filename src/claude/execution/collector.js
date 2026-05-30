/**
 * Bounded output collector shared by execution backends.
 *
 * Appends decoded chunks until `limitBytes` is reached, then stops and flags
 * truncation. Used to cap per-stream output and trigger a kill on overflow.
 */
export function createCollector(limitBytes) {
  let total = 0;
  let truncated = false;
  let content = '';

  const append = (chunk) => {
    if (truncated) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const remaining = limitBytes - total;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (buffer.length > remaining) {
      content += buffer.subarray(0, remaining).toString('utf-8');
      total += remaining;
      truncated = true;
      return;
    }
    content += buffer.toString('utf-8');
    total += buffer.length;
  };

  return {
    append,
    get content() {
      return content;
    },
    get truncated() {
      return truncated;
    },
  };
}
