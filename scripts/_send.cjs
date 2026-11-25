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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

(async () => {
  console.log("=== 模板状态 ===");
  const list = await call("ListEmailTemplates", { Limit: 20, Offset: 0 });
  for (const t of list.json?.Response?.TemplatesMetadata || []) {
    console.log(`${t.TemplateID} ${t.TemplateName} status=${t.TemplateStatus} ${t.ReviewReason || ""}`);
  }
  console.log(`\n设置中的模板: admin=${s.mail_tencent_template_admin} reply=${s.mail_tencent_template_reply}`);

  console.log("\n=== 发送测试邮件到", TO, "===");
  const r = await call("SendEmail", {
    FromEmailAddress: from,
    Destination: [TO],
    Subject: "Nooj Log 邮件通道测试",
    Template: {
      TemplateID: Number(s.mail_tencent_template_admin),
      TemplateData: JSON.stringify({
        site: s.site_title || "Nooj Log",
        nickname: "测试访客",
        target: "文章「慢一点也没关系」",
        content: "这封邮件由腾讯云 SES 模板发送，收到即代表邮件通道已打通。之后每条新评论都会发到这里（管理员通知）或评论者邮箱（回复通知）。",
        path: "",
      }),
    },
  });
  console.log(JSON.stringify(r.json, null, 2));
  const ok = r.json?.Response?.MessageId;
  console.log(ok ? `\n✅ 发送成功 MessageId=${ok}` : "\n❌ 发送失败");
})();
