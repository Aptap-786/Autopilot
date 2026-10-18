import http from 'http';
import fs from 'fs';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.AUTH_TOKEN;
const KEY = process.env.API_KEY || process.env.ANTHROPIC_API_KEY;
const BASE_URL = (process.env.BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''); // khali = Anthropic
const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash'; // text + image dono samajhta hai
const MODEL = process.env.MODEL || (BASE_URL ? DEFAULT_MODEL : 'claude-haiku-5-5');
const VISION_MODEL = process.env.VISION_MODEL || (BASE_URL ? (MODEL === DEFAULT_MODEL ? DEFAULT_MODEL : '') : MODEL); // image samajhne wala model
const IMG_MODE = process.env.IMG_MODE || 'auto'; // auto | always | off
if (!TOKEN || !KEY) { console.error('AUTH_TOKEN aur API_KEY set karo'); process.exit(1); }

console.log(`Config: model=${MODEL} base=${BASE_URL || 'anthropic'} key=${KEY.slice(0, 8)}... (${KEY.length} chars)`);

const SYSTEM = 'You control an Android phone in real time. The user may speak Hindi, Hinglish or English. ' +
  'Reply with ONLY one JSON object, no other text. Keys: action (tap|swipe|swipe_loop|type|enter|back|home|open|wait|done), ' +
  'x, y, x2, y2 (pixels taken from the screen list), text (for type: text to write; for open: app name), ' +
  'say (short Hinglish note). One action per reply. If the AutoPilot app itself is on screen, use home or open first. ' +
  'swipe_loop = keep swiping up to the next reel/short/video on its own: set seconds (wait on each video) or min_seconds and max_seconds (random wait), and count (how many swipes, 0 = until the user presses STOP). Use it when the user wants to keep watching reels or videos. ' +
  'If the history says the user declined an action, do not retry it; use done. ' +
  'Use action done when the goal is complete.';

const page = fs.readFileSync(new URL('./index.html', import.meta.url));
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});
const wss = new WebSocketServer({ server, path: '/ws' });

let device = null;
const webs = new Set();
let job = null;
let busy = false;
let warned = false;
let lastPkg = '';
const notifs = [];

const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const log = (text) => {
  console.log(text);
  send(device, { type: 'log', text });
  webs.forEach((w) => send(w, { type: 'log', text }));
};
const webLog = (text) => webs.forEach((w) => send(w, { type: 'log', text }));
const queue = [];
const finish = (say) => {
  job = null;
  send(device, { type: 'done', say });
  log('Done: ' + say);
  if (queue.length) setTimeout(() => { if (!job) startJob(queue.shift()); }, 1500);
};
function startJob(goal) {
  if (!device) return log('Phone connected nahi hai');
  job = { goal, hist: [], step: 0 };
  log('Naya kaam: ' + goal);
  send(device, { type: 'need_screen', img: IMG_MODE });
}

// ---------- Chat mode: pehle baat, phir "task add kardo" ----------
const chat = [];
const TRIGGER = /task\s*add|add\s*task|task\s*bana|task\s*chala/i;
const CHAT_SYSTEM = 'You are the chat assistant of AutoPilot, an app that controls the user\'s Android phone. ' +
  'Talk in the same language as the user (Hinglish is fine). Help them decide what they want the phone to do. ' +
  'Keep replies short, ask at most one question, never claim you already did something on the phone. ' +
  'When the plan is clear, tell them to say "task add kardo".';
const TASK_SYSTEM = 'Read the conversation. The user\'s last message asks to create the task. ' +
  'Write ONE clear instruction for an Android phone agent that covers everything agreed: app names, contact names, message text, counts and seconds. ' +
  'Use the user\'s language. Output only the instruction, nothing else.';

async function llm(system, messages, maxTokens = 400) {
  if (BASE_URL) {
    const r = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'system', content: system }, ...messages] }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || r.status);
    const t = d.choices?.[0]?.message?.content || '';
    if (!t) throw new Error('model ne khali jawab diya');
    return t.trim();
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || r.status);
  return d.content[0].text.trim();
}

const toWebs = (o) => { webs.forEach((w) => send(w, o)); send(device, o); };

async function onChat(text) {
  chat.push({ role: 'user', content: text });
  while (chat.length > 20) chat.shift();
  while (chat.length && chat[0].role !== 'user') chat.shift();
  try {
    if (TRIGGER.test(text)) {
      if (chat.length < 2) { chat.pop(); return toWebs({ type: 'log', text: 'Pehle batao kya karna hai, phir "task add kardo" bolo' }); }
      const goal = await llm(TASK_SYSTEM, chat, 300);
      chat.length = 0;
      toWebs({ type: 'chat', text: 'Task: ' + goal });
      if (job) { queue.push(goal); log('Queue me daala: ' + goal); } else startJob(goal);
    } else {
      const reply = await llm(CHAT_SYSTEM, chat);
      chat.push({ role: 'assistant', content: reply });
      toWebs({ type: 'chat', text: reply });
    }
  } catch (e) {
    chat.pop();
    console.log('Chat error:', e.message);
    toWebs({ type: 'chat', text: 'Error: ' + e.message });
  }
}

