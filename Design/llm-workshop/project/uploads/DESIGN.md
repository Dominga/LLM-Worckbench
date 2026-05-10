# Local LLM Workbench — Design Document

**Статус:** черновик v0.2
**Платформы:** Windows, Linux (Debian 13 / KDE), позже — macOS
**Лицензия:** MIT
**Назначение:** персональный инструмент для работы с локальными LLM — оркестрация
llama.cpp серверов, проектная работа с нарративом и геймдизайном, агентный
редактор, эксперименты с промптами.

---

## 1. Назначение и контекст

### 1.1. Что это

Desktop-приложение, расширяющее идею LM Studio в сторону production-grade
рабочей среды для:

1. **Управления локальной инфраструктурой LLM** — запуск, конфигурация и
   мониторинг нескольких процессов `llama-server` параллельно (генеративная
   модель + embedding-модель + reranker), включая управление форками и
   автоматизированную сборку.
2. **Проектной работы с текстовым контентом** — markdown-проекты с локальным
   RAG-поиском, версионированием через git под капотом, шарингом через файлы.
3. **Агентного редактирования** — режимы работы для нарратива, геймдизайна,
   диалогового письма (SillyTavern-style), с tool-loop'ом, доступом к файлам
   проекта и семантическим поиском.
4. **Скриптовой автоматизации** — эксперименты с промптами, batch-генерация,
   workflow поверх локальных моделей.

### 1.2. Аудитория

Один пользователь (single-user). Multi-user explicitly out of scope.
Шаринг — через файловую систему (git-friendly project layout).

### 1.3. Не-цели

- Cloud-функциональность, синхронизация, multi-tenant.
- Замена IDE для кода — фокус на нарративе и markdown-контенте.
- Production-deployment моделей (это не сервер для команды).
- Поддержка моделей не через `llama-server` (нет ollama, vLLM, exllamav2 и т.д.
  на v1; абстракция позволит добавить позже).

---

## 2. Технологический стек

### 2.1. Основной язык и UI

**Go 1.22+ с Wails v2** для desktop-приложения.

Обоснование:

- Управление процессами (`os/exec` + goroutines + channels) — естественно
  ложится на оркестрацию llama.cpp серверов и стриминг SSE.
- Wails использует системный WebView (WebView2 / WKWebView / WebKitGTK) →
  бинарник 10–20 МБ, без таскания Chromium.
- JS-фронтенд даёт доступ к зрелой экосистеме редакторов (CodeMirror 6).
- Один `go build` для каждой платформы, без отдельной упаковки runtime.

**Frontend:** TypeScript + React + **Mantine v7** в качестве компонентной
библиотеки. Обоснование: проект — multi-panel workspace с большим
количеством форм (профили, build recipes, mode definitions, sampler
overrides, indexing settings) и табличного UI; Mantine из коробки
покрывает 90% этого набора (Form, MultiSelect, NumberInput, Tabs,
Drawer, Modal, Notifications), что экономит существенное время на
этапе MVP. Tailwind не используется — стили через Mantine theme +
emotion (его внутренний CSS-in-JS) для консистентности.

**Редактор markdown:** CodeMirror 6 с Lezer-парсером. Обоснование: проект —
text-heavy с упором на просмотр и редактирование markdown, CodeMirror 6 даёт
отличную производительность на больших документах, гибкую кастомизацию,
зрелый markdown-режим.

### 2.2. Хранилище

- **SQLite + sqlite-vec** — один файл базы на проект. Содержит индекс RAG,
  метаданные чанков, историю сессий чата, кэш эмбеддингов. Драйвер:
  `modernc.org/sqlite` (pure Go) либо `mattn/go-sqlite3` (CGo, нативные
  расширения проще). Финализировать после прототипа sqlite-vec интеграции.
- **Файлы проекта на диске** — `.md`, изображения, `project.toml`, конфиги
  режимов. Это primary source of truth, а не БД.
- **TOML** — для всей конфигурации, доступной пользователю (профили,
  рецепты сборки, режимы агента, project.toml). Git-friendly, диффится,
  читается человеком.

