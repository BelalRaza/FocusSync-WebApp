import { env } from 'cloudflare:workers';
import { authenticate, createRoom, mutateRoom, publicRoom, SessionError, settle, type Room } from './session';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const database = () => { if (!env.DB) throw new SessionError('Session service is unavailable. Please try again.', 503); return env.DB; };
const tokenFrom = (request: Request) => request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
async function body(request: Request) {
  if (Number(request.headers.get('content-length')) > 8192) throw new SessionError('Request is too large.', 413);
  const raw = await request.text();
  if (raw.length > 8192) throw new SessionError('Request is too large.', 413);
  try { const b = JSON.parse(raw); if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error(); return b; }
  catch { throw new SessionError('Invalid request.'); }
}
export async function create(request: Request) {
  try {
    const data = await body(request); const db = database();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 5; i++) {
      const random = crypto.getRandomValues(new Uint8Array(6));
      const code = Array.from(random, x => chars[x % chars.length]).join('');
      const room = createRoom(code, data.name, data.hostName, data.config, Date.now());
      const result = await db.prepare('INSERT OR IGNORE INTO rooms (code,state,revision,created_at) VALUES (?,?,?,?)').bind(code, JSON.stringify(room), 1, room.createdAt).run();
      if (result.meta.changes) { const token = room.members[0].token; return json({ room: publicRoom(room, token, Date.now()), token }, 201); }
    }
    throw new SessionError('Could not create a room. Please try again.', 503);
  } catch (error) { return handleError(error); }
}
function handleError(error: unknown) {
  if (error instanceof SessionError) return json({ error: error.message }, error.status);
  console.error('FocusSync room service:', error instanceof Error ? error.message : 'Unknown error');
  return json({ error: 'The session service could not respond. Please retry.' }, 503);
}
export async function access(request: Request, rawCode: string) {
  try {
    const code = rawCode.toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new SessionError('Enter a valid six-character room code.');
    const db = database(); const token = tokenFrom(request);
    const data = request.method === 'POST' ? await body(request) : null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await db.prepare('SELECT state, revision FROM rooms WHERE code = ?').bind(code).first<{ state: string; revision: number }>();
      if (!row) throw new SessionError('Room not found. Check the code and try again.', 404);
      const room = JSON.parse(row.state) as Room;
      // Validate read credentials before any database mutation.
      if (!data || data.action !== 'join') authenticate(room, token);
      const now = Date.now(); let changed = settle(room, now); let newToken: string | undefined;
      if (data) { const result = mutateRoom(room, token, data, now); changed ||= result.changed; newToken = result.token; }
      if (changed) {
        room.revision = row.revision + 1;
        const saved = await db.prepare('UPDATE rooms SET state = ?, revision = ? WHERE code = ? AND revision = ?').bind(JSON.stringify(room), room.revision, code, row.revision).run();
        if (!saved.meta.changes) continue;
      }
      return json({ room: publicRoom(room, newToken || token, now), ...(newToken ? { token: newToken } : {}) });
    }
    throw new SessionError('The room is busy. Please try again.', 409);
  } catch (error) { return handleError(error); }
}
