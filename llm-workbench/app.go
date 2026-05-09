package main

import (
	"context"
	"fmt"
	"os"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	cfg        *Config
	supervisor *LlamaSupervisor
	chat       *ChatService
	renderer   *Renderer
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	cfg, err := LoadConfig()
	if err != nil {
		wruntime.LogErrorf(ctx, "config: %v", err)
		wruntime.EventsEmit(ctx, "app:fatal", err.Error())
		return
	}
	a.cfg = cfg
	a.supervisor = NewLlamaSupervisor(cfg)
	a.supervisor.Attach(ctx)
	a.chat = NewChatService(cfg)
	a.chat.Attach(ctx)
	a.renderer = NewRenderer()

	if cfg.Autostart {
		if err := a.supervisor.Start(); err != nil {
			wruntime.EventsEmit(ctx, "llama:log", fmt.Sprintf("autostart failed: %v", err))
		}
	}
}

func (a *App) shutdown(ctx context.Context) {
	if a.supervisor != nil {
		_ = a.supervisor.Stop()
	}
}

// --- bindings exposed to JS ---

func (a *App) GetConfig() map[string]any {
	if a.cfg == nil {
		return map[string]any{"loaded": false}
	}
	return map[string]any{
		"loaded":    true,
		"binPath":   a.cfg.BinPath,
		"modelPath": a.cfg.ModelPath,
		"baseUrl":   a.cfg.BaseURL(),
		"args":      a.cfg.ExtraArgs,
		"autostart": a.cfg.Autostart,
	}
}

func (a *App) StartServer() error {
	if a.supervisor == nil {
		return fmt.Errorf("config not loaded")
	}
	return a.supervisor.Start()
}

func (a *App) StopServer() error {
	if a.supervisor == nil {
		return nil
	}
	return a.supervisor.Stop()
}

func (a *App) ServerStatus() Status {
	if a.supervisor == nil {
		return Status{}
	}
	return a.supervisor.Status()
}

func (a *App) ChatStream(messages []ChatMessage, temperature float64) (StreamHandle, error) {
	if a.chat == nil {
		return StreamHandle{}, fmt.Errorf("config not loaded")
	}
	return a.chat.StartStream(messages, temperature)
}

func (a *App) ChatCancel(streamID string) {
	if a.chat != nil {
		a.chat.CancelStream(streamID)
	}
}

func (a *App) RenderMarkdown(source string) RenderResult {
	if a.renderer == nil {
		a.renderer = NewRenderer()
	}
	return a.renderer.Render(source)
}

type InitialDoc struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Bytes    int    `json:"bytes"`
	LoadedMs int64  `json:"loadedMs"`
}

// LoadInitialDoc reads the file at LOAD_DOC_PATH (relative paths resolve
// against the binary's CWD). Returns empty content if unset or unreadable.
func (a *App) LoadInitialDoc() InitialDoc {
	if a.cfg == nil || a.cfg.LoadDocPath == "" {
		return InitialDoc{}
	}
	t0 := time.Now()
	b, err := os.ReadFile(a.cfg.LoadDocPath)
	if err != nil {
		wruntime.LogErrorf(a.ctx, "LoadInitialDoc: %v", err)
		return InitialDoc{Path: a.cfg.LoadDocPath}
	}
	return InitialDoc{
		Path:     a.cfg.LoadDocPath,
		Content:  string(b),
		Bytes:    len(b),
		LoadedMs: time.Since(t0).Milliseconds(),
	}
}
