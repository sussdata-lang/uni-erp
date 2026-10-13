// البنية الأساسية للتوقيع: هوية التوقيع (شهادة X.509 + مفتاح)، توقيع CMS منفصل (PKCS#7)، ختم زمني RFC 3161، وتحقق.
// الشهادة الموثوقة علناً تصدر من جهة اعتماد (CA) وتُمرَّر بالمتغير SIGNING_PEM. دونها تُولَّد شهادة ذاتية التوقيع تعمل داخلياً ولا تعدّها قارئات PDF موثوقة.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as D from '../lib/der.js';

const O = { sha256: '2.16.840.1.101.3.4.2.1', rsa: '1.2.840.113549.1.1.1', sha256rsa: '1.2.840.113549.1.1.11', data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5', signingCertV2: '1.2.840.113549.1.9.16.2.47', tsToken: '1.2.840.113549.1.9.16.2.14',
  CN: '2.5.4.3', C: '2.5.4.6', O: '2.5.4.10', OU: '2.5.4.11', basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', ski: '2.5.29.14', eku: '2.5.29.37' };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const name = (pairs) => D.seq(...pairs.map(([k, v]) => D.set(D.seq(D.oid(O[k]), k === 'C' ? D.printable(v) : D.utf8(v)))));
const ext = (id, critical, valueDer) => D.seq(D.oid(id), ...(critical ? [D.bool(true)] : []), D.octet(valueDer));
const pem = (der, label) => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END ${label}-----\n`;

/* ---------- الهوية ---------- */
export function generateSelfSigned({ cn, org, years = 5 }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' }), subject = name([['C', 'SY'], ['O', org], ['OU', 'Student Records'], ['CN', cn]]);
  const from = new Date(Date.now() - 3600_000), to = new Date(from.getTime() + years * 365 * 86400_000);
  const exts = D.ctx(3, D.seq(
    ext(O.basicConstraints, true, D.seq()),
    ext(O.keyUsage, true, D.bitString(Buffer.from([0xc0]), 6)),                          // digitalSignature + nonRepudiation
    ext(O.ski, false, D.octet(sha256(spki).subarray(0, 20))),
    ext(O.eku, false, D.seq(D.oid('1.3.6.1.5.5.7.3.4'), D.oid('1.3.6.1.4.1.311.10.3.12'), D.oid('1.2.840.113583.1.1.5')))));   // بريد/توقيع مستندات/Adobe
  const tbs = D.seq(D.ctx(0, D.int(2)), D.int(crypto.randomBytes(16)), D.seq(D.oid(O.sha256rsa), D.nul()), subject, D.seq(D.utcTime(from), D.utcTime(to)), subject, spki, exts);
  const cert = D.seq(tbs, D.seq(D.oid(O.sha256rsa), D.nul()), D.bitString(crypto.sign('sha256', tbs, privateKey)));
  return { certPem: pem(cert, 'CERTIFICATE'), keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function describe(certDer) {
  const x = new crypto.X509Certificate(certDer), top = D.read(certDer), tbs = D.children(top)[0], kids = D.children(tbs), o = kids[0].tag === 0xa0 ? 1 : 0;
  return { x, der: certDer, serialDer: D.raw(kids[o]), issuerDer: D.raw(kids[o + 2]), subject: x.subject.replace(/\n/g, ', '), issuer: x.issuer.replace(/\n/g, ', '), selfSigned: x.subject === x.issuer,
    fingerprint: sha256(certDer).toString('hex'), serial: x.serialNumber, notBefore: new Date(x.validFrom), notAfter: new Date(x.validTo) };
}

// SIGNING_PEM: نص PEM (مفتاح خاص + الشهادة + السلسلة) أو base64 له. وإلا ملف data/pki/signing.pem، وإلا تُولَّد شهادة ذاتية.
export function loadIdentity(cfg) {
  let text = (process.env.SIGNING_PEM || '').trim();
  if (text && !text.includes('-----BEGIN')) text = Buffer.from(text, 'base64').toString('utf8');
  let source = 'env';
  if (!text) {
    const dir = path.join(path.dirname(cfg.dbPath), 'pki'), file = path.join(dir, 'signing.pem'); source = 'generated';
    if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
    else {
      // أسماء لاتينية في الشهادة لأن بعض أدوات التحقق لا تعرض UTF-8 العربي في حقل الموضوع
      const g = generateSelfSigned({ cn: 'SUSS Student Records Signing', org: 'Syrian University for Security Sciences' });
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); text = g.certPem + g.keyPem; fs.writeFileSync(file, text, { mode: 0o600 });
    }
  }
  const keyBlock = /-----BEGIN (?:ENCRYPTED |RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:ENCRYPTED |RSA |EC )?PRIVATE KEY-----/.exec(text);
  if (!keyBlock) throw new Error('SIGNING_PEM لا يحوي مفتاحاً خاصاً.');
  const key = crypto.createPrivateKey({ key: keyBlock[0], passphrase: process.env.SIGNING_PASSPHRASE || undefined });
  if (key.asymmetricKeyType !== 'rsa') throw new Error('مفتاح التوقيع يجب أن يكون RSA.');
  const certs = [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g)].map((m) => describe(Buffer.from(m[1].replace(/\s+/g, ''), 'base64')));
  const pub = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const leaf = certs.find((c) => c.x.publicKey.export({ type: 'spki', format: 'der' }).equals(pub));
  if (!leaf) throw new Error('لا شهادة مطابقة للمفتاح الخاص في SIGNING_PEM.');
  return { key, leaf, chain: certs.filter((c) => c !== leaf), source, trusted: !leaf.selfSigned };
}

/* ---------- CMS (PKCS#7 SignedData منفصل) ---------- */
const attr = (id, ...vals) => D.seq(D.oid(id), D.set(...vals));
function signerInfo(id, signedAttrsCtx, signature, unsigned) {
  return D.seq(D.int(1), D.seq(id.leaf.issuerDer, id.leaf.serialDer), D.seq(D.oid(O.sha256), D.nul()), signedAttrsCtx, D.seq(D.oid(O.rsa), D.nul()), D.octet(signature), ...(unsigned ? [D.ctx(1, unsigned)] : []));
}
function signedData(id, si) {
  const certs = [id.leaf, ...id.chain].map((c) => c.der);
  return D.seq(D.oid(O.signedData), D.ctx(0, D.seq(D.int(1), D.set(D.seq(D.oid(O.sha256), D.nul())), D.seq(D.oid(O.data)), D.ctx(0, ...certs), D.set(si))));
}

// digest = SHA-256 للمحتوى الموقَّع. tsToken: ختم زمني جاهز (DER) اختياري يُضاف كسمة غير موقَّعة.
export function signDetached(id, digest, { signingTime = new Date(), tsToken = null } = {}) {
  const attrs = [attr(O.contentType, D.oid(O.data)), attr(O.signingTime, D.utcTime(signingTime)), attr(O.messageDigest, D.octet(digest)), attr(O.signingCertV2, D.seq(D.seq(D.seq(D.octet(sha256(id.leaf.der))))))].sort(Buffer.compare);
  const asSet = D.tlv(0x31, ...attrs), signature = crypto.sign('sha256', asSet, id.key);     // التوقيع على DER لـ SET وليس [0]
  const ctxAttrs = D.tlv(0xa0, ...attrs);
  const unsignedAttrs = tsToken ? attr(O.tsToken, tsToken) : null;
  return { cms: signedData(id, signerInfo(id, ctxAttrs, signature, unsignedAttrs)), signature };
}
// نسخة CMS بعد إضافة الختم الزمني (التوقيع نفسه لا يتغير)
export function withTimestamp(id, digest, opts, tsToken) { return signDetached(id, digest, { ...opts, tsToken }); }

/* ---------- RFC 3161 ---------- */
export function timestampRequest(hash) {
  return D.seq(D.int(1), D.seq(D.seq(D.oid(O.sha256), D.nul()), D.octet(hash)), D.int(crypto.randomBytes(8)), D.bool(true));
}
// يُرجع { token (DER), time (Date) } أو يرمي. يتحقق من أن بصمة الرد تطابق المطلوب.
export function parseTimestampResponse(buf, hash) {
  const top = D.read(buf), [status, token] = D.children(top);
  const st = D.value(D.children(status)[0]); if (!(st.length && (st[st.length - 1] === 0 || st[st.length - 1] === 1))) throw new Error('رفضت جهة الختم الزمني الطلب.');
  if (!token) throw new Error('رد الختم الزمني بلا رمز.');
  const sd = D.children(D.children(token)[1])[0], encap = D.children(sd)[2], oc = D.value(D.children(D.children(encap)[1])[0]);
  const tst = D.children(D.read(oc)), imprint = D.children(tst[2]);
  if (!Buffer.from(D.value(imprint[1])).equals(hash)) throw new Error('بصمة الختم الزمني لا تطابق المطلوب.');
  const time = D.parseTime(tst.find((n, i) => i > 2 && (n.tag === 0x18)));
  return { token: D.raw(token), time };
}
export async function requestTimestamp(url, hash, { timeoutMs = 6000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body: timestampRequest(hash), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`جهة الختم الزمني أعادت ${res.status}`);
  return parseTimestampResponse(Buffer.from(await res.arrayBuffer()), hash);
}

/* ---------- التحقق من PDF موقَّع ---------- */
export function verifyPdf(pdf) {
  const text = pdf.toString('latin1'), br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text), ct = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(text);
  if (!br || !ct) return { signed: false };
  const [a, b, c, d] = br.slice(1).map(Number), ranges = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
  const covers = a === 0 && c + d === pdf.length && ct.index + ct[0].indexOf('<') === a + b;
  try {
    const cmsBuf = Buffer.from(ct[1], 'hex'), top = D.read(cmsBuf), sd = D.children(D.children(top)[1])[0], kids = D.children(sd);
    const certsNode = kids.find((n) => n.tag === 0xa0), sinfo = D.children(kids.at(-1))[0], sk = D.children(sinfo);
    const certNodes = D.children(certsNode), leafDer = D.raw(certNodes[0]), cert = new crypto.X509Certificate(leafDer);
    const attrsNode = sk.find((n) => n.tag === 0xa0), unsignedNode = sk.find((n) => n.tag === 0xa1);
    const signature = Buffer.from(D.value(sk.find((n) => n.tag === 0x04)));
    const asSet = Buffer.concat([Buffer.from([0x31]), D.raw(attrsNode).subarray(1)]);
    let md = null, signingTime = null;
    for (const at of D.children(attrsNode)) { const [o, v] = D.children(at), id = D.oidString(o), val = D.children(v)[0]; if (id === O.messageDigest) md = Buffer.from(D.value(val)); if (id === O.signingTime) signingTime = D.parseTime(val); }
    const digestOk = !!md && md.equals(sha256(ranges)), sigOk = crypto.verify('sha256', asSet, cert.publicKey, signature);
    let ts = null;
    if (unsignedNode) for (const at of D.children(unsignedNode)) { const [o, v] = D.children(at); if (D.oidString(o) === O.tsToken) { try { const tok = D.children(v)[0], sd2 = D.children(D.children(tok)[1])[0], oc = D.value(D.children(D.children(D.children(sd2)[2])[1])[0]), tst = D.children(D.read(oc)); ts = { present: true, time: D.parseTime(tst.find((n, i) => i > 2 && n.tag === 0x18)), imprintOk: Buffer.from(D.value(D.children(tst[2])[1])).equals(sha256(signature)) }; } catch { ts = { present: true, time: null, imprintOk: false }; } } }
    const self = cert.subject === cert.issuer;
    return { signed: true, covers, digestOk, signatureOk: sigOk, intact: covers && digestOk && sigOk, signingTime, subject: cert.subject.replace(/\n/g, ', '), selfSigned: self, fingerprint: sha256(leafDer).toString('hex'), timestamp: ts, pdfSha256: sha256(pdf).toString('hex') };
  } catch (e) { return { signed: true, intact: false, error: e.message }; }
}
export { sha256 };
