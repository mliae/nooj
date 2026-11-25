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
async function call(action, payloadObj) {
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
      "X-TC-Region": region,
    },
    body: payload,
  });
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { raw: t }; }
}

(async () => {
  const list = await call("ListEmailTemplates", { Limit: 100, Offset: 0 });
  const tpls = list?.Response?.TemplatesMetadata || [];
  console.log("=== 全部模板 ===", "总数", list?.Response?.TotalCount);
  for (const t of tpls) console.log(`${t.TemplateID}  ${t.TemplateName}  status=${t.TemplateStatus}  reason=${t.ReviewReason || "-"}`);

  // 逐个试发，找出可用的模板
  for (const t of tpls) {
    const detail = await call("GetEmailTemplate", { TemplateID: t.TemplateID });
    const html = detail?.Response?.Template?.TemplateContent?.Html || "";
    const decoded = Buffer.from(html, "base64").toString("utf8");
    const vars = [...new Set((decoded.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || []).map(v => v.replace(/[{}]/g, "").trim()))];
    const td = {};
    for (const v of vars) td[v] = v === "path" ? "" : "测试值-" + v;
    const r = await call("SendEmail", { FromEmailAddress: from, Destination: [TO], Subject: "Nooj 模板测试 " + t.TemplateID, Template: { TemplateID: t.TemplateID, TemplateData: JSON.stringify(td) } });
    console.log(`\n[${t.TemplateID} ${t.TemplateName}] 变量=${vars.join(",")}`);
    console.log("  结果:", r?.Response?.MessageId ? "✅ MessageId=" + r.Response.MessageId : "❌ " + JSON.stringify(r?.Response?.Error));
  }
})();