### 2.3. Версионирование

- **Git под капотом** через `go-git` (pure Go) или вызовы системного git.
  Проект инициализируется как git-репозиторий автоматически.
- Snapshot-коммиты делаются автоматически перед деструктивными операциями
  (агентские массовые правки, batch-скрипты).
- Пользовательский UX остаётся папочным (Ideas/, Drafts/, Old Versions/) —
  git это не заменяет, а дополняет.

### 2.4. Скриптовый слой

- **Embedded JavaScript через goja** — для inline-скриптов (Prompt Lab,
  определения режимов, кастомные tools агента, workflow-автоматизация).
  Pure Go, без внешнего runtime'а.
- **External Python через subprocess** — для ML-специфичных задач (TTS,
  Whisper, OCR, document parsing). Не зависимость для запуска приложения,
  а дополнительные tools, которые регистрируются и запускаются по
  необходимости.

### 2.5. Embedding и RAG модели

- **Generative LLM**: пользовательский выбор, любая GGUF-модель.
- **Embeddings (default)**: `deepvk/USER-bge-m3` (BGE-M3, дообученная на
  русском). 1024d, контекст 8192, без префиксов. CLS-pooling.
- **Reranker (optional)**: `BAAI/bge-reranker-v2-m3`, мультиязычный.
- **Альтернативы (профили)**: Qwen3-Embedding-0.6B/4B/8B, оригинальная
  BGE-M3, nomic-embed-text-v1.5 (если содержимое преимущественно
  английское).

Embedding-модель — это **профиль того же типа, что генеративная**, не зашитая
константа. Индексы версионируются по `(model_id, dim)`.

---

## 3. Высокоуровневая архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (TypeScript + React/Svelte + CodeMirror 6)         │
│  ├─ Workspace shell (sidebar, tabs, panels)                  │
│  ├─ Editor (markdown view/edit)                              │
│  ├─ Chat panel (streaming, tool calls, sources)              │
│  ├─ Profile/Server manager UI                                │
│  ├─ Prompt Lab (script editor + run/output)                  │
│  └─ Project explorer (files, git history, snapshots)         │
├─────────────────────────────────────────────────────────────┤
│  Wails bindings (autogenerated TS ↔ Go)                      │
├─────────────────────────────────────────────────────────────┤
│  Application services (Go)                                   │
│  ├─ ProfileManager      — TOML configs, builds, models       │
│  ├─ ServerSupervisor    — multiple llama-server processes    │
│  ├─ ProjectService      — FS sandbox, git ops, watcher       │
│  ├─ ChatService         — sessions, streaming, tool routing  │
│  ├─ AgentRuntime        — modes, tool-loop, system prompts   │
│  ├─ RagService          — chunking, embedding, retrieval     │
│  ├─ ScriptingService    — goja runtime + API bindings        │
│  ├─ WorkflowEngine      — triggers, pipelines, batch         │
│  └─ BuildOrchestrator   — git clone/pull, cmake, packaging   │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure (Go)                                         │
│  ├─ LlamaCppClient      — HTTP + SSE streaming               │
│  ├─ ProcessHost         — subprocess lifecycle, log capture  │
│  ├─ VectorStore         — SQLite + sqlite-vec wrapper        │
│  ├─ FileIndexer         — fs watcher, chunker, hashing       │
│  └─ GitWorker           — go-git or system git wrapper       │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
External processes:
  - llama-server (one or more instances: chat, embed, rerank)
  - Python sidecars (optional: TTS, Whisper, OCR — on demand)
