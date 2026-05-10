// Shared fake data + tiny icon set used by every variation.
// Story: user is iterating on a narrative project; agent is searching the
// project, reading source markdown, and proposing an edit.

const MODES = [
  { id: 'narrative-coauthor', name: 'Narrative coauthor',  color: '#3b82f6', source: 'builtin', desc: 'Continuity-aware co-writer; tools for read/search/edit.' },
  { id: 'dialogue-writer',    name: 'Dialogue writer',     color: '#a78bfa', source: 'builtin', desc: 'Voice-card driven; line-level revisions only.' },
  { id: 'game-designer',      name: 'Game designer',       color: '#f59e0b', source: 'builtin', desc: 'Numbers, balance, faction tables.' },
  { id: 'beat-doctor',        name: 'Beat doctor',         color: '#ec4899', source: 'plugin',  plugin: 'plugins/beat-doctor', desc: 'Story beats + pacing critique. Plugin.' },
  { id: 'lore-keeper',        name: 'Lore keeper',         color: '#22c55e', source: 'plugin',  plugin: 'plugins/lore-keeper', desc: 'Read-only consistency sweep over canon. Plugin.' },
];
const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

const SESSIONS = [
  { id: 's1', title: "Marek's first appearance — weapon tag", mode: 'narrative-coauthor', updated: '2m', active: true },
  { id: 's2', title: 'Chapter 4 outline pass', mode: 'beat-doctor', updated: '1h' },
  { id: 's3', title: 'Voice card for Sidonia', mode: 'dialogue-writer', updated: '3h' },
  { id: 's4', title: 'Faction balance — Tide of Embers', mode: 'game-designer', updated: '2d' },
  { id: 's5', title: 'Scratch — name brainstorm', mode: 'narrative-coauthor', updated: '4d' },
  { id: 's6', title: 'Lore consistency sweep', mode: 'lore-keeper', updated: '1w' },
];

const FILE_TREE = [
  { type: 'dir', name: 'narrative', open: true, children: [
    { type: 'file', name: 'ch1-arrival.md', kb: 8.2 },
    { type: 'file', name: 'ch2-the-bridge.md', kb: 11.7, dirty: true },
    { type: 'file', name: 'ch3-marek.md', kb: 6.0 },
    { type: 'file', name: 'ch4-outline.md', kb: 1.4 },
  ]},
  { type: 'dir', name: 'characters', open: true, children: [
    { type: 'file', name: 'marek.md', kb: 3.1, active: true },
    { type: 'file', name: 'sidonia.md', kb: 2.8 },
    { type: 'file', name: 'el-tarrim.md', kb: 4.2 },
    { type: 'file', name: 'ravn.md', kb: 1.9 },
  ]},
  { type: 'dir', name: 'lore', open: false, children: [
    { type: 'file', name: 'weapons.md', kb: 5.3 },
    { type: 'file', name: 'factions.md', kb: 7.6 },
  ]},
  { type: 'dir', name: 'drafts', open: false, children: [] },
  { type: 'file', name: 'project.toml', kb: 0.8 },
];

const PROFILES = [
  { id: 'qwen-32b-cuda-prod', kind: 'chat', model: 'Qwen2.5-32B-Instruct Q5_K_M', port: 18080, status: 'running', vram: 22.4, tps: 41.2 },
  { id: 'embed-user-bge-m3', kind: 'embed', model: 'USER-bge-m3', port: 18081, status: 'running', vram: 1.1, tps: null },
  { id: 'rerank-bge-v2-m3', kind: 'rerank', model: 'bge-reranker-v2-m3', port: 18082, status: 'idle', vram: 0, tps: null },
  { id: 'mistral-small-cpu', kind: 'chat', model: 'Mistral-Small-22B Q4_K_M', port: 18083, status: 'stopped', vram: 0, tps: null },
];

