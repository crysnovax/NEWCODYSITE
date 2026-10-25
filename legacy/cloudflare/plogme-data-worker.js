const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' } });
const authorized = (request, env) => { const expected = env.PLOGME_DATA_SECRET; return expected && request.headers.get('authorization') === `Bearer ${expected}`; };
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' } });
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, database: 'plogme-platform' });
      if (request.method === 'POST' && url.pathname === '/query') {
        const body = await request.json();
        if (!body.sql || !Array.isArray(body.params || [])) return json({ error: 'sql and params are required' }, 400);
        const result = await env.PLOGME_DB.prepare(body.sql).bind(...(body.params || [])).all();
        return json(result);
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) { return json({ error: String(error?.message || error) }, 500); }
  }
};