async function think(m) {
  if (!job || busy) return;
  busy = true;
  const mine = job;
  try {
    const screen = m.text || '';
    const sm = screen.match(/Screen size: (\d+)x(\d+)/);
    const sw = sm ? +sm[1] : 0;
    const vision = !!(m.image && VISION_MODEL);
    if (m.image && !VISION_MODEL && !warned) { warned = true; log('Screenshot aaya par VISION_MODEL set nahi hai, sirf text use ho raha hai'); }

    let prompt = `Goal: ${mine.goal}\nActions so far:\n${mine.hist.slice(-15).join('\n')}\nCurrent screen (x,y label):\n${screen}`;
    if (/notif/i.test(mine.goal) && notifs.length) {
      prompt += '\nRecent notifications:\n' + notifs.slice(-5).map((n) => `${n.pkg}: ${n.text}`).join('\n');
    }
    if (vision) prompt += `\nA screenshot is attached, size ${m.iw}x${m.ih}. For this reply give x,y,x2,y2 in SCREENSHOT pixels.`;
    const model = vision ? VISION_MODEL : MODEL;

    let r, data, txt;
    if (BASE_URL) {
      const content = vision
        ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + m.image } }]
        : prompt;
      r = await fetch(BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }] }),
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || r.status);
      txt = data.choices?.[0]?.message?.content || '';
      if (!txt) throw new Error('model ne khali jawab diya, MODEL badal ke dekho');
    } else {
      const content = vision
        ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.image } }, { type: 'text', text: prompt }]
        : prompt;
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content }] }),
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || r.status);
      txt = data.content[0].text;
    }
    if (job !== mine) return; // stop dabaya gaya
    const a = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    if (a.action === 'done') return finish(a.say || 'ho gaya');
    if (vision && sw && m.iw) {
      const k = sw / m.iw; // screenshot pixels -> asli screen pixels
      for (const key of ['x', 'y', 'x2', 'y2']) if (typeof a[key] === 'number') a[key] = Math.round(a[key] * k);
    }
    mine.step++;
    if (mine.step > 25) return finish('25 steps ho gaye, ruk gaya');
    mine.hist.push(`${mine.step}. ${JSON.stringify(a)}`);
    log(`${mine.step}) ${vision ? '👁 ' : ''}${a.action} ${a.text || ''} ${a.say || ''}`);
    send(device, { type: 'action', img: IMG_MODE, ...a });
  } catch (e) {
    log('Error: ' + e.message);
    finish('error aaya');
  } finally {
    busy = false;
  }
}

wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  if (u.searchParams.get('token') !== TOKEN) return ws.close(1008, 'bad token');
  const isDevice = u.searchParams.get('role') === 'device';
  if (isDevice) {
    const old = device;
    device = ws;
    if (old) old.close();
    log('Phone connected');
  } else {
    webs.add(ws);
    send(ws, { type: 'log', text: device ? 'Phone connected hai' : 'Phone abhi connected nahi hai' });
  }
  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'goal' && m.text) {
      startJob(m.text);
    } else if (m.type === 'chat' && m.text) {
      await onChat(String(m.text).slice(0, 2000));
    } else if (m.type === 'stop') {
      job = null;
      queue.length = 0;
      send(device, { type: 'done', say: 'stop' });
      log('Stop');
    } else if (m.type === 'screen' && ws === device) {
      await think(m);
    } else if (m.type === 'event' && ws === device) { // realtime: app/screen badla
      if (m.pkg !== lastPkg) { lastPkg = m.pkg; webLog('📱 ' + m.pkg); }
    } else if (m.type === 'note' && ws === device) { // user ne confirm me mana kiya
      if (job) job.hist.push('NOTE: ' + m.text);
      log(m.text);
    } else if (m.type === 'notif' && ws === device) { // notification aaya
      notifs.push({ pkg: m.pkg, text: m.text });
      if (notifs.length > 20) notifs.shift();
      webLog(`🔔 ${m.pkg}: ${m.text}`);
    }
  });
  ws.on('close', () => {
    webs.delete(ws);
    if (ws === device) { device = null; job = null; log('Phone disconnect ho gaya'); }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log('Server chal raha hai, port', PORT));
