package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Dish struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CategoryID  string `json:"categoryId"`
	PriceCents  int    `json:"priceCents"`
	Available   bool   `json:"available"`
	Image       string `json:"image"`
}
type Catalog struct {
	Name       string     `json:"name"`
	Tagline    string     `json:"tagline"`
	Color      string     `json:"color"`
	Logo       string     `json:"logo"`
	Categories []Category `json:"categories"`
	Dishes     []Dish     `json:"dishes"`
}
type Settings struct {
	Mode             string `json:"mode"`
	Server           string `json:"server"`
	AccessExperience string `json:"accessExperience"`
	SSID             string `json:"ssid"`
	WifiPassword     string `json:"wifiPassword"`
	LocalURL         string `json:"localUrl"`
	WebURL           string `json:"webUrl"`
}
type License struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}
type LicensePayload struct {
	SchemaVersion int      `json:"schemaVersion"`
	RestaurantID  string   `json:"restaurantId"`
	LicenseID     string   `json:"licenseId"`
	Modes         []string `json:"modes"`
	IssuedAt      string   `json:"issuedAt"`
	Customer      string   `json:"customer"`
}
type Publication struct {
	Version          int     `json:"version"`
	At               string  `json:"at"`
	Catalog          Catalog `json:"catalog"`
	Mode             string  `json:"mode"`
	AccessExperience string  `json:"accessExperience"`
}
type Password struct {
	Salt string `json:"salt"`
	Hash string `json:"hash"`
}
type Failures struct {
	Count int   `json:"count"`
	Until int64 `json:"until"`
}
type State struct {
	SchemaVersion int          `json:"schemaVersion"`
	RestaurantID  string       `json:"restaurantId"`
	OwnerID       string       `json:"ownerId"`
	Draft         Catalog      `json:"draft"`
	Settings      Settings     `json:"settings"`
	Published     *Publication `json:"published"`
	License       *License     `json:"license"`
	Password      Password     `json:"password"`
	RecoveryHash  string       `json:"recoveryHash"`
	SessionEpoch  int          `json:"sessionEpoch"`
	Failures      Failures     `json:"failures"`
	CreatedAt     string       `json:"createdAt"`
}
type Stored struct {
	Revision int   `json:"revision"`
	State    State `json:"state"`
}
type Media struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Data string `json:"data"`
}
type Backup struct {
	SchemaVersion int      `json:"schemaVersion"`
	SourceID      string   `json:"sourceId"`
	ExportedAt    string   `json:"exportedAt"`
	Draft         Catalog  `json:"draft"`
	Settings      Settings `json:"settings"`
	Media         []Media  `json:"media"`
}
type Server struct {
	mu                                        sync.Mutex
	data                                      *Stored
	dir, ui, publicKey, setupToken, httpsPort string
}

