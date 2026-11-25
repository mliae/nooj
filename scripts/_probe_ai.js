const https = require("https");
const db = require("/app/node_modules/better-sqlite3")("/app/data/nooj.db");
const s = JSON.parse(db.prepare("SELECT data FROM site_config WHERE id=1").get().data);

const prompt = [
  "你是轻博客「Nooj Log」的 AI 助手「阿沐」，正在回复读者评论。",
  "上文内容摘要：示例文章 | 慢一点也没关系",
  "读者评论：看完感觉智商被碾压了",
  "请结合上文与读者评论，生成一句友好、简洁、口语化的中文回复（不超过 80 字，可适当用 emoji）。",
  "严格要求：不要输出任何分析、推理过程、任务说明或分点计划；",
  "把最终回复放在 <<<回复>>> 和 <<<结束>>> 两个标记之间，标记之外不要写任何字符。",
].join("\n");

function call(extra) {
  return new Promise(resolve => {
    const body = Object.assign({ model: s.ai_model, messages: [{ role: "user", content: prompt }], max_tokens: extra._mt || 768, temperature: 0.7 }, extra);
    delete body._mt;
    const data = JSON.stringify(body);
    const u = new URL(s.ai_base_url + "/chat/completions");
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + s.ai_api_key, "content-length": Buffer.byteLength(data) } }, res => {
      let x = ""; res.on("data", d => x += d); res.on("end", () => {
        try { const j = JSON.parse(x); const m = j.choices && j.choices[0] && j.choices[0].message; resolve({ status: res.statusCode, content: m && m.content, reasoningLen: (m && m.reasoning_content || "").length, ct: j.usage && j.usage.completion_tokens, finish: j.choices && j.choices[0] && j.choices[0].finish_reason }); }
        catch { resolve({ status: res.statusCode, content: null, raw: x.slice(0, 200) }); }
      });
    });
    req.on("error", e => resolve({ status: -1, content: "ERR:" + e.message }));
    req.write(data); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const configs = [
  { name: "A do_thinking:false mt768", extra: { do_thinking: false, _mt: 768 } },
  { name: "B do_thinking:false + effort mt768", extra: { do_thinking: false, reasoning_effort: "low", chat_template_kwargs: { enable_thinking: false }, _mt: 768 } },
  { name: "C do_thinking:false mt2048", extra: { do_thinking: false, _mt: 2048 } },
  { name: "D default(no flag) mt2048", extra: { _mt: 2048 } },
  { name: "E do_thinking:false mt1024", extra: { do_thinking: false, _mt: 1024 } },
];

(async () => {
  for (const cfg of configs) {
    console.log("\n##### " + cfg.name + " #####");
    for (let i = 0; i < 3; i++) {
      let r = await call(cfg.extra);
      let tries = 0;
      while (r.status === 429 && tries < 4) { await sleep(6000); r = await call(cfg.extra); tries++; }
      const ok = r.status === 200;
      const clen = ok ? (r.content || "").length : -1;
      console.log(`  #${i} status=${r.status} contentLen=${clen} reasoningLen=${r.reasoningLen} completionTokens=${r.ct} finish=${r.finish}${r.content ? " | " + JSON.stringify(r.content).slice(0, 80) : ""}${!ok && r.raw ? " raw=" + r.raw : ""}`);
      await sleep(1500);
    }
  }
})();
