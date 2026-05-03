export async function proxyJson<TResponse = unknown>(input: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
}): Promise<{ ok: boolean; status: number; data: TResponse | null }> {
  const base = input.baseUrl.replace(/\/$/, "");
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const url = new URL(`${base}${path}`);

  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      ...(input.headers || {}),
    },
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  });

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
