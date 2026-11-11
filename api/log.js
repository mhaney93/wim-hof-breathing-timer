// GET  /api/log -> [{t, secs, left}]   PUT /api/log (JSON array) -> merged array
// One private Vercel Blob holds the whole hold log. PUT merges with what is stored (union by `t`)
// so two devices logging near the same time never overwrite each other.
import { get, put } from '@vercel/blob';

const PATH = 'hold-log.json';
const KEEP_MS = 30 * 864e5;
const MAX_ENTRIES = 500;

async function readStored() {
    try {
        const r = await get(PATH, { access: 'private', useCache: false });
        if (!r || !r.stream) return [];
        const data = JSON.parse(await new Response(r.stream).text());
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function clean(list) {
    const cutoff = Date.now() - KEEP_MS;
    const byT = new Map();
    for (const e of Array.isArray(list) ? list : []) {
        if (!e || !Number.isFinite(e.t) || e.t < cutoff || e.t > Date.now() + 864e5) continue;
        const out = { t: Math.round(e.t) };
        if (Number.isFinite(e.secs)) out.secs = e.secs;
        if (Number.isFinite(e.left)) out.left = e.left;
        const prev = byT.get(out.t);
        byT.set(out.t, prev ? { ...prev, ...out } : out);
    }
    return [...byT.values()].sort((a, b) => a.t - b.t).slice(-MAX_ENTRIES);
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (req.method === 'GET') return res.status(200).json(clean(await readStored()));
        if (req.method === 'PUT' || req.method === 'POST') {
            const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const merged = clean([...(await readStored()), ...clean(incoming)]);
            await put(PATH, JSON.stringify(merged), {
                access: 'private',
                allowOverwrite: true,
                addRandomSuffix: false,
                contentType: 'application/json',
            });
            return res.status(200).json(merged);
        }
        res.setHeader('Allow', 'GET, PUT');
        return res.status(405).json({ error: 'method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: String(err && err.message || err) });
    }
}
