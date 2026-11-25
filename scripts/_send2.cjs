const { webcrypto } = require("crypto");
const Database = require("/app/node_modules/better-sqlite3");
const db = new Database("/app/data/nooj.db");
const s = JSON.parse(db.prepare("SELECT data FROM site_config WHERE id=1").get().data);
const TO = process.argv[2] || "mliae@qq.com";

const host = "ses.tencentcloudapi.com";
const service = "ses";
const contentType = "application/json; charset=utf-8";
const secretId = s.mail_tencent_id || "";
const secretKey = s.mail_tencent_key || "";
const region = s.mail_tencent_region || "ap-guangzhou";
const from = s.mail_from || "";

const toArrayBuffer = u => { const ab = new ArrayBuffer(u.byteLength); new Uint8Array(ab).set(u); return ab; };
const bufToHex = buf => { const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let out = ""; for (const b of u8) out += b.toString(16).padStart(2, "0"); return out; };
const sha256Hex = async str => bufToHex(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(str)));
const hmacSha256 = async (key, msg) => {
  const k = await webcrypto.subtle.importKey("raw", toArrayBuffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await webcrypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
};

async function call(action, payloadObj, regionOverride) {
  const payload = JSON.stringify(payloadObj || {});
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const signedHeaders = "content-type;host";
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, await sha256Hex(payload)].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, await sha256Hex(canonicalRequest)].join("\n");
  const kDate = await hmacSha256(new TextEncoder().encode("TC3" + secretKey), date);
  const kService = await hmacSha256(kDate, service);
  const kSigning = await hmacSha256(kService, "tc3_request");
  const signature = bufToHex(await hmacSha256(kSigning, stringToSign));
  const res = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": contentType,
      "X-TC-Action": action,
      "X-TC-Version": "2020-10-02",
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": regionOverride || region,
    },
    body: payload,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const data = JSON.stringify({
  site: s.site_title || "Nooj Log",
  nickname: "测试访客",
  target: "文章「测试」",
  content: "参数写法测试",
  path: "",
});
const tpl = Number(s.mail_tencent_template_admin);

(async () => {
  console.log("模板详情（含状态）:");
  console.log(JSON.stringify(await call("ListEmailTemplates", { Limit: 20, Offset: 0 }), null, 1).slice(0, 1200));

  const cases = [
    ["1. 数字 TemplateID + Subject", { FromEmailAddress: from, Destination: [TO], Subject: "Nooj 测试1", Template: { TemplateID: tpl, TemplateData: data } }],
    ["2. 字符串 TemplateID + Subject", { FromEmailAddress: from, Destination: [TO], Subject: "Nooj 测试2", Template: { TemplateID: String(tpl), TemplateData: data } }],
    ["3. 数字 TemplateID 无 Subject", { FromEmailAddress: from, Destination: [TO], Template: { TemplateID: tpl, TemplateData: data } }],
    ["4. 顶层 TemplateID", { FromEmailAddress: from, Destination: [TO], Subject: "Nooj 测试4", TemplateID: tpl, TemplateData: data }],
  ];
  for (const [name, payload] of cases) {
    const r = await call("SendEmail", payload);
    const ok = r?.Response?.MessageId;
    console.log(`\n${name}: ${ok ? "✅ MessageId=" + ok : "❌ " + JSON.stringify(r?.Response?.Error || r)}`);
  }
})();
