// 니가교수 AI 백업 프록시 (Cloudflare Worker)
// 클로드 API 장애 시 클라이언트가 여기로 폴백한다. 키는 이 서버(시크릿)에만 존재.
// 순서: Gemini → (실패 시) OpenAI(GPT). smart 단계 OpenAI는 추론 모델 지원.
//
// 시크릿 등록:  wrangler secret put GEMINI_KEY  /  wrangler secret put OPENAI_KEY
// 배포:        wrangler deploy
//
// 요청(POST /):  { system, messages:[{role,content}], wantJson, maxTok, tier:"fast"|"smart" }
//   content: 문자열 또는 Anthropic식 블록배열 [{type:"text"|"image"|"document", ...}]
// 응답:          { text, provider, model } | { error }

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
    if (!bodySizeAllowed(request, env)) return json({ error: "request too large" }, 413, cors);

    // Origin 필수 — 없으면(curl/봇 등 비브라우저) 거부. 정상 트래픽은 전부 크로스 오리진이라 항상 Origin이 붙는다.
    const origin = request.headers.get("Origin");
    if (!originAllowed(origin, env)) return json({ error: "forbidden origin" }, 403, cors);

    const path = new URL(request.url).pathname.replace(/\/$/, "");
    const limited = await rateLimited(request, env, path || "/");
    if (limited) return json({ error: "rate limited" }, 429, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "bad json" }, 400, cors); }

    if (path === "/log") return handleLog(body, cors);              // 클라이언트 에러 리포트 (A5)

    const invalid = validateAiBody(body);
    if (invalid) return json({ error: invalid }, 400, cors);
    if (path !== "/claude" && env.BACKUP_TOKEN && request.headers.get("x-yp-token") !== env.BACKUP_TOKEN) {
      return json({ error: "missing backup token" }, 403, cors);
    }
    if (path === "/claude") return handleClaude(body, env, cors, request);   // 회사키(학원) 메인 경로
    return handleBackup(body, env, cors);                            // 백업 전용 경로(개인 BYO 폴백)
  },
};

// A5: 클라이언트 에러 수집 — 저장 없이 콘솔 로그만(wrangler tail·대시보드에서 확인). 사용자 늘어 시끄러워지면 Sentry.
function handleLog(body, cors) {
  const msg = String(body.msg || "").slice(0, 500);
  if (!msg) return json({ error: "empty" }, 400, cors);
  console.log("[client-error]", JSON.stringify({ msg, stack: String(body.stack || "").slice(0, 1500), url: String(body.url || "").slice(0, 100) }));
  return json({ ok: true }, 200, cors);
}

