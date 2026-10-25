import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const root = path.dirname(new URL(import.meta.url).pathname);
const bundledDataDir = path.join(root, 'data');
const dataDir = path.resolve(process.env.PLOGME_DATA_DIR || path.join(os.tmpdir(), 'plogme-data'));
fs.mkdirSync(dataDir, { recursive: true });
const localFile = name => path.join(dataDir, name);
const bundledFile = name => path.join(bundledDataDir, name);
const localRead = name => {
  try { return JSON.parse(fs.readFileSync(localFile(name), 'utf8')); }
  catch {
    try { return JSON.parse(fs.readFileSync(bundledFile(name), 'utf8')); }
    catch { return []; }
  }
};
const localWrite = (name, value) => fs.writeFileSync(localFile(name), JSON.stringify(value, null, 2));

const remoteEnabled = () => Boolean(process.env.PLOGME_DATA_API_URL && process.env.PLOGME_DATA_SECRET);
export const storeMode = () => remoteEnabled() ? 'cloudflare-d1' : 'local-json-fallback';
export const query = async (sql, params = []) => {
  if (!remoteEnabled()) return null;
  const response = await fetch(`${process.env.PLOGME_DATA_API_URL.replace(/\/$/, '')}/query`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.PLOGME_DATA_SECRET}` }, body: JSON.stringify({ sql, params }) });
  if (!response.ok) throw new Error(`D1 gateway returned ${response.status}`);
  return response.json();
};
export const recordRequest = async entry => {
  if (remoteEnabled()) { try { await query('INSERT INTO request_logs (method,path,status,duration_ms,ip_hash,created_at) VALUES (?,?,?,?,?,?)', [entry.method, entry.path, entry.status, entry.durationMs, entry.ipHash || '', entry.timestamp]); return; } catch (error) { console.error('D1 request log failed:', error.message); } }
  const rows = localRead('requests.json'); rows.push(entry); if (rows.length > 20000) rows.splice(0, rows.length - 20000); localWrite('requests.json', rows);
};
export const upsertUser = async user => {
  const id = crypto.createHash('sha256').update(`github:${user.login}`).digest('hex').slice(0, 32);
  if (remoteEnabled()) { await query('INSERT INTO users (id,github_login,display_name,avatar_url,created_at,last_seen_at) VALUES (?,?,?,?,?,?) ON CONFLICT(github_login) DO UPDATE SET display_name=excluded.display_name,avatar_url=excluded.avatar_url,last_seen_at=excluded.last_seen_at', [id, user.login, user.name || user.login, user.avatar_url || '', new Date().toISOString(), new Date().toISOString()]); return { ...user, id, role: 'member' }; }
  const rows = localRead('users.json'); const existing = rows.find(x => x.login === user.login); const next = { ...(existing || {}), ...user, id, role: existing?.role || 'member', updatedAt: new Date().toISOString() }; localWrite('users.json', [...rows.filter(x => x.login !== user.login), next]); return next;
};
export const listPublishedPlugins = async () => {
  if (remoteEnabled()) { const r = await query("SELECT id,name,slug,description,category,latest_version,cdn_url AS cdnUrl,install_command AS installCommand,downloads,created_at AS createdAt FROM plugins WHERE status='approved' ORDER BY updated_at DESC"); return r?.results || []; }
  return localRead('plugins.json').filter(x => x.status === 'approved').map(({ code, ...x }) => x);
};
export const search = async q => {
  const term = `%${String(q || '').trim()}%`;
  if (remoteEnabled()) { const r = await query("SELECT 'plugin' AS type,id,name,description,cdn_url AS url FROM plugins WHERE status='approved' AND (name LIKE ? OR description LIKE ?) UNION ALL SELECT 'submission' AS type,id,name,description,url FROM submissions WHERE name LIKE ? OR description LIKE ? ORDER BY name LIMIT 40", [term, term, term, term]); return r?.results || []; }
  return localRead('plugins.json').filter(x => x.status === 'approved' && `${x.name} ${x.description}`.toLowerCase().includes(String(q).toLowerCase())).map(x => ({ type: 'plugin', id: x.id, name: x.name, description: x.description, url: x.cdnUrl }));
};
export const localReadFile = localRead;
export const localWriteFile = localWrite;
