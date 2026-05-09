package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	BinPath       string
	BinCwd        string
	ModelPath     string
	Host          string
	Port          int
	ExtraArgs     []string
	HealthTimeout int
	Autostart     bool
	LoadDocPath   string
}

func LoadConfig() (*Config, error) {
	loadDotenv(".env")

	port, err := strconv.Atoi(getEnv("LLAMA_PORT", "8080"))
	if err != nil {
		return nil, fmt.Errorf("LLAMA_PORT: %w", err)
	}
	timeout, err := strconv.Atoi(getEnv("LLAMA_HEALTH_TIMEOUT", "120"))
	if err != nil {
		return nil, fmt.Errorf("LLAMA_HEALTH_TIMEOUT: %w", err)
	}
	cfg := &Config{
		BinPath:       getEnv("LLAMA_SERVER_BIN", ""),
		BinCwd:        getEnv("LLAMA_SERVER_CWD", ""),
		ModelPath:     getEnv("LLAMA_MODEL", ""),
		Host:          getEnv("LLAMA_HOST", "127.0.0.1"),
		Port:          port,
		ExtraArgs:     splitArgs(getEnv("LLAMA_EXTRA_ARGS", "")),
		HealthTimeout: timeout,
		Autostart:     strings.EqualFold(getEnv("LLAMA_AUTOSTART", "true"), "true"),
		LoadDocPath:   getEnv("LOAD_DOC_PATH", ""),
	}
	if cfg.BinPath == "" {
		return nil, fmt.Errorf("LLAMA_SERVER_BIN not set (copy .env.example to .env)")
	}
	if cfg.ModelPath == "" {
		return nil, fmt.Errorf("LLAMA_MODEL not set")
	}
	return cfg, nil
}

func (c *Config) BaseURL() string {
	return fmt.Sprintf("http://%s:%d", c.Host, c.Port)
}

func getEnv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func splitArgs(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return strings.Fields(s)
}

// loadDotenv: minimal .env parser. KEY=VALUE per line, # comments, no expansion.
func loadDotenv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		i := strings.Index(line, "=")
		if i < 0 {
			continue
		}
		k := strings.TrimSpace(line[:i])
		v := strings.TrimSpace(line[i+1:])
		v = strings.Trim(v, `"'`)
		if _, exists := os.LookupEnv(k); !exists {
			os.Setenv(k, v)
		}
	}
}
