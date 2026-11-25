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
      stream.on("data", d => (out += d.toString()));
      stream.stderr.on("data", d => (out += d.toString()));
      stream.on("close", () => { process.stdout.write(out); resolve(out); });
    });
  });
}
c.on("ready", () => {
  c.sftp((err, sftp) => {
    if (err) { console.error("SFTP ERR", err.message); c.end(); return; }
    sftp.fastPut(path.join(ROOT, "scripts", process.argv[2] || "_send2.cjs"), "/tmp/" + (process.argv[2] || "_send2.cjs"), async e => {
      if (e) { console.error("UPLOAD ERR", e.message); c.end(); return; }
      await exec(`sudo docker cp /tmp/${process.argv[2] || "_send2.cjs"} nooj:/tmp/${process.argv[2] || "_send2.cjs"}`);
      await exec(`sudo docker exec nooj node /tmp/${process.argv[2] || "_send2.cjs"} mliae@qq.com 2>&1`);
      c.end();
    });
  });
}).on("error", e => { console.error("SSH ERR:", e.message); process.exit(1); }).connect(SSH);