```

### 3.1. Принципы

- **Single-process GUI на v1.** Headless daemon — расширение, не основа.
  Все application services отделены интерфейсами, чтобы потом вытащить.
- **File system как primary store.** SQLite — для того, что часто меняется
  (индекс, история чата, кэш). Конфиги и контент — в файлах.
- **Все file-операции агента — через ProjectService.** Песочница в пределах
  project root, аудит, возможность virtual FS позже.
- **Внешние процессы — через стабильный контракт** (HTTP / argv+stdout JSON).
  Никакого CGo-вшивания llama.cpp или Python.

---

## 4. Доменные понятия

Чёткое разделение этих концептов критично — они меняются независимо.

### 4.1. Build

Конкретный собранный бинарник `llama-server` из конкретного форка.

```toml
[build."llama-mainline-cuda12"]
source_repo = "https://github.com/ggml-org/llama.cpp"
commit = "a1b2c3d"          # фактический закоммиченный snapshot
backend = "cuda12"           # cuda11 / cuda12 / rocm / vulkan / metal / cpu
binary_path = "~/.local/llm-workbench/builds/llama-mainline-cuda12/llama-server"
build_recipe_id = "cuda12-default"
capabilities = ["chat", "embed", "rerank", "mmproj"]
built_at = "2026-05-08T12:34:56Z"
```

### 4.2. BuildRecipe

Декларативное описание того, как собирать сборку.

```toml
[recipe."cuda12-default"]
cmake_flags = ["-DGGML_CUDA=ON", "-DGGML_CUDA_FA_ALL_QUANTS=ON"]
post_build = []
```

`BuildOrchestrator` использует `BuildRecipe` + git ref → создаёт `Build`.

### 4.3. ModelBundle

Модель или связка модель+аксессуары.

```toml
[model."qwen-2.5-32b-instruct-q5"]
type = "chat"                # chat / embed / rerank
gguf_path = "~/models/qwen2.5-32b-instruct-q5_k_m.gguf"
mmproj_path = ""             # для vision-моделей
draft_model = ""             # для speculative decoding
context_max = 32768
chat_template = "auto"       # auto / explicit string
recommended_sampler = { temperature = 0.7, top_p = 0.95, min_p = 0.05 }
```

### 4.4. Profile

`Profile = Build × ModelBundle × RuntimeArgs`. Это то, что запускается.

```toml
[profile."qwen-32b-cuda-prod"]
build_id = "llama-mainline-cuda12"
model_id = "qwen-2.5-32b-instruct-q5"
endpoints = ["chat"]
host = "127.0.0.1"
port = 18080
[profile."qwen-32b-cuda-prod".args]
ctx_size = 16384
n_gpu_layers = 99
parallel = 2
cont_batching = true
flash_attn = true
cache_type_k = "q8_0"
cache_type_v = "q8_0"

[profile."embed-user-bge-m3"]
build_id = "llama-mainline-cuda12"
model_id = "user-bge-m3"
endpoints = ["embed"]
host = "127.0.0.1"
port = 18081
[profile."embed-user-bge-m3".args]
embeddings = true
pooling = "cls"           # критично для BGE-style моделей
ctx_size = 8192
n_gpu_layers = 99
```

Профили активируются параллельно — у проекта может быть «текущий chat»,
«текущий embed», «текущий rerank».

### 4.5. Project

Директория с:

```
my-game/
├── project.toml          # метаданные, активные профили, режимы
├── .git/                 # автоматический git
├── index.db              # SQLite + sqlite-vec
├── chats/                # JSONL сессии
│   └── 2026-05-08-narrative-session.jsonl
├── modes/                # пользовательские override'ы режимов
│   └── my-narrative-mode.toml
├── scripts/              # JS-скрипты пользователя
│   └── generate-tts-prompts.js
├── narrative/
├── characters/
├── lore/
├── ideas/
├── drafts/
└── illustrations/
```

`project.toml`:

```toml
[project]
name = "Crimson Tide"
created_at = "2026-05-08T10:00:00Z"
default_chat_profile = "qwen-32b-cuda-prod"
default_embed_profile = "embed-user-bge-m3"
default_rerank_profile = "rerank-bge-v2-m3"
default_mode = "narrative-coauthor"

