// A stand-in for Netlify Identity's API, for local testing only.
// Answers GET /user for HS256 tokens signed with "secret" (the same secret
// `netlify dev` uses to evaluate Role= rules in _redirects).
//   node test/mock-identity.mjs            -> listens on :9999
//   import { makeToken } from "./mock-identity.mjs"
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const SECRET = "secret";
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

export function makeToken({ id = "user-1", email = "staff@example.com", name = "Test Member", roles = ["member"], ttl = 3600, secret = SECRET } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: id, email, exp: now + ttl, iat: now,
    app_metadata: { roles, authorization: { roles } },
    user_metadata: { full_name: name },
  };
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verify(token) {
  const [head, body, sig] = String(token || "").split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  if (claims.exp < Date.now() / 1000) return null;
  return claims;
}

export function startMockIdentity(port = 9999) {
  const server = createServer((req, res) => {
    const path = req.url.replace(/^\/\.netlify\/identity/, "");
    const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (req.method === "GET" && path.startsWith("/user")) {
      const claims = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
      if (!claims) return send(401, { msg: "Invalid token" });
      return send(200, { id: claims.sub, email: claims.email, app_metadata: { roles: claims.app_metadata.roles }, user_metadata: claims.user_metadata });
    }
    if (path.startsWith("/settings")) return send(200, { external: {}, disable_signup: true, autoconfirm: false });
    return send(404, { msg: "Not available in the local stand-in" });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startMockIdentity(Number(process.env.PORT) || 9999);
  console.log("Mock Identity listening. Member token:");
  console.log(makeToken());
}
