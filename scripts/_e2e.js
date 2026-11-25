const http = require("http");
const db = require("/app/node_modules/better-sqlite3")("/app/data/nooj.db");
const s = JSON.parse(db.prepare("SELECT data FROM site_config WHERE id=1").get().data);
console.log("settings:", JSON.stringify({
  comments_enabled: s.comments_enabled, ai_reply_enabled: s.ai_reply_enabled,
  ai_auto_reply: s.ai_auto_reply, comment_rate_limit: s.comment_rate_limit,
  has_origin_token: !!s.origin_token, ai_base_url: s.ai_base_url, ai_model: s.ai_model,
}));
const post = db.prepare("SELECT id, slug, title FROM posts WHERE status='published' ORDER BY id DESC LIMIT 1").get();
console.log("test post:", JSON.stringify(post));
const before = (db.prepare("SELECT MAX(id) m FROM comments").get().m) || 0;
console.log("before max comment id:", before);

function postComment(slug) {
  return new Promise(resolve => {
    const body = JSON.stringify({ nickname: "测试小助手", email: "test@example.com", content: "这篇文章写得真好，学到了很多！" });
    const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
    if (s.origin_token) headers["x-nooj-origin"] = s.origin_token;
    const req = http.request({ hostname: "127.0.0.1", port: 3001, path: "/api/posts/" + encodeURIComponent(slug) + "/comments", method: "POST", headers }, res => {
      let x = ""; res.on("data", d => x += d); res.on("end", () => resolve({ status: res.statusCode, body: x }));
    });
    req.on("error", e => resolve({ status: -1, body: e.message }));
    req.write(body); req.end();
  });
}

(async () => {
  const r = await postComment(post.slug);
  console.log("comment POST:", r.status, r.body.slice(0, 200));
  let found = false;
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const rows = db.prepare("SELECT id, nickname, content, is_ai FROM comments WHERE id > ? AND target_type='post' AND target_id=? ORDER BY id DESC").all(before, post.id);
    const ai = rows.filter(x => x.is_ai === 1);
    if (ai.length) {
      console.log("✅ AI 回复已生成（耗时约 " + ((i + 1) * 2) + "s）：");
      ai.forEach(a => console.log("  id=" + a.id + " 昵称=" + a.nickname + " 内容=" + JSON.stringify(a.content)));
      found = true; break;
    }
  }
  if (!found) {
    const rows = db.prepare("SELECT id, nickname, content, is_ai FROM comments WHERE id > ? AND target_type='post' AND target_id=? ORDER BY id DESC LIMIT 5").all(before, post.id);
    console.log("❌ 48s 内未生成 AI 回复；最近评论：", JSON.stringify(rows));
  }
  const del = db.prepare("DELETE FROM comments WHERE id > ? AND target_type='post' AND target_id=?").run(before, post.id);
  console.log("cleanup deleted", del.changes, "test rows");
})();
