// Mobile browsers can silently stall in-flight fetches when a backgrounded tab
// is suspended and later resumed (no error, no completion). Without a timeout
// those requests hang forever and so does the loading screen waiting on them.
export function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}
