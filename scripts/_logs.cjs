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
  console.log("===== 最近 [AI] 日志 =====");
  await exec("sudo docker logs --tail 300 nooj 2>&1 | grep -iE '\\[AI\\]|maybeSchedule|empty reply|giving up|429|reasoning' | tail -40");
  console.log("\n===== 容器是否正常运行 =====");
  await exec("sudo docker ps --filter name=nooj --format '{{.Names}} {{.Status}}'");
  c.end();
}).on("error", e => { console.error("SSH ERR:", e.message); process.exit(1); }).connect(SSH);