const TOOL_LOG = [
  { kind: 'user', text: "In ch3 Marek pulls a weapon for the first time — make sure it's tagged in his character card and consistent with lore/weapons.md. Don't rewrite anything else." },
  { kind: 'assistant_thought', text: "Pulling Marek's card and the chapter to compare against the weapons lore." },
  { kind: 'tool', name: 'search_semantic', args: { query: 'Marek weapon first appearance', k: 6 }, result: {
      hits: [
        { path: 'narrative/ch3-marek.md', heading: '## The bridge at dusk', score: 0.847, line: 142 },
        { path: 'characters/marek.md', heading: '### Equipment', score: 0.713, line: 38 },
        { path: 'lore/weapons.md', heading: '## Curved blades — sahir', score: 0.681, line: 67 },
      ]
    }, dur: 218 },
  { kind: 'tool', name: 'read_file', args: { path: 'narrative/ch3-marek.md', range: '135-160' }, result: {
      preview: '…the cloth fell away. In his hand the curved blade caught the last\nof the lamplight — single-edged, knuckle guard hammered from a coin.\nHe did not raise it. He only let them see it…',
      bytes: 1124,
    }, dur: 41 },
  { kind: 'tool', name: 'read_file', args: { path: 'characters/marek.md' }, result: {
      preview: '---\nname: Marek of Ostavar\nage: 34\n---\n\n### Equipment\n- worn leather coat\n- wax-sealed letter\n',
      bytes: 3174,
    }, dur: 28 },
  { kind: 'tool', name: 'read_file', args: { path: 'lore/weapons.md', range: '60-90' }, result: {
      preview: '## Curved blades — sahir\nA single-edged blade common to the river\ncaravans. Knuckle-guards are typically forged from the\nmemorial coin of a fallen kin…',
      bytes: 2014,
    }, dur: 34 },
  { kind: 'assistant_thought', text: "The blade Marek draws matches a sahir from the lore. I'll add it to his Equipment list and tag the canonical reference. No prose changes." },
  { kind: 'tool', name: 'edit_file', args: { path: 'characters/marek.md' },
    diff: [
      { type: 'context', text: '### Equipment' },
      { type: 'context', text: '- worn leather coat' },
      { type: 'context', text: '- wax-sealed letter' },
      { type: 'add', text: '- sahir, knuckle-guard hammered from a memorial coin (lore/weapons.md#curved-blades)' },
      { type: 'add', text: '- first drawn: ch3 §"The bridge at dusk"' },
    ],
    awaiting_approval: true, dur: null },
];

const SOURCES = [
  { path: 'narrative/ch3-marek.md', heading: 'The bridge at dusk', score: 0.85 },
  { path: 'characters/marek.md', heading: 'Equipment', score: 0.71 },
  { path: 'lore/weapons.md', heading: 'Curved blades — sahir', score: 0.68 },
];

const SERVER_LOG_TAIL = [
  { t: '14:22:08', lvl: 'I', src: 'chat', msg: 'slot 0 released | tokens 1284 | 41.2 t/s' },
  { t: '14:22:08', lvl: 'I', src: 'chat', msg: 'kv cache: 4096 / 16384 used' },
  { t: '14:22:09', lvl: 'I', src: 'embed', msg: 'POST /embed (3 docs) 1024d → 18ms' },
  { t: '14:22:11', lvl: 'I', src: 'embed', msg: 'POST /embed (1 doc) 1024d → 14ms' },
  { t: '14:22:14', lvl: 'I', src: 'chat', msg: 'slot 0 acquired | ctx 16384' },
  { t: '14:22:14', lvl: 'I', src: 'chat', msg: 'sampling: temp=0.7 top_p=0.95 min_p=0.05' },
  { t: '14:22:15', lvl: 'W', src: 'chat', msg: 'tool-loop iteration 4/8' },
];

// Tiny inline icons. All 16x16 unless noted, stroke=1.6, currentColor.
const Icon = ({ d, size = 16, fill = 'none', sw = 1.6, vb = '0 0 16 16', children, style }) => (
  <svg width={size} height={size} viewBox={vb} fill={fill} stroke="currentColor"
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {d ? <path d={d}/> : children}
  </svg>
);

