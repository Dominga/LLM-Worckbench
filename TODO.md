# TODO — Milestone 1 + V5 Loom shell

План реализации M1 (DESIGN.md §9) поверх V5-мокапа (`Design/llm-workshop/project/v5-loom.jsx`, `v5-servers.jsx`). Текущая база: M0 spike (single `.env` profile, single CodeMirror, чат без сессий).

## Scope: V5 vs M1

| V5 элемент | M1? | Решение |
|---|---|---|
| Tabs: Chat, Servers | да | реализуем |
| Tabs: Project, Prompt Lab, Runs | нет | tab-stub disabled, серые иконки |
| Sidebar Sessions / Files / Servers | да | три pane |
| Mode picker pill | metadata only | id+цвет в session, picker disabled (агент → M3) |
| Tool log (search/read/edit) | нет | placeholder; чат plain user/assistant |
| Diff/Edit/Preview split | Edit+Preview да, Diff нет | "Diff" tab скрыт (staged-edits → M3) |
| Sources chips, Approval, Snapshot | нет | прячем |
| Servers dashboard (master+detail+logs+config+metrics) | да | logs/config работают, metrics — basic |
| KPI strip (VRAM/RAM/throughput/req) | partial | VRAM/throughput из llama-server `/health`/`/metrics`; req — counter в supervisor |
| Embed/Rerank kinds | profile-kind enum (DESIGN §4.4); запускать chat по умолчанию | embed допустим, rerank → M2 |

## Backend — Go layer

### Phase B1 — Domain types + persistence

Новые файлы (`llm-workbench/internal/` или плоско):

- `profile.go` — `Profile{ID, Kind (chat|embed|rerank), Bin, ModelPath, Host, Port, ExtraArgs[], CtxSize, NGL, Sampling{Temp,TopP,MinP,RepeatPenalty}, Autostart}`. Хранение: `~/.config/llm-workbench/profiles.toml`. Валидация: уникальный port, существование bin/model.
- `project.go` — `Project{ID, Path, Name, CreatedAt, LastOpened}`. Реестр: `~/.config/llm-workbench/projects.toml`. Per-project: `<root>/project.toml` + `<root>/.llm-workbench/`. `git init` если нет `.git`. `.gitignore` исключает `.llm-workbench/state/`.
- `session.go` — `Session{ID, ProjectID, Title, ModeID, ProfileID, CreatedAt, UpdatedAt}` + messages. JSONL: `<project>/.llm-workbench/sessions/<id>.jsonl` (DESIGN §7.2). Header line + per-message line.
- `mode.go` — статичный реестр builtin режимов (id, name, color, desc). Без выполнения. Frontend читает через `ListModes()`.

### Phase B2 — Services (рефактор существующих)

- `ProfileManager` — `List() / Get(id) / Create / Update / Delete`. Заменяет чтение `.env` в `config.go`. `.env` остаётся как одноразовый seed для миграции.
- `ServerSupervisor` (рефактор `supervisor.go`). Single instance → `map[profileID]*ServerInstance`. Каждый instance: своя cmd, log buffer, health-poll loop, tps counter (парсить `slot N released | tokens X | Y t/s` из stderr). Events: `llama:status:<profileID>`, `llama:log:<profileID>`, `llama:metrics:<profileID>` (vram через `/health` или `nvidia-smi --query-gpu=memory.used`).
- `ProjectService` — открыть/создать проект. Wrapper для file ops. M1 редактирование руками юзера через CodeMirror = `WriteFile(projectID, relPath, content)` с проверкой path clean+inside root. Snapshot — отложен или `git add -A && git commit -m "snapshot"` minimal.
- `SessionService` — CRUD сессий, append messages, стрим через `chat.go`. `ChatStream(streamID, prompt)` → `ChatStream(sessionID, prompt)`; service подгружает историю и шлёт `messages[]` в `/v1/chat/completions`.
- `FileService` — `ListTree(projectID)` (рекурсивно size+mtime, dotfiles фильтр), `ReadFile`, `WriteFile`. Dirty-флаг = mtime vs in-memory open buffer.

### Phase B3 — App bindings

Заменить узкий M0 API:

```
ListProfiles / SaveProfile / DeleteProfile
StartProfile(id) / StopProfile(id) / RestartProfile(id) / ProfileStatus(id) / ProfileMetrics(id)
ListProjects / OpenProject(path) / CreateProject(path, name) / CurrentProject()
ListFiles(projectID) / ReadFile / WriteFile
ListSessions(projectID) / CreateSession(projectID, modeID, profileID) / RenameSession / DeleteSession / GetSession(id)
ChatStream(sessionID, userText) / ChatCancel(streamID)
ListModes()
```

После — `wails generate module` (CLAUDE.md).

## Frontend — V5 shell

### Phase F1 — Mantine theme + V5 палитра

`App.tsx` → тёмная тема, V5-палитра (см. mockup `V5` const). `MantineProvider` + `theme={createTheme({ colors: { brand: [...синий 50-900...] }, defaultRadius: 'sm' })}`. Цели: сетка/цвета/spacing, не pixel-perfect.

### Phase F2 — Shell layout

Новый `frontend/src/shell/`:
- `TitleBar.tsx` — 44px, brand bolt + tabs + статусы (vram/tps live из bindings) + project chip + window controls (Wails `WindowMinimise/Maximise/Hide`).
- `Sidebar.tsx` 280px — segmented (Sessions/Files/Servers), Search input, `+` action. Состояние сегмента в `useLocalStorage`.
- `MainPane.tsx` — switch по tab: `<ChatTab>` / `<ServersTab>`. Project/Lab/Runs disabled (`opacity 0.4 cursor:not-allowed`).

