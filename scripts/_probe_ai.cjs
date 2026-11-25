// 在服务器容器内直接调用智谱 API，打印原始返回结构，测试 do_thinking 开关效果
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
      let out = "";
      stream.on("data", d => out += d.toString()).stderr.on("data", d => out += d.toString());
      stream.on("close", () => resolve(out));
    });
  });
}
const probe = `const https=require('https');
const db=require('/app/node_modules/better-sqlite3')('/app/data/nooj.db');
const s=JSON.parse(db.prepare('SELECT data FROM site_config WHERE id=1').get().data);
const body={model:s.ai_model, messages:[{role:'user',content:'用一句话回复读者评论：文章写得真好。只输出回复正文。'}], max_tokens:400, do_thinking:false};
const data=JSON.stringify(body);
const u=new URL(s.ai_base_url+'/chat/completions');
const req=https.request({hostname:u.hostname,path:u.pathname,method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+s.ai_api_key,'content-length':Buffer.byteLength(data)}},res=>{let x='';res.on('data',d=>x+=d);res.on('end',()=>{try{const j=JSON.parse(x);const m=j.choices&&j.choices[0]&&j.choices[0].message;console.log('status',res.statusCode);console.log('keys',m?Object.keys(m):'none');console.log('content=',JSON.stringify(m&&m.content));console.log('reasoning_content=',JSON.stringify(m&&m.reasoning_content));console.log('finish_reason=',j.choices&&j.choices[0]&&j.choices[0].finish_reason);console.log('usage=',JSON.stringify(j.usage));}catch(e){console.log('RAW',x.slice(0,800));}});});
req.on('error',e=>console.log('ERR',e.message));req.write(data);req.end();`;
const probeCmd = `sudo docker exec nooj node -e ${JSON.stringify(probe)} 2>&1`;
c.on("ready", async () => {
  console.log("===== 智谱 API 原始返回（do_thinking:false）=====");
  console.log(await exec(probeCmd));
  c.end();
}).on("error", e => { console.error("SSH ERR:", e.message); process.exit(1); }).connect(SSH);
