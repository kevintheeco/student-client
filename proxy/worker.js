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

    const origin = request.headers.get("Origin");
    if (origin && !originAllowed(origin, env)) return json({ error: "forbidden origin" }, 403, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "bad json" }, 400, cors); }

    const { system = "", messages = [], wantJson = false, maxTok, tier = "smart" } = body;
    const tokens = clampInt(maxTok, 16, 8192, wantJson ? 2048 : 1024);

    const errors = [];

    // 1) Gemini
    if (env.GEMINI_KEY) {
      try {
        const r = await callGemini(env, system, messages, tokens, tier);
        return json({ text: r.text, provider: "gemini", model: r.model }, 200, cors);
      } catch (e) { errors.push("gemini: " + (e && e.message || e)); }
    } else errors.push("gemini: no key");

    // 2) OpenAI (GPT) — smart는 추론 모델, 실패 시 gpt-4o로 자동 복구
    if (env.OPENAI_KEY) {
      try {
        const r = await callOpenAI(env, system, messages, tokens, tier);
        return json({ text: r.text, provider: "openai", model: r.model }, 200, cors);
      } catch (e) { errors.push("openai: " + (e && e.message || e)); }
    } else errors.push("openai: no key");

    return json({ error: "all backups failed", detail: errors }, 502, cors);
  },
};

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