var embeddedPublicKey string
var uuidPattern = regexp.MustCompile(`^[a-f0-9-]{36}$`)
var idPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func uuid() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func randomToken() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(s string) string {
	h := sha256.Sum256([]byte(s))
	return base64.StdEncoding.EncodeToString(h[:])
}
func passwordHash(password, salt string) string {
	h := hmac.New(sha256.New, []byte(password))
	h.Write([]byte(salt))
	h.Write([]byte{0, 0, 0, 1})
	u := h.Sum(nil)
	t := append([]byte(nil), u...)
	for i := 1; i < 100000; i++ {
		h.Reset()
		h.Write(u)
		u = h.Sum(nil)
		for j := range t {
			t[j] ^= u[j]
		}
	}
	return base64.StdEncoding.EncodeToString(t)
}
func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
func validAsset(s string) bool {
	return s == "" || s == "/demo/encebollado.jpg" || (strings.HasPrefix(s, "/api/v1/media/") && uuidPattern.MatchString(strings.TrimPrefix(s, "/api/v1/media/")))
}
func validateCatalog(c Catalog) error {
	if strings.TrimSpace(c.Name) == "" || utf8.RuneCountInString(c.Name) > 80 || len(c.Tagline) > 720 || !colorPattern.MatchString(c.Color) || !validAsset(c.Logo) || len(c.Categories) < 1 || len(c.Categories) > 30 || len(c.Dishes) > 150 {
		return errors.New("Carta inválida: revisa nombre, categorías y límite de platos.")
	}
	cats := map[string]bool{}
	ids := map[string]bool{}
	for _, x := range c.Categories {
		if !idPattern.MatchString(x.ID) || cats[x.ID] || strings.TrimSpace(x.Name) == "" || utf8.RuneCountInString(x.Name) > 50 {
			return errors.New("Categoría inválida o duplicada.")
		}
		cats[x.ID] = true
	}
	for _, d := range c.Dishes {
		if !idPattern.MatchString(d.ID) || ids[d.ID] || !cats[d.CategoryID] || strings.TrimSpace(d.Name) == "" || utf8.RuneCountInString(d.Name) > 90 || utf8.RuneCountInString(d.Description) > 500 || d.PriceCents < 0 || d.PriceCents > 9999999 || !validAsset(d.Image) {
			return errors.New("Hay un plato inválido o duplicado.")
		}
		ids[d.ID] = true
	}
	return nil
}
func validateSettings(s Settings) error {
	if !contains([]string{"local", "web", "text"}, s.Mode) || !contains([]string{"router", "windows7", "windows10", "android"}, s.Server) || !contains([]string{"automatic_preferred", "guided"}, s.AccessExperience) || len(s.SSID) < 1 || len(s.SSID) > 32 || len(s.WifiPassword) < 8 || len(s.WifiPassword) > 63 {
		return errors.New("Configuración inválida.")
	}
	for _, r := range s.WifiPassword {
		if r < 32 || r > 126 {
			return errors.New("Usa una contraseña Wi-Fi ASCII de 8 a 63 caracteres.")
		}
	}
	u, e := url.Parse(s.LocalURL)
	if e != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("La dirección local debe usar HTTP.")
	}
	ip := net.ParseIP(u.Hostname())
	if u.Hostname() != "menu.lan" && (ip == nil || !ip.IsPrivate()) {
		return errors.New("La dirección debe pertenecer a la red privada.")
	}
	if s.WebURL != "" {
		u, e = url.Parse(s.WebURL)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return errors.New("El menú web necesita HTTPS.")
		}
	}
	return nil
}
func verifyLicense(l *License, key, id string) ([]string, error) {
	if l == nil {
		return []string{}, nil
	}
	pub, e := base64.StdEncoding.DecodeString(strings.TrimSpace(key))
	if e != nil || len(pub) != ed25519.PublicKeySize {
		return nil, errors.New("Falta configurar la clave pública del vendedor.")
	}
	b, e := base64.StdEncoding.DecodeString(l.Payload)
	if e != nil {
		return nil, e
	}
	sig, e := base64.StdEncoding.DecodeString(l.Signature)
	if e != nil || !ed25519.Verify(pub, b, sig) {
		return nil, errors.New("Firma de licencia inválida.")
	}
	var p LicensePayload
	if json.Unmarshal(b, &p) != nil || p.SchemaVersion != 1 || p.RestaurantID != id || len(p.Modes) < 1 || len(p.Modes) > 3 || p.Customer == "" || !idPattern.MatchString(p.LicenseID) {
		return nil, errors.New("La licencia no corresponde a este restaurante.")
	}
	for _, m := range p.Modes {
		if !contains([]string{"web", "local", "text"}, m) {
			return nil, errors.New("Modalidad inválida.")
		}
	}
	if _, e = time.Parse(time.RFC3339, p.IssuedAt); e != nil {
		return nil, e
	}
	return p.Modes, nil
}
func assetIDs(c Catalog) []string {
	ids := []string{}
	seen := map[string]bool{}
	paths := []string{c.Logo}
	for _, d := range c.Dishes {
		paths = append(paths, d.Image)
	}
	for _, p := range paths {
		if strings.HasPrefix(p, "/api/v1/media/") {
			id := strings.TrimPrefix(p, "/api/v1/media/")
			if !seen[id] {
				ids = append(ids, id)
				seen[id] = true
			}
		}
	}
	return ids
}
func newState(name, password string) (State, string) {
	salt := randomToken()
	recovery := randomToken()
	return State{SchemaVersion: 1, RestaurantID: uuid(), OwnerID: "local-owner", Draft: Catalog{Name: name, Tagline: "Sabores que nos reúnen.", Color: "#244130", Categories: []Category{{ID: "principales", Name: "Platos principales"}, {ID: "bebidas", Name: "Bebidas"}}, Dishes: []Dish{}}, Settings: Settings{Mode: "text", Server: "router", AccessExperience: "automatic_preferred", SSID: "QR-Menu", WifiPassword: "menu-invitados", LocalURL: "http://192.168.8.1:8080/menu"}, Password: Password{Salt: salt, Hash: passwordHash(password, salt)}, RecoveryHash: digest(recovery), CreatedAt: time.Now().UTC().Format(time.RFC3339)}, recovery
}

