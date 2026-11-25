import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/session.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createRoom, mutateRoom, publicRoom, elapsed, settle, SessionError } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const config = { mode: 'custom', focus: 1, rest: 1, sound: true };
const fresh = () => createRoom('ABC234', 'Interview room', 'Host', config, 1000);
const change = (room, action, now = 2000, extra = {}, token = room.members[0].token) => mutateRoom(room, token, { action, eventId: crypto.randomUUID(), revision: room.revision, ...extra }, now);

test('creates a validated room with a host and ready timer', () => {
  const room = fresh(); assert.equal(room.members[0].role, 'host'); assert.equal(room.timer.status, 'idle'); assert.equal(room.phase, 'focus');
  assert.throws(() => createRoom('ABC234', ' ', 'Host', config, 1000), SessionError);
  for (const focus of [0, 121, 1.5, NaN]) assert.throws(() => createRoom('ABC234', 'Room', 'Host', { ...config, focus }, 1000), SessionError);
  for (const rest of [0, 31]) assert.throws(() => createRoom('ABC234', 'Room', 'Host', { ...config, rest }, 1000), SessionError);
});
test('Pomodoro enforces the classic 25/5 configuration', () => {
  const room = createRoom('ABC234', 'Room', 'Host', { ...config, mode: 'pomodoro' }, 1000);
  assert.equal(room.config.focus, 25); assert.equal(room.config.rest, 5);
});
test('join retries are idempotent and do not leak credentials in public state', () => {
  const room = fresh(); const input = { action: 'join', eventId: crypto.randomUUID(), name: '<Guest>' };
  const joined = mutateRoom(room, '', input, 2000); assert.ok(joined.token);
  const retry = mutateRoom(room, '', input, 3000); assert.equal(retry.token, joined.token); assert.equal(room.members.length, 2);
  const state = publicRoom(room, joined.token, 3000);
  assert.equal(state.me, room.members[1].id); assert.equal(state.members[1].name, '<Guest>');
  assert.ok(!('processed' in state)); assert.ok(state.members.every(m => !('token' in m) && !('joinKey' in m)));
  // A publicly visible member ID cannot be exchanged for that member's token.
  const different = mutateRoom(room, '', { action: 'join', eventId: state.members[1].id, name: 'Other' }, 4000);
  assert.notEqual(different.token, joined.token);
});
test('members and invalid credentials cannot perform host controls', () => {
  const room = fresh(); const member = change(room, 'join', 2000, { name: 'Guest' }, '').token;
  for (const action of ['start', 'pause', 'reset', 'settings', 'end', 'phase']) assert.throws(() => change(room, action, 3000, {}, member), e => e.status === 403);
  assert.throws(() => publicRoom(room, 'bad-token', 3000), e => e.status === 401);
});
test('start, pause, resume, and reset use server timestamps without drift', () => {
  const room = fresh(); change(room, 'start', 2000); assert.equal(elapsed(room, 7000), 5000);
  change(room, 'pause', 7000); assert.equal(elapsed(room, 20000), 5000);
  change(room, 'start', 20000); assert.equal(elapsed(room, 23000), 8000);
  change(room, 'reset', 23000); assert.deepEqual(room.timer, { status: 'idle', elapsed: 0, startedAt: null });
});
test('rejects stale writes and duplicate event delivery does not apply twice', () => {
  const room = fresh(); assert.throws(() => change(room, 'start', 2000, { revision: 0 }), e => e.status === 409);
  const input = { action: 'start', eventId: 'same-event', revision: room.revision };
  mutateRoom(room, room.members[0].token, input, 2000); const activityCount = room.activity.length;
  const duplicate = mutateRoom(room, room.members[0].token, input, 3000);
  assert.equal(duplicate.changed, false); assert.equal(room.timer.startedAt, 2000); assert.equal(room.activity.length, activityCount);
});
test('completion is exact, occurs once, and enables an explicit break', () => {
  const room = fresh(); change(room, 'start', 2000); assert.equal(settle(room, 61999), false);
  assert.equal(settle(room, 62000), true); assert.equal(room.timer.status, 'complete'); assert.equal(room.rounds, 1);
  assert.equal(settle(room, 70000), false); assert.equal(room.rounds, 1);
  change(room, 'phase', 70000, { phase: 'break' }); change(room, 'start', 71000);
  settle(room, 131000); assert.equal(room.timer.status, 'complete'); assert.equal(room.rounds, 1);
});
test('open-ended focus counts up without auto-completing', () => {
  const room = createRoom('ABC234', 'Flow', 'Host', { ...config, mode: 'infinite' }, 1000);
  change(room, 'start', 2000); assert.equal(settle(room, 3602000), false); assert.equal(elapsed(room, 3602000), 3600000);
  change(room, 'pause', 3602000); change(room, 'phase', 3603000, { phase: 'break' }); change(room, 'start', 3604000);
  assert.equal(settle(room, 3664000), true);
});
test('settings cannot change a running timer and reset a paused timer cleanly', () => {
  const room = fresh(); change(room, 'start');
  assert.throws(() => change(room, 'settings', 3000, { name: 'New', config }), SessionError);
  assert.throws(() => change(room, 'phase', 3000, { phase: 'break' }), SessionError);
  change(room, 'pause', 4000); change(room, 'settings', 5000, { name: 'New', config: { ...config, focus: 45 } });
  assert.equal(room.name, 'New'); assert.equal(room.config.focus, 45); assert.equal(room.timer.elapsed, 0); assert.equal(room.timer.status, 'idle');
});
test('leave and reconnect retain host ownership; ended rooms are terminal', () => {
  const room = fresh(); const host = room.members[0]; change(room, 'leave'); assert.equal(host.left, true);
  assert.throws(() => change(room, 'start'), e => e.status === 403);
  change(room, 'heartbeat'); assert.equal(host.left, false); assert.equal(host.role, 'host');
  change(room, 'start', 3000); change(room, 'end', 7000); assert.equal(room.status, 'ended'); assert.equal(room.timer.elapsed, 4000);
  assert.throws(() => change(room, 'start'), e => e.status === 410);
  assert.throws(() => change(room, 'join', 8000, { name: 'Late' }, ''), e => e.status === 410);
});