const ALLOWED_CLAUDE_MODELS = new Set(["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);

// 회사키(학원) 경로: 클로드(학원 워크스페이스 키) → 실패 시 Gemini → OpenAI. 스트리밍 passthrough.
async function handleClaude(body, env, cors, request) {
  const { academyCode = "", system = "", messages = [], wantJson = false, maxTok, model, stream = false } = body;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(academyCode)) return json({ error: "invalid academy code" }, 403, cors);
  const keys = parseJson(env.ACADEMY_KEYS) || {};
  const key = academyCode && keys[academyCode];
  if (!key) return json({ error: "unknown academy code" }, 403, cors);
  // 학원 코드 단위 분당 상한(IP 제한과 별개) — 코드가 유출돼도 여러 IP에서의 남용이 학원 키 요금을 태우지 못하게
  if (await rateLimited(request, env, "aca", academyCode, clampInt(env.RATE_LIMIT_ACADEMY_PER_MIN, 1, 3000, 240))) {
    return json({ error: "academy rate limited" }, 429, cors);
  }
  const tokens = clampInt(maxTok, 16, 8192, wantJson ? 2048 : 1024);
  // 모델은 서버에서 고정 — 학원 키로 비싼/임의 모델 호출 차단 (보안점검 2026-07-04 §2). 목록 밖 요청은 Sonnet으로 강제.
  const useModel = ALLOWED_CLAUDE_MODELS.has(model) ? model : "claude-sonnet-4-6";
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: useModel, max_tokens: tokens, system, messages, ...(stream ? { stream: true } : {}) }),
    });
    if (!upstream.ok) throw new Error("HTTP " + upstream.status + " " + (await safeText(upstream)));
    if (stream && upstream.body) {
      // 클로드 SSE를 그대로 클라이언트로 흘려보냄(스트리밍 유지)
      return new Response(upstream.body, { status: 200, headers: { ...cors, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
    }
    const data = await upstream.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) throw new Error("empty");
    return json({ text, provider: "claude", model: useModel }, 200, cors);
  } catch (e1) {
    // 클로드 실패 → 백업(비스트림). tier는 모델로 추정.
    const tier = /haiku/i.test(useModel) ? "fast" : "smart";
    const errors = ["claude: " + (e1 && e1.message || e1)];
    if (env.GEMINI_KEY) { try { const r = await callGemini(env, system, messages, tokens, tier); return json({ text: r.text, provider: "gemini", model: r.model }, 200, cors); } catch (e) { errors.push("gemini: " + (e && e.message || e)); } }
    if (env.OPENAI_KEY) { try { const r = await callOpenAI(env, system, messages, tokens, tier); return json({ text: r.text, provider: "openai", model: r.model }, 200, cors); } catch (e) { errors.push("openai: " + (e && e.message || e)); } }
    return json({ error: "all providers failed", detail: errors }, 502, cors);
  }
}

// 백업 전용 경로(개인 BYO에서 클로드 죽었을 때): Gemini → OpenAI
async function handleBackup(body, env, cors) {
  const { system = "", messages = [], wantJson = false, maxTok, tier = "smart" } = body;
  const tokens = clampInt(maxTok, 16, 8192, wantJson ? 2048 : 1024);
  const errors = [];
  if (env.GEMINI_KEY) {
    try { const r = await callGemini(env, system, messages, tokens, tier); return json({ text: r.text, provider: "gemini", model: r.model }, 200, cors); }
    catch (e) { errors.push("gemini: " + (e && e.message || e)); }
  } else errors.push("gemini: no key");
  if (env.OPENAI_KEY) {
    try { const r = await callOpenAI(env, system, messages, tokens, tier); return json({ text: r.text, provider: "openai", model: r.model }, 200, cors); }
    catch (e) { errors.push("openai: " + (e && e.message || e)); }
  } else errors.push("openai: no key");
  return json({ error: "all backups failed", detail: errors }, 502, cors);
}