[indexing]
include = ["narrative/**/*.md", "characters/**/*.md", "lore/**/*.md"]
exclude = ["drafts/**", "ideas/scratch/**"]
chunk_size = 512
chunk_overlap = 64
```

### 4.6. Mode

Декларативное описание режима работы агента — system prompt, доступные tools,
структура контекста.

```toml
[mode."narrative-coauthor"]
display_name = "Narrative Co-Author"
description = "Помощник для работы над сюжетом, сценами, персонажами"
system_prompt_template = "modes/narrative-coauthor.system.md"
tools = ["read_file", "search_files", "search_semantic", "list_dir",
         "get_outline", "edit_file"]
context_strategy = "outline+recent+rag"   # ключ к ContextBuilder

[mode."dialogue-writer"]
display_name = "Dialogue Writer"
system_prompt_template = "modes/dialogue-writer.system.md"
tools = ["read_file", "get_character_card", "update_character_card",
         "search_semantic"]
context_strategy = "character-cards+scene+history"

[mode."game-designer"]
display_name = "Game Designer"
system_prompt_template = "modes/game-designer.system.md"
tools = ["read_file", "write_file", "search_files", "search_semantic",
         "list_dir"]
context_strategy = "full-rag"
```

`tools` — whitelist по именам зарегистрированных инструментов.
Mode-файлы — как built-in (внутри бинаря, дефолтные), так и project-local
(`modes/`, переопределяют built-in по id).

### 4.7. Tool

Именованный инструмент, доступный агенту в режиме tool-loop'а.
Описание включает JSON Schema для входов/выходов и реализацию (Go-функция или
JS-скрипт).

Built-in tools (минимальный набор v1):

| Tool                  | Назначение                                            |
|-----------------------|-------------------------------------------------------|
| `read_file`           | Прочитать файл проекта (sandbox)                      |
| `write_file`          | Записать/перезаписать файл                            |
| `edit_file`           | Применить unified diff (атомарно, через snapshot)     |
| `list_dir`            | Список файлов в директории                            |
| `search_files`        | Lexical search по именам и содержимому (FTS5)         |
| `search_semantic`     | RAG-поиск по проекту                                  |
| `get_outline`         | Структура (заголовки) markdown-файла или дерева       |
| `get_character_card`  | Чтение character-card по id                           |
| `update_character_card` | Изменение character-card                            |

User-defined tools — JS-функции через ScriptingService.

---

## 5. Функциональные требования

### 5.1. Управление инфраструктурой llama.cpp

**FR-LLM-1.** Управление множеством Build'ов разных форков параллельно.
**FR-LLM-2.** Автоматическая сборка по `BuildRecipe`: `git clone/pull` →
`cmake -B build [...]` → `cmake --build build` со стримингом stdout/stderr
в UI и записью в build-log.
**FR-LLM-3.** Детект GPU при первом запуске (`nvidia-smi`, `rocminfo`,
`vulkaninfo`, `system_profiler` на macOS) → дефолтные `BuildRecipe`.
**FR-LLM-4.** ServerSupervisor запускает несколько llama-server одновременно
на разных портах. Health-check каждого через `/health`.
**FR-LLM-5.** Автостарт нужных профилей при открытии проекта. Остановка
при закрытии (с опцией keep-alive для долгих фоновых сессий).
**FR-LLM-6.** UI показывает живые логи каждого процесса, RAM/VRAM
утилизацию (если доступно через nvidia-smi), token throughput из
`/metrics` endpoint.
**FR-LLM-7.** Hot-swap модели в рамках одного профиля: остановить процесс,
изменить args, запустить. Активные чат-сессии gracefully переподключаются.
**FR-LLM-8.** Support для multimodal (mmproj), embeddings, rerank через
правильные endpoints и флаги.

### 5.2. Управление проектами и файлами

**FR-PRJ-1.** Создание проекта: выбрать директорию → инициализация
`project.toml` + `.git` + `index.db` + дефолтная структура папок.
**FR-PRJ-2.** Открытие существующего проекта: валидация `project.toml`,
проверка целостности `index.db`, при необходимости — переиндексация.
**FR-PRJ-3.** File watcher (через `fsnotify`) с fallback на polling
(для случаев исчерпания inotify-лимитов на Linux). Изменения файлов →
incremental re-indexing.
**FR-PRJ-4.** Auto-snapshot перед агентскими массовыми правками
(`commit -m "pre-agent: <mode>: <task summary>"`). UI «Восстановить
до снапшота» для отката.
**FR-PRJ-5.** История файла: показать git log конкретного `.md`,
diff между версиями, blame.
**FR-PRJ-6.** Импорт SillyTavern character cards (V2 формат, JSON в PNG)
→ markdown с frontmatter в `characters/`.
**FR-PRJ-7.** Опциональная привязка проекта к remote git
(сам пользователь решает; приложение не обязывает).

### 5.3. Чат и агентный редактор

**FR-AGT-1.** Чат-сессия с потоковым ответом (SSE из llama-server →
goroutine → Wails event → редактор).
**FR-AGT-2.** Tool-loop: модель возвращает tool-call → ScriptingService
или Go-handler выполняет → результат подаётся в следующий шаг → пока модель
не вернёт финальный ответ. Лимиты: max iterations, max wall time, max
tokens per iteration.
**FR-AGT-3.** Поддержка форматов tool-calling: OpenAI-compatible
function calling (нативный llama-server в свежих версиях), Hermes,
Qwen, Llama 3.x. Парсер выбирается по chat_template модели или явно
в профиле.
**FR-AGT-4.** Переключение режима внутри одной сессии (с пересборкой
контекста соответствующим `context_strategy`).
**FR-AGT-5.** Отображение source attribution: какие файлы агент читал,
какие правил, какие чанки RAG-а попали в контекст.
**FR-AGT-6.** Manual approval gate для destructive tools (`write_file`,
`edit_file`) — настраивается в настройках режима.
**FR-AGT-7.** Сохранение сессий в `chats/*.jsonl` с полным trace'ом:
сообщения, tool-calls, token-counts, времена, использованный профиль.

### 5.4. RAG

**FR-RAG-1.** Индексация по правилам `[indexing]` в project.toml.
Chunker — recursive splitter с overlap'ом, по умолчанию 512/64 токенов;
markdown-aware (учитывает заголовки и параграфы как natural boundary).
**FR-RAG-2.** Hashing чанков (SHA-256 от содержимого) для idempotent
re-indexing: пересчитываются только изменённые чанки.
**FR-RAG-3.** Hybrid retrieval: dense (vector via sqlite-vec) + sparse
(BM25 via SQLite FTS5), объединение через RRF (Reciprocal Rank Fusion).
**FR-RAG-4.** Optional reranking top-N через bge-reranker-v2-m3.
Pipeline: query → dense + BM25 → top-50 → rerank → top-K в контекст.
**FR-RAG-5.** Версионирование индекса по `(model_id, dim)`. Смена
embedding-профиля → создание нового индекса (или переиспользование, если
параметры совпадают).
**FR-RAG-6.** Полнотекстовый чанк хранится в БД отдельно от вектора,
чтобы пересчитывать эмбеддинги без перечитывания исходных файлов.

### 5.5. Скриптовый слой и Prompt Lab

**FR-SCR-1.** Inline JavaScript runtime (goja). Глобальный объект `app`
с биндингами: `app.llm`, `app.project`, `app.fs`, `app.rag`,
`app.chat`, `app.log`. Async через Promise.
**FR-SCR-2.** Prompt Lab UI: editor (CodeMirror) + Run + output. Сохранение
скриптов в `scripts/`. Параметризация через input-форму, генерируемую из
JSDoc-аннотаций или явного schema-объекта.
**FR-SCR-3.** Workflow definitions в TOML: trigger (manual / file change /
schedule) → steps (`llm.chat`, `script`, `subprocess`) → output paths.
**FR-SCR-4.** Внешние Python-tools регистрируются как `[external_tool.*]`
в global config: путь к интерпретатору, путь к скрипту, contract
(argv / stdin-json / http). Доступны из JS как `app.tools.run("xtts",
{...})`.
**FR-SCR-5.** API скриптового слоя версионируется. Каждый скрипт может
объявить `requireApi("1.0")` в первой строке.

---

## 6. Нефункциональные требования

### 6.1. Производительность

- Открытие проекта со 100k чанков — < 3 сек до интерактивности.
- Стриминг токенов от llama-server в редактор — без видимых задержек
  (latency Wails-event → DOM update < 16ms на token).
- Incremental re-index при сохранении одного `.md` файла — < 500 мс.

### 6.2. Надёжность

- Crash llama-server не должен ронять приложение. Supervisor рестартит с
  exponential backoff, UI показывает статус.
- Все file writes агента — через temp-file + atomic rename.
- Pre-agent git snapshot обязателен для destructive operations.

### 6.3. Безопасность

- Tool-loop работает в file sandbox, ограниченный project root.
  Path traversal (`../../etc/passwd`) блокируется в ProjectService.
- User-defined JS-скрипты в goja: ограничения по wall time, memory,
  отсутствие доступа к Node API. Goja по дефолту изолирован — это плюс.
- External tools (Python sidecars) запускаются с явными аргументами,
  без shell-interpolation от пользовательских данных.

### 6.4. Поддерживаемость

- Логирование structured (slog в Go), лог-файлы в `~/.local/share/llm-workbench/logs/`.
- Каждая внешняя интеграция (llama.cpp, git, python tool) — за интерфейсом
  с моками для тестов.

### 6.5. Дистрибуция

- Windows: одиночный `.exe` (от Wails) + установщик через NSIS или
  Inno Setup.
- Linux: `.AppImage` или `.deb` для Debian-based.
- macOS (future): `.dmg`, нотаризация — отдельная задача.
- Update mechanism: на v1 — manual (новая версия → перезапуск). Auto-update —
  потенциально через go-selfupdate, но не v1.

---

## 7. Модель данных

### 7.1. SQLite schema (упрощённо)

```sql
-- проектные метаданные
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- файлы проекта (отслеживаемые)
CREATE TABLE files (
    id           INTEGER PRIMARY KEY,
    rel_path     TEXT UNIQUE NOT NULL,
    content_hash TEXT NOT NULL,
    size_bytes   INTEGER,
    indexed_at   INTEGER,            -- unix timestamp
    git_blob_sha TEXT
);

-- чанки
CREATE TABLE chunks (
    id           INTEGER PRIMARY KEY,
    file_id      INTEGER REFERENCES files(id) ON DELETE CASCADE,
    ord          INTEGER,            -- порядковый номер в файле
    text         TEXT NOT NULL,
    text_hash    TEXT NOT NULL,
    start_byte   INTEGER,
    end_byte     INTEGER,
    heading_path TEXT                -- "## Chapter 3 > ### Scene 2" для контекста
);
CREATE INDEX idx_chunks_file ON chunks(file_id);
CREATE UNIQUE INDEX idx_chunks_text_hash ON chunks(text_hash);

-- эмбеддинги (один индекс на пару model+dim)
-- vec0 — virtual table от sqlite-vec
CREATE VIRTUAL TABLE embeddings_user_bge_m3_1024 USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding FLOAT[1024]
);

-- BM25 индекс
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,
    heading_path,
    content='chunks',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

-- сессии чата (легковесная shadow-таблица; primary store — JSONL в chats/)
CREATE TABLE chat_sessions (
    id           TEXT PRIMARY KEY,   -- uuid
    title        TEXT,
    mode_id      TEXT,
    profile_id   TEXT,
    created_at   INTEGER,
    updated_at   INTEGER,
    file_path    TEXT                -- относительно project root
);
```

### 7.2. JSONL формат сессии чата

Один файл = одна сессия. Каждая строка — событие:

```jsonl
{"t":"session_start","id":"...","mode":"narrative-coauthor","profile":"qwen-32b-cuda-prod","ts":"..."}
{"t":"user_message","content":"...","ts":"..."}
{"t":"assistant_token_stream","stream_id":"s1","delta":"...","ts":"..."}
{"t":"tool_call","stream_id":"s1","tool":"read_file","args":{"path":"narrative/ch1.md"},"ts":"..."}
{"t":"tool_result","stream_id":"s1","tool":"read_file","ok":true,"summary":"3.4 KB read","ts":"..."}
{"t":"assistant_message","stream_id":"s1","content":"...","tokens_in":1234,"tokens_out":567,"ts":"..."}
{"t":"sources","stream_id":"s1","files":["narrative/ch1.md"],"chunks":[{"file_id":3,"chunk_id":42,"score":0.81}]}
```

JSONL — append-only, легко резюмировать после крэша, легко диффить.

---

## 8. Скриптовый API (черновик v1.0)

```ts
declare const app: {
  llm: {
    /** Однократный запрос с возможным стримингом. */
    chat(opts: {
      profile?: string;       // default — текущий профиль проекта
      messages: Message[];
      tools?: ToolDef[];
      sampler?: SamplerOverrides;
      onToken?: (delta: string) => void;
    }): Promise<ChatResult>;

    embed(opts: {
      profile?: string;
      texts: string[];
    }): Promise<number[][]>;

    rerank(opts: {
      profile?: string;
      query: string;
      docs: string[];
    }): Promise<{index: number, score: number}[]>;
  };

  project: {
    root: string;
    listFiles(glob?: string): Promise<string[]>;
    getCharacterCard(id: string): Promise<CharacterCard>;
    updateCharacterCard(id: string, patch: Partial<CharacterCard>): Promise<void>;
    snapshot(message: string): Promise<string>;  // git commit, returns sha
  };

  fs: {
    read(relPath: string): Promise<string>;
    write(relPath: string, content: string): Promise<void>;
    edit(relPath: string, unifiedDiff: string): Promise<void>;
    exists(relPath: string): Promise<boolean>;
  };

  rag: {
    search(query: string, opts?: {
      k?: number;
      hybrid?: boolean;
      rerank?: boolean;
      filter?: { paths?: string[] };
    }): Promise<RagHit[]>;
    reindex(): Promise<void>;
  };

  chat: {
    /** Доступ к текущей чат-сессии (если скрипт запущен из неё). */
    current?: {
      messages: Message[];
      append(msg: Message): Promise<void>;
    };
  };

  tools: {
    /** Запуск зарегистрированного external tool. */
    run(name: string, payload: any): Promise<any>;
    list(): string[];
  };

  log: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
};

