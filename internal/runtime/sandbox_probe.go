package runtime

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

// SandboxCapabilities describes what a given sandbox image has available at
// runtime. It is built by probing the image once per process and cached —
// results are stable for the lifetime of a given image tag.
type SandboxCapabilities struct {
	Image          string
	OS             string
	Binaries       map[string]bool
	PythonModules  map[string]bool
	NetworkDNS     bool
	InstallApt     bool
	InstallPip     bool
	Probed         bool
	Error          string
}

var (
	probeCache   = make(map[string]*SandboxCapabilities)
	probeCacheMu sync.Mutex
)

// probeBinaries is the set we surface in the primer. Keep it small so the
// primer stays legible — add new probes only when a missing capability
// causes visible model confusion.
var probeBinaries = []string{
	"python3", "python", "pip", "pip3",
	"node", "npm", "go",
	"convert", "ffmpeg", "jq", "curl", "wget",
	"apt-get",
}

var probePythonModules = []string{
	"PIL", "numpy", "requests", "bs4", "pandas", "matplotlib",
}

// probeSandbox runs a single `docker run --rm` against the image to enumerate
// available binaries, importable python modules, and install pathways. The
// result is cached per-image for the lifetime of the process.
func probeSandbox(ctx context.Context, image string) *SandboxCapabilities {
	image = strings.TrimSpace(image)
	if image == "" {
		return nil
	}
	probeCacheMu.Lock()
	if cached, ok := probeCache[image]; ok {
		probeCacheMu.Unlock()
		return cached
	}
	probeCacheMu.Unlock()

	result := &SandboxCapabilities{
		Image:         image,
		Binaries:      make(map[string]bool, len(probeBinaries)),
		PythonModules: make(map[string]bool, len(probePythonModules)),
	}

	script := buildProbeScript()
	probeCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, "docker", "run", "--rm", image, "bash", "-lc", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		result.Error = strings.TrimSpace(string(out))
		if result.Error == "" {
			result.Error = err.Error()
		}
	} else {
		parseProbeOutput(string(out), result)
		result.Probed = true
	}

	probeCacheMu.Lock()
	probeCache[image] = result
	probeCacheMu.Unlock()
	return result
}

func buildProbeScript() string {
	var b strings.Builder
	b.WriteString("set +e\n")
	for _, bin := range probeBinaries {
		fmt.Fprintf(&b, "command -v %s >/dev/null 2>&1 && echo bin:%s=1 || echo bin:%s=0\n", bin, bin, bin)
	}
	b.WriteString("if command -v python3 >/dev/null 2>&1; then\n")
	for _, mod := range probePythonModules {
		fmt.Fprintf(&b, "  python3 -c 'import %s' >/dev/null 2>&1 && echo py:%s=1 || echo py:%s=0\n", mod, mod, mod)
	}
	b.WriteString("fi\n")
	b.WriteString("getent hosts pypi.org >/dev/null 2>&1 && echo net:dns=1 || echo net:dns=0\n")
	b.WriteString("os=$(. /etc/os-release 2>/dev/null && echo \"${NAME} ${VERSION}\" | sed 's/  */ /g' | sed 's/^ *//;s/ *$//')\n")
	b.WriteString("echo os:$os\n")
	return b.String()
}

func parseProbeOutput(out string, r *SandboxCapabilities) {
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "bin:"):
			name, val, ok := parseKV(line[len("bin:"):])
			if ok {
				r.Binaries[name] = val == "1"
			}
		case strings.HasPrefix(line, "py:"):
			name, val, ok := parseKV(line[len("py:"):])
			if ok {
				r.PythonModules[name] = val == "1"
			}
		case strings.HasPrefix(line, "net:dns="):
			r.NetworkDNS = strings.TrimPrefix(line, "net:dns=") == "1"
		case strings.HasPrefix(line, "os:"):
			r.OS = strings.TrimSpace(strings.TrimPrefix(line, "os:"))
		}
	}
	r.InstallApt = r.Binaries["apt-get"]
	r.InstallPip = r.Binaries["pip"] || r.Binaries["pip3"]
}

func parseKV(s string) (string, string, bool) {
	eq := strings.IndexByte(s, '=')
	if eq <= 0 {
		return "", "", false
	}
	return s[:eq], s[eq+1:], true
}

// primerSection formats the capability result as a markdown block for the
// session primer. Returns an empty string when nothing useful was probed.
func (c *SandboxCapabilities) primerSection() string {
	if c == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n## Sandbox capabilities\n")
	if c.Image != "" {
		fmt.Fprintf(&b, "- Image: %s", c.Image)
		if c.OS != "" {
			fmt.Fprintf(&b, " (%s)", c.OS)
		}
		b.WriteString("\n")
	}
	if !c.Probed {
		if c.Error != "" {
			fmt.Fprintf(&b, "- Probe failed: %s\n", truncateOneLine(c.Error, 200))
		} else {
			b.WriteString("- Probe skipped.\n")
		}
		return b.String()
	}
	present, missing := splitPresence(c.Binaries)
	if len(present) > 0 {
		fmt.Fprintf(&b, "- Available binaries: %s\n", strings.Join(present, ", "))
	}
	if len(missing) > 0 {
		fmt.Fprintf(&b, "- Missing binaries: %s\n", strings.Join(missing, ", "))
	}
	if len(c.PythonModules) > 0 {
		pPresent, pMissing := splitPresence(c.PythonModules)
		if len(pPresent) > 0 {
			fmt.Fprintf(&b, "- Python modules present: %s\n", strings.Join(pPresent, ", "))
		}
		if len(pMissing) > 0 {
			fmt.Fprintf(&b, "- Python modules missing: %s\n", strings.Join(pMissing, ", "))
		}
	}
	switch {
	case c.InstallApt && c.InstallPip:
		b.WriteString("- Install capability: apt-get and pip are both available (you may install missing packages).\n")
	case c.InstallApt:
		b.WriteString("- Install capability: apt-get is available; pip is NOT — install python deps via `apt-get install python3-<pkg>`.\n")
	case c.InstallPip:
		b.WriteString("- Install capability: pip is available; apt-get is NOT.\n")
	default:
		b.WriteString("- Install capability: neither apt-get nor pip is available — do NOT retry installs. If you need a missing capability, tell the user and suggest an alternative.\n")
	}
	if c.NetworkDNS {
		b.WriteString("- Network: DNS resolves (outbound likely available).\n")
	} else {
		b.WriteString("- Network: DNS did not resolve at probe time (installs from the internet may fail).\n")
	}
	b.WriteString("- If a capability you need is missing, prefer asking the user for a different approach over retrying installs that have already failed once.\n")
	return b.String()
}

func splitPresence(m map[string]bool) (present, missing []string) {
	for k, v := range m {
		if v {
			present = append(present, k)
		} else {
			missing = append(missing, k)
		}
	}
	sort.Strings(present)
	sort.Strings(missing)
	return
}

func (c *SandboxCapabilities) summaryMap() map[string]any {
	if c == nil {
		return nil
	}
	bins := make(map[string]bool, len(c.Binaries))
	for k, v := range c.Binaries {
		bins[k] = v
	}
	mods := make(map[string]bool, len(c.PythonModules))
	for k, v := range c.PythonModules {
		mods[k] = v
	}
	return map[string]any{
		"image":            c.Image,
		"os":               c.OS,
		"binaries":         bins,
		"python_modules":   mods,
		"network_dns":      c.NetworkDNS,
		"install_apt":      c.InstallApt,
		"install_pip":      c.InstallPip,
		"probed":           c.Probed,
		"probe_error":      c.Error,
	}
}

func truncateOneLine(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