// An append-only journal gives Windows 7, OpenWrt and modern Windows identical
// crash semantics. A torn final line is ignored; every acknowledged write is fsynced.
func (s *Server) load() error {
	b, e := os.ReadFile(filepath.Join(s.dir, "state.journal"))
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	lines := bytes.Split(b, []byte{'\n'})
	for i, line := range lines {
		if i == len(lines)-1 {
			break
		}
		if len(line) == 0 {
			continue
		}
		var entry struct {
			Data   json.RawMessage `json:"data"`
			SHA256 string          `json:"sha256"`
		}
		if json.Unmarshal(line, &entry) != nil || digest(string(entry.Data)) != entry.SHA256 {
			return errors.New("El respaldo del servidor tiene un registro corrupto.")
		}
		var next Stored
		if json.Unmarshal(entry.Data, &next) != nil {
			return errors.New("Registro inválido.")
		}
		s.data = &next
	}
	return nil
}
func (s *Server) commit(state State) error {
	rev := 0
	if s.data != nil {
		rev = s.data.Revision + 1
	}
	stored := Stored{Revision: rev, State: state}
	b, e := json.Marshal(stored)
	if e != nil {
		return e
	}
	line, _ := json.Marshal(map[string]interface{}{"data": json.RawMessage(b), "sha256": digest(string(b))})
	file := filepath.Join(s.dir, "state.journal")
	f, e := os.OpenFile(file, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	existing, e := io.ReadAll(f)
	if e != nil {
		return e
	}
	last := bytes.LastIndexByte(existing, '\n') + 1
	if len(existing) > last {
		if e = f.Truncate(int64(last)); e != nil {
			return e
		}
	}
	if _, e = f.Seek(int64(last), io.SeekStart); e != nil {
		return e
	}
	if _, e = f.Write(append(line, '\n')); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	s.data = &stored
	return nil
}
func (s *Server) mediaPut(id, typ string, b []byte) error {
	if !uuidPattern.MatchString(id) {
		return errors.New("Imagen inválida.")
	}
	if e := os.WriteFile(filepath.Join(s.dir, "media", id), b, 0600); e != nil {
		return e
	}
	return os.WriteFile(filepath.Join(s.dir, "media", id+".type"), []byte(typ), 0600)
}
func (s *Server) mediaGet(id string) ([]byte, string, error) {
	if !uuidPattern.MatchString(id) {
		return nil, "", errors.New("Imagen inválida.")
	}
	b, e := os.ReadFile(filepath.Join(s.dir, "media", id))
	t, _ := os.ReadFile(filepath.Join(s.dir, "media", id+".type"))
	return b, string(t), e
}
func imageValid(b []byte, t string) bool {
	return len(b) > 12 && len(b) <= 1000000 && ((t == "image/jpeg" && b[0] == 255 && b[1] == 216) || (t == "image/png" && bytes.Equal(b[:4], []byte{137, 80, 78, 71})) || (t == "image/webp" && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP"))
}
func (s *Server) token(expires int64) string {
	return fmt.Sprintf("%d.%s", expires, digest(fmt.Sprintf("%s:%d:%d", s.data.State.Password.Hash, s.data.State.SessionEpoch, expires)))
}
func (s *Server) authed(r *http.Request) bool {
	if s.data == nil {
		return false
	}
	c, e := r.Cookie("qrmenu_session")
	if e != nil {
		return false
	}
	parts := strings.SplitN(c.Value, ".", 2)
	if len(parts) != 2 {
		return false
	}
	v, e := strconv.ParseInt(parts[0], 10, 64)
	return e == nil && v > time.Now().UnixMilli() && v < time.Now().UnixMilli()+86400001 && equal(c.Value, s.token(v))
}
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
func decode(r *http.Request, v interface{}) error {
	return json.NewDecoder(io.LimitReader(r.Body, 30000001)).Decode(v)
}
func (s *Server) cookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "qrmenu_session", Value: s.token(time.Now().UnixMilli() + 86400000), Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: 86400})
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	p := r.URL.Path
	if !strings.HasPrefix(p, "/api/v1/") {
		if p == "/generate_204" || p == "/hotspot-detect.html" || p == "/connecttest.txt" || p == "/portal" {
			http.Redirect(w, r, "/menu", 302)
			return
		}
		clean := filepath.Clean("/" + p)
		file := filepath.Join(s.ui, clean)
		if info, e := os.Stat(file); e == nil && !info.IsDir() {
			http.ServeFile(w, r, file)
			return
		}
		if p == "/" || p == "/menu" || p == "/preview" || p == "/demo" {
			http.ServeFile(w, r, filepath.Join(s.ui, "index.html"))
			return
		}
		http.NotFound(w, r)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.api(w, r, strings.TrimPrefix(p, "/api/v1/"))
}
func (s *Server) api(w http.ResponseWriter, r *http.Request, p string) {
	method := r.Method
	if method != "GET" {
		origin := r.Header.Get("Origin")
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if origin != "" && origin != scheme+"://"+r.Host {
			fail(w, 403, "Origen no permitido.")
			return
		}
		if p != "media" && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			fail(w, 415, "Se requiere JSON.")
			return
		}
	}
	if p == "session" && method == "GET" {
		writeJSON(w, 200, map[string]interface{}{"configured": s.data != nil, "authenticated": s.authed(r), "platformSetup": false, "runtime": "local"})
		return
	}
	if p == "setup" && method == "POST" {
		if s.data != nil {
			fail(w, 409, "Ya configurado.")
			return
		}
		var b struct{ Name, Password, SetupToken string }
		if decode(r, &b) != nil || len(b.Password) < 12 || len(b.Password) > 128 || strings.TrimSpace(b.Name) == "" || utf8.RuneCountInString(b.Name) > 80 {
			fail(w, 400, "Nombre o contraseña inválidos.")
			return
		}
		if !equal(b.SetupToken, s.setupToken) {
			fail(w, 403, "Código de instalación incorrecto.")
			return
		}
		state, recovery := newState(b.Name, b.Password)
		if e := s.commit(state); e != nil {
			fail(w, 500, e.Error())
			return
		}
		s.cookie(w, r)
		writeJSON(w, 201, map[string]string{"recovery": recovery, "restaurantId": state.RestaurantID})
		return
	}
	if s.data == nil {
		fail(w, 404, "Configura primero el restaurante.")
		return
	}
	state := s.data.State // Clone mutable slices via JSON before every transaction.
	raw, _ := json.Marshal(state)
	json.Unmarshal(raw, &state)
	commit := func() bool {
		if e := s.commit(state); e != nil {
			fail(w, 500, e.Error())
			return false
		}
		return true
	}
	if (p == "login" || p == "recover") && method == "POST" {
		if state.Failures.Until > time.Now().UnixMilli() {
			fail(w, 429, "Demasiados intentos. Espera 15 minutos.")
			return
		}
		var b struct{ Password, Recovery string }
		if decode(r, &b) != nil || len(b.Password) > 128 {
			fail(w, 400, "Credenciales inválidas.")
			return
		}
		valid := false
		if p == "login" {
			valid = equal(passwordHash(b.Password, state.Password.Salt), state.Password.Hash)
		} else {
			valid = equal(digest(b.Recovery), state.RecoveryHash)
		}
		if !valid {
			state.Failures.Count++
			if state.Failures.Count >= 5 {
				state.Failures.Until = time.Now().UnixMilli() + 900000
			}
			if commit() {
				fail(w, 401, "Credenciales incorrectas.")
			}
			return
		}
		state.Failures = Failures{}
		recovery := ""
		if p == "recover" {
			if len(b.Password) < 12 {
				fail(w, 400, "La contraseña necesita al menos 12 caracteres.")
				return
			}
			state.Password.Salt = randomToken()
			state.Password.Hash = passwordHash(b.Password, state.Password.Salt)
			state.SessionEpoch++
			recovery = randomToken()
			state.RecoveryHash = digest(recovery)
		}
		if commit() {
			s.cookie(w, r)
			writeJSON(w, 200, map[string]interface{}{"ok": true, "recovery": recovery})
		}
		return
	}
	modes, _ := verifyLicense(state.License, s.publicKey, state.RestaurantID)
	if modes == nil {
		modes = []string{}
	}
	if p == "menu" && method == "GET" {
		if state.Published == nil {
			fail(w, 404, "El restaurante todavía no ha publicado su menú.")
			return
		}
		if !contains(modes, state.Published.Mode) || state.Published.Mode == "text" {
			fail(w, 403, "Esta modalidad no tiene un menú interactivo habilitado.")
			return
		}
		pub := *state.Published
		pub.AccessExperience = state.Settings.AccessExperience
		writeJSON(w, 200, pub)
		return
	}
	if strings.HasPrefix(p, "media/") && method == "GET" {
		id := strings.TrimPrefix(p, "media/")
		public := state.Published != nil && contains(modes, state.Published.Mode) && contains(assetIDs(state.Published.Catalog), id)
		if !public && !s.authed(r) {
			fail(w, 401, "Imagen privada.")
			return
		}
		b, t, e := s.mediaGet(id)
		if e != nil {
			fail(w, 404, "Imagen no encontrada.")
			return
		}
		w.Header().Set("Content-Type", t)
		if public {
			w.Header().Set("Cache-Control", "public, max-age=86400")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
		w.Write(b)
		return
	}
	if !s.authed(r) {
		fail(w, 401, "Inicia sesión para administrar el restaurante.")
		return
	}
	if p == "logout" && method == "POST" {
		state.SessionEpoch++
		if commit() {
			http.SetCookie(w, &http.Cookie{Name: "qrmenu_session", Path: "/", MaxAge: -1, HttpOnly: true})
			writeJSON(w, 200, map[string]bool{"ok": true})
		}
		return
	}
	if p == "state" && method == "GET" {
		writeJSON(w, 200, map[string]interface{}{"restaurantId": state.RestaurantID, "revision": s.data.Revision, "draft": state.Draft, "settings": state.Settings, "published": state.Published, "licensedModes": modes, "hasLicense": state.License != nil, "createdAt": state.CreatedAt})
		return
	}
	if p == "draft" && method == "PUT" {
		var b struct {
			Revision int     `json:"revision"`
			Catalog  Catalog `json:"catalog"`
		}
		if decode(r, &b) != nil {
			fail(w, 400, "Datos inválidos.")
			return
		}
		if b.Revision != s.data.Revision {
			fail(w, 409, "Hay cambios de otro dispositivo. Recarga el editor.")
			return
		}
		if e := validateCatalog(b.Catalog); e != nil {
			fail(w, 400, e.Error())
			return
		}
		state.Draft = b.Catalog
		if commit() {
			writeJSON(w, 200, map[string]int{"revision": s.data.Revision})
		}
		return
	}
	if p == "settings" && method == "PUT" {
		var b struct {
			Revision int      `json:"revision"`
			Settings Settings `json:"settings"`
		}
		if decode(r, &b) != nil {
			fail(w, 400, "Datos inválidos.")
			return
		}
		if b.Revision != s.data.Revision {
			fail(w, 409, "Hay cambios de otro dispositivo.")
			return
		}
		if e := validateSettings(b.Settings); e != nil {
			fail(w, 400, e.Error())
			return
		}
		if b.Settings.Mode != state.Settings.Mode && !contains(modes, b.Settings.Mode) {
			fail(w, 403, "La modalidad requiere una ampliación de licencia.")
			return
		}
		state.Settings = b.Settings
		if commit() {
			writeJSON(w, 200, map[string]int{"revision": s.data.Revision})
		}
		return
	}
	if p == "license" && method == "POST" {
		var b License
		if decode(r, &b) != nil {
			fail(w, 400, "Licencia inválida.")
			return
		}
		if _, e := verifyLicense(&b, s.publicKey, state.RestaurantID); e != nil {
			fail(w, 400, e.Error())
			return
		}
		state.License = &b
		if commit() {
			writeJSON(w, 200, map[string]bool{"ok": true})
		}
		return
	}
	if p == "publish" && method == "POST" {
		var b struct {
			Revision int `json:"revision"`
		}
		if decode(r, &b) != nil || b.Revision != s.data.Revision {
			fail(w, 409, "Guarda o recarga antes de publicar.")
			return
		}
		if !contains(modes, state.Settings.Mode) {
			fail(w, 403, "Importa la licencia de esta modalidad antes de publicar.")
			return
		}
		if len(state.Draft.Dishes) == 0 {
			fail(w, 400, "Añade al menos un plato.")
			return
		}
		for _, id := range assetIDs(state.Draft) {
			if _, _, e := s.mediaGet(id); e != nil {
				fail(w, 400, "Faltan fotos del borrador.")
				return
			}
		}
		v := 1
		if state.Published != nil {
			v = state.Published.Version + 1
		}
		state.Published = &Publication{Version: v, At: time.Now().UTC().Format(time.RFC3339), Catalog: state.Draft, Mode: state.Settings.Mode, AccessExperience: state.Settings.AccessExperience}
		if commit() {
			writeJSON(w, 200, map[string]int{"version": v})
		}
		return
	}
	if p == "media" && method == "POST" {
		b, e := io.ReadAll(io.LimitReader(r.Body, 1000001))
		t := r.Header.Get("Content-Type")
		if e != nil || !imageValid(b, t) {
			fail(w, 415, "Solo imágenes JPG, PNG o WebP de hasta 1 MB.")
			return
		}
		id := uuid()
		if e = s.mediaPut(id, t, b); e != nil {
			fail(w, 500, e.Error())
			return
		}
		writeJSON(w, 201, map[string]string{"url": "/api/v1/media/" + id})
		return
	}
	if p == "backup" && method == "GET" {
		b := Backup{SchemaVersion: 1, SourceID: state.RestaurantID, ExportedAt: time.Now().UTC().Format(time.RFC3339), Draft: state.Draft, Settings: state.Settings, Media: []Media{}}
		for _, id := range assetIDs(state.Draft) {
			data, t, e := s.mediaGet(id)
			if e != nil {
				fail(w, 400, "Falta una foto del borrador.")
				return
			}
			b.Media = append(b.Media, Media{ID: id, Type: t, Data: base64.StdEncoding.EncodeToString(data)})
		}
		w.Header().Set("Content-Disposition", "attachment; filename=qr-menu-respaldo.json")
		writeJSON(w, 200, b)
		return
	}
	if p == "restore" && method == "POST" {
		var b Backup
		if decode(r, &b) != nil || b.SchemaVersion != 1 || len(b.Media) > 151 {
			fail(w, 400, "Respaldo inválido.")
			return
		}
		if e := validateCatalog(b.Draft); e != nil {
			fail(w, 400, e.Error())
			return
		}
		if e := validateSettings(b.Settings); e != nil {
			fail(w, 400, e.Error())
			return
		}
		remap := map[string]string{}
		buffers := map[string][]byte{}
		for _, m := range b.Media {
			data, e := base64.StdEncoding.DecodeString(m.Data)
			if e != nil || !uuidPattern.MatchString(m.ID) || !imageValid(data, m.Type) {
				fail(w, 400, "Foto de respaldo inválida.")
				return
			}
			remap[m.ID] = uuid()
			buffers[m.ID] = data
		}
		for _, id := range assetIDs(b.Draft) {
			if remap[id] == "" {
				fail(w, 400, "El respaldo no incluye todas las fotos.")
				return
			}
		}
		for _, m := range b.Media {
			if e := s.mediaPut(remap[m.ID], m.Type, buffers[m.ID]); e != nil {
				fail(w, 500, e.Error())
				return
			}
		}
		rewrite := func(p string) string {
			if strings.HasPrefix(p, "/api/v1/media/") {
				return "/api/v1/media/" + remap[strings.TrimPrefix(p, "/api/v1/media/")]
			}
			return p
		}
		b.Draft.Logo = rewrite(b.Draft.Logo)
		for i := range b.Draft.Dishes {
			b.Draft.Dishes[i].Image = rewrite(b.Draft.Dishes[i].Image)
		}
		state.Draft = b.Draft
		if !contains(modes, b.Settings.Mode) {
			b.Settings.Mode = state.Settings.Mode
		}
		state.Settings = b.Settings
		if commit() {
			writeJSON(w, 200, map[string]interface{}{"ok": true, "notice": "Borrador restaurado. Revisa y publica. Licencia y contraseña conservadas."})
		}
		return
	}
	if p == "qr" && method == "GET" {
		if !contains(modes, state.Settings.Mode) {
			fail(w, 403, "Activa la modalidad antes de generar tarjetas comerciales.")
			return
		}
		if state.Published == nil || state.Published.Mode != state.Settings.Mode {
			fail(w, 400, "Publica primero esta modalidad.")
			return
		}
		texts := []string{}
		switch state.Settings.Mode {
		case "local":
			esc := strings.NewReplacer("\\", "\\\\", ";", "\\;", ",", "\\,", ":", "\\:", "\"", "\\\"", " ", "\\ ")
			texts = []string{"WIFI:T:WPA;S:" + esc.Replace(state.Settings.SSID) + ";P:" + esc.Replace(state.Settings.WifiPassword) + ";;"}
		case "web":
			if state.Settings.WebURL == "" {
				fail(w, 400, "Configura la dirección HTTPS del menú.")
				return
			}
			texts = []string{state.Settings.WebURL}
		case "text":
			var err error
			texts, err = textPages(state.Published.Catalog)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if len(texts) == 0 {
				fail(w, 400, "Marca al menos un plato como disponible y vuelve a publicar el menú.")
				return
			}
		}
		codes := []map[string]string{}
		for _, t := range texts {
			codes = append(codes, map[string]string{"payload": t})
		}
		writeJSON(w, 200, map[string]interface{}{"codes": codes, "name": state.Published.Catalog.Name, "mode": state.Settings.Mode, "version": state.Published.Version, "settings": state.Settings})
		return
	}
	if p == "health" && method == "GET" {
		writeJSON(w, 200, map[string]interface{}{"runtime": "local", "server": state.Settings.Server, "portal": "not_verified", "certified": false, "checkedAt": time.Now().UTC().Format(time.RFC3339)})
		return
	}
	fail(w, 404, "Ruta no encontrada.")
}
func textPages(c Catalog) ([]string, error) {
	const maxBytes = 900
	footer := func(part, total int) string { return fmt.Sprintf("\n\nPARTE %d DE %d", part, total) }
	contentLimit := maxBytes - len(footer(150, 150))
	pages := []string{}
	text := c.Name + "\nMENÚ · PRECIOS EN USD"
	hasDish, currentCategory := false, ""
	for _, cat := range c.Categories {
		for _, d := range c.Dishes {
			if d.CategoryID != cat.ID || !d.Available {
				continue
			}
			item := fmt.Sprintf("- %s: $%.2f", d.Name, float64(d.PriceCents)/100)
			addition := "\n" + item
			if currentCategory != cat.ID {
				addition = "\n\n" + cat.Name + "\n" + item
			}
			if len(text+addition) > contentLimit {
				if !hasDish {
					return nil, fmt.Errorf("El texto de %q es demasiado largo para un QR legible.", d.Name)
				}
				pages = append(pages, text)
				text, hasDish, currentCategory = c.Name+"\nMENÚ · CONTINUACIÓN", false, ""
				addition = "\n\n" + cat.Name + "\n" + item
				if len(text+addition) > contentLimit {
					return nil, fmt.Errorf("El texto de %q es demasiado largo para un QR legible.", d.Name)
				}
			}
			text += addition
			hasDish, currentCategory = true, cat.ID
		}
	}
	if hasDish {
		pages = append(pages, text)
	}
	for i := range pages {
		pages[i] += footer(i+1, len(pages))
	}
	return pages, nil
}
func ensureTLS(dir string, addresses []string) (string, string, error) {
	certFile, keyFile := filepath.Join(dir, "server.crt"), filepath.Join(dir, "server.key")
	if _, e := os.Stat(certFile); e == nil {
		if _, e = os.Stat(keyFile); e == nil {
			return certFile, keyFile, nil
		}
	}
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		return "", "", e
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "QR Menu - Administracion local"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(5, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, IsCA: true, DNSNames: []string{"localhost", "menu.lan"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}}
	for _, addr := range addresses {
		if ip := net.ParseIP(addr); ip != nil {
			tmpl.IPAddresses = append(tmpl.IPAddresses, ip)
		}
	}
	der, e := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, key.Public(), key)
	if e != nil {
		return "", "", e
	}
	priv, _ := x509.MarshalPKCS8PrivateKey(key)
	if e = os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); e != nil {
		return "", "", e
	}
	e = os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: priv}), 0600)
	return certFile, keyFile, e
}
func main() {
	dir := flag.String("data", "data", "Directorio privado de datos")
	ui := flag.String("ui", "ui", "Interfaz local compilada")
	listen := flag.String("listen", ":8080", "Puerto HTTP público del menú")
	admin := flag.String("admin", ":8443", "Puerto HTTPS de administración")
	keyfile := flag.String("public-key", "seller-public.txt", "Clave pública del vendedor")
	ips := flag.String("cert-ips", "", "Direcciones IP fijas del servidor, separadas por coma")
	flag.Parse()
	if err := runPlatform(func(ctx context.Context, ready func()) error {
		if err := os.MkdirAll(filepath.Join(*dir, "media"), 0700); err != nil {
			return err
		}
		key := embeddedPublicKey
		if b, e := os.ReadFile(*keyfile); e == nil {
			key = strings.TrimSpace(string(b))
		}
		setupFile := filepath.Join(*dir, "installation-code.txt")
		setup, e := os.ReadFile(setupFile)
		if os.IsNotExist(e) {
			setup = []byte(randomToken())
			if e = os.WriteFile(setupFile, setup, 0600); e != nil {
				return e
			}
		}
		if e != nil {
			return e
		}
		s := &Server{dir: *dir, ui: *ui, publicKey: key, setupToken: strings.TrimSpace(string(setup)), httpsPort: strings.TrimPrefix(*admin, ":")}
		if _, port, err := net.SplitHostPort(*admin); err == nil {
			s.httpsPort = port
		}
		if e = s.load(); e != nil {
			return e
		}
		cert, priv, e := ensureTLS(*dir, strings.Split(*ips, ","))
		if e != nil {
			return e
		}
		mime.AddExtensionType(".js", "text/javascript")
		mime.AddExtensionType(".css", "text/css")
		publicHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := r.URL.Path
			allowed := p == "/menu" || p == "/portal" || p == "/demo" || p == "/api/v1/menu" || strings.HasPrefix(p, "/api/v1/media/") || strings.HasPrefix(p, "/assets/") || strings.HasPrefix(p, "/demo/") || p == "/generate_204" || p == "/hotspot-detect.html" || p == "/connecttest.txt" || p == "/icon.svg"
			if !allowed {
				host, _, e := net.SplitHostPort(r.Host)
				if e != nil {
					host = r.Host
				}
				if net.ParseIP(host) == nil && host != "localhost" && host != "menu.lan" {
					fail(w, 400, "Host no permitido.")
					return
				}
				http.Redirect(w, r, "https://"+net.JoinHostPort(host, s.httpsPort)+p, http.StatusTemporaryRedirect)
				return
			}
			if r.Method != "GET" && r.Method != "HEAD" {
				fail(w, 405, "Solo lectura.")
				return
			}
			s.ServeHTTP(w, r)
		})
		return servePair(ctx, ready, *listen, *admin, cert, priv, publicHandler, s)
	}); err != nil {
		log.Fatal(err)
	}
}

var _ = hex.EncodeToString
