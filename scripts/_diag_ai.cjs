// 一次性诊断：读取服务器 .env 的 AI 配置 + DB 里的 AI 设置 + 最近 AI 日志
const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SSH = {
  host: process.env.NOOJ_SSH_HOST,
  port: Number(process.env.NOOJ_SSH_PORT || 22),
  username: process.env.NOOJ_SSH_USER || "ubuntu",
  password: process.env.NOOJ_SSH_PASSWORD,
  readyTimeout: 20000,
};
const c = new Client();
function exec(cmd) {
  return new Promise(resolve => {
    c.exec(cmd, (e, stream) => {
      if (e) { console.error("EXEC ERR", e.message); resolve(""); return; }
      let out = "";
      stream.on("data", d => out += d.toString()).stderr.on("data", d => out += d.toString());
      stream.on("close", () => { process.stdout.write(out); resolve(out); });
    });
  });
}
c.on("ready", async () => {
  try {
    console.log("===== .env AI 配置 =====");
    await exec("grep -E '^AI_' /opt/1panel/www/sites/nooj/.env 2>/dev/null || echo '(no .env AI_*)'");
    console.log("\n===== DB AI 设置 =====");
    await exec("sudo docker exec nooj node -e \"const db=require('/app/node_modules/better-sqlite3')('/app/data/nooj.db'); const r=db.prepare('SELECT data FROM site_config WHERE id=1').get(); const s=JSON.parse(r.data); console.log(JSON.stringify({ai_reply_enabled:s.ai_reply_enabled,ai_auto_reply:s.ai_auto_reply,ai_base_url:s.ai_base_url,ai_api_key:(s.ai_api_key||'').slice(0,6)+'...',ai_model:s.ai_model,ai_text_model:s.ai_text_model,ai_bot_name:s.ai_bot_name},null,2))\" 2>&1 || echo 'docker exec failed'");
    console.log("\n===== 最近 AI 日志（含失败/回退）=====");
    await exec("sudo docker logs --tail 80 nooj 2>&1 | grep -iE '\\[AI\\]|ai|model|reasoning' | tail -40");
  } catch (e) { console.error("FAIL", e.message); }
  c.end();
}).on("error", e => { console.error("SSH ERR:", e.message); process.exit(1); }).connect(SSH);