const I = {
  Chat:    (p) => <Icon {...p} d="M2.5 4.5h11v6.5h-7l-3 2.5v-2.5h-1z"/>,
  Files:   (p) => <Icon {...p}><path d="M3 2.5h5l1.5 1.5H13v8.5H3z"/></Icon>,
  Servers: (p) => <Icon {...p}><rect x="2.5" y="3" width="11" height="3.5" rx=".5"/><rect x="2.5" y="9" width="11" height="3.5" rx=".5"/><circle cx="5" cy="4.75" r=".5" fill="currentColor"/><circle cx="5" cy="10.75" r=".5" fill="currentColor"/></Icon>,
  Search:  (p) => <Icon {...p}><circle cx="7" cy="7" r="4"/><path d="M10 10l3 3"/></Icon>,
  Beaker:  (p) => <Icon {...p} d="M6 2.5v3.5L3 12.5h10L10 6V2.5M5 2.5h6"/>,
  Git:     (p) => <Icon {...p}><circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M4 5.5v5M5.5 4h5a2 2 0 012 2v.5"/></Icon>,
  Settings:(p) => <Icon {...p}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></Icon>,
  Play:    (p) => <Icon {...p} fill="currentColor" sw={0} d="M4 3l9 5-9 5z"/>,
  Stop:    (p) => <Icon {...p} fill="currentColor" sw={0}><rect x="4" y="4" width="8" height="8" rx="1"/></Icon>,
  Pause:   (p) => <Icon {...p} fill="currentColor" sw={0}><rect x="4" y="3" width="2.5" height="10"/><rect x="9.5" y="3" width="2.5" height="10"/></Icon>,
  Send:    (p) => <Icon {...p} d="M2 8l11-5-3.5 11L8 9z"/>,
  ChevR:   (p) => <Icon {...p} d="M6 3l4 5-4 5"/>,
  ChevD:   (p) => <Icon {...p} d="M3 6l5 4 5-4"/>,
  Plus:    (p) => <Icon {...p} d="M8 3v10M3 8h10"/>,
  X:       (p) => <Icon {...p} d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>,
  Folder:  (p) => <Icon {...p} d="M2 4.5l1.5-1.5h3l1 1.5H14v8H2z"/>,
  File:    (p) => <Icon {...p} d="M3.5 2.5h6l3 3v8h-9z"/>,
  Cpu:     (p) => <Icon {...p}><rect x="4" y="4" width="8" height="8" rx="1"/><rect x="6.5" y="6.5" width="3" height="3"/><path d="M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2"/></Icon>,
  Db:      (p) => <Icon {...p}><ellipse cx="8" cy="3.5" rx="5" ry="1.5"/><path d="M3 3.5v9c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5v-9M3 8c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5"/></Icon>,
  Doc:     (p) => <Icon {...p}><path d="M3.5 2.5h6l3 3v8h-9z"/><path d="M5.5 7h5M5.5 9.5h5M5.5 12h3"/></Icon>,
  Wand:    (p) => <Icon {...p} d="M3 13l8-8M9 3l1 1M11 5l1 1M5 11l1 1M13 7l1-1"/>,
  Tool:    (p) => <Icon {...p} d="M11 2.5a2.5 2.5 0 00-2.5 2.5c0 .5.1 1 .3 1.4L3 12.2l1.8 1.8 6.3-5.8c.4.2.9.3 1.4.3a2.5 2.5 0 100-5z"/>,
  Bolt:    (p) => <Icon {...p} d="M9 1.5L3 9.5h4l-1 5 6-8H8l1-5z" fill="currentColor" sw={0}/>,
  Min:     (p) => <Icon {...p} d="M3 8h10" sw={1.4}/>,
  Max:     (p) => <Icon {...p}><rect x="3.5" y="3.5" width="9" height="9" rx=".5"/></Icon>,
  Restore: (p) => <Icon {...p}><rect x="3" y="5" width="8" height="8"/><path d="M5 5V3h8v8h-2"/></Icon>,
  Close:   (p) => <Icon {...p} d="M4 4l8 8M12 4l-8 8" sw={1.4}/>,
  Dot:     ({ color = 'currentColor', size = 8 }) => <span style={{ display: 'inline-block', width: size, height: size, borderRadius: size, background: color, flex: 'none' }}/>,
  User:    (p) => <Icon {...p}><circle cx="8" cy="6" r="2.5"/><path d="M3 13.5a5 5 0 0110 0"/></Icon>,
  Bot:     (p) => <Icon {...p}><rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 3v2M5.5 8.5h.01M10.5 8.5h.01" sw={2}/><path d="M6 13l-1.5 1.5M10 13l1.5 1.5"/></Icon>,
  Sparkle: (p) => <Icon {...p} d="M8 2v4M8 10v4M2 8h4M10 8h4M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2"/>,
  Pin:     (p) => <Icon {...p} d="M10 2.5l3.5 3.5-2 2-1 4-2-2-3 3v-3l-3-2 4-1 2-2z"/>,
  Bell:    (p) => <Icon {...p} d="M4 11h8l-1-2V7a3 3 0 10-6 0v2zM6.5 13a1.5 1.5 0 003 0"/>,
  Branch:  (p) => <Icon {...p}><circle cx="4" cy="3" r="1.2"/><circle cx="4" cy="13" r="1.2"/><circle cx="12" cy="6.5" r="1.2"/><path d="M4 4.2v7.6M5 5.5h4a3 3 0 013 3v.7"/></Icon>,
  Edit:    (p) => <Icon {...p} d="M3 13l2.5-.5L13 5l-2-2-7.5 7.5z M9.5 4.5l2 2"/>,
  Refresh: (p) => <Icon {...p} d="M3 8a5 5 0 018.5-3.5L13 6 M13 8a5 5 0 01-8.5 3.5L3 10 M11 3v3h-3 M5 13v-3h3"/>,
  Copy:    (p) => <Icon {...p}><rect x="5" y="5" width="8" height="9" rx="1"/><path d="M3 11V3.5a.5.5 0 01.5-.5H10"/></Icon>,
};

