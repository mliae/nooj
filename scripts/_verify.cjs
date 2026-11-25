const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SSH = { host: process.env.NOOJ_SSH_HOST, port: Number(process.env.NOOJ_SSH_PORT || 22), username: process.env.NOOJ_SSH_USER || "ubuntu", password: process.env.NOOJ_SSH_PASSWORD, readyTimeout: 20000 };
const c = new Client();
function exec(cmd) {
  return new Promise(resolve => {
    c.exec(cmd, (e, stream) => {
      if (e) { console.error("EXEC ERR", e.message); resolve(""); return; }
      let out = ""; stream.on("data", d => out += d.toString()).stderr.on("data", d => out += d.toString());
      stream.on("close", () => { process.stdout.write(out); resolve(out); });
    });
  });
}
c.on("ready", async () => {
  // 1. 确认部署的 bundle 含新逻辑
  console.log("===== bundle 校验 =====");
  await exec("sudo docker exec nooj sh -c 'grep -o \"do_thinking\" /app/dist/server.mjs | head -1; grep -o \"refineReply\" /app/dist/server.mjs | head -1; grep -o \"<<<回复>>>\" /app/dist/server.mjs | head -1; grep -o \"empty reply after refine\" /app/dist/server.mjs | head -1'");
  // 2. 找一篇文章 id，用于评论测试
  console.log("\n===== 最新文章 =====");
  await exec("sudo docker exec nooj node -e \"const db=require('/app/node_modules/better-sqlite3')('/app/data/nooj.db'); const r=db.prepare('SELECT id,title FROM posts ORDER BY id DESC LIMIT 3').all(); console.log(JSON.stringify(r))\"");
  c.end();
}).on("error", e => { console.error("SSH ERR:", e.message); process.exit(1); }).connect(SSH);
