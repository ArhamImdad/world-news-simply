export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit & { next?: { revalidate?: number | false } } = {},
  timeoutMs = 10000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
