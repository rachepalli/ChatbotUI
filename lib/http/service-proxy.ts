export async function proxyJson<TResponse = unknown>(input: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; data: TResponse | null }> {
  const base = input.baseUrl.replace(/\/$/, "");
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const url = new URL(`${base}${path}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 5000);

  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        ...(input.headers || {}),
      },
      signal: controller.signal,
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
  } finally {
    clearTimeout(timeout);
  }

  let data: TResponse | null = null;
  try {
    data = (await response.json()) as TResponse;
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}
