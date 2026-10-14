// 노션 → 성장일지 실시간 연결 (Vercel 서버리스 함수)
// /api/notion?s=yoga      THE 692 마스터 리스트에서 완료한 수련
// /api/notion?s=archive   성장일지 아카이브 (일기·일지·한 문장)
// /api/notion?s=page&id=  아카이브 글 한 편의 전문 (아카이브 DB 안의 페이지만)
// Vercel 환경변수: NOTION_TOKEN (필수)
const SRC = {
  yoga: { ds: "509dbcdc-d16a-43a8-9ca8-d0196f1969f7", db: "2e5fff6db3be424da690882af6222d6b",
    body: { filter: { property: "완료", checkbox: { equals: true } }, sorts: [{ property: "수련일", direction: "descending" }] } },
  archive: { ds: "8c5fef4e-3bce-4a54-8047-11c1ef965a27", db: "709b3c23542a42e79495948dafdafc05",
    body: { sorts: [{ property: "날짜", direction: "descending" }] } },
};
const H = v => ({ Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": v, "Content-Type": "application/json" });
const txt = a => (a || []).map(x => x.plain_text || "").join("");
const nid = s => String(s || "").replace(/-/g, "");
async function call(path, v, body) {
  const r = await fetch("https://api.notion.com/v1/" + path, { method: body ? "POST" : "GET", headers: H(v), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.message || "notion"), { status: r.status, code: j.code });
  return j;
}
async function rows(src) {
  const run = async (path, v) => { const out = []; let c;
    for (let i = 0; i < 20; i++) { const j = await call(path, v, { ...src.body, page_size: 100, ...(c ? { start_cursor: c } : {}) });
      out.push(...j.results); if (!j.has_more) break; c = j.next_cursor; } return out; };
  try { return await run(`data_sources/${src.ds}/query`, "2025-09-03"); }
  catch (e) { if (e.status === 401) throw e; return await run(`databases/${src.db}/query`, "2022-06-28"); }
}
const P = (p, n) => (p.properties || {})[n] || {};
const yoga = p => ({ n: P(p, "번호").number ?? null, d: ((P(p, "수련일").date || {}).start || "").slice(0, 10), m: P(p, "길이(분)").number ?? "",
  type: (P(p, "유형").select || {}).name || "", t: txt(P(p, "제목").title), lv: (P(p, "강도").select || {}).name || "", url: P(p, "링크").url || "", line: txt(P(p, "한 줄 기록").rich_text) });
const arch = p => ({ id: nid(p.id), date: ((P(p, "날짜").date || {}).start || "").slice(0, 10), title: txt(P(p, "제목").title),
  line: txt(P(p, "한 문장").rich_text), themes: (P(p, "테마").multi_select || []).map(x => x.name), format: (P(p, "형식").select || {}).name || "" });
async function blocks(id, depth = 0) {
  const out = []; let c;
  for (let i = 0; i < 10; i++) {
    const j = await call(`blocks/${id}/children?page_size=100${c ? "&start_cursor=" + c : ""}`, "2022-06-28");
    for (const b of j.results) {
      const d = b[b.type] || {}, t = txt(d.rich_text);
      const k = { heading_1: "h", heading_2: "h", heading_3: "h", quote: "q", callout: "q", bulleted_list_item: "li", numbered_list_item: "li", to_do: "li", toggle: "p", paragraph: "p" }[b.type];
      if (b.type === "divider") out.push({ k: "hr" }); else if (k && t.trim()) out.push({ k, t });
      if (b.has_children && depth < 2 && !/database|page/.test(b.type)) out.push(...await blocks(b.id, depth + 1));
    }
    if (!j.has_more) break; c = j.next_cursor;
  }
  return out;
}
module.exports = async (req, res) => {
  if (!process.env.NOTION_TOKEN) return res.status(503).json({ error: "setup", message: "Vercel 환경변수에 NOTION_TOKEN을 넣어주세요." });
  const s = String(req.query.s || "");
  try {
    if (s === "page") {
      const id = nid(req.query.id); if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).json({ error: "bad_id" });
      const pg = await call(`pages/${id}`, "2025-09-03");
      const par = pg.parent || {}; const pid = nid(par.data_source_id || par.database_id);
      if (pid !== nid(SRC.archive.ds) && pid !== nid(SRC.archive.db)) return res.status(403).json({ error: "forbidden" });
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
      return res.status(200).json({ ...arch(pg), blocks: await blocks(id) });
    }
    if (!SRC[s]) return res.status(404).json({ error: "unknown" });
    const r = await rows(SRC[s]);
    const data = s === "yoga" ? r.map(yoga).filter(x => x.t) : r.map(arch).filter(x => x.title && x.date);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");
    return res.status(200).json({ data, at: new Date().toISOString() });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    const message = e.status === 401 ? "노션 열쇠(NOTION_TOKEN)가 맞지 않아요." : e.status === 404 ? "노션에서 이 데이터베이스를 연결(Integration)에 공유해주세요." : "노션 연결에 문제가 있어요.";
    return res.status(502).json({ error: e.code || "notion", message });
  }
};