declare function requireApi(version: string): void;
```

Пример скрипта (batch-генерация TTS-промптов):

```js
requireApi("1.0");

const characters = await app.project.listFiles("characters/*.md");
for (const path of characters) {
  const md = await app.fs.read(path);
  const result = await app.llm.chat({
    messages: [
      { role: "system", content: "Сгенерируй краткое описание голоса для TTS на основе character card." },
      { role: "user", content: md }
    ]
  });
  const outPath = path.replace("characters/", "tts/voices/").replace(".md", ".voice.txt");
  await app.fs.write(outPath, result.content);
  app.log.info("voice generated", { character: path });
}

await app.project.snapshot("batch: generated TTS voice prompts");
```

---

## 9. Поэтапный план

### Milestone 0 — Spike (1–2 недели)

Цель: снять технический риск стека.

- Wails-проект, минимальное окно, CodeMirror 6 на одном `.md` файле в 50k строк.
- Go-сервис, запускающий `llama-server`, читающий SSE, стримящий токены через
  Wails event в редактор.
- Прогон на Linux Debian KDE и Windows.

Если плавно — продолжаем. Если на этом этапе видно тормоза WebKitGTK или
проблемы со стримом — пересматриваем стек.

### Milestone 1 — MVP

- ProfileManager + ServerSupervisor (один профиль chat).
- ProjectService + git init + базовый file explorer.
- Чат-окно без агентного цикла, без RAG.
- Сохранение/загрузка сессий в JSONL.
- Простейший markdown viewer/editor.

### Milestone 2 — RAG

- FileIndexer + chunker + sqlite-vec.
- Embedding-профиль (USER-bge-m3) запускается рядом с chat.
- FTS5 + RRF.
- `search_semantic` доступен в чате как простая команда (`/search ...`).

### Milestone 3 — Agent loop

- AgentRuntime, tool-loop с file/search/edit инструментами.
- Mode definitions (built-in + project-local).
- Approval gate, source attribution в UI.
- Pre-agent snapshots.

### Milestone 4 — Scripting + Prompt Lab

- ScriptingService с goja, API v1.0.
- Prompt Lab UI.
- WorkflowEngine для batch-задач.
- External tools registry.

### Milestone 5 — Builds & forks

- BuildOrchestrator: git clone/pull, cmake invocations со стримингом, GPU detect.
- UI для управления Build'ами и BuildRecipe'ами.

### Milestone 6 — Polish

- Reranker, hot-swap, multimodal (mmproj).
- SillyTavern character card import.
- Установщики Win/Linux.

### Future / not-v1

- macOS support.
- Headless daemon mode.
- Auto-update.
- Альтернативные backends (ollama, vLLM).
- Branching для альтернативных сюжетов в UI поверх git branches.

---

## 10. Открытые вопросы

1. **Драйвер SQLite** — `modernc.org/sqlite` (без CGo, но грузить расширения
   возможно сложнее) vs `mattn/go-sqlite3` (CGo, проще с sqlite-vec, но тянет
   зависимости при кросс-компиляции). Решить на этапе Milestone 2.

2. **Rich-text edge cases в CodeMirror 6** — достаточно ли его для
   нарративного редактирования с inline-аннотациями агента? Если нет —
   возможно, частичное переключение на Tiptap для отдельных режимов.
   Проверить на Milestone 1.

3. **Формат character cards** — собственный (markdown с frontmatter) и
   импорт SillyTavern V2, или нативно SillyTavern V2? Markdown проще
   диффить и редактировать руками; ST V2 даёт совместимость. Скорее всего —
   markdown как основной, ST V2 на импорт/экспорт.

4. **Windows file watcher на network shares** — `fsnotify` не поддерживает,
   нужен polling fallback. Заложить early.

5. **Telemetry / crash reporting** — на v1 явно нет, но дизайн error-handling
   должен учитывать возможность будущего opt-in отчёта.

### 10.1. Принятые решения (лог)

- **Frontend stack** → **React + Mantine v7**. Выбран из-за богатой готовой
  компонентной библиотеки, что критично для multi-panel workspace UI с
  большим числом форм и настроечных экранов. Альтернатива (Svelte +
  Skeleton/shadcn-svelte) даёт более приятный DX, но требует ощутимо больше
  ручной работы на сложных компонентах. *(2026-05)*
- **Лицензия** → **MIT**. Default в экосистемах Go и npm, максимальная
  совместимость с зависимостями, минимум юридического текста. Перед
  публичным релизом — прогон `go-licenses` и `license-checker` на
  transitive deps. *(2026-05)*

---

## Приложение A. Глоссарий

- **Profile** — связка Build + Model + Args, представляющая запускаемый
  llama-server инстанс.
- **Mode** — описание режима работы агента (system prompt + tools + context
  strategy).
- **Tool** — функция, доступная агенту через function calling.
- **Tool-loop** — итеративный цикл «модель просит вызвать tool → результат
  обратно в модель», до финального ответа.
- **Chunk** — фрагмент текста проекта, единица индексации в RAG.
- **Hybrid retrieval** — комбинация dense (vector) и sparse (BM25) поиска.
- **RRF (Reciprocal Rank Fusion)** — алгоритм объединения рейтингов из разных
  retrievers.
- **mmproj** — multimodal projection файл, нужен для vision-моделей в llama.cpp.
- **Speculative decoding** — ускорение генерации через draft-модель.
- **Pooling (cls/mean)** — способ агрегации token embeddings в финальный
  sentence embedding. Для BGE-style моделей — cls.
