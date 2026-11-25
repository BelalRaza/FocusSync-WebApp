// Browser adaptation of FocusSync's host-owned event state machine.
// Absolute server timestamps keep countdowns stable across refreshes and tabs.
export type Mode = 'pomodoro' | 'custom' | 'infinite';
export type Config = { mode: Mode; focus: number; rest: number; sound: boolean };
export type Member = { id: string; name: string; role: 'host' | 'member'; token: string; joinKey?: string; seenAt: number; left: boolean };
export type Activity = { id: string; text: string; at: number };
export type Room = {
  code: string; name: string; config: Config; revision: number; createdAt: number;
  status: 'open' | 'ended'; phase: 'focus' | 'break';
  timer: { status: 'idle' | 'running' | 'paused' | 'complete'; elapsed: number; startedAt: number | null };
  members: Member[]; activity: Activity[]; processed: string[]; rounds: number;
};
export type PublicRoom = Omit<Room, 'members' | 'processed'> & { members: Omit<Member, 'token' | 'joinKey'>[]; me: string; serverNow: number };
export class SessionError extends Error { constructor(message: string, public status = 400) { super(message); } }
const fail = (message: string, status = 400): never => { throw new SessionError(message, status); };
export function cleanName(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} must be 1–${max} characters.`);
  return (value as string).trim();
}
export function validateConfig(value: unknown): Config {
  const c = value as Config;
  if (!c || !['pomodoro', 'custom', 'infinite'].includes(c.mode)) fail('Choose a valid focus mode.');
  if (!Number.isInteger(c.focus) || c.focus < 1 || c.focus > 120) fail('Focus duration must be 1–120 minutes.');
  if (!Number.isInteger(c.rest) || c.rest < 1 || c.rest > 30) fail('Break duration must be 1–30 minutes.');
  if (typeof c.sound !== 'boolean') fail('Choose a valid sound setting.');
  return { mode: c.mode, focus: c.mode === 'pomodoro' ? 25 : c.focus, rest: c.mode === 'pomodoro' ? 5 : c.rest, sound: c.sound };
}
export function duration(room: Pick<Room, 'phase' | 'config'>) { return (room.phase === 'break' ? room.config.rest : room.config.focus) * 60000; }
export function elapsed(room: Pick<Room, 'timer'>, now: number) {
  return Math.max(0, room.timer.elapsed + (room.timer.status === 'running' && room.timer.startedAt !== null ? Math.max(0, now - room.timer.startedAt) : 0));
}
function log(room: Room, text: string, now: number) {
  room.activity = [{ id: crypto.randomUUID(), text, at: now }, ...room.activity].slice(0, 30);
}
export function settle(room: Room, now: number) {
  if (room.timer.status === 'running' && !(room.config.mode === 'infinite' && room.phase === 'focus') && elapsed(room, now) >= duration(room)) {
    room.timer = { status: 'complete', elapsed: duration(room), startedAt: null };
    if (room.phase === 'focus') room.rounds += 1;
    log(room, room.phase === 'focus' ? 'Focus complete. Time for a well-earned break.' : 'Break complete. Ready for another round.', now);
    return true;
  }
  return false;
}
export function createRoom(code: string, name: unknown, hostName: unknown, config: unknown, now: number): Room {
  const host: Member = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(hostName, 30, 'Your name'), role: 'host', seenAt: now, left: false };
  return { code, name: cleanName(name, 50, 'Session name'), config: validateConfig(config), createdAt: now, revision: 1, status: 'open', phase: 'focus', timer: { status: 'idle', elapsed: 0, startedAt: null }, members: [host], activity: [{ id: crypto.randomUUID(), text: `${host.name} created the session.`, at: now }], processed: [], rounds: 0 };
}
export function authenticate(room: Room, token: string) {
  const member = room.members.find(m => m.token === token);
  if (!member) fail('Join this session to continue.', 401);
  return member!;
}
export function publicRoom(room: Room, token: string, now: number): PublicRoom {
  const me = authenticate(room, token);
  const { processed: _processed, members, ...rest } = room;
  return { ...rest, members: members.map(({ token: _token, joinKey: _joinKey, ...member }) => member), me: me.id, serverNow: now };
}
export function mutateRoom(room: Room, token: string, input: Record<string, unknown>, now: number): { changed: boolean; token?: string } {
  const action = input.action;
  const eventId: string = typeof input.eventId === 'string' ? input.eventId : fail('An action identifier is required.');
  if (eventId.length > 100 || !eventId) fail('An action identifier is required.');
  if (action === 'join') {
    if (room.status === 'ended') fail('This session has ended. Create a new one.', 410);
    // A retried join returns the same credential instead of adding duplicates.
    const existing = room.members.find(m => m.joinKey === eventId);
    if (existing) return { changed: false, token: existing.token };
    if (room.members.filter(m => !m.left).length >= 50 || room.members.length >= 100) fail('This room is full.');
    const m: Member = { id: crypto.randomUUID(), token: crypto.randomUUID(), joinKey: eventId, name: cleanName(input.name, 30, 'Your name'), role: 'member', seenAt: now, left: false };
    room.members.push(m); log(room, `${m.name} joined the session.`, now);
    return { changed: true, token: m.token };
  }
  const actor = authenticate(room, token);
  if (room.processed.includes(eventId)) return { changed: false };
  if (action === 'heartbeat') {
    if (actor.left && room.status === 'open') { actor.left = false; log(room, `${actor.name} rejoined the session.`, now); }
    actor.seenAt = now; return { changed: true };
  }
  if (action === 'leave') {
    actor.left = true; actor.seenAt = now; log(room, `${actor.name} left the session.`, now);
  } else {
    if (room.status === 'ended') fail('This session has ended.', 410);
    if (actor.left) fail('Rejoin this session to continue.', 403);
    if (actor.role !== 'host') fail('Only the host can control this session.', 403);
    if (!Number.isInteger(input.revision) || input.revision !== room.revision) fail('The session changed. Please try again.', 409);
    const status = room.timer.status;
    switch (action) {
      case 'start':
        if (!['idle', 'paused'].includes(status)) fail('The timer is already running or complete.', 409);
        room.timer.status = 'running'; room.timer.startedAt = now;
        log(room, status === 'paused' ? 'Timer resumed.' : `${room.phase === 'focus' ? 'Focus' : 'Break'} started.`, now); break;
      case 'pause':
        if (status !== 'running') fail('Only a running timer can be paused.', 409);
        room.timer = { status: 'paused', elapsed: elapsed(room, now), startedAt: null };
        log(room, 'Timer paused.', now); break;
      case 'reset':
        room.timer = { status: 'idle', elapsed: 0, startedAt: null }; log(room, 'Timer reset.', now); break;
      case 'phase':
        if (input.phase !== 'focus' && input.phase !== 'break') fail('Choose focus or break.');
        if (status === 'running') fail('Pause the timer before changing phase.');
        room.phase = input.phase as Room['phase']; room.timer = { status: 'idle', elapsed: 0, startedAt: null };
        log(room, room.phase === 'focus' ? 'Ready for a focus round.' : 'Ready for a break.', now); break;
      case 'settings':
        if (status === 'running') fail('Pause the timer before editing settings.');
        room.config = validateConfig(input.config); room.name = cleanName(input.name, 50, 'Session name');
        room.timer = { status: 'idle', elapsed: 0, startedAt: null }; log(room, 'Session settings updated. Timer reset.', now); break;
      case 'end':
        room.timer = { status: 'paused', elapsed: elapsed(room, now), startedAt: null }; room.status = 'ended'; log(room, 'The host ended the session.', now); break;
      default: fail('Unknown session action.');
    }
  }
  room.processed = [...room.processed, eventId].slice(-100);
  return { changed: true };
}
