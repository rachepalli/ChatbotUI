const checks = [
  { name: "auth-service", url: process.env.AUTH_HEALTH_URL || "http://localhost:4001/health" },
  { name: "thread-service", url: process.env.THREAD_HEALTH_URL || "http://localhost:4002/health" },
  { name: "chat-service", url: process.env.CHAT_HEALTH_URL || "http://localhost:4003/health" },
  { name: "llm-service", url: process.env.LLM_HEALTH_URL || "http://localhost:4004/health" },
  { name: "rag-service", url: process.env.RAG_HEALTH_URL || "http://localhost:4005/health" },
];

if (process.env.CHECK_GATEWAY === "true" || process.env.GATEWAY_URL) {
  checks.unshift({ name: "gateway", url: process.env.GATEWAY_URL || "http://localhost:8080/health" });
}

async function run() {
  let failed = false;

  for (const check of checks) {
    try {
      const response = await fetch(check.url, { method: "GET" });
      if (!response.ok) {
        failed = true;
        console.error(`[FAIL] ${check.name} -> ${check.url} (${response.status})`);
        continue;
      }
      const body = await response.json();
      console.log(`[OK]   ${check.name} -> ${check.url} ${JSON.stringify(body)}`);
    } catch (error) {
      failed = true;
      console.error(`[FAIL] ${check.name} -> ${check.url} (${error.message})`);
    }
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log("All microservice health checks passed.");
}

run();
