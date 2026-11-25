'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Timer, Plus, Users, Copy, Check, Play, Pause, RotateCcw, Settings2, LogOut, X, Volume2, VolumeX, Infinity as InfinityIcon, Clock3, History, LayoutDashboard, Sparkles, Coffee, Target, Link as LinkIcon, ExternalLink, WifiOff, CheckCircle2, CircleHelp, Menu, ChevronRight, Pencil, Leaf } from 'lucide-react';
import { duration, elapsed, type Config, type PublicRoom, type Mode } from '../lib/session';

type Saved = { code: string; name: string; token: string; createdAt: number; config: Config; ended: boolean; role: string };
const defaults: Config = { mode: 'pomodoro', focus: 25, rest: 5, sound: true };
const modeName = (mode: Mode) => ({ pomodoro: 'Pomodoro', custom: 'Custom timer', infinite: 'Open-ended' }[mode]);
const timeString = (ms: number, up = false) => { const s = Math.max(0, up ? Math.floor(ms / 1000) : Math.ceil(ms / 1000)); return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; };
const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const initials = (name: string) => name.trim().split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase();

export default function FocusSync() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'home' | 'history' | 'room'>('home');
  const [name, setName] = useState('');
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const roomRef = useRef<PublicRoom | null>(null);
  const [token, setToken] = useState('');
  const tokenRef = useRef('');
  const [recent, setRecent] = useState<Saved[]>([]);
  const [modal, setModal] = useState<'create' | 'join' | 'settings' | 'end' | 'leave' | 'reset' | 'help' | null>(null);
  const [draft, setDraft] = useState<Config>({ ...defaults });
  const [roomName, setRoomName] = useState('Deep work session');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'reconnecting'>('connecting');
  const [now, setNow] = useState(0);
  const [guest, setGuest] = useState(false);
  const [muted, setMuted] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [goal, setGoal] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const clockOffset = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const previousStatus = useRef('');
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHost = !!room && room.members.find(m => m.id === room.me)?.role === 'host';

  const notify = (message: string) => { setToast(message); if (notificationTimer.current) clearTimeout(notificationTimer.current); notificationTimer.current = setTimeout(() => setToast(''), 3500); };
  const openModal = (type: typeof modal) => { setError(''); setModal(type); setMobileNav(false); };
  async function request(path: string, body?: unknown, auth = tokenRef.current) {
    const start = Date.now();
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const data = await response.json() as { room: PublicRoom; token?: string; error?: string };
    if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: response.status });
    if (data.room) clockOffset.current = data.room.serverNow - (start + Date.now()) / 2;
    return data;
  }
  const saveRecent = (r: PublicRoom, credential: string) => {
    if (new URLSearchParams(location.search).get('guest') === '1') return;
    const list = read<Saved[]>('fs-recent', []);
    const entry: Saved = { code: r.code, name: r.name, token: credential, createdAt: r.createdAt, config: r.config, ended: r.status === 'ended', role: r.members.find(m => m.id === r.me)?.role || 'member' };
    const next = [entry, ...list.filter(x => x.code !== r.code)].slice(0, 15);
    write('fs-recent', next); setRecent(next);
  };
  const applyRoom = (next: PublicRoom, credential = tokenRef.current) => {
    if (roomRef.current?.code === next.code && roomRef.current.revision > next.revision) return;
    roomRef.current = next; setRoom(next); setConnection('online'); saveRecent(next, credential);
  };
  const enter = (next: PublicRoom, credential: string, isGuest = guest) => {
    tokenRef.current = credential; setToken(credential);
    applyRoom(next, credential); setView('room'); setModal(null); setError('');
    if (isGuest) { try { sessionStorage.setItem(`fs-guest-${next.code}`, credential); } catch {} }
    const params = new URLSearchParams({ room: next.code }); if (isGuest) params.set('guest', '1');
    window.history.replaceState(null, '', `?${params}`);
    setGoal(read<string>(`fs-goal-${next.code}`, ''));
    previousStatus.current = next.timer.status;
  };
  async function restore(code: string, credential: string, isGuest = false) {
    setBusy(true); setConnection('connecting');
    try { const data = await request(`/api/rooms/${code}`, { action: 'heartbeat', eventId: crypto.randomUUID() }, credential); enter(data.room, credential, isGuest); }
    catch (e) { setCode(code); setModal('join'); setError(e instanceof Error ? e.message : 'Could not reconnect.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const list = read<Saved[]>('fs-recent', []); setRecent(Array.isArray(list) ? list : []);
    setName(read<string>('fs-name', '')); setMuted(read<boolean>('fs-muted', false));
    setReady(true); setNow(Date.now());
    const params = new URLSearchParams(location.search); const q = params.get('room')?.toUpperCase(); const isGuest = params.get('guest') === '1'; setGuest(isGuest);
    if (isGuest) setName('Demo guest');
    if (q && /^[A-Z2-9]{6}$/.test(q)) {
      let credential = isGuest ? sessionStorage.getItem(`fs-guest-${q}`) : list.find(x => x.code === q)?.token;
      if (credential) void restore(q, credential, isGuest);
      else { setCode(q); setModal('join'); }
    }
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => { clearInterval(interval); if (notificationTimer.current) clearTimeout(notificationTimer.current); };
  }, []);
  useEffect(() => {
    if (!room?.code || !token) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let heartbeatAt = Date.now();
    const code = room.code;
    const poll = async () => {
      try {
        const heartbeat = Date.now() - heartbeatAt > 15000;
        const data = await request(`/api/rooms/${code}`, heartbeat ? { action: 'heartbeat', eventId: crypto.randomUUID() } : undefined, token);
        if (stopped) return;
        if (heartbeat) heartbeatAt = Date.now();
        applyRoom(data.room, token);
      } catch { if (!stopped) setConnection('reconnecting'); }
      if (!stopped) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 1200);
    const online = () => { if (!stopped) { clearTimeout(timer); void poll(); } };
    window.addEventListener('online', online);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('online', online); };
  }, [room?.code, token]);
  useEffect(() => {
    if (!room) return;
    if (room.timer.status === 'complete' && previousStatus.current === 'running' && room.config.sound && !muted && audio.current) {
      const ctx = audio.current;
      [0, .18, .36].forEach((offset, i) => { const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.connect(gain); gain.connect(ctx.destination); oscillator.frequency.value = [523.25, 659.25, 783.99][i]; gain.gain.setValueAtTime(.08, ctx.currentTime + offset); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + offset + .5); oscillator.start(ctx.currentTime + offset); oscillator.stop(ctx.currentTime + offset + .5); });
    }
    previousStatus.current = room.timer.status;
  }, [room?.timer.status]);
  async function unlockAudio() { try { if (!audio.current) audio.current = new AudioContext(); if (audio.current.state === 'suspended') await audio.current.resume(); } catch {} }
  async function submitSession(event: FormEvent, joining = false) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); void unlockAudio();
    try {
      if (!guest) write('fs-name', name.trim());
      const data = joining ? await request(`/api/rooms/${code.toUpperCase()}`, { action: 'join', name: name.trim(), eventId: crypto.randomUUID() }, '') : await request('/api/rooms', { name: roomName.trim(), hostName: name.trim(), config: draft }, '');
      enter(data.room, data.token!); notify(joining ? 'You’re in. Let’s focus together.' : 'Your room is ready. Invite someone to join.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect. Please try again.'); }
    finally { setBusy(false); }
  }
  async function action(type: string, extra: Record<string, unknown> = {}) {
    if (!roomRef.current || busy) return; setBusy(true); setError(''); void unlockAudio();
    try {
      const eventId = crypto.randomUUID(); let data;
      try { data = await request(`/api/rooms/${roomRef.current.code}`, { action: type, eventId, revision: roomRef.current.revision, ...extra }); }
      catch (e) {
        if ((e as { status?: number }).status !== 409) throw e;
        const fresh = await request(`/api/rooms/${roomRef.current.code}`); applyRoom(fresh.room);
        data = await request(`/api/rooms/${roomRef.current.code}`, { action: type, eventId, revision: fresh.room.revision, ...extra });
      }
      applyRoom(data.room); setModal(null);
      if (type === 'leave') goHome();
      else if (type === 'settings') notify('Settings saved. Ready for a fresh start.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete the action. Please retry.'); }
    finally { setBusy(false); }
  }
  function goHome() {
    setView('home'); setRoom(null); roomRef.current = null; setToken(''); tokenRef.current = ''; setModal(null); setError(''); setGuest(false); window.history.replaceState(null, '', location.pathname); document.title = 'FocusSync — Find your focus, together';
  }
  async function copyInvite(onlyCode = false) {
    if (!room) return;
    const value = onlyCode ? room.code : `${location.origin}${location.pathname}?room=${room.code}`;
    try { await navigator.clipboard.writeText(value); notify(onlyCode ? 'Room code copied.' : 'Invite link copied. Share it with your people.'); }
    catch { setError(`Copy this ${onlyCode ? 'code' : 'invite link'}: ${value}`); }
  }
  const configure = () => { if (!room) return; setDraft({ ...room.config }); setRoomName(room.name); openModal('settings'); };
  const newRoom = () => { setDraft({ ...defaults }); setRoomName('Deep work session'); openModal('create'); };
  const setMode = (mode: Mode) => setDraft(d => ({ ...d, mode, ...(mode === 'pomodoro' ? { focus: 25, rest: 5 } : {}) }));
  const adjustedNow = now + clockOffset.current;
  const passed = room ? elapsed(room, adjustedNow) : 0;
  const openEnded = room?.config.mode === 'infinite' && room.phase === 'focus';
  const remaining = room ? Math.max(0, duration(room) - passed) : 25 * 60000;
  const displayTime = room ? timeString(openEnded ? passed : remaining, openEnded) : '25:00';
  const progress = room ? (openEnded ? .12 : Math.min(1, passed / duration(room))) : .12;
  const activeMembers = room?.members.filter(m => !m.left) || [];
  const connected = connection === 'online';
  const running = room?.timer.status === 'running';
  const ended = room?.status === 'ended';
  useEffect(() => { if (room && view === 'room') document.title = `${ended ? 'Session ended' : displayTime} · ${room.name} — FocusSync`; }, [displayTime, view, room?.name, ended]);

  const timerFace = (preview = false) => <div className={`timer-dial ${running ? 'running' : ''} ${room?.phase === 'break' ? 'break-dial' : ''}`}>
    <svg viewBox="0 0 360 360" aria-hidden="true"><circle className="dial-track" cx="180" cy="180" r="163"/><circle className="dial-progress" cx="180" cy="180" r="163" strokeDasharray="1024.16" strokeDashoffset={1024.16 * (1 - (preview ? .12 : progress))}/>{Array.from({ length: 60 }, (_, i) => { const angle = i * Math.PI / 30; return <line key={i} x1={180 + Math.sin(angle) * 142} y1={180 - Math.cos(angle) * 142} x2={180 + Math.sin(angle) * (i % 5 === 0 ? 133 : 138)} y2={180 - Math.cos(angle) * (i % 5 === 0 ? 133 : 138)} className={i % 5 === 0 ? 'major-tick' : 'minor-tick'}/>; })}</svg>
    <div className="dial-content"><span className="eyebrow">{preview ? 'YOUR NEXT FOCUS' : ended ? 'SESSION ENDED' : room?.timer.status === 'complete' ? 'NICE WORK' : room?.phase === 'break' ? 'TAKE A BREATHER' : 'TIME TO FOCUS'}</span><span className="timer-digits" role="timer" aria-label={preview ? '25 minutes' : `${displayTime} ${openEnded ? 'elapsed' : 'remaining'}`}>{preview ? '25:00' : displayTime}</span><span className="dial-sub">{preview ? 'One thing at a time.' : ended ? 'Thanks for showing up.' : room?.timer.status === 'complete' ? room.phase === 'focus' ? 'You earned a little pause.' : 'A fresh start awaits.' : running ? 'You’re right where you need to be.' : room?.timer.status === 'paused' ? 'A pause is part of the process.' : isHost ? 'Start when you’re ready.' : 'Waiting for the host to start.'}</span></div>
  </div>;

  if (!ready) return <div className="loading-screen"><div className="brand-mark"><Timer size={25}/></div><span>Finding your focus…</span></div>;
  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <a href="/" className="brand" onClick={e => { e.preventDefault(); if (room) { setView('room'); } else setView('home'); }}><span className="brand-mark"><Timer size={24} strokeWidth={2.3}/></span><span>Focus<span className="brand-accent">Sync</span></span></a>
      <div className="nav-section-label">YOUR SPACE</div>
      <nav aria-label="Main navigation"><button className={view === 'home' || view === 'room' ? 'nav-item selected' : 'nav-item'} onClick={() => { setView(room ? 'room' : 'home'); setMobileNav(false); }}><LayoutDashboard size={19}/><span>{room ? 'Focus room' : 'Overview'}</span></button><button className={view === 'history' ? 'nav-item selected' : 'nav-item'} onClick={() => { setView('history'); setMobileNav(false); }}><History size={19}/><span>Recent sessions</span>{recent.length > 0 && <span className="count">{recent.length}</span>}</button></nav>
      <div className="sidebar-note"><span className="note-icon"><Leaf size={21}/></span><p>Small sessions.<br/><strong>Meaningful progress.</strong></p><span>Give your attention a place to land.</span></div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => openModal('help')}><CircleHelp size={19}/><span>How it works</span></button><div className="profile"><span className="avatar profile-avatar">{name.trim() ? initials(name) : <Users size={18}/>}</span><div><strong>{name.trim() || 'Your workspace'}</strong><span>One focus at a time</span></div></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={21}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{view === 'history' ? 'Recent sessions' : view === 'room' ? 'Focus room' : 'Overview'}</strong></div><div className="topbar-right">{room ? <span className={`connection ${connected ? 'connected' : ''}`}>{connected ? <span className="status-dot"/> : <WifiOff size={14}/>} {connected ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span> : <span className="web-badge">WEB EDITION</span>}<button className="help-button icon-button" aria-label="How it works" onClick={() => openModal('help')}><CircleHelp size={19}/></button></div></header>
      <main>
      {view === 'home' && <div className="home-page page-in"><div className="welcome-head"><div><div className="kicker"><span className="mini-line"/> A LITTLE COLLECTIVE MOMENTUM</div><h1>Find your focus.<br/><span>Bring your people.</span></h1><p>Make space for deep work, together.<br className="desktop-break"/> One shared timer. A little accountability. Real progress.</p></div><div className="header-symbol" aria-hidden="true"><Sparkles size={34}/></div></div>
        <div className="home-grid"><section className="start-card"><div className="card-top"><span className="card-icon"><Plus size={22}/></span><span className="small-tag">YOUR NEXT SESSION</span></div><h2>Good work starts<br/>with a little space.</h2><p>Set a rhythm, invite a friend, and give your next task your full attention.</p><button className="button primary" onClick={newRoom}><Plus size={18}/>Create a session</button><div className="card-foot"><Users size={16}/><span>Better together. Just as good solo.</span></div></section>
        <section className="preview-card" aria-label="25 minute timer preview"><div className="preview-label"><span className="focus-symbol"><Target size={16}/></span> A MOMENT OF FOCUS</div>{timerFace(true)}<div className="preview-bottom"><span><span className="little-dot green"/>25 min focus</span><span className="divider"/><span><span className="little-dot blue"/>5 min reset</span></div></section></div>
        <section className="join-strip"><span className="join-strip-icon"><LinkIcon size={21}/></span><div><h3>Have a room code?</h3><p>Your people saved you a seat.</p></div><button className="button secondary" onClick={() => { setCode(''); openModal('join'); }}>Join a session</button></section>
        <div className="section-heading"><h2>Recent sessions</h2>{recent.length > 0 && <button className="text-button" onClick={() => setView('history')}>View all</button>}</div>
        {recent.length === 0 ? <div className="empty-recent"><span className="empty-icon"><Clock3 size={24}/></span><div><h3>A fresh page for your next idea.</h3><p>Your sessions will appear here. Start one when you’re ready.</p></div></div> : <div className="recent-grid">{recent.slice(0, 3).map(s => <button className="recent-card" key={s.code} onClick={() => void restore(s.code, s.token)} disabled={busy}><span className="recent-icon"><Timer size={19}/></span><strong>{s.name}</strong><span>{modeName(s.config.mode)} · {s.config.mode === 'infinite' ? 'No time limit' : `${s.config.focus} min`}</span><div><code>{s.code}</code><span>{s.ended ? 'Ended' : 'Rejoin room'}</span></div></button>)}</div>}
        <footer className="page-footer"><span className="footer-brand"><Timer size={14}/>FocusSync</span><span>A shared rhythm. A clearer mind.</span></footer>
      </div>}
      {view === 'history' && <div className="history-page page-in"><div className="page-heading"><div><div className="kicker">PICK UP YOUR RHYTHM</div><h1>Recent sessions</h1><p>Your latest rooms, right where you left them.</p></div><button className="button primary" onClick={newRoom}><Plus size={18}/>New session</button></div>{recent.length ? <div className="history-list">{recent.map(s => <div className="history-row" key={s.code}><span className="recent-icon"><Timer size={22}/></span><div className="history-info"><h3>{s.name}</h3><p>{modeName(s.config.mode)} · {s.config.mode === 'infinite' ? 'No time limit' : `${s.config.focus} min focus`} · {new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p></div><code>{s.code}</code><span className="subtle-badge">{s.ended ? 'Ended' : s.role === 'host' ? 'Host' : 'Member'}</span><button className="button secondary" disabled={busy} onClick={() => void restore(s.code, s.token)}>{s.ended ? 'View session' : 'Rejoin'}</button><button className="icon-button" aria-label={`Remove ${s.name} from history`} onClick={() => { const next = recent.filter(x => x.code !== s.code); setRecent(next); write('fs-recent', next); }}><X size={17}/></button></div>)}</div> : <section className="history-empty"><span className="empty-icon"><History size={32}/></span><h2>Your first session is ahead of you.</h2><p>Create a room and start building your focus rhythm.</p><button className="button primary" onClick={newRoom}><Plus size={18}/>Create a session</button></section>}</div>}
      {view === 'room' && room && <div className="room-page page-in"><div className="room-heading"><div><div className="kicker"><span className="mini-line"/>{ended ? 'THANK YOU FOR SHOWING UP' : 'A SHARED SPACE FOR DEEP WORK'}</div><h1>{room.name}</h1><p>{ended ? 'Every focused moment counts. Take that momentum with you.' : 'Different tasks. One shared rhythm.'}</p></div><div className="room-heading-actions"><button className="button code-button" onClick={() => void copyInvite(true)} title="Copy room code"><span>ROOM</span><code>{room.code}</code><Copy size={15}/></button>{!ended && <button className="button primary invite-button" onClick={() => void copyInvite()}><Plus size={17}/>Invite people</button>}</div></div>
        {!connected && <div className="reconnect-banner" role="status"><WifiOff size={18}/><span>Reconnecting to your room. The timer keeps its place; controls return when you’re connected.</span></div>}
        {error && !modal && <div className="inline-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={16}/></button></div>}
        <div className="room-grid"><section className={`focus-card ${room.phase === 'break' ? 'on-break' : ''}`}><div className="focus-card-header"><div className="phase-switch" aria-label="Timer phase">{(['focus', 'break'] as const).map(phase => <button key={phase} className={room.phase === phase ? 'active' : ''} disabled={!isHost || running || ended || busy || !connected} onClick={() => void action('phase', { phase })}>{phase === 'focus' ? <Target size={16}/> : <Coffee size={16}/>} {phase === 'focus' ? 'Focus' : 'Break'}</button>)}</div><button className="icon-button sound-toggle" aria-label={muted ? 'Enable sound on this device' : 'Mute sound on this device'} onClick={() => { setMuted(!muted); write('fs-muted', !muted); void unlockAudio(); }}>{muted || !room.config.sound ? <VolumeX size={19}/> : <Volume2 size={19}/>}</button></div>
          {timerFace()}
          <div className={`timer-state ${running ? 'timer-state-running' : ''}`}><span className={`little-dot ${running ? 'green' : ''}`}/>{ended ? 'Session ended' : room.timer.status === 'complete' ? 'Round complete' : running ? room.phase === 'focus' ? 'Focus in progress' : 'Break in progress' : room.timer.status === 'paused' ? 'Paused together' : 'Ready when you are'}</div>
          <div className="timer-controls">{ended ? <button className="button primary timer-main" onClick={goHome}><CheckCircle2 size={19}/>Back to workspace</button> : room.timer.status === 'complete' ? isHost ? <button className="button primary timer-main" disabled={busy || !connected} onClick={() => void action('phase', { phase: room.phase === 'focus' ? 'break' : 'focus' })}>{room.phase === 'focus' ? <Coffee size={19}/> : <Target size={19}/>}{room.phase === 'focus' ? 'Prepare a break' : 'Next focus round'}</button> : <div className="member-wait"><CheckCircle2 size={18}/>Round complete. Waiting for the host.</div> : isHost ? <><button className="button secondary reset-button" aria-label="Reset timer" disabled={busy || !connected} onClick={() => openModal('reset')}><RotateCcw size={20}/></button><button className="button primary timer-main" disabled={busy || !connected} onClick={() => void action(running ? 'pause' : 'start')}>{running ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}{busy ? 'Syncing…' : running ? 'Pause timer' : room.timer.status === 'paused' ? 'Resume timer' : room.phase === 'break' ? 'Start break' : 'Start focus'}</button><button className="button secondary reset-button" aria-label="Session settings" disabled={busy || running || !connected} onClick={configure}><Settings2 size={20}/></button></> : <div className="member-wait"><Users size={19}/>{running ? 'You’re in sync with the host.' : 'Your host will start the timer.'}</div>}</div>
          <div className="timer-meta"><span>{modeName(room.config.mode)}</span><span>·</span><span>{room.rounds} {room.rounds === 1 ? 'round' : 'rounds'} completed</span></div>
          <div className="intention"><span className="intention-icon"><Pencil size={16}/></span><div><span className="eyebrow">MY FOCUS FOR THIS SESSION</span>{editingGoal ? <form onSubmit={e => { e.preventDefault(); write(`fs-goal-${room.code}`, goal.trim()); setEditingGoal(false); }}><input aria-label="My focus for this session" autoFocus maxLength={120} value={goal} onChange={e => setGoal(e.target.value)} placeholder="What deserves your attention?"/><button className="icon-button" aria-label="Save focus"><Check size={18}/></button></form> : <button className="goal-button" onClick={() => setEditingGoal(true)}>{goal || 'What deserves your attention?'}</button>}</div>{!editingGoal && <button className="icon-button" aria-label="Edit my focus" onClick={() => setEditingGoal(true)}><Pencil size={15}/></button>}</div>
        </section><aside className="room-side"><section className="panel people-panel"><div className="panel-title"><h2><Users size={18}/>In this together</h2><span className="people-count">{activeMembers.length}</span></div><p className="panel-description">A little company goes a long way.</p><div className="people-list">{activeMembers.map((m, i) => { const online = adjustedNow - m.seenAt < 45000; return <div className="person" key={m.id}><span className={`avatar avatar-${i % 4}`}>{initials(m.name)}<span className={`presence ${online ? 'present' : ''}`}/></span><div><strong>{m.name}{m.id === room.me && <span> (you)</span>}</strong><span>{m.role === 'host' ? 'Host' : 'Member'}{!online && ' · Away'}</span></div>{m.role === 'host' && <span className="host-badge">HOST</span>}</div>; })}</div>{!ended && <><button className="invite-outline" onClick={() => void copyInvite()}><Plus size={17}/>Invite someone</button><button className="companion-button" onClick={() => window.open(`${location.origin}${location.pathname}?room=${room.code}&guest=1`, '_blank', 'noopener,noreferrer')}><ExternalLink size={14}/>Open companion tab</button></>}</section>
          <section className="panel rhythm-panel"><div className="panel-title"><h2><Settings2 size={18}/>The rhythm</h2>{isHost && !ended && <button className="text-button" disabled={running || busy || !connected} onClick={configure}>Edit</button>}</div><div className="rhythm-row"><span><Target size={15}/>Focus</span><strong>{room.config.mode === 'infinite' ? 'No limit' : `${room.config.focus} ${room.config.focus === 1 ? 'minute' : 'minutes'}`}</strong></div><div className="rhythm-row"><span><Coffee size={15}/>Break</span><strong>{room.config.rest} {room.config.rest === 1 ? 'minute' : 'minutes'}</strong></div><div className="rhythm-row"><span><Volume2 size={15}/>Completion sound</span><strong>{room.config.sound ? 'On' : 'Off'}</strong></div>{running && isHost && <p className="rhythm-hint">Pause the timer to edit the rhythm.</p>}</section>
          <section className="panel activity-panel"><div className="panel-title"><h2><Clock3 size={18}/>Room activity</h2></div><ol>{room.activity.slice(0, 4).map((a, i) => <li key={a.id}><span className={`activity-dot ${i === 0 ? 'latest' : ''}`}/><div><p>{a.text}</p><time>{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div></li>)}</ol></section>
          {!ended && <div className="room-exit">{isHost && <button className="text-button danger-text" onClick={() => openModal('end')}>End session for everyone</button>}<button className="text-button" onClick={() => openModal('leave')}><LogOut size={15}/>Leave room</button></div>}
        </aside></div><footer className="page-footer"><span className="footer-brand"><Timer size={14}/>FocusSync</span><span>{isHost ? 'You set the pace. Everyone stays in sync.' : 'Follow the rhythm. Find your flow.'}</span></footer>
      </div>}
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={18}/>{toast}</div>}
    {modal && <Modal title={modal === 'create' ? 'Make room for focus.' : modal === 'settings' ? 'Find your rhythm.' : modal === 'join' ? 'Your people are here.' : modal === 'help' ? 'A shared rhythm. Simple.' : modal === 'end' ? 'Call it a good session?' : modal === 'leave' ? 'Step out of the room?' : 'Start with a clean slate?'} busy={busy} onClose={() => { setModal(null); setError(''); }}>
      {(modal === 'create' || modal === 'settings') && <form onSubmit={e => { if (modal === 'create') void submitSession(e); else { e.preventDefault(); void action('settings', { name: roomName, config: draft }); } }}><p className="modal-description">{modal === 'create' ? 'A little structure for your next big thing.' : 'Changes apply to everyone and reset the current timer.'}</p>{modal === 'create' && <label className="field">Your name<input required autoFocus maxLength={30} placeholder="What should we call you?" value={name} onChange={e => setName(e.target.value)} autoComplete="given-name"/></label>}<label className="field">Session name<input required autoFocus={modal === 'settings'} maxLength={50} value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="e.g. Sunday study club"/></label><label className="field-label">Choose your focus mode</label><div className="mode-options">{(['pomodoro', 'custom', 'infinite'] as Mode[]).map(mode => <button type="button" className={draft.mode === mode ? 'mode-option chosen' : 'mode-option'} key={mode} onClick={() => setMode(mode)}>{mode === 'infinite' ? <InfinityIcon size={21}/> : mode === 'pomodoro' ? <Timer size={21}/> : <Settings2 size={21}/>}<strong>{mode === 'infinite' ? 'Open-ended' : mode === 'pomodoro' ? 'Pomodoro' : 'Custom'}</strong><span>{mode === 'pomodoro' ? 'The classic 25 / 5' : mode === 'custom' ? 'Your own rhythm' : 'Follow your flow'}</span></button>)}</div>{draft.mode !== 'infinite' && <div className="duration-fields"><label className="field">Focus duration<div className="number-input"><input type="number" min="1" max="120" required disabled={draft.mode === 'pomodoro'} value={draft.focus} onChange={e => setDraft(d => ({ ...d, focus: Number(e.target.value) }))}/><span>min</span></div></label><label className="field">Break duration<div className="number-input"><input type="number" min="1" max="30" required disabled={draft.mode === 'pomodoro'} value={draft.rest} onChange={e => setDraft(d => ({ ...d, rest: Number(e.target.value) }))}/><span>min</span></div></label></div>}{draft.mode === 'infinite' && <p className="mode-hint">A count-up timer with no finish line. Pause or end whenever you’re ready. Breaks are {draft.rest} {draft.rest === 1 ? 'minute' : 'minutes'}.</p>}<button type="button" className="quick-preset" onClick={() => setDraft(d => ({ ...d, mode: 'custom', focus: 1, rest: 1 }))}><Sparkles size={15}/>Try a 1-minute demo preset</button><div className="sound-setting"><div><strong>Completion sound</strong><p>A gentle chime when a round finishes.</p></div><button type="button" className={`switch ${draft.sound ? 'on' : ''}`} role="switch" aria-checked={draft.sound} aria-label="Completion sound" onClick={() => setDraft(d => ({ ...d, sound: !d.sound }))}><span/></button></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full-width" disabled={busy}>{busy ? 'Setting things up…' : modal === 'settings' ? 'Save rhythm' : 'Create focus room'}</button><p className="form-footnote">{modal === 'create' ? 'You’ll be the host. Invite others once your room is ready.' : 'Everyone in the room will receive the new settings.'}</p></form>}
      {modal === 'join' && <form onSubmit={e => void submitSession(e, true)}><p className="modal-description">Enter a room code and settle into the same rhythm.</p><label className="field">Your name<input autoFocus required maxLength={30} value={name} onChange={e => setName(e.target.value)} placeholder="What should we call you?" autoComplete="given-name"/></label><label className="field">Room code<input className="room-code-input" required minLength={6} maxLength={6} pattern="[A-Z2-9]{6}" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} placeholder="ABC234" autoComplete="off" autoCapitalize="characters" spellCheck={false}/></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full-width" disabled={busy}>{busy ? 'Joining your people…' : 'Join focus room'}</button><p className="form-footnote">The host controls the timer. You bring your attention.</p></form>}
      {modal === 'help' && <div className="help-content"><p className="modal-description">FocusSync gives your attention a shared place to land.</p><div className="help-item"><span><Plus size={22}/></span><div><h3>Create your space</h3><p>Name your room and choose Pomodoro, a custom duration, or an open-ended timer.</p></div></div><div className="help-item"><span><Users size={22}/></span><div><h3>Bring your people</h3><p>Share the invite link or six-character code. Everyone joins with their own name.</p></div></div><div className="help-item"><span><Target size={22}/></span><div><h3>Find a shared rhythm</h3><p>The host starts, pauses, and resets. Everyone follows the same timer. Start a break after a focus round.</p></div></div><div className="help-tip"><Sparkles size={18}/><p>Presenting the app? Try the 1-minute preset, then open a companion tab from your room to show both sides.</p></div><p className="help-detail">Live rooms need an internet connection. Preferences and room access are remembered on this device. Sound needs a browser interaction first.</p><button className="button primary full-width" onClick={() => setModal(null)}>Got it. Let’s focus.</button></div>}
      {['end', 'leave', 'reset'].includes(modal) && <div><p className="modal-description">{modal === 'end' ? 'This ends the room for everyone. You can still view it in your recent sessions.' : modal === 'leave' ? isHost ? 'The room stays open and the timer keeps going. You can rejoin from your recent sessions to control it.' : 'The session will continue. Rejoin from your recent sessions whenever you’re ready.' : 'The current timer will return to its full duration for everyone in this room.'}</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="confirm-actions"><button className="button secondary" disabled={busy} onClick={() => setModal(null)}>Keep {modal === 'leave' ? 'focusing' : 'going'}</button><button className={`button ${modal === 'end' ? 'destructive' : 'primary'}`} disabled={busy} onClick={() => void action(modal)}>{busy ? 'Syncing…' : modal === 'end' ? 'End session' : modal === 'leave' ? 'Leave room' : 'Reset timer'}</button></div></div>}
    </Modal>}
  </div>;
}

function Modal({ title, children, onClose, busy }: { title: string; children: React.ReactNode; onClose: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="modal" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }} onClick={e => { if (e.target === ref.current && !busy) { const r = ref.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}><div className="modal-header"><span className="modal-mark"><Timer size={23}/></span><button className="icon-button" aria-label="Close dialog" type="button" disabled={busy} onClick={onClose}><X size={20}/></button></div><h2>{title}</h2>{children}</dialog>;
}