/* ---------- Gemini ---------- */
async function callGemini(env, system, messages, maxTok, tier) {
  const model = tier === "fast" ? "gemini-2.5-flash" : "gemini-2.5-pro";
  const contents = (messages || []).map((m) => {
    const ps = [];
    const c = m.content;
    if (typeof c === "string") ps.push({ text: c });
    else for (const b of c || []) {
      if (b.type === "text") ps.push({ text: b.text });
      else if (b.type === "image") ps.push({ inline_data: { mime_type: b.source.media_type, data: b.source.data } });
      else if (b.type === "document") ps.push({ inline_data: { mime_type: "application/pdf", data: b.source.data } });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts: ps };
  });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_KEY}`,
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: maxTok, temperature: 0.3 },
      }) }
  );
  if (!res.ok) throw new Error("HTTP " + res.status + " " + (await safeText(res)));
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("empty");
  return { text, model };
}

/* ---------- OpenAI (Chat Completions) ---------- */
async function callOpenAI(env, system, messages, maxTok, tier) {
  const primary = tier === "fast"
    ? (env.OPENAI_MODEL_FAST || "gpt-4o-mini")
    : (env.OPENAI_MODEL_SMART || "gpt-4o");
  const oaMsgs = [{ role: "system", content: system }];
  for (const m of messages || []) {
    const c = m.content;
    if (typeof c === "string") { oaMsgs.push({ role: m.role || "user", content: c }); continue; }
    const parts = [];
    for (const b of c || []) {
      if (b.type === "text") parts.push({ type: "text", text: b.text });
      else if (b.type === "image") parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
      else if (b.type === "document") throw new Error("PDF not supported on GPT fallback");
    }
    oaMsgs.push({ role: m.role || "user", content: parts });
  }
  try { return await oaRequest(env, primary, oaMsgs, maxTok); }
  catch (e) {
    // 지정 모델 실패(오타·미접근·추론모델 이슈) → 안전 모델 gpt-4o로 복구. 라이브 제품 보호.
    if (primary !== "gpt-4o") return await oaRequest(env, "gpt-4o", oaMsgs, maxTok);
    throw e;
  }
}
async function oaRequest(env, model, oaMsgs, maxTok) {
  const reasoning = /^o\d/i.test(model) || /^gpt-5/i.test(model);   // o1/o3/o4..., 향후 추론 모델
  const payload = { model, messages: oaMsgs };
  if (reasoning) {
    payload.max_completion_tokens = Math.max(maxTok, 6000);          // 추론 토큰 여유(답 잘림 방지)
  } else {
    payload.max_tokens = maxTok;
    payload.temperature = 0.3;
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + env.OPENAI_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + (await safeText(res)));
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("empty");
  return { text, model };
}

/* ---------- helpers ---------- */
function originAllowed(origin, env) {
  const list = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(origin);
}
function bodySizeAllowed(request, env) {
  const max = clampInt(env.MAX_BODY_BYTES, 1024, 25 * 1024 * 1024, 12 * 1024 * 1024);
  const len = Number(request.headers.get("content-length") || 0);
  return !len || len <= max;
}
// bucket+id 단위 분당 카운터. id 생략 시 요청 IP. limitOverride 생략 시 RATE_LIMIT_PER_MIN.
async function rateLimited(request, env, bucket, id, limitOverride) {
  const limit = limitOverride || clampInt(env.RATE_LIMIT_PER_MIN, 1, 300, 60);
  if (!limit || typeof caches === "undefined") return false;
  try {
    const who = id || request.headers.get("CF-Connecting-IP") || "unknown";
    const minute = Math.floor(Date.now() / 60000);
    const key = new Request("https://rate.local/" + encodeURIComponent(bucket) + "/" + encodeURIComponent(who) + "/" + minute);
    const hit = await caches.default.match(key);
    const count = hit ? Number(await hit.text()) || 0 : 0;
    if (count >= limit) return true;
    await caches.default.put(key, new Response(String(count + 1), { headers: { "cache-control": "max-age=90" } }));
  } catch (_) {}
  return false;
}
function validateAiBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "bad body";
  if (body.system != null && typeof body.system !== "string") return "bad system";
  if (body.system && body.system.length > 60000) return "system too large";
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) return "bad messages";
  let total = body.system ? body.system.length : 0;
  for (const msg of body.messages) {
    if (!msg || typeof msg !== "object") return "bad message";
    if (!["user", "assistant"].includes(msg.role)) return "bad role";
    const c = msg.content;
    if (typeof c === "string") total += c.length;
    else if (Array.isArray(c)) {
      if (c.length > 12) return "too many content blocks";
      for (const b of c) {
        if (!b || typeof b !== "object") return "bad content block";
        if (b.type === "text") total += String(b.text || "").length;
        else if (b.type === "image" || b.type === "document") {
          const data = b.source && b.source.data;
          if (typeof data !== "string") return "bad file block";
          total += data.length;
        } else return "bad content type";
      }
    } else return "bad content";
    if (total > 10 * 1024 * 1024) return "payload too large";
  }
  return "";
}
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (origin && originAllowed(origin, env)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}
function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
async function safeText(res) { try { return (await res.text()).slice(0, 300); } catch { return ""; } }
function parseJson(s) { try { return JSON.parse(s); } catch { return null; } }