### Phase F3 — Sessions pane

- `SessionList` — группировка по дате (Today/Earlier/<week>), карточки `V5SessionCard`.
- New session — модалка: profile picker (только running chat-kind) + mode picker (read-only из `ListModes`).
- Click → set активную, chat-tab подгружает.

### Phase F4 — Files pane

- `FileTree` — рекурсивный, expand/collapse в `useState`, persist в localStorage by projectID.
- Click файла → открыть в правой панели (Edit/Preview), обновить `active`.
- Dirty marker по unsaved-buffer в Editor.

### Phase F5 — Servers pane (sidebar mini-cards)

- Список профилей — карточка с dot/kind chip/model/port/vram/tps + Start/Stop. Поллинг `ProfileMetrics(id)` каждые 2s через event `llama:metrics:*`.

### Phase F6 — Chat tab

- Header: title (editable inline), Snapshot (M1 hidden/disabled), mode pill (read-only), profile chip, ctx counter (приблизительно от истории).
- Message list: `user` справа, `assistant` слева с Sparkle-аватаром. Markdown через `render.go` (server-side, per memory `feedback_render_pipeline`).
- Tool log entries — скрыты в M1.
- Input: textarea + mode pill (disabled) + Send (`Cmd/Ctrl+Enter`). Без "9 tools / Approval".
- Streaming через существующий `chat:delta:<id>`; delta append-only в DOM (no per-token React re-render).

### Phase F7 — Right pane (Edit/Preview)

- Tabs: **Diff (hidden M1) / Edit / Preview**. Default Preview; segmented control.
- Edit = `Editor.tsx` (CodeMirror 6, markdown, append-stream API сохранить → M3).
- Preview = `Preview.tsx`, HTML из `RenderMarkdown(content)` (`render.go` уже есть).
- Footer: dirty + Save/Revert. Auto-save debounce 1s (опц).

### Phase F8 — Servers tab (full screen)

`V5ServersScreen` 1:1:
- Header + KPI strip (VRAM total по running, RAM, throughput, requests).
- Filter row: All/Chat/Embed/Rerank.
- Master list — карточки из `ListProfiles()` + live metrics.
- Detail: Logs / Config / Metrics. Logs = ring-buffer (1000 last lines) per profile via event sub. Config = read-only launch cmd + sampling. Metrics = bars + sparkline.
- New/Edit profile — Mantine модалка (`TextInput`, `NumberInput`, `FileButton`). Validation client+server.

## Persistence + миграция

- M0 `.env` → on first launch, если `profiles.toml` нет, создать профиль `m0-default` из `.env`. Пометить `.env` deprecated в README, не удалять.
- Sessions JSONL (DESIGN §7.2):
  ```
  {"v":1,"sessionId":...,"projectId":...,"modeId":...,"profileId":...,"createdAt":...}
  {"role":"user","content":"...","ts":...}
  {"role":"assistant","content":"...","ts":...,"profileId":...}
  ```

## Порядок работ (PR-по-PR)

- [x] **PR1** — Domain types + ProfileManager + миграция .env → toml. ✓
- [x] **PR2** — Multi-instance ServerSupervisor + per-profile events + TPS counter + frontend wiring. ✓
- [x] **PR3** — ProjectService + projects.toml + per-project `.llm-workshop/` + git init. Files pane + project menu. Polling 3s. ✓
- [x] **PR4** — SessionService + JSONL persistence. Sessions pane (group Today/This week/Earlier). Session-bound chat: history loaded, user/assistant messages auto-persisted. Mode picker → UpdateSessionMode. ✓
- [x] **PR5** — V5 shell: TitleBar + Sidebar + MainPane (F1+F2 в одном цикле). ✓
- [x] **PR6** — Edit pane: dirty tracking, Save/Revert footer, auto-save 1s debounce, ⌘S/Ctrl+S shortcut. ✓
- [ ] **PR7** — Servers tab (KPI + master/detail). Logs + config view.
- [x] **PR8** — Profile create/edit/delete modal (Mantine form + path pickers). Validation client+server. ✓

## Принятые решения

1. **Storage layout**:
   - Глобальный реестр (профили, список проектов): `~/.config/llm-workbench/` (XDG).
   - Per-project state (sessions JSONL, sqlite-vec индекс будущего M2, кэш): `<projectRoot>/.llm-workshop/`. Папка добавляется в `.gitignore`.
2. **File watcher** — без `fsnotify`. Polling раз в 2-3 секунды (refresh tree on tick + on user action). Меньше нюансов, кросс-платформенно, для дизайн-целей достаточно.
3. **Snapshot button** — прячем в M1 (git wrap → M3 вместе с агентным циклом).
4. **Embed-профиль** — поддерживается как часть управления llama.cpp серверами. Use-cases: (a) запуск двух инстансов параллельно для отладки, (b) флаг `--embedding` для одного инстанса. UI: kind=embed виден в Servers tab, метрики (latency вместо t/s), без RAG-consumer (consumer → M2).
5. **Mode picker** — демо-вариант: dropdown открывается, выбор пишется в session metadata, но на промпт не влияет (system prompt = пустой, агент-цикла нет). Готовая UI основа под M3.