// Expanded server fixtures used by the Servers dashboard.
const SERVERS = [
  { id: 'qwen-32b-cuda-prod', kind: 'chat', model: 'Qwen2.5-32B-Instruct', quant: 'Q5_K_M', size: '23.1 GB',
    port: 18080, host: '127.0.0.1', status: 'running', vram: 22.4, vramCap: 24.0, ramMb: 1840,
    ctxUsed: 4128, ctxMax: 16384, slots: '1/4', tps: 41.2, reqs: 287, uptime: '4h 22m', gpu: 'CUDA:0',
    cmd: 'llama-server -m models/qwen2.5-32b.Q5_K_M.gguf -c 16384 -ngl 99 --port 18080',
    spark: [38.1, 37.4, 41.0, 39.6, 42.8, 40.9, 41.2, 43.0, 41.8, 41.2, 39.9, 41.2, 40.8, 41.5, 41.2],
    cpu: 18, selected: true,
  },
  { id: 'embed-user-bge-m3', kind: 'embed', model: 'USER-bge-m3', quant: 'F16', size: '1.1 GB',
    port: 18081, host: '127.0.0.1', status: 'running', vram: 1.1, vramCap: 24.0, ramMb: 320,
    ctxUsed: 0, ctxMax: 8192, slots: '1/8', tps: null, reqs: 1842, uptime: '4h 22m', gpu: 'CUDA:0',
    cmd: 'llama-server -m models/user-bge-m3.gguf --embedding --port 18081',
    spark: [3,5,4,8,7,6,9,12,8,5,7,4,3,4,5], cpu: 4,
  },
  { id: 'rerank-bge-v2-m3', kind: 'rerank', model: 'bge-reranker-v2-m3', quant: 'Q8_0', size: '0.6 GB',
    port: 18082, host: '127.0.0.1', status: 'idle', vram: 0.6, vramCap: 24.0, ramMb: 220,
    ctxUsed: 0, ctxMax: 4096, slots: '0/4', tps: null, reqs: 41, uptime: '34m', gpu: 'CUDA:0',
    cmd: 'llama-server -m models/bge-reranker-v2-m3.Q8_0.gguf --reranking --port 18082',
    spark: Array(15).fill(0), cpu: 0,
  },
  { id: 'mistral-small-cpu', kind: 'chat', model: 'Mistral-Small-22B', quant: 'Q4_K_M', size: '13.4 GB',
    port: 18083, host: '127.0.0.1', status: 'stopped', vram: 0, vramCap: 24.0, ramMb: 0,
    ctxUsed: 0, ctxMax: 8192, slots: '0/2', tps: null, reqs: 0, uptime: '—', gpu: 'CPU',
    cmd: 'llama-server -m models/mistral-small-22b.Q4_K_M.gguf -ngl 0 --port 18083 -t 12',
    spark: Array(15).fill(0), cpu: 0,
  },
  { id: 'qwen-coder-7b-dev', kind: 'chat', model: 'Qwen2.5-Coder-7B', quant: 'Q6_K', size: '5.8 GB',
    port: 18084, host: '127.0.0.1', status: 'crashed', vram: 0, vramCap: 24.0, ramMb: 0,
    ctxUsed: 0, ctxMax: 32768, slots: '0/2', tps: null, reqs: 0, uptime: '—', gpu: 'CUDA:0',
    cmd: 'llama-server -m models/qwen2.5-coder-7b.Q6_K.gguf -c 32768 --port 18084',
    spark: Array(15).fill(0), cpu: 0, error: 'CUDA OOM @ 18:42 — try -ngl 35 or smaller ctx',
  },
];

Object.assign(window, { MODES, MODE_BY_ID, SESSIONS, FILE_TREE, PROFILES, SERVERS, TOOL_LOG, SOURCES, SERVER_LOG_TAIL, I, Icon });
