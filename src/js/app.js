/* =========================================================================
   AuraBeat AI - Controlador Principal + Python Backend Integration
========================================================================= */

const ORIGINAL_FETCH = window.fetch;
window.fetch = function (input, init) {
    if (typeof input === "string" && input.startsWith("/api/")) {
        const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "";
        const base = isLocalhost
            ? (window.location.origin.includes("5000") ? "" : "http://localhost:5000")
            : "";
        return ORIGINAL_FETCH(base + input, init);
    }
    return ORIGINAL_FETCH(input, init);
};

// Algoritmo de similitud fuzzy (Levenshtein normalizado) para búsqueda y comandos por voz
function calcularSimilitudFuzzy(s1, s2) {
    s1 = s1.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
    s2 = s2.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();

    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.85;

    const m = s1.length;
    const n = s2.length;
    if (m === 0 || n === 0) return 0;

    const d = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,       // Borrado
                d[i][j - 1] + 1,       // Inserción
                d[i - 1][j - 1] + cost // Sustitución
            );
        }
    }
    const maxLen = Math.max(m, n);
    return 1.0 - (d[m][n] / maxLen);
}

// Helper: llamar a la API de nuestro servidor Python
async function supabaseFetch(path, options = {}) {
    const res = await fetch(`/api${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    return res;
}

// =========================================================================
// CATÁLOGO — carga desde Supabase
// =========================================================================
const CATALOGO_MOCK = [
    { id: 1, titulo: "Bohemian Rhapsody", artista: "Queen", genero: "Rock", mood: "Energético" },
    { id: 2, titulo: "Shape of You", artista: "Ed Sheeran", genero: "Pop", mood: "Fiesta" },
    { id: 3, titulo: "Lose Yourself", artista: "Eminem", genero: "Hip Hop", mood: "Energético" },
    { id: 4, titulo: "Strobe", artista: "deadmau5", genero: "Electrónica", mood: "Fiesta" },
    { id: 5, titulo: "Hotel California", artista: "Eagles", genero: "Rock", mood: "Relajado" },
    { id: 6, titulo: "Billie Jean", artista: "Michael Jackson", genero: "Pop", mood: "Energético" },
    { id: 7, titulo: "N.Y. State of Mind", artista: "Nas", genero: "Hip Hop", mood: "Relajado" },
    { id: 8, titulo: "Levels", artista: "Avicii", genero: "Electrónica", mood: "Fiesta" },
    { id: 9, titulo: "Don't Stop Me Now", artista: "Queen", genero: "Rock", mood: "Fiesta" },
    { id: 10, titulo: "Blinding Lights", artista: "The Weeknd", genero: "Pop", mood: "Energético" },
    { id: 11, titulo: "HUMBLE.", artista: "Kendrick Lamar", genero: "Hip Hop", mood: "Energético" },
    { id: 12, titulo: "One More Time", artista: "Daft Punk", genero: "Electrónica", mood: "Fiesta" }
];

let catalogoActual = [];
try {
    const cached = localStorage.getItem('aurabeat_cached_catalogo');
    if (cached) {
        catalogoActual = JSON.parse(cached);
    }
} catch (e) {
    console.error("Error reading cached catalog:", e);
}
let historialEscucha = [];
let generosPrevios = []; // Géneros favoritos de la sesión/visita anterior (para detectar cambio de gusto)
let esNuevaVisita = true; // True solo la primera vez que se llama ejecutarIA en la sesión

// Caché de recomendaciones e información de gusto del usuario
let cachedRecomendaciones = null;
let lastRecommendationUser = null;
let lastRecommendationScores = null;
let lastRecommendationLikes = null;
let lastRecommendationHistorial = null;
let lastRecommendationGenres = null;


async function cargarCatalogo() {
    try {
        const res = await supabaseFetch("/catalogo");
        if (!res.ok) throw new Error("Error al cargar catálogo");
        const data = await res.json();

        let newCatalogo = [];
        if (data.length > 0) {
            newCatalogo = data.sort((a, b) => a.titulo.localeCompare(b.titulo));
        }

        const isDifferent = JSON.stringify(newCatalogo) !== JSON.stringify(catalogoActual);

        catalogoActual = newCatalogo;
        window.catalogoActual = catalogoActual;
        localStorage.setItem('aurabeat_cached_catalogo', JSON.stringify(catalogoActual));

        if (isDifferent) {
            // Re-renderizar la vista actual para mostrar las canciones actualizadas (excepto en Comunidad)
            const activeTab = localStorage.getItem('aurabeat_active_tab') || 'btn-nav-inicio';
            if (activeTab !== 'btn-nav-comunidad') {
                const btnTab = document.getElementById(activeTab);
                if (btnTab) btnTab.click();
            }

            // Actualizar el dropdown de artistas
            const artistaDropdown = document.getElementById('search-artista');
            if (artistaDropdown && catalogoActual.length > 0) {
                artistaDropdown.innerHTML = '<option value="">Todos los Artistas</option>';
                const artistas = [...new Set(catalogoActual.map(c => c.artista))].sort((a, b) => a.localeCompare(b));
                artistas.forEach(artista => {
                    const opt = document.createElement('option');
                    opt.value = artista;
                    opt.textContent = artista;
                    artistaDropdown.appendChild(opt);
                });
            }
        }
    } catch (e) {
        console.warn("Servidor no disponible, usando catálogo local o vacío:", e);
    }
}

function tieneHistorial() {
    if (historialEscucha.length > 0) return true;
    if (usuarioActivo && usuarioActivo.likes && usuarioActivo.likes.length > 0) return true;
    return false;
}

function mostrarEstadoVacio() {
    const container = document.getElementById("songs-list");
    const heading = document.getElementById("section-heading-rec");
    if (heading) heading.innerHTML = 'Tu espacio musical <span>›</span>';
    container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
            <div style="font-size: 64px; margin-bottom: 16px; opacity: 0.7;">🎧</div>
            <h3 style="color: white; font-size: 22px; margin: 0 0 10px; font-weight: 600;">¡Bienvenido a AuraBeat AI!</h3>
            <p style="color: #888; font-size: 15px; max-width: 400px; margin: 0 auto 24px; line-height: 1.6;">
                Aún no tienes recomendaciones porque no has escuchado ninguna canción.<br>
                Usa el <strong style='color:#2e77d0;'>buscador 🔍</strong> para encontrar música y empezar a escuchar.
            </p>
            <button onclick="document.getElementById('btn-nav-inicio').click();"
                style="background: linear-gradient(135deg, #2e77d0, #8a2be2); border: none; color: white;
                       padding: 12px 32px; border-radius: 10px; font-size: 15px; font-weight: 600;
                       cursor: pointer; transition: opacity 0.2s;">
                🔍 Explorar Canciones
            </button>
        </div>
    `;
}

// =========================================================================
// SUBIDA DE CANCIONES A SUPABASE
// =========================================================================
function sanearNombreArchivo(nombre) {
    return nombre
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9.-]/g, "_")
        .replace(/_+/g, "_");
}

async function subirCancion(file, titulo, artista, genero, mood, imagenFile = null, imagenUrl = null, index = 1, total = 1, bpm = 100, energia = 50) {
    if (total > 1) {
        mostrarToast(`⬆ Subiendo canción ${index} de ${total}: "${titulo}"...`);
    } else {
        mostrarToast(`⬆ Subiendo "${titulo}"...`);
    }

    const formData = new FormData();
    formData.append("audio", file);
    formData.append("titulo", titulo);
    formData.append("artista", artista);
    formData.append("genero", genero);
    formData.append("mood", mood);
    formData.append("bpm", bpm);
    formData.append("energia", energia);
    if (imagenFile) {
        formData.append("imagen", imagenFile);
    }
    if (imagenUrl) {
        formData.append("imagen_url", imagenUrl);
    }

    try {
        const uploadRes = await fetch("/api/subir", {
            method: "POST",
            body: formData
        });

        if (!uploadRes.ok) {
            const err = await uploadRes.text();
            mostrarToast(`❌ Error al subir "${titulo}": ` + err);
            return { success: false };
        }

        const data = await uploadRes.json();
        return {
            success: true,
            url_imagen: (data.cancion && data.cancion.url_imagen) ? data.cancion.url_imagen : null
        };
    } catch (e) {
        mostrarToast(`❌ Error de conexión al subir "${titulo}".`);
        return { success: false };
    }
}

// =========================================================================
// ADMIN ROLE & SUPABASE INTEGRATION
// =========================================================================
function esUsuarioAdmin() {
    return usuarioActivo && (usuarioActivo.role === 'admin' || usuarioActivo.nombre.trim().toLowerCase() === 'alex');
}

async function asegurarAdminCreado() {
    try {
        await fetch("/api/admin/init", { method: "POST" });
        console.log("Admin asegurado con éxito en servidor Python.");
    } catch (e) {
        console.warn("No se pudo conectar al servidor para asegurar admin:", e);
    }
}

async function asegurarTablaComunidad() {
    console.log('[AuraBeat Comunidad] Verificación de comunidad delegada al servidor Python.');
}

// =========================================================================
// MODAL DE SUBIDA
// =========================================================================
function inicializarModalSubida() {
    const btnCerrar = document.getElementById("btn-cerrar-subida");
    const btnSubir = document.getElementById("btn-do-upload");
    const fileInput = document.getElementById("upload-file");
    const imageInput = document.getElementById("upload-image");
    const imageLabel = document.getElementById("upload-image-label");
    const fileLabel = document.getElementById("upload-file-label");

    if (fileInput && fileLabel) {
        fileInput.onchange = (e) => {
            const files = e.target.files;
            if (files.length > 1) {
                fileLabel.textContent = `📁 ${files.length} archivos seleccionados`;
                fileLabel.style.borderColor = "#2e77d0";
                fileLabel.style.color = "white";
            } else if (files.length === 1) {
                fileLabel.textContent = `📁 ${files[0].name}`;
                fileLabel.style.borderColor = "#2e77d0";
                fileLabel.style.color = "white";
            } else {
                fileLabel.textContent = "📁 Seleccionar archivos MP3";
                fileLabel.style.borderColor = "";
                fileLabel.style.color = "";
            }
        };
    }

    if (imageInput && imageLabel) {
        imageInput.onchange = (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                imageLabel.textContent = `🖼️ Portada: ${files[0].name}`;
                imageLabel.style.borderColor = "#2e77d0";
                imageLabel.style.color = "white";
            } else {
                imageLabel.textContent = "🖼️ Seleccionar Portada (Opcional)";
                imageLabel.style.borderColor = "";
                imageLabel.style.color = "";
            }
        };
    }

    if (btnCerrar) btnCerrar.onclick = cerrarModalSubida;

    if (btnSubir) {
        btnSubir.onclick = async () => {
            if (!esUsuarioAdmin()) {
                mostrarToast('⚠ Solo el administrador puede subir música.');
                return;
            }
            const files = document.getElementById("upload-file").files;
            const artista = document.getElementById("upload-artista").value.trim();
            const genero = document.getElementById("upload-genero").value;
            const mood = document.getElementById("upload-mood").value;

            const bpmInput = document.getElementById("upload-bpm");
            const bpm = bpmInput ? parseInt(bpmInput.value) || 100 : 100;
            const energiaInput = document.getElementById("upload-energia");
            const energia = energiaInput ? parseInt(energiaInput.value) || 50 : 50;

            const imageInput = document.getElementById("upload-image");
            const imagenFile = (imageInput && imageInput.files.length > 0) ? imageInput.files[0] : null;

            if (!files || files.length === 0) {
                mostrarToast("⚠ Selecciona al menos un archivo de audio.");
                return;
            }
            if (!artista) {
                mostrarToast("⚠ Completa el nombre del artista.");
                return;
            }

            for (let i = 0; i < files.length; i++) {
                if (!files[i].name.match(/\.(mp3|wav|ogg|m4a|flac)$/i)) {
                    mostrarToast(`⚠ "${files[i].name}" no es un archivo de audio válido.`);
                    return;
                }
            }

            btnSubir.disabled = true;
            btnSubir.textContent = "Subiendo música...";
            let exitos = 0;
            let lastUploadedImageUrl = null;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const titulo = file.name
                    .replace(/\.[^/.]+$/, "")
                    .replace(/[_-]/g, " ")
                    .trim();

                const imgFile = i === 0 ? imagenFile : null;
                const imgUrl = i > 0 ? lastUploadedImageUrl : null;

                const res = await subirCancion(
                    file, titulo, artista, genero, mood,
                    imgFile, imgUrl, i + 1, files.length,
                    bpm, energia
                );

                if (res.success) {
                    exitos++;
                    if (i === 0 && res.url_imagen) {
                        lastUploadedImageUrl = res.url_imagen;
                    }
                }
            }

            btnSubir.disabled = false;
            btnSubir.textContent = "⬆ Subir Música a la nube";

            if (exitos > 0) {
                mostrarToast(`✅ ¡Música subida! ${exitos} de ${files.length} canciones.`);
                cerrarModalSubida();
                await cargarCatalogo();
                const btnBiblioteca = document.getElementById("btn-nav-biblioteca");
                if (btnBiblioteca) btnBiblioteca.click();
            } else {
                mostrarToast("❌ No se pudo subir ninguna canción.");
            }
        };
    }
}

function cerrarModalSubida() {
    const modal = document.getElementById("modal-subida");
    if (modal) modal.classList.add("hidden");

    const campos = ["upload-titulo", "upload-artista"];
    campos.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ""; el.disabled = false; }
    });

    const inputTitulo = document.getElementById("upload-titulo");
    if (inputTitulo) inputTitulo.placeholder = "Ej: Bohemian Rhapsody";

    const fileInput = document.getElementById("upload-file");
    if (fileInput) fileInput.value = "";

    const label = document.getElementById("upload-file-label");
    if (label) {
        label.textContent = "📁 Seleccionar archivos MP3";
        label.style.borderColor = "";
        label.style.color = "";
    }

    const imageInput = document.getElementById("upload-image");
    if (imageInput) imageInput.value = "";
    const imageLabel = document.getElementById("upload-image-label");
    if (imageLabel) {
        imageLabel.textContent = "🖼️ Seleccionar Portada (Opcional)";
        imageLabel.style.borderColor = "";
        imageLabel.style.color = "";
    }

    const modalTitle = document.getElementById("modal-subida-title");
    if (modalTitle) modalTitle.textContent = "Subir Música";

    const btnSubir = document.getElementById("btn-do-upload");
    if (btnSubir) {
        btnSubir.textContent = "⬆ Subir Música a la nube";
        btnSubir.disabled = false;
    }
}

// Toast de notificaciones
// Toast de notificaciones premium (Listo / Error) con diseño de cristal y filtro de saltos de tiempo
function mostrarToast(msg) {
    // Omitir avisos de reproducción y saltos de 15 segundos (molestos en la pantalla)
    if (msg.includes("segundos") || msg.includes("15") || msg.includes("Modo aleatorio") || msg.includes("Repetir")) {
        return;
    }

    let toast = document.getElementById("toast-notif");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast-notif";
        document.body.appendChild(toast);
    }

    // Estilos base premium
    toast.style.cssText = `
        position: fixed;
        bottom: 86px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(10, 8, 26, 0.95);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: white;
        padding: 10px 18px;
        border-radius: 30px;
        font-size: 13.5px;
        font-family: 'Inter', sans-serif;
        font-weight: 500;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
        transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.25);
        opacity: 0;
        pointer-events: none;
        border: 1px solid rgba(255, 255, 255, 0.1);
    `;

    // Determinar tipo: éxito, error o info
    let typeText = "INFO";
    let iconColor = "#9b51e0";
    let borderColor = "rgba(155, 81, 224, 0.3)";

    // Limpiar los emojis toscos iniciales del mensaje original
    let cleanMsg = msg.replace(/^[✅❌⚠ℹ🔀🔁🗑↺]+/, '').trim();

    if (msg.includes("✅") || msg.toLowerCase().includes("exito") || msg.toLowerCase().includes("creada") || msg.toLowerCase().includes("añadida") || msg.toLowerCase().includes("correctamente") || msg.toLowerCase().includes("eliminada")) {
        typeText = "LISTO";
        iconColor = "#00e676";
        borderColor = "rgba(0, 230, 118, 0.35)";
    } else if (msg.includes("❌") || msg.includes("⚠") || msg.toLowerCase().includes("error") || msg.toLowerCase().includes("no se pudo") || msg.toLowerCase().includes("debes") || msg.toLowerCase().includes("error")) {
        typeText = "ERROR";
        iconColor = "#ff1744";
        borderColor = "rgba(255, 23, 68, 0.35)";
    }

    toast.style.borderColor = borderColor;

    // Contenido maquetado con badges elegantes
    toast.innerHTML = `
        <span style="font-size:10px; display:inline-flex; align-items:center; justify-content:center; background:${iconColor}18; color:${iconColor}; padding:2px 8px; border-radius:20px; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; border:1px solid ${iconColor}30; flex-shrink:0;">
            ${typeText}
        </span>
        <span style="color:rgba(255,255,255,0.95); margin-right:4px;">${cleanMsg}</span>
    `;

    // Disparar animación
    setTimeout(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateX(-50%) translateY(0)";
    }, 15);

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-50%) translateY(20px)";
    }, 2800);
}

// =========================================================================
// REPRODUCTOR DE AUDIO REAL
// =========================================================================
let audioPlayer = new Audio();
audioPlayer.volume = 0.8;
audioPlayer.preload = 'metadata';
let shuffleActivo = false;
let repeatActivo = false;

audioPlayer.onended = () => {
    const disc = document.getElementById("player-disc");
    if (disc) disc.classList.remove("spinning");

    if (repeatActivo) {
        audioPlayer.currentTime = 0;
        audioPlayer.play().catch(e => {
            console.error("Error al autoreproducir:", e);
        });
        if (disc) disc.classList.add("spinning");
        return;
    }

    const celdas = document.querySelectorAll('.track-list-row');
    if (celdas.length === 0) return;

    if (shuffleActivo) {
        let nuevoIdx;
        do {
            nuevoIdx = Math.floor(Math.random() * celdas.length);
        } while (nuevoIdx === indiceActual && celdas.length > 1);
        indiceActual = nuevoIdx;
    } else {
        indiceActual = (indiceActual + 1) % celdas.length;
    }
    celdas[indiceActual].click();
};

// Avanzar automáticamente si hay error de reproducción (canción sin audio, CORS, etc.)
audioPlayer.onerror = () => {
    console.warn('[AuraBeat] Error al reproducir la canción. Avanzando a la siguiente...');
    const celdas = document.querySelectorAll('.track-list-row');
    if (celdas.length === 0) return;

    // Pequeño delay para evitar bucle infinito en dispositivos lentos
    setTimeout(() => {
        if (shuffleActivo) {
            let nuevoIdx;
            do {
                nuevoIdx = Math.floor(Math.random() * celdas.length);
            } while (nuevoIdx === indiceActual && celdas.length > 1);
            indiceActual = nuevoIdx;
        } else {
            indiceActual = (indiceActual + 1) % celdas.length;
        }
        celdas[indiceActual].click();
    }, 800);
};

audioPlayer.ontimeupdate = () => {
    const progressEl = document.getElementById("player-progress-bar");
    const currentEl = document.getElementById("player-current-time");
    const durationEl = document.getElementById("player-duration");
    if (!progressEl || !audioPlayer.duration) return;

    const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    progressEl.style.width = `${pct}%`;
    if (currentEl) currentEl.textContent = formatTime(audioPlayer.currentTime);
    if (durationEl) durationEl.textContent = formatTime(audioPlayer.duration);
};

function formatTime(s) {
    if (isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
}

// =========================================================================
// STORAGE LOCAL — usuarios y sesión
// =========================================================================
const STORAGE_SESSION_KEY = "mzb_active_session";

let usuarioActivo = null;
let cancionActual = null;
let indiceActual = 0;

async function registrarUsuario(nombre, password, generoFav) {
    try {
        const res = await fetch("/api/registro", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, password, generofav: generoFav })
        });
        return res.ok;
    } catch (e) {
        console.error("Error al registrar:", e);
        return false;
    }
}

async function loginUsuario(nombre, password) {
    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, password })
        });
        if (!res.ok) {
            const errData = await res.json();
            return { error: errData.error || "error" };
        }
        return await res.json();
    } catch (e) {
        console.error("Error al ingresar:", e);
        return null;
    }
}

async function guardarEstadoUsuario() {
    if (!usuarioActivo || usuarioActivo.nombre === "Invitado") return;

    try {
        await fetch("/api/usuario/estado", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nombre: usuarioActivo.nombre,
                scores: usuarioActivo.scores,
                likes: usuarioActivo.likes,
                playlists: usuarioActivo.playlists
            })
        });
    } catch (e) {
        console.warn("Error guardando estado en servidor:", e);
    }

    localStorage.setItem(STORAGE_SESSION_KEY, btoa(JSON.stringify(usuarioActivo)));
}

// =========================================================================
// MODAL DE AUTENTICACIÓN
// =========================================================================
function inicializarModal() {
    document.getElementById("tab-login-btn").onclick = () => cambiarTab("login");
    document.getElementById("tab-register-btn").onclick = () => cambiarTab("register");

    document.getElementById("btn-do-login").onclick = async () => {
        const nombre = document.getElementById("login-name").value.trim();
        const pass = document.getElementById("login-pass").value;
        const errorEl = document.getElementById("login-error");
        if (!nombre || !pass) { mostrarError(errorEl, "Completa todos los campos."); return; }

        const btn = document.getElementById("btn-do-login");
        const prevText = btn.textContent;
        btn.textContent = "Ingresando...";
        btn.disabled = true;

        const result = await loginUsuario(nombre, pass);

        btn.textContent = prevText;
        btn.disabled = false;

        if (!result || result.error) {
            mostrarError(errorEl, result && result.error === "not_found"
                ? "⚠ Ese usuario no existe. Ve a \"Crear Cuenta\" primero."
                : "Contraseña incorrecta. Intenta de nuevo."
            );
            return;
        }
        errorEl.classList.add("hidden");
        usuarioActivo = result;
        historialEscucha = [];
        localStorage.setItem(STORAGE_SESSION_KEY, btoa(JSON.stringify(usuarioActivo)));
        cerrarModal();
        mostrarPerfil();
        if (tieneHistorial()) {
            if (typeof window.ejecutarIA === "function") window.ejecutarIA(true);
        } else {
            mostrarEstadoVacio();
        }
    };

    document.getElementById("btn-guest").onclick = () => {
        usuarioActivo = { nombre: "Invitado", scores: {}, likes: [], playlists: [] };
        historialEscucha = [];
        cerrarModal();
        mostrarPerfil();
        mostrarEstadoVacio();
    };

    document.getElementById("btn-do-register").onclick = async () => {
        const nombre = document.getElementById("reg-name").value.trim();
        const pass = document.getElementById("reg-pass").value;
        const genero = document.getElementById("reg-genero").value;
        const errorEl = document.getElementById("reg-error");
        if (!nombre || !pass) { mostrarError(errorEl, "Completa todos los campos."); return; }

        const btn = document.getElementById("btn-do-register");
        const prevText = btn.textContent;
        btn.textContent = "Creando cuenta...";
        btn.disabled = true;

        const success = await registrarUsuario(nombre, pass, genero);

        btn.textContent = prevText;
        btn.disabled = false;

        if (!success) {
            mostrarError(errorEl, "Ese nombre de usuario ya existe o error de conexión."); return;
        }
        errorEl.classList.add("hidden");
        usuarioActivo = await loginUsuario(nombre, pass);
        historialEscucha = [];
        localStorage.setItem(STORAGE_SESSION_KEY, btoa(JSON.stringify(usuarioActivo)));
        cerrarModal();
        mostrarPerfil();
        if (tieneHistorial()) {
            if (typeof window.ejecutarIA === "function") window.ejecutarIA(true);
        } else {
            mostrarEstadoVacio();
        }
    };

    const hacerLogout = () => {
        localStorage.removeItem(STORAGE_SESSION_KEY);
        audioPlayer.pause();
        usuarioActivo = { nombre: "Invitado", scores: {}, likes: [], playlists: [] };
        historialEscucha = [];

        // Limpiar caché de recomendaciones
        cachedRecomendaciones = null;
        lastRecommendationUser = null;
        lastRecommendationScores = null;
        lastRecommendationLikes = null;
        lastRecommendationHistorial = null;
        lastRecommendationGenres = null;

        document.getElementById("user-name-display").textContent = "Invitado";
        document.getElementById("user-fav-genre").textContent = "Fav: —";
        document.getElementById("auth-user-panel").classList.add("hidden");
        document.getElementById("auth-guest-panel").classList.remove("hidden");
        document.getElementById("sel-genero").value = "";
        const headerLetter = document.getElementById("header-avatar-letter");
        if (headerLetter) headerLetter.textContent = "👤";
        const dropdownName = document.getElementById("dropdown-username");
        if (dropdownName) dropdownName.textContent = "Invitado";
        const dropdown = document.getElementById("user-dropdown");
        if (dropdown) dropdown.classList.add("hidden");
        mostrarEstadoVacio();
        mostrarPerfil();
    };

    document.getElementById("btn-logout").onclick = hacerLogout;
    const dropdownLogout = document.getElementById("dropdown-logout");
    if (dropdownLogout) dropdownLogout.onclick = hacerLogout;

    document.getElementById("btn-open-login").onclick = abrirModal;

    const headerLoginBtn = document.getElementById("header-login-btn");
    if (headerLoginBtn) headerLoginBtn.onclick = abrirModal;

    const sesionGuardada = localStorage.getItem(STORAGE_SESSION_KEY);
    if (sesionGuardada) {
        try {
            const sesionLocal = JSON.parse(atob(sesionGuardada));
            if (sesionLocal.nombre && sesionLocal.nombre !== "Invitado") {
                fetch("/api/usuario/refrescar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nombre: sesionLocal.nombre })
                })
                    .then(r => r.json())
                    .then(data => {
                        if (data && !data.error) {
                            usuarioActivo = data;
                            localStorage.setItem(STORAGE_SESSION_KEY, btoa(JSON.stringify(usuarioActivo)));
                        }
                    })
                    .catch(() => { });
            }
            usuarioActivo = sesionLocal;
            historialEscucha = [];
            cerrarModal();
            mostrarPerfil();
        } catch (e) {
            usuarioActivo = { nombre: "Invitado", scores: {}, likes: [], playlists: [] };
        }
    } else {
        usuarioActivo = { nombre: "Invitado", scores: {}, likes: [], playlists: [] };
    }
}

function cambiarTab(tab) {
    const isLogin = tab === "login";
    document.getElementById("form-login").classList.toggle("hidden", !isLogin);
    document.getElementById("form-register").classList.toggle("hidden", isLogin);
    document.getElementById("tab-login-btn").classList.toggle("active", isLogin);
    document.getElementById("tab-register-btn").classList.toggle("active", !isLogin);
}

function abrirModal() { document.getElementById("modal-auth").classList.remove("hidden"); }
function cerrarModal() { document.getElementById("modal-auth").classList.add("hidden"); }

function mostrarError(el, msg) {
    el.textContent = msg;
    el.classList.remove("hidden");
}

/**
 * Muestra un toast cuando la IA detecta un cambio de géneros favoritos durante la sesión.
 * Por ejemplo: el usuario lleva 2h escuchando y cambió de Cumbia → Rock.
 */
function mostrarToastCambioGenero(nuevosGeneros) {
    let toast = document.getElementById("toast-cambio-genero");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast-cambio-genero";
        toast.style.cssText = `
            position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
            background: linear-gradient(135deg, #7c3aed, #4f46e5);
            color: #fff; padding: 12px 20px; border-radius: 12px;
            font-size: 13px; z-index: 9999; box-shadow: 0 4px 20px rgba(124,58,237,0.5);
            display: flex; align-items: center; gap: 8px; max-width: 340px;
            animation: slideUpFade 0.4s ease;
        `;
        document.body.appendChild(toast);
    }
    toast.innerHTML = `🔄 <strong>¡Nuevo gusto detectado!</strong> La IA actualizó tus recomendaciones a: <em>${nuevosGeneros}</em>`;
    toast.style.display = "flex";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.display = "none"; }, 4000);
}

function mostrarPerfil() {
    const isLoggedIn = usuarioActivo && usuarioActivo.nombre !== "Invitado";
    const headerLoginBtn = document.getElementById("header-login-btn");
    const userMenuWrapper = document.getElementById("user-menu-wrapper");

    if (isLoggedIn) {
        document.getElementById("auth-guest-panel").classList.add("hidden");
        document.getElementById("auth-user-panel").classList.remove("hidden");
        if (headerLoginBtn) headerLoginBtn.style.display = "none";
        if (userMenuWrapper) {
            userMenuWrapper.style.display = "block";
            userMenuWrapper.classList.remove("hidden");
        }
    } else {
        document.getElementById("auth-user-panel").classList.add("hidden");
        document.getElementById("auth-guest-panel").classList.remove("hidden");
        if (headerLoginBtn) headerLoginBtn.style.display = "block";
        if (userMenuWrapper) {
            userMenuWrapper.style.display = "none";
            userMenuWrapper.classList.add("hidden");
        }
    }

    document.getElementById("user-name-display").textContent = usuarioActivo.nombre;
    actualizarVistaGeneroFavorito();

    const headerLetter = document.getElementById("header-avatar-letter");
    if (headerLetter && isLoggedIn) {
        headerLetter.textContent = usuarioActivo.nombre.charAt(0).toUpperCase();
    } else if (headerLetter) {
        headerLetter.textContent = "👤";
    }

    const dropdownName = document.getElementById("dropdown-username");
    if (dropdownName) dropdownName.textContent = usuarioActivo.nombre;

    actualizarPlaylists();

    const uploadBtn = document.querySelector('.btn-subir-cancion');
    if (uploadBtn) uploadBtn.style.display = esUsuarioAdmin() ? '' : 'none';
    const deleteBtn = document.getElementById('btn-delete-current');
    if (deleteBtn) deleteBtn.style.display = esUsuarioAdmin() ? '' : 'none';

    // Si el usuario está en la pestaña comunidad y cambia su sesión, actualizar para desbloquear o bloquear el chat
    const activeTab = document.querySelector(".nav-item.active");
    if (activeTab && activeTab.id === "btn-nav-comunidad") {
        inicializarComunidad();
    }
}

function actualizarPlaylists() {
    const container = document.getElementById("sidebar-playlists-container");
    if (!container) return;

    if (!usuarioActivo.likes) usuarioActivo.likes = [];
    if (!usuarioActivo.playlists) usuarioActivo.playlists = [];

    container.innerHTML = "";

    const favDiv = document.createElement("div");
    favDiv.className = "playlist-item";
    favDiv.innerHTML = `
        <div class="pl-icon">♪</div>
        <div class="pl-info">
            <span class="pl-name">Mis Favoritas</span>
            <span class="pl-count">${usuarioActivo.likes.length} canciones</span>
        </div>
    `;
    favDiv.onclick = () => {
        const likedSongs = (typeof catalogoActual !== 'undefined' ? catalogoActual : []).filter(c => usuarioActivo.likes.includes(c.id));
        const headerTitle = document.getElementById("section-heading-rec");
        if (headerTitle) headerTitle.textContent = "Mis Favoritas";
        renderizarCanciones(likedSongs);
    };
    container.appendChild(favDiv);

    usuarioActivo.playlists.forEach((pl, idx) => {
        const plDiv = document.createElement("div");
        plDiv.className = "playlist-item";
        const colorClass = idx % 2 === 0 ? "pl-blue" : "pl-purple";
        plDiv.innerHTML = `
            <div class="pl-icon ${colorClass}">♪</div>
            <div class="pl-info">
                <span class="pl-name">${pl.nombre}</span>
                <span class="pl-count">${pl.canciones.length} canciones</span>
            </div>
            <button class="pl-remove-btn" title="Eliminar playlist">×</button>
        `;

        plDiv.onclick = () => {
            const plSongs = (typeof catalogoActual !== 'undefined' ? catalogoActual : []).filter(c => pl.canciones.includes(c.id));
            const headerTitle = document.getElementById("section-heading-rec");
            if (headerTitle) headerTitle.textContent = pl.nombre;
            renderizarCancionesPlaylist(plSongs, pl, idx);
        };

        plDiv.querySelector(".pl-remove-btn").onclick = (e) => {
            e.stopPropagation();
            if (confirm(`¿Eliminar la playlist "${pl.nombre}"?`)) {
                usuarioActivo.playlists.splice(idx, 1);
                guardarEstadoUsuario();
                actualizarPlaylists();
                mostrarToast(`🗑 Playlist "${pl.nombre}" eliminada.`);
            }
        };

        container.appendChild(plDiv);
    });

    const btnNew = document.getElementById("btn-new-playlist");
    if (btnNew) {
        btnNew.onclick = () => {
            const modal = document.getElementById("modal-new-playlist");
            const input = document.getElementById("new-playlist-name");
            if (!modal || !input) return;

            input.value = "";
            modal.classList.remove("hidden");
            setTimeout(() => input.focus(), 50);

            const cerrar = () => modal.classList.add("hidden");

            document.getElementById("btn-cerrar-new-playlist").onclick = cerrar;
            document.getElementById("btn-cancel-new-playlist").onclick = cerrar;
            modal.onclick = (e) => { if (e.target === modal) cerrar(); };

            const crear = () => {
                const nombre = input.value.trim();
                if (!nombre) {
                    input.style.borderColor = "#ff4444";
                    setTimeout(() => input.style.borderColor = "#2a2a2a", 1500);
                    return;
                }
                usuarioActivo.playlists.push({ nombre, canciones: [] });
                guardarEstadoUsuario();
                actualizarPlaylists();
                mostrarToast(`🎶 Playlist "${nombre}" creada.`);
                cerrar();
            };

            document.getElementById("btn-confirm-new-playlist").onclick = crear;
            input.onkeydown = (e) => { if (e.key === "Enter") crear(); };
            input.onfocus = () => input.style.borderColor = "#2e77d0";
            input.onblur = () => input.style.borderColor = "#2a2a2a";
        };
    }
}

// =========================================================================
// MACHINE LEARNING
// =========================================================================

async function registrarInteraccion(cancion, accion) {
    if (!usuarioActivo || !cancion) return;
    const genero = cancion.genero;
    // Activar Factor de Olvido en sesión después de 10 canciones escuchadas
    // (para detectar cambios de gusto durante sesiones largas de 2-3 horas)
    const aplicarDecay = historialEscucha.length >= 10;

    try {
        const res = await fetch("/api/interaccion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                scores: usuarioActivo.scores,
                genero: genero,
                accion: accion,
                aplicar_decay: aplicarDecay  // Activa decay de sesión tras 10 canciones
            })
        });
        if (res.ok) {
            const data = await res.json();
            usuarioActivo.scores = data.scores;
            logIA(`[ML] ${accion} registrado para ${genero}${aplicarDecay ? ' (con decay de sesión)' : ''}.`);
        }
    } catch (e) {
        console.error("Error en interacción RL:", e);
    }

    guardarEstadoUsuario();
    actualizarVistaGeneroFavorito();

}

function mostrarEsqueletoCargaRecomendaciones() {
    const container = document.getElementById("songs-list");
    if (!container) return;

    container.classList.remove("grid-view");
    const trackHeader = document.getElementById("track-header");
    if (trackHeader) trackHeader.style.display = "none";

    let rowsHtml = "";
    for (let i = 0; i < 5; i++) {
        rowsHtml += `
            <div class="skeleton-row" style="margin-bottom: 8px;">
                <div class="skeleton-cell num" style="grid-column: 1;"></div>
                <div class="col-title" style="grid-column: 2;">
                    <div class="skeleton-cell img"></div>
                    <div class="col-title-text">
                        <div class="skeleton-cell title"></div>
                        <div class="skeleton-cell artist"></div>
                    </div>
                </div>
                <div class="skeleton-cell genre" style="grid-column: 3;"></div>
                <div class="skeleton-cell duration" style="grid-column: 4;"></div>
                <div></div>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="recommendations-loading">
            <div class="loading-ai-header">
                <div class="loading-ai-icon">🧠</div>
                <div class="loading-ai-text">
                    <h4>AuraBeat AI está analizando tus gustos</h4>
                    <p>Consultando el motor de inteligencia artificial y generando recomendaciones personalizadas...</p>
                </div>
            </div>
            ${rowsHtml}
        </div>
    `;
}

function calcularTopGenerosFront(scores, historial, n = 2) {
    if (!scores && (!historial || historial.length === 0)) {
        return [];
    }

    // 1. Calcular scores del historial reciente (últimas 20 canciones)
    const recientes = (historial || []).slice(-20);
    const recienteConteo = {};
    recientes.forEach(cancion => {
        const gen = cancion.genero;
        if (gen) {
            recienteConteo[gen] = (recienteConteo[gen] || 0) + 1;
        }
    });

    // 2. Combinar: 70% historial reciente + 30% scores históricos
    const scoresCombinados = {};
    const todosGeneros = new Set([
        ...Object.keys(scores || {}),
        ...Object.keys(recienteConteo)
    ]);

    todosGeneros.forEach(gen => {
        const scoreHist = (scores || {})[gen] || 0;
        const scoreRec = (recienteConteo[gen] || 0) * 3; // Escalar conteo reciente
        scoresCombinados[gen] = Number((scoreRec * 0.70 + scoreHist * 0.30).toFixed(2));
    });

    // 3. Ordenar desc y tomar los top n
    const sortedGenres = Object.entries(scoresCombinados)
        .sort((a, b) => b[1] - a[1]);

    return sortedGenres.slice(0, n).map(entry => entry[0]);
}

window.ejecutarIA = async function (force = false) {
    if (!usuarioActivo || usuarioActivo.nombre === "Invitado") {
        mostrarEstadoVacio();
        return;
    }

    const currentScoresStr = JSON.stringify(usuarioActivo.scores || {});
    const currentLikesStr = JSON.stringify(usuarioActivo.likes || []);
    const currentHistorialStr = JSON.stringify((historialEscucha || []).map(c => c.id));
    const currentUser = usuarioActivo.nombre;
    const currentTopGenresStr = JSON.stringify(calcularTopGenerosFront(usuarioActivo.scores, historialEscucha, 2));

    // Si el gusto no cambió a nivel de géneros top, usar la caché directamente sin skeleton
    if (
        !force &&
        cachedRecomendaciones &&
        lastRecommendationUser === currentUser &&
        lastRecommendationGenres === currentTopGenresStr
    ) {
        logIA("Los géneros top recomendados no han cambiado (" + currentTopGenresStr + "). Mostrando recomendaciones desde la caché.");
        renderizarCanciones(cachedRecomendaciones);
        return;
    }

    // Solo mostrar skeleton cuando realmente necesitamos consultar el servidor
    mostrarEsqueletoCargaRecomendaciones();
    logIA("Consultando motor de IA en servidor Python...");

    try {
        const res = await fetch("/api/recomendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nombre: usuarioActivo.nombre,
                scores: usuarioActivo.scores,
                likes: usuarioActivo.likes,
                historial: historialEscucha,
                generos_anteriores: generosPrevios,     // Para detectar si el gusto cambió
                es_nueva_visita: esNuevaVisita          // Para aplicar decaimiento al entrar
            })
        });

        if (!res.ok) throw new Error("Error en servidor de recomendaciones");

        const data = await res.json();

        // Marcar que ya no es nueva visita para esta sesión
        esNuevaVisita = false;

        // Actualizar scores si el backend aplicó decaimiento
        if (data.scores_decaidos) {
            usuarioActivo.scores = data.scores_decaidos;
            guardarEstadoUsuario();
        }

        // Detectar y notificar cambio de gusto
        if (data.cambio_genero && generosPrevios.length > 0) {
            const nuevosGen = (data.top_generos || []).join(' & ');
            mostrarToastCambioGenero(nuevosGen);
        }

        // Guardar géneros actuales como referencia para la próxima comparación
        if (data.top_generos && data.top_generos.length > 0) {
            generosPrevios = data.top_generos;
        }

        // Loggear mensajes de la consola de IA del backend
        if (data.log) {
            data.log.forEach(msg => logIA(msg));
        }

        // Renderizar las canciones recomendadas ordenadas de A-Z
        if (data.recomendaciones) {
            const recomendadasOrdenadas = [...data.recomendaciones].sort((a, b) =>
                a.titulo.localeCompare(b.titulo)
            );

            // Guardar en caché local
            cachedRecomendaciones = recomendadasOrdenadas;
            lastRecommendationUser = currentUser;
            lastRecommendationScores = JSON.stringify(usuarioActivo.scores || {});
            lastRecommendationLikes = currentLikesStr;
            lastRecommendationHistorial = currentHistorialStr;
            lastRecommendationGenres = currentTopGenresStr;

            renderizarCanciones(recomendadasOrdenadas);
        }
    } catch (e) {
        logIA("❌ Error al ejecutar IA en el servidor: " + e.message);
        console.error(e);
        const container = document.getElementById("songs-list");
        if (container) {
            container.innerHTML = "<p style='color:var(--text-muted); grid-column: 1 / -1; padding: 20px;'>❌ Error al cargar recomendaciones de IA. Por favor, intenta de nuevo.</p>";
        }
    }
};

// Actualiza scores en background sin borrar ni recargar la lista de canciones
window.ejecutarIASilenciosa = async function () {
    if (!usuarioActivo || usuarioActivo.nombre === "Invitado") return;
    try {
        const res = await fetch("/api/recomendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nombre: usuarioActivo.nombre,
                scores: usuarioActivo.scores,
                likes: usuarioActivo.likes,
                historial: historialEscucha,
                generos_anteriores: generosPrevios,
                es_nueva_visita: false
            })
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.scores_decaidos) {
            usuarioActivo.scores = data.scores_decaidos;
            guardarEstadoUsuario();
        }
        if (data.top_generos && data.top_generos.length > 0) {
            generosPrevios = data.top_generos;
        }
        // NO redibuja la lista para no interrumpir la reproducción
    } catch (e) {
        console.warn("[IA Silenciosa] Error ignorado:", e);
    }
};

window.guardarGustoRecomendado = function (top, mood) {
    // Delegado al backend durante la llamada a /api/recomendar e /api/interaccion
};

window.calcularMoodPreferido = function (catalogo) {
    return null;
};

function obtenerGeneroDominante() {
    if (!usuarioActivo) return null;
    let max = 0, dominante = null;
    for (const [gen, score] of Object.entries(usuarioActivo.scores)) {
        if (score > max) { max = score; dominante = gen; }
    }
    return dominante;
}

// ── NUEVO: devuelve los N géneros con mayor score ordenados de mayor a menor
function obtenerTopGeneros(n = 2) {
    if (!usuarioActivo) return [];
    return Object.entries(usuarioActivo.scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([genero]) => genero);
}

function actualizarVistaGeneroFavorito() {
    const fav = obtenerGeneroDominante();
    document.getElementById("user-fav-genre").textContent = `Fav: ${fav || "—"}`;
    if (fav) document.getElementById("sel-genero").value = fav;
}

// =========================================================================
// REPRODUCTOR (con audio real)
// =========================================================================
function inicializarReproductor() {
    const btnLike = document.getElementById("btn-like");
    btnLike.onclick = () => {
        if (!cancionActual || !usuarioActivo) return;
        if (typeof window.alternarLikeFila === "function") {
            window.alternarLikeFila(cancionActual.id, btnLike);
        }
    };

    let btnAddPlaylist = document.getElementById("btn-add-playlist");
    if (!btnAddPlaylist) {
        const controlsRow = document.querySelector(".player-controls-row");
        if (controlsRow) {
            btnAddPlaylist = document.createElement("button");
            btnAddPlaylist.id = "btn-add-playlist";
            btnAddPlaylist.className = "player-btn";
            btnAddPlaylist.title = "Agregar a playlist";
            btnAddPlaylist.textContent = "➕";
            controlsRow.appendChild(btnAddPlaylist);
        }
    }
    if (btnAddPlaylist) {
        btnAddPlaylist.onclick = () => {
            if (!cancionActual) {
                mostrarToast("⚠ No hay ninguna canción reproduciéndose.");
                return;
            }
            abrirModalPlaylists(cancionActual.id);
        };
    }

    document.getElementById("btn-next").onclick = () => {
        registrarInteraccion(cancionActual, 'skip');
        const celdas = document.querySelectorAll('.track-list-row');
        if (!celdas.length) return;
        indiceActual = (indiceActual + 1) % celdas.length;
        celdas[indiceActual].click();
    };

    document.getElementById("btn-prev").onclick = () => {
        const celdas = document.querySelectorAll('.track-list-row');
        if (!celdas.length) return;
        indiceActual = (indiceActual - 1 + celdas.length) % celdas.length;
        celdas[indiceActual].click();
    };

    document.getElementById("btn-play").onclick = () => {
        if (!cancionActual) return;
        const disc = document.getElementById("player-disc");
        if (!audioPlayer.src || audioPlayer.src === window.location.href) {
            if (cancionActual.url_audio) {
                reproducirCancion(cancionActual, null);
            } else {
                mostrarToast("ℹ Esta canción no tiene audio.");
            }
            return;
        }
        if (audioPlayer.paused) {
            audioPlayer.play().catch(e => {
                if (e.name !== 'AbortError' && !e.message.includes('interrupted by a call to pause')) {
                    mostrarToast("⚠ No hay audio disponible para esta canción: " + e.message);
                }
            });
            document.getElementById("btn-play").textContent = "⏸";
            if (disc) disc.classList.add("spinning");
        } else {
            audioPlayer.pause();
            document.getElementById("btn-play").textContent = "▶";
            if (disc) disc.classList.remove("spinning");
        }
    };

    const btnDeleteCurrent = document.getElementById("btn-delete-current");
    if (btnDeleteCurrent) {
        btnDeleteCurrent.onclick = () => {
            if (!esUsuarioAdmin()) {
                mostrarToast('⚠ Solo el administrador puede eliminar canciones.');
                return;
            }
            if (cancionActual) {
                mostrarConfirmacionEliminar(cancionActual);
            } else {
                mostrarToast("⚠ No hay ninguna canción reproduciéndose.");
            }
        };
    }

    // Control de volumen
    const volSlider = document.querySelector(".vol-slider");
    const volIcon = document.querySelector(".vol-icon");
    if (volSlider) {
        let isDragging = false;

        const updateVolume = (clientX) => {
            const rect = volSlider.getBoundingClientRect();
            const pct = (clientX - rect.left) / rect.width;
            const volume = Math.max(0, Math.min(1, pct));
            audioPlayer.volume = volume;

            const progress = volSlider.querySelector(".vol-progress");
            if (progress) progress.style.width = `${volume * 100}%`;

            if (volIcon) {
                if (volume === 0) volIcon.textContent = "🔇";
                else if (volume < 0.4) volIcon.textContent = "🔈";
                else if (volume < 0.7) volIcon.textContent = "🔉";
                else volIcon.textContent = "🔊";
            }
        };

        volSlider.onmousedown = (e) => {
            isDragging = true;
            updateVolume(e.clientX);
        };

        window.addEventListener("mousemove", (e) => {
            if (isDragging) updateVolume(e.clientX);
        });

        window.addEventListener("mouseup", () => {
            isDragging = false;
        });

        if (volIcon) {
            let lastVolume = 0.8;
            volIcon.onclick = () => {
                const progress = volSlider.querySelector(".vol-progress");
                if (audioPlayer.volume > 0) {
                    lastVolume = audioPlayer.volume;
                    audioPlayer.volume = 0;
                    if (progress) progress.style.width = "0%";
                    volIcon.textContent = "🔇";
                } else {
                    audioPlayer.volume = lastVolume;
                    if (progress) progress.style.width = `${lastVolume * 100}%`;
                    if (lastVolume < 0.4) volIcon.textContent = "🔈";
                    else if (lastVolume < 0.7) volIcon.textContent = "🔉";
                    else volIcon.textContent = "🔊";
                }
            };
        }
    }

    // Barra de progreso clickeable
    const progressWrap = document.getElementById("player-progress-wrap");
    if (progressWrap) {
        progressWrap.onclick = (e) => {
            if (!audioPlayer.duration) return;
            const rect = progressWrap.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            audioPlayer.currentTime = pct * audioPlayer.duration;
        };
    }

    // Botón Shuffle
    const btnShuffle = document.getElementById("btn-shuffle");
    if (btnShuffle) {
        btnShuffle.onclick = () => {
            shuffleActivo = !shuffleActivo;
            btnShuffle.classList.toggle("active", shuffleActivo);
            mostrarToast(shuffleActivo ? "🔀 Modo aleatorio activado" : "🔀 Modo aleatorio desactivado");
        };
    }

    // Botón Repeat
    const btnRepeat = document.getElementById("btn-repeat");
    if (btnRepeat) {
        btnRepeat.onclick = () => {
            repeatActivo = !repeatActivo;
            btnRepeat.classList.toggle("active", repeatActivo);
            mostrarToast(repeatActivo ? "🔁 Repetir canción activado" : "🔁 Repetir desactivado");
        };
    }

    // Retroceder 15 segundos
    const btnRewind15 = document.getElementById("btn-rewind15");
    if (btnRewind15) {
        btnRewind15.onclick = () => {
            if (!audioPlayer.src || audioPlayer.src === window.location.href) {
                mostrarToast("⚠ No hay canción cargada.");
                return;
            }
            // Si ya sabemos la duración, úsala; si no, simplemente resta 15s
            audioPlayer.currentTime = Math.max(0, (audioPlayer.currentTime || 0) - 15);
            mostrarToast("↺ -15 segundos");
        };
    }

    // Avanzar 15 segundos
    const btnForward15 = document.getElementById("btn-forward15");
    if (btnForward15) {
        btnForward15.onclick = () => {
            if (!audioPlayer.src || audioPlayer.src === window.location.href) {
                mostrarToast("⚠ No hay canción cargada.");
                return;
            }
            // Si ya sabemos la duración, limita al final; si no, simplemente suma 15s
            if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 15);
            } else {
                audioPlayer.currentTime = (audioPlayer.currentTime || 0) + 15;
            }
            mostrarToast("15↻ +15 segundos");
        };
    }

    inicializarVisualizador();
}

function inicializarVisualizador() {
    const canvas = document.getElementById("player-visualizer");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const barCount = 48;
    let barHeights = new Array(barCount).fill(2);

    function dibujar() {
        canvas.width = canvas.offsetWidth;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const barW = Math.max(2, (w / barCount) - 2);
        const gap = 2;

        for (let i = 0; i < barCount; i++) {
            if (!audioPlayer.paused && audioPlayer.duration) {
                const t = performance.now() / 1000;
                const wave = Math.sin(t * 3 + i * 0.5) * 0.5 + 0.5;
                const wave2 = Math.sin(t * 2.3 + i * 0.8) * 0.3 + 0.5;
                barHeights[i] = (wave * wave2) * (h - 4) + 2;
            } else {
                barHeights[i] += (2 - barHeights[i]) * 0.12;
            }

            const x = i * (barW + gap);
            const bh = barHeights[i];
            const y = (h - bh) / 2;

            const grad = ctx.createLinearGradient(x, y, x, y + bh);
            grad.addColorStop(0, "rgba(94, 23, 235, 0.9)");
            grad.addColorStop(1, "rgba(0, 122, 255, 0.6)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(x, y, barW, bh, 1);
            ctx.fill();
        }
        requestAnimationFrame(dibujar);
    }
    dibujar();
}

// =========================================================================
// RENDERIZADO DE CANCIONES
// =========================================================================
const gradientes = [
    "linear-gradient(135deg, #2e77d0, #8a2be2)",
    "linear-gradient(135deg, #00d2ff, #3a7bd5)",
    "linear-gradient(135deg, #1f1c2c, #928DAB)",
    "linear-gradient(135deg, #4A00E0, #8E2DE2)",
    "linear-gradient(135deg, #007aff, #5e17eb)",
    "linear-gradient(135deg, #0099ff, #a044ff)"
];

function renderizarCanciones(lista) {
    const container = document.getElementById("songs-list");
    container.classList.remove("grid-view");
    const trackHeader = document.getElementById("track-header");
    if (trackHeader) trackHeader.style.display = "grid";
    container.innerHTML = "";

    if (!lista || lista.length === 0) {
        container.innerHTML = "<p style='color:var(--text-muted); grid-column: 1 / -1; padding: 20px;'>No hay canciones que coincidan.</p>";
        return;
    }

    const listaFinal = [...lista].sort((a, b) => a.titulo.localeCompare(b.titulo));

    listaFinal.forEach((c, index) => {
        const div = document.createElement("div");
        div.className = "track-list-row";
        div.id = `track-${c.id}`;
        const gradient = gradientes[index % gradientes.length];
        const duration = `3:${(20 + index * 5) % 60}`.padEnd(4, '0');

        // Construir badge de motivo IA
        const motivoPrincipal = (c._motivos && c._motivos.length > 0) ? c._motivos[0] : '';
        const motivoHtml = motivoPrincipal
            ? `<span class="ia-motivo-badge" style="
                display: inline-block;
                background: linear-gradient(135deg, rgba(46,119,208,0.15), rgba(138,43,226,0.15));
                border: 1px solid rgba(46,119,208,0.3);
                color: #7ab4ff;
                font-size: 10px;
                padding: 2px 8px;
                border-radius: 12px;
                margin-top: 2px;
                font-weight: 500;
                letter-spacing: 0.3px;
            ">🤖 ${motivoPrincipal}</span>`
            : '';

        const coverUrl = obtenerCoverUrl(c.artista, c);

        div.innerHTML = `
            <div class="col-num">
                <span class="num-text">${index + 1}</span>
            </div>
            <div class="col-title">
                <div class="col-title-img" style="background: ${gradient}; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                    <img src="${coverUrl}" alt="Cover" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.src='https://whqxgrijuctfjwvydxpr.supabase.co/storage/v1/object/public/canciones/logodesinvoz.png';">
                </div>
                <div class="col-title-text">
                    <span class="list-title">${c.titulo}</span>
                    <span class="list-artist">${c.artista} ${motivoHtml}</span>
                </div>
            </div>
            <div class="col-album">${c.genero}</div>
            <div class="col-duration">${duration}</div>
            <div class="col-actions">
                <span class="action-btn-like ${(usuarioActivo && usuarioActivo.likes && usuarioActivo.likes.includes(c.id)) ? 'liked' : ''}" onclick="event.stopPropagation(); alternarLikeFila('${c.id}', this)">
                    ${(usuarioActivo && usuarioActivo.likes && usuarioActivo.likes.includes(c.id)) ? '♥' : '♡'}
                </span>
                <span class="action-btn-add" onclick="event.stopPropagation(); abrirModalPlaylists('${c.id}')" title="Agregar a playlist">➕</span>
            </div>
        `;

        div.onclick = () => {
            indiceActual = index;
            reproducirCancion(c, gradient);
        };

        container.appendChild(div);
    });
}

function obtenerCoverUrl(artista, cancion = null) {
    // 1. Prioridad: url_imagen guardada en Supabase junto a la canción
    if (cancion && cancion.url_imagen) return cancion.url_imagen;

    const sanitizedArtist = artista.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 2. Buscar en el catálogo si alguna canción del artista tiene url_imagen en Supabase
    if (typeof catalogoActual !== 'undefined' && catalogoActual) {
        const conImg = catalogoActual.find(c => c.artista === artista && c.url_imagen);
        if (conImg) return conImg.url_imagen;
    }

    // 3. Mapa de logos locales para artistas predefinidos con nombres especiales
    const mapaLogos = {
        "acdc": "logoAC-DC.png",
        "avici": "logoavicii.png",
        "badbunny": "logobadbunny.png",
        "brunomars": "logobrunomars.png",
        "kiss": "logokiss.png",
        "michaeljackson": "logomichael.png",
        "marshmello": "logomarshmello.png",
        "masrhmello": "logomarshmello.png",
        "phonkcolectivo": "logophonk.png",
        "phonk": "logophonk.png",
        "eminem": "logoeminen.png",
        "linkinpark": "logolinkinpark.png",
        "luismiguel": "logolusimiguel.png",
        "twentyonepilots": "logopilots.png."
    };

    if (mapaLogos[sanitizedArtist]) {
        return `assets/logos/${mapaLogos[sanitizedArtist]}`;
    }

    // 4. Fallback: convención logode{artista}.png
    return `assets/logos/logode${sanitizedArtist}.png`;
}

function reproducirCancion(cancion, coverGradient) {
    cancionActual = cancion;
    localStorage.setItem('aurabeat_current_song', JSON.stringify(cancion));
    document.getElementById("player-title").textContent = cancion.titulo;
    document.getElementById("player-artist").textContent = cancion.artista;
    document.getElementById("btn-play").textContent = "⏸";

    const playerArt = document.getElementById("player-art");
    const disc = document.getElementById("player-disc");
    const discArtInner = document.getElementById("disc-art-inner");

    if (discArtInner) {
        const coverUrl = obtenerCoverUrl(cancion.artista, cancion);
        discArtInner.innerHTML = "";
        const img = document.createElement("img");
        img.src = coverUrl;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";
        img.onerror = () => { discArtInner.innerHTML = "🎵"; };
        discArtInner.appendChild(img);
    }
    if (playerArt) playerArt.style.backgroundImage = "";
    if (disc) disc.classList.add("spinning");

    const btnLike = document.getElementById("btn-like");
    if (btnLike) {
        if (usuarioActivo && usuarioActivo.likes && usuarioActivo.likes.includes(cancion.id)) {
            btnLike.textContent = "♥";
            btnLike.style.color = "#ff2d55";
        } else {
            btnLike.textContent = "♡";
            btnLike.style.color = "";
        }
    }

    const coverUrl = obtenerCoverUrl(cancion.artista, cancion);

    const rightArt = document.getElementById("right-player-art");
    if (rightArt) {
        rightArt.src = coverUrl;
        rightArt.onerror = () => {
            rightArt.onerror = null;
            rightArt.src = 'https://whqxgrijuctfjwvydxpr.supabase.co/storage/v1/object/public/canciones/logodesinvoz.png';
        };
    }

    const rightTitle = document.getElementById("right-player-title");
    if (rightTitle) rightTitle.textContent = cancion.titulo;

    const rightArtist = document.getElementById("right-player-artist");
    if (rightArtist) rightArtist.textContent = cancion.artista;

    const rightComposer = document.getElementById("right-player-composer");
    if (rightComposer) rightComposer.textContent = `${cancion.artista} (${cancion.genero})`;

    const queueBody = document.getElementById("right-queue-item");
    if (queueBody) {
        let siguiente = null;
        if (typeof catalogoActual !== 'undefined' && catalogoActual.length > 0) {
            const nextIdx = (indiceActual + 1) % catalogoActual.length;
            siguiente = catalogoActual[nextIdx];
        }
        if (siguiente && siguiente.id !== cancion.id) {
            queueBody.innerHTML = `
                <div class="queue-next-item" style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                    <div style="font-weight: 600; font-size: 13px; color: white; margin-bottom: 2px;">${siguiente.titulo}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${siguiente.artista}</div>
                </div>
            `;
        } else {
            queueBody.innerHTML = `<p class="queue-empty" style="font-size:12px; color:var(--text-muted);">Fin de la reproducción</p>`;
        }
    }

    document.querySelectorAll('.track-list-row').forEach(row => row.classList.remove('playing'));
    const filaDOM = document.getElementById(`track-${cancion.id}`);
    if (filaDOM) filaDOM.classList.add('playing');

    historialEscucha.push(cancion);
    registrarInteraccion(cancion, 'play');

    // Re-renderizar carruseles si la sección de Inicio está activa
    const isInicioActive = document.getElementById('btn-nav-inicio')?.classList.contains('active') ||
                           localStorage.getItem('aurabeat_active_tab') === 'btn-nav-inicio';
    if (isInicioActive) {
        inicializarCarruseles();
    }

    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();

    if (cancion.url_audio) {
        audioPlayer.src = cancion.url_audio;
        audioPlayer.load();

        setTimeout(() => {
            audioPlayer.play()
                .then(() => {
                    document.getElementById("btn-play").textContent = "⏸";
                })
                .catch(e => {
                    console.error("Error al reproducir audio:", e);
                    if (e.name !== 'AbortError' && !e.message.includes('interrupted by a call to pause')) {
                        mostrarToast("⚠ Error al reproducir: " + e.message);
                    }
                    document.getElementById("btn-play").textContent = "▶";
                });
        }, 50);
    } else {
        mostrarToast("ℹ Esta canción del catálogo demo no tiene audio.");
        document.getElementById("btn-play").textContent = "▶";
    }
}

// =========================================================================
// ELIMINAR CANCIONES
// =========================================================================
function mostrarConfirmacionEliminar(cancion) {
    const existente = document.getElementById('modal-confirm-delete');
    if (existente) existente.remove();

    const overlay = document.createElement('div');
    overlay.id = 'modal-confirm-delete';
    overlay.className = 'modal-confirm-overlay';
    overlay.innerHTML = `
        <div class="modal-confirm-box">
            <h3>🗑 Eliminar canción</h3>
            <p>¿Estás seguro de que deseas eliminar<br>
            <span class="confirm-song-name">"${cancion.titulo}"</span> de <strong>${cancion.artista}</strong>?<br>
            <span style="font-size:12px; color:#666;">Esta acción no se puede deshacer.</span></p>
            <div class="modal-confirm-actions">
                <button class="btn-confirm-cancel" id="btn-cancel-delete">Cancelar</button>
                <button class="btn-confirm-delete" id="btn-confirm-delete">Eliminar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('btn-cancel-delete').onclick = () => overlay.remove();

    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    document.getElementById('btn-confirm-delete').onclick = async () => {
        overlay.remove();
        await eliminarCancion(cancion);
    };
}

async function eliminarCancion(cancion) {
    mostrarToast("🗑 Eliminando canción...");

    try {
        const deleteRes = await fetch(`/api/eliminar/${cancion.id}`, {
            method: "DELETE"
        });
        if (!deleteRes.ok) {
            mostrarToast("❌ Error al eliminar la canción.");
        }
    } catch (e) {
        console.warn("Error eliminando de la base de datos:", e);
    }

    catalogoActual = catalogoActual.filter(c => c.id !== cancion.id);

    const mockIndex = CATALOGO_MOCK.findIndex(c => c.id === cancion.id);
    if (mockIndex !== -1) CATALOGO_MOCK.splice(mockIndex, 1);

    if (cancionActual && cancionActual.id === cancion.id) {
        audioPlayer.pause();
        audioPlayer.src = "";
        cancionActual = null;
        document.getElementById("player-title").textContent = "Ninguna canción";
        document.getElementById("player-artist").textContent = "Selecciona una pista";
        document.getElementById("btn-play").textContent = "▶";
        const discArtReset = document.getElementById("disc-art-inner");
        if (discArtReset) discArtReset.innerHTML = "🎵";
        const discReset = document.getElementById("player-disc");
        if (discReset) discReset.classList.remove("spinning");
    }

    historialEscucha = historialEscucha.filter(h => h.id !== cancion.id);

    mostrarToast(`✅ "${cancion.titulo}" eliminada correctamente.`);

    if (catalogoActual.length > 0) {
        renderizarCanciones(catalogoActual);
    } else {
        mostrarEstadoVacio();
    }
}

// =========================================================================
// CONSOLA VISUAL DE IA
// =========================================================================
function logIA(mensaje) {
    const container = document.getElementById("ia-log-container");
    if (container.textContent === "Esperando...") container.innerHTML = "";
    const div = document.createElement("div");
    div.textContent = `> ${mensaje}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// =========================================================================
// BÚSQUEDA Y NAVEGACIÓN
// =========================================================================
function cambiarTabActivo(idBoton) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById(idBoton);
    if (btn) btn.classList.add('active');

    const filterPills = document.getElementById("filter-pills");
    if (filterPills) {
        if (idBoton === "btn-nav-recomendaciones" || idBoton === "btn-nav-biblioteca") {
            filterPills.style.display = "none";
        } else {
            filterPills.style.display = "flex";
        }
    }

    const libTabs = document.getElementById("library-tabs");
    if (libTabs) {
        if (idBoton === "btn-nav-biblioteca") {
            libTabs.style.display = "flex";
            libTabs.classList.remove("hidden");
        } else {
            libTabs.style.display = "none";
            libTabs.classList.add("hidden");
        }
    }

    if (idBoton === "btn-nav-comunidad") {
        document.body.classList.add('comunidad-activa');
    } else {
        document.body.classList.remove('comunidad-activa');
    }
}

function renderizarBiblioteca() {
    const container = document.getElementById("songs-list");
    container.classList.add("grid-view");
    const trackHeader = document.getElementById("track-header");
    if (trackHeader) trackHeader.style.display = "none";
    container.innerHTML = "";

    const base = catalogoActual;
    const albums = {};
    base.forEach(c => {
        if (!albums[c.artista]) {
            albums[c.artista] = {
                artista: c.artista,
                genero: c.genero || "General",
                canciones: []
            };
        }
        albums[c.artista].canciones.push(c);
    });

    const albumList = Object.values(albums).sort((a, b) => a.artista.localeCompare(b.artista));

    if (albumList.length === 0) {
        container.innerHTML = "<p style='color:var(--text-muted); grid-column: 1 / -1; padding: 20px;'>No tienes ningún género en tu biblioteca.</p>";
        return;
    }

    albumList.forEach((album, index) => {
        const div = document.createElement("div");
        div.className = "album-card";
        const coverUrl = obtenerCoverUrl(album.artista);

        div.innerHTML = `
            <div class="album-cover">
                <img src="${coverUrl}" class="album-cover-img" alt="Cover de ${album.artista}" loading="lazy" onerror="this.onerror=null; this.src='https://whqxgrijuctfjwvydxpr.supabase.co/storage/v1/object/public/canciones/logodesinvoz.png';">
            </div>
            <div class="album-info">
                <div class="album-title">${album.genero}</div>
                <div class="album-subtitle">${album.artista} · ${album.canciones.length} canciones</div>
            </div>
        `;

        div.onclick = () => mostrarDetalleAlbum(album);
        container.appendChild(div);
    });

    if (esUsuarioAdmin()) {
        const addBtn = document.createElement("div");
        addBtn.className = "btn-add-album";
        addBtn.innerHTML = `
            <span class="add-icon">＋</span>
            <span>Subir Música</span>
        `;
        addBtn.onclick = () => {
            document.getElementById("modal-subida").classList.remove("hidden");
        };
        container.appendChild(addBtn);
    }
}

function renderizarBibliotecaPlaylists() {
    const container = document.getElementById("songs-list");
    container.classList.add("grid-view");
    const trackHeader = document.getElementById("track-header");
    if (trackHeader) trackHeader.style.display = "none";
    container.innerHTML = "";

    if (!usuarioActivo) {
        usuarioActivo = { nombre: "Invitado", likes: [], playlists: [] };
    }
    if (!usuarioActivo.likes) usuarioActivo.likes = [];
    if (!usuarioActivo.playlists) usuarioActivo.playlists = [];

    // 1. Añadir "Mis Favoritas" como una card
    const favCard = document.createElement("div");
    favCard.className = "album-card playlist-card";
    favCard.innerHTML = `
        <div class="album-cover" style="background: linear-gradient(135deg, #ff2d55 0%, #ff5e3a 100%); display: flex; align-items: center; justify-content: center; font-size: 50px; color: white; height: 160px; border-radius: 8px; box-shadow: 0 4px 15px rgba(255, 45, 85, 0.4);">
            ♥
        </div>
        <div class="album-info">
            <div class="album-title" style="font-weight:700; color:#fff;">Mis Favoritas</div>
            <div class="album-subtitle" style="color:var(--text-muted); font-size:13px;">${usuarioActivo.likes.length} canciones</div>
        </div>
    `;
    favCard.onclick = () => {
        const likedSongs = (typeof catalogoActual !== 'undefined' ? catalogoActual : []).filter(c => usuarioActivo.likes.includes(c.id));
        renderizarCancionesFavoritas(likedSongs);
    };
    container.appendChild(favCard);

    // 2. Añadir las playlists creadas por el usuario
    usuarioActivo.playlists.forEach((pl, idx) => {
        const plCard = document.createElement("div");
        plCard.className = "album-card playlist-card";
        const colors = [
            "linear-gradient(135deg, #2e77d0 0%, #3b82f6 100%)",
            "linear-gradient(135deg, #8a2be2 0%, #a855f7 100%)",
            "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)",
            "linear-gradient(135deg, #fd746c 0%, #ff9068 100%)"
        ];
        const color = colors[idx % colors.length];

        plCard.innerHTML = `
            <div class="album-cover" style="background: ${color}; display: flex; align-items: center; justify-content: center; font-size: 50px; color: white; position: relative; height: 160px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                ♪
                <button class="pl-card-remove-btn" title="Eliminar playlist" style="
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: rgba(0,0,0,0.6);
                    border: none;
                    border-radius: 50%;
                    width: 28px;
                    height: 28px;
                    color: white;
                    font-size: 18px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 1;
                    transition: background 0.2s;
                ">×</button>
            </div>
            <div class="album-info">
                <div class="album-title" style="font-weight:700; color:#fff;">${pl.nombre}</div>
                <div class="album-subtitle" style="color:var(--text-muted); font-size:13px;">${pl.canciones.length} canciones</div>
            </div>
        `;

        plCard.onclick = () => {
            const plSongs = (typeof catalogoActual !== 'undefined' ? catalogoActual : []).filter(c => pl.canciones.includes(c.id));
            renderizarCancionesPlaylist(plSongs, pl, idx);
        };

        const removeBtn = plCard.querySelector(".pl-card-remove-btn");
        if (removeBtn) {
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`¿Eliminar la playlist "${pl.nombre}"?`)) {
                    usuarioActivo.playlists.splice(idx, 1);
                    guardarEstadoUsuario();
                    actualizarPlaylists();
                    renderizarBibliotecaPlaylists();
                    mostrarToast(`🗑 Playlist "${pl.nombre}" eliminada.`);
                }
            };
        }

        container.appendChild(plCard);
    });

    // 3. Botón para crear una nueva playlist
    const newCard = document.createElement("div");
    newCard.className = "album-card btn-add-album";
    newCard.style.cursor = "pointer";
    newCard.innerHTML = `
        <div class="album-cover" style="background: rgba(255,255,255,0.03); border: 2px dashed rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 50px; color: var(--text-muted); height: 160px; border-radius: 8px;">
            ＋
        </div>
        <div class="album-info">
            <div class="album-title" style="font-weight:700; color: var(--text-main);">Nueva Playlist</div>
            <div class="album-subtitle" style="color:var(--text-muted); font-size:13px;">Crear lista de reproducción</div>
        </div>
    `;
    newCard.onclick = () => {
        const btnNew = document.getElementById("btn-new-playlist");
        if (btnNew) btnNew.click();
    };
    container.appendChild(newCard);
}

function renderizarCancionesFavoritas(lista) {
    const container = document.getElementById("songs-list");
    container.classList.remove("grid-view");
    const trackHeader = document.getElementById("track-header");
    if (trackHeader) trackHeader.style.display = "grid";
    container.innerHTML = "";

    // Ocultar pestañas de biblioteca
    const libTabs = document.getElementById("library-tabs");
    if (libTabs) {
        libTabs.style.display = "none";
        libTabs.classList.add("hidden");
    }

    // Configurar encabezado con botón de volver
    const heading = document.getElementById("section-heading-rec");
    const pageTitle = document.getElementById("page-title");
    if (pageTitle) pageTitle.textContent = "Mis Canciones Favoritas";
    if (heading) {
        heading.innerHTML = `
            <button id="btn-back-library-fav" style="background: transparent; border: 1px solid #444; color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-right: 12px; transition: background 0.2s;">
                ← Volver a Biblioteca
            </button>
            Mis Favoritas <span>›</span>
        `;
        setTimeout(() => {
            const btnBack = document.getElementById("btn-back-library-fav");
            if (btnBack) {
                btnBack.onclick = () => {
                    if (pageTitle) pageTitle.textContent = "Tus Listas de Reproducción";
                    heading.innerHTML = 'Tus Playlists <span>›</span>';
                    if (libTabs) {
                        libTabs.style.display = "flex";
                        libTabs.classList.remove("hidden");
                    }
                    renderizarBibliotecaPlaylists();
                };
            }
        }, 50);
    }

    renderizarCanciones(lista);
}

function mostrarDetalleAlbum(album) {
    const container = document.getElementById("songs-list");
    container.classList.remove("grid-view");
    const trackHeader = document.getElementById("track-header");
    if (trackHeader) trackHeader.style.display = "grid";
    container.innerHTML = "";

    // Ocultar pestañas de biblioteca
    const libTabs = document.getElementById("library-tabs");
    if (libTabs) {
        libTabs.style.display = "none";
        libTabs.classList.add("hidden");
    }

    const pageTitle = document.getElementById("page-title");
    if (pageTitle) pageTitle.textContent = `Género: ${album.genero} — ${album.artista}`;

    const heading = document.getElementById("section-heading-rec");
    if (heading) {
        const esAdmin = esUsuarioAdmin();
        heading.innerHTML = `
            <button id="btn-back-library" style="background: transparent; border: 1px solid #444; color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-right: 12px; transition: background 0.2s;">
                ← Volver a Biblioteca
            </button>
            Canciones del género <span>›</span>
            ${esAdmin ? `<button id="btn-add-songs-genre" style="background: linear-gradient(135deg, #2e77d0, #8a2be2); border: none; color: white; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; margin-left: 12px; transition: opacity 0.2s; box-shadow: 0 2px 8px rgba(46,119,208,0.3);">
                ＋ Agregar Música
            </button>` : ''}
        `;

        setTimeout(() => {
            const btnBack = document.getElementById("btn-back-library");
            if (btnBack) {
                btnBack.onclick = () => {
                    if (pageTitle) pageTitle.textContent = "Tu Biblioteca de Géneros";
                    heading.innerHTML = 'Tus Géneros <span>›</span>';

                    const libTabs = document.getElementById("library-tabs");
                    if (libTabs) {
                        libTabs.style.display = "flex";
                        libTabs.classList.remove("hidden");
                    }
                    renderizarBiblioteca();
                };
            }
            const btnAddSongs = document.getElementById("btn-add-songs-genre");
            if (btnAddSongs) {
                btnAddSongs.onclick = () => {
                    if (!esUsuarioAdmin()) {
                        mostrarToast('⚠ Solo el administrador puede subir música.');
                        return;
                    }
                    const artistaInput = document.getElementById("upload-artista");
                    const generoSelect = document.getElementById("upload-genero");
                    if (artistaInput) artistaInput.value = album.artista;
                    if (generoSelect) generoSelect.value = album.genero;
                    document.getElementById("modal-subida").classList.remove("hidden");
                };
            }
        }, 10);
    }

    renderizarCanciones(album.canciones);
}

function mostrarRecomendacionesVacias() {
    const container = document.getElementById("songs-list");
    const heading = document.getElementById("section-heading-rec");
    if (heading) heading.innerHTML = 'Recomendado para ti <span>›</span>';
    container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
            <div style="font-size: 64px; margin-bottom: 16px; opacity: 0.7;">🧠</div>
            <h3 style="color: white; font-size: 22px; margin: 0 0 10px; font-weight: 600;">Tu recomendador inteligente</h3>
            <p style="color: #888; font-size: 15px; max-width: 450px; margin: 0 auto 24px; line-height: 1.6;">
                Aún no has escuchado música en esta sesión. Empieza a reproducir canciones de tu
                <strong style='color:#007aff;'>Biblioteca 📚</strong> para que la IA aprenda de tu actividad.
            </p>
            <button onclick="document.getElementById('btn-nav-biblioteca').click();"
                style="background: linear-gradient(135deg, #007aff, #8a2be2); border: none; color: white;
                       padding: 12px 32px; border-radius: 10px; font-size: 15px; font-weight: 600;
                       cursor: pointer; transition: opacity 0.2s;">
                📚 Ir a Biblioteca
            </button>
        </div>
    `;
}

function cargarCancionEnPlayer(cancion) {
    if (!cancion) return;
    cancionActual = cancion;
    localStorage.setItem('aurabeat_current_song', JSON.stringify(cancion));

    if (typeof catalogoActual !== 'undefined') {
        indiceActual = catalogoActual.findIndex(c => c.id === cancion.id);
        if (indiceActual === -1) indiceActual = 0;
    }

    document.getElementById("player-title").textContent = cancion.titulo;
    document.getElementById("player-artist").textContent = cancion.artista;
    document.getElementById("btn-play").textContent = "▶";

    const coverUrl = obtenerCoverUrl(cancion.artista, cancion);

    const discArtInner = document.getElementById("disc-art-inner");
    if (discArtInner) {
        discArtInner.innerHTML = '';
        const img = document.createElement('img');
        img.src = coverUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
        img.onerror = () => { discArtInner.innerHTML = '🎵'; };
        discArtInner.appendChild(img);
    }

    const playerArt = document.getElementById("player-art");
    if (playerArt) playerArt.style.backgroundImage = '';

    const rightArt = document.getElementById("right-player-art");
    if (rightArt) {
        rightArt.src = coverUrl;
        rightArt.onerror = () => {
            rightArt.onerror = null;
            rightArt.src = 'https://whqxgrijuctfjwvydxpr.supabase.co/storage/v1/object/public/canciones/logodesinvoz.png';
        };
    }

    const rightTitle = document.getElementById("right-player-title");
    if (rightTitle) rightTitle.textContent = cancion.titulo;

    const rightArtist = document.getElementById("right-player-artist");
    if (rightArtist) rightArtist.textContent = cancion.artista;

    const rightComposer = document.getElementById("right-player-composer");
    if (rightComposer) rightComposer.textContent = `${cancion.artista} (${cancion.genero})`;

    const queueBody = document.getElementById("right-queue-item");
    if (queueBody) {
        let siguiente = null;
        if (typeof catalogoActual !== 'undefined' && catalogoActual.length > 1) {
            const nextIdx = (indiceActual + 1) % catalogoActual.length;
            siguiente = catalogoActual[nextIdx];
        }
        if (siguiente && siguiente.id !== cancion.id) {
            queueBody.innerHTML = `
                <div class="queue-next-item" style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                    <div style="font-weight: 600; font-size: 13px; color: white; margin-bottom: 2px;">${siguiente.titulo}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${siguiente.artista}</div>
                </div>
            `;
        } else {
            queueBody.innerHTML = `<p class="queue-empty" style="font-size:12px; color:var(--text-muted);">Fin de la reproducción</p>`;
        }
    }

    document.querySelectorAll('.track-list-row').forEach(row => row.classList.remove('playing'));
    const filaDOM = document.getElementById(`track-${cancion.id}`);
    if (filaDOM) filaDOM.classList.add('playing');
}

// =========================================================================
// CARRUSELES DE INICIO (Artistas, Canciones, Álbumes)
// =========================================================================
function inicializarCarruseles() {
    const catalogo = catalogoActual || [];

    // ── Carrusel de Artistas ──
    const artistasTrack = document.getElementById('artists-carousel-track');
    if (artistasTrack) {
        artistasTrack.innerHTML = '';
        
        // Contar reproducciones reales de cada artista en el historial
        const playCounts = {};
        historialEscucha.forEach(c => {
            if (c && c.artista) {
                playCounts[c.artista] = (playCounts[c.artista] || 0) + 1;
            }
        });

        // Agrupar por artista y contar canciones en catálogo + play count
        const artMap = {};
        catalogo.forEach(c => {
            if (!artMap[c.artista]) {
                artMap[c.artista] = { 
                    nombre: c.artista, 
                    songCount: 0, 
                    playCount: playCounts[c.artista] || 0, 
                    cancion: c 
                };
            }
            artMap[c.artista].songCount++;
        });

        // Ordenar primero por reproducciones desc, luego por cantidad de canciones desc
        const artistas = Object.values(artMap).sort((a, b) => {
            if (b.playCount !== a.playCount) {
                return b.playCount - a.playCount;
            }
            return b.songCount - a.songCount;
        }).slice(0, 5); // Limitamos al top 5

        const coloresArtista = [
            'linear-gradient(135deg, #5e17eb, #8a2be2)',
            'linear-gradient(135deg, #007aff, #5e17eb)',
            'linear-gradient(135deg, #e91e8c, #8a2be2)',
            'linear-gradient(135deg, #00b4d8, #0077b6)',
            'linear-gradient(135deg, #f77f00, #e63946)'
        ];

        if (artistas.length === 0) {
            artistasTrack.innerHTML = '<p style="color:var(--text-muted); padding: 20px; font-size:13px;">Aún no hay artistas en el catálogo.</p>';
        } else {
            artistas.forEach((art, i) => {
                const coverUrl = obtenerCoverUrl(art.nombre, art.cancion);
                const color = coloresArtista[i % coloresArtista.length];
                const card = document.createElement('div');
                card.className = 'artist-card';
                
                // Mostrar cuántas veces se ha escuchado o fallback al total de canciones
                const metaText = art.playCount > 0 
                    ? `${art.playCount} reproducción${art.playCount !== 1 ? 'es' : ''}` 
                    : `${art.songCount} canción${art.songCount !== 1 ? 'es' : ''}`;

                card.innerHTML = `
                    <div class="artist-avatar" style="background: ${color}; overflow: hidden;">
                        <img src="${coverUrl}" alt="${art.nombre}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.onerror=null;this.parentElement.innerHTML='${art.nombre.charAt(0).toUpperCase()}';">
                    </div>
                    <div class="artist-name">${art.nombre}</div>
                    <div class="artist-meta">${metaText}</div>
                `;
                card.onclick = () => {
                    const songs = catalogo.filter(c => c.artista === art.nombre);
                    const heading = document.getElementById('section-heading-rec');
                    if (heading) heading.innerHTML = `${art.nombre} <span>›</span>`;
                    renderizarCanciones(songs);
                    document.querySelector('.tracks-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                };
                artistasTrack.appendChild(card);
            });
        }

        // Botones de navegación artistas
        const btnPrev = document.getElementById('btn-carousel-prev');
        const btnNext = document.getElementById('btn-carousel-next');
        const wrapper = artistasTrack;
        if (btnPrev) btnPrev.onclick = () => { wrapper.scrollBy({ left: -320, behavior: 'smooth' }); };
        if (btnNext) btnNext.onclick = () => { wrapper.scrollBy({ left: 320, behavior: 'smooth' }); };
    }

    // ── Carrusel de Canciones más escuchadas ──
    const songsTrack = document.getElementById('songs-carousel-track');
    if (songsTrack) {
        songsTrack.innerHTML = '';
        // Usar historial de escucha o primeras del catálogo
        let topSongs = [...catalogo];
        if (historialEscucha && historialEscucha.length > 0) {
            // Ordenar por frecuencia en historial
            const freqMap = {};
            historialEscucha.forEach(c => { freqMap[c.id] = (freqMap[c.id] || 0) + 1; });
            topSongs = [...catalogo].sort((a, b) => (freqMap[b.id] || 0) - (freqMap[a.id] || 0));
        }
        topSongs = topSongs.slice(0, 20);

        const gradSongs = [
            'linear-gradient(135deg, #2e77d0, #8a2be2)',
            'linear-gradient(135deg, #00d2ff, #3a7bd5)',
            'linear-gradient(135deg, #4A00E0, #8E2DE2)',
            'linear-gradient(135deg, #007aff, #5e17eb)',
            'linear-gradient(135deg, #e91e8c, #8a2be2)',
            'linear-gradient(135deg, #f77f00, #e63946)'
        ];

        if (topSongs.length === 0) {
            songsTrack.innerHTML = '<p style="color:var(--text-muted); padding: 20px; font-size:13px;">Aún no hay canciones en el catálogo.</p>';
        } else {
            topSongs.forEach((c, i) => {
                const coverUrl = obtenerCoverUrl(c.artista, c);
                const grad = gradSongs[i % gradSongs.length];
                const card = document.createElement('div');
                card.className = 'song-carousel-card';
                card.innerHTML = `
                    <div class="song-card-cover" style="background:${grad};">
                        <img src="${coverUrl}" alt="${c.titulo}" loading="lazy" onerror="this.onerror=null;this.style.display='none';">
                        <div class="song-card-play-icon">▶</div>
                    </div>
                    <div class="song-card-info">
                        <div class="song-card-title">${c.titulo}</div>
                        <div class="song-card-artist">${c.artista}</div>
                    </div>
                `;
                card.onclick = () => {
                    indiceActual = i;
                    reproducirCancion(c, grad);
                };
                songsTrack.appendChild(card);
            });
        }
        const btnSPrev = document.getElementById('btn-songs-carousel-prev');
        const btnSNext = document.getElementById('btn-songs-carousel-next');
        if (btnSPrev) btnSPrev.onclick = () => { songsTrack.scrollBy({ left: -320, behavior: 'smooth' }); };
        if (btnSNext) btnSNext.onclick = () => { songsTrack.scrollBy({ left: 320, behavior: 'smooth' }); };
    }

}

function inicializarNavegacion() {
    const btnInicio = document.getElementById("btn-nav-inicio");
    const btnBiblioteca = document.getElementById("btn-nav-biblioteca");
    const btnRecomendaciones = document.getElementById("btn-nav-recomendaciones");
    const btnHomeHeader = document.getElementById("header-btn-home");
    const searchInput = document.getElementById("search-input");
    const pageTitle = document.getElementById("page-title");
    const heading = document.getElementById("section-heading-rec");

    const irAInicio = () => {
        cambiarTabActivo("btn-nav-inicio");
        if (searchInput) searchInput.value = "";
        if (pageTitle) pageTitle.textContent = "Novedades y Lanzamientos";
        if (heading) heading.innerHTML = 'Todas las canciones <span>›</span>';

        // Mostrar vistas normales, ocultar comunidad
        const commView = document.getElementById('community-view');
        const tracksSection = document.querySelector('.tracks-section');
        const scrollContent = document.querySelector('.scroll-content');
        const filterPills = document.getElementById('filter-pills');
        if (commView) commView.classList.add('hidden');
        if (tracksSection) tracksSection.style.display = '';
        if (scrollContent) scrollContent.style.display = '';
        if (filterPills) filterPills.style.display = 'flex';

        // Mostrar carruseles
        const artistasCarousel = document.getElementById('artists-carousel-container');
        const songsCarousel = document.getElementById('songs-carousel-container');
        if (artistasCarousel) artistasCarousel.style.display = '';
        if (songsCarousel) songsCarousel.style.display = '';

        inicializarCarruseles();
        renderizarCanciones(catalogoActual);
    };

    if (btnInicio) btnInicio.onclick = (e) => { e.preventDefault(); irAInicio(); };
    if (btnHomeHeader) btnHomeHeader.onclick = (e) => { e.preventDefault(); irAInicio(); };

    if (btnBiblioteca) {
        btnBiblioteca.onclick = (e) => {
            e.preventDefault();
            cambiarTabActivo("btn-nav-biblioteca");
            if (pageTitle) pageTitle.textContent = "Tu Biblioteca de Géneros";
            if (heading) heading.innerHTML = 'Tus Géneros <span>›</span>';

            // Resetear pestañas de biblioteca a "Géneros" por defecto
            const tabGen = document.getElementById("lib-tab-generos");
            const tabPl = document.getElementById("lib-tab-playlists");
            if (tabGen && tabPl) {
                tabGen.classList.add("active");
                tabGen.style.background = "linear-gradient(135deg, #2e77d0, #8a2be2)";
                tabGen.style.color = "white";

                tabPl.classList.remove("active");
                tabPl.style.background = "rgba(255,255,255,0.06)";
                tabPl.style.color = "var(--text-muted)";
            }

            // Ocultar carruseles de inicio en biblioteca
            const artistasCarousel = document.getElementById('artists-carousel-container');
            const songsCarousel = document.getElementById('songs-carousel-container');
            if (artistasCarousel) artistasCarousel.style.display = 'none';
            if (songsCarousel) songsCarousel.style.display = 'none';

            // Mostrar vistas normales, ocultar comunidad
            const commView = document.getElementById('community-view');
            const tracksSection = document.querySelector('.tracks-section');
            const scrollContent = document.querySelector('.scroll-content');
            if (commView) commView.classList.add('hidden');
            if (tracksSection) tracksSection.style.display = '';
            if (scrollContent) scrollContent.style.display = '';

            renderizarBiblioteca();
        };
    }

    // Configurar pestañas de biblioteca (Géneros / Playlists)
    const tabGen = document.getElementById("lib-tab-generos");
    const tabPl = document.getElementById("lib-tab-playlists");
    if (tabGen && tabPl) {
        tabGen.onclick = (e) => {
            e.preventDefault();
            tabGen.classList.add("active");
            tabGen.style.background = "linear-gradient(135deg, #2e77d0, #8a2be2)";
            tabGen.style.color = "white";

            tabPl.classList.remove("active");
            tabPl.style.background = "rgba(255,255,255,0.06)";
            tabPl.style.color = "var(--text-muted)";

            if (pageTitle) pageTitle.textContent = "Tu Biblioteca de Géneros";
            if (heading) heading.innerHTML = 'Tus Géneros <span>›</span>';
            renderizarBiblioteca();
        };

        tabPl.onclick = (e) => {
            e.preventDefault();
            tabPl.classList.add("active");
            tabPl.style.background = "linear-gradient(135deg, #2e77d0, #8a2be2)";
            tabPl.style.color = "white";

            tabGen.classList.remove("active");
            tabGen.style.background = "rgba(255,255,255,0.06)";
            tabGen.style.color = "var(--text-muted)";

            if (pageTitle) pageTitle.textContent = "Tus Listas de Reproducción";
            if (heading) heading.innerHTML = 'Tus Playlists <span>›</span>';
            renderizarBibliotecaPlaylists();
        };
    }

    if (btnRecomendaciones) {
        btnRecomendaciones.onclick = (e) => {
            e.preventDefault();
            cambiarTabActivo("btn-nav-recomendaciones");
            if (pageTitle) pageTitle.textContent = "Recomendaciones Personalizadas IA";

            // Ocultar carruseles de inicio en recomendaciones
            const artistasCarousel = document.getElementById('artists-carousel-container');
            const songsCarousel = document.getElementById('songs-carousel-container');
            if (artistasCarousel) artistasCarousel.style.display = 'none';
            if (songsCarousel) songsCarousel.style.display = 'none';

            // Ocultar comunidad, mostrar sección principal
            const commView = document.getElementById('community-view');
            const tracksSection = document.querySelector('.tracks-section');
            const scrollContent = document.querySelector('.scroll-content');
            if (commView) commView.classList.add('hidden');
            if (tracksSection) tracksSection.style.display = '';
            if (scrollContent) scrollContent.style.display = '';

            if (tieneHistorial()) {
                if (heading) heading.innerHTML = 'Recomendado para ti <span>›</span>';
                if (typeof window.ejecutarIA === "function") window.ejecutarIA();
                else renderizarCanciones(catalogoActual);
            } else {
                mostrarRecomendacionesVacias();
            }
        };
    }

    // ── Navegación Comunidad ──
    const btnComunidad = document.getElementById("btn-nav-comunidad");
    let comunidadInicializada = false;
    if (btnComunidad) {
        btnComunidad.onclick = async (e) => {
            e.preventDefault();
            cambiarTabActivo("btn-nav-comunidad");
            if (pageTitle) pageTitle.textContent = "Comunidad AuraBeat";

            // Ocultar vistas normales
            const tracksSection = document.querySelector('.tracks-section');
            const scrollContent = document.querySelector('.scroll-content');
            const lyricsView = document.getElementById('lyrics-view');
            const filterPills = document.getElementById('filter-pills');
            if (tracksSection) tracksSection.style.display = 'none';
            if (scrollContent) scrollContent.style.display = 'none';
            if (lyricsView) lyricsView.classList.add('hidden');
            if (filterPills) filterPills.style.display = 'none';

            // Ocultar carruseles (solo son de Inicio)
            ['artists-carousel-container', 'songs-carousel-container'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

            // Mostrar vista comunidad
            const commView = document.getElementById('community-view');
            if (commView) commView.classList.remove('hidden');

            // Inicializar comunidad o actualizar según rol
            const isGuest = !usuarioActivo || usuarioActivo.nombre === 'Invitado';
            if (isGuest) {
                comunidadInicializada = false;
                await inicializarComunidad();
            } else if (!comunidadInicializada) {
                comunidadInicializada = true;
                await inicializarComunidad();
            } else {
                // Si ya estaba inicializada pero ya no es guest, asegurar de que la sección de input se muestre
                const inputSection = document.querySelector('#community-view .comm-input-section');
                if (inputSection) inputSection.style.display = 'block';

                // Actualizar avatar si el usuario cambió sesión
                const myAvatar = document.getElementById('comm-my-avatar');
                if (myAvatar && usuarioActivo) {
                    const inicial = usuarioActivo.nombre !== 'Invitado' ? usuarioActivo.nombre.charAt(0).toUpperCase() : '?';
                    myAvatar.textContent = inicial;
                    myAvatar.style.background = generarColorAvatar(usuarioActivo.nombre);
                }
            }
        };
    }

    // ── Búsqueda avanzada simplificada: solo texto ──
    function aplicarFiltrosBusqueda() {
        const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

        // Actualizar título de página
        if (pageTitle) {
            if (query) {
                pageTitle.textContent = `Resultados para "${searchInput.value}"`;
            } else {
                const activeTab = document.querySelector('.nav-item.active');
                if (activeTab) {
                    if (activeTab.id === 'btn-nav-inicio') pageTitle.textContent = 'Novedades y Lanzamientos';
                    else if (activeTab.id === 'btn-nav-biblioteca') pageTitle.textContent = 'Tu Biblioteca de Géneros';
                    else if (activeTab.id === 'btn-nav-recomendaciones') pageTitle.textContent = 'Recomendaciones Personalizadas IA';
                }
            }
        }

        // Sin consulta → mostrar vista normal de la pestaña activa
        if (!query) {
            const activeTab = document.querySelector('.nav-item.active');
            if (activeTab && activeTab.id === 'btn-nav-biblioteca') {
                renderizarBiblioteca();
            } else {
                renderizarCanciones(catalogoActual);
            }
            return;
        }

        const resultados = catalogoActual.filter(c =>
            c.titulo.toLowerCase().includes(query) ||
            c.artista.toLowerCase().includes(query) ||
            c.genero.toLowerCase().includes(query) ||
            (c.mood && c.mood.toLowerCase().includes(query))
        );
        renderizarCanciones(resultados);
    }

    if (searchInput) {
        searchInput.oninput = aplicarFiltrosBusqueda;
    }

    // ── Búsqueda por voz ──
    const btnVoice = document.getElementById('btn-voice-search');
    if (btnVoice) {
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRec) {
            btnVoice.title = 'Tu navegador no soporta búsqueda por voz';
            btnVoice.style.opacity = '0.4';
            btnVoice.style.cursor = 'not-allowed';
        } else {
            const recognizer = new SpeechRec();
            recognizer.lang = 'es-ES';
            recognizer.continuous = false;
            recognizer.interimResults = false;

            let escuchando = false;

            recognizer.onstart = () => {
                escuchando = true;
                btnVoice.classList.add('listening');
                btnVoice.title = '🔴 Escuchando...';
                mostrarToast('🎙 Escuchando... Habla ahora');
            };

            recognizer.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                mostrarToast(`🎙 Escuchado: "${transcript}"`);

                let query = transcript.toLowerCase().trim();
                const prefijos = ["buscar", "reproducir", "poner", "toca", "pon", "escuchar"];
                for (const prefijo of prefijos) {
                    if (query.startsWith(prefijo + " ")) {
                        query = query.substring(prefijo.length + 1).trim();
                        break;
                    }
                }

                if (!query) {
                    mostrarToast("🎙 Por favor menciona una canción, artista o género.");
                    return;
                }

                // Buscar mejor coincidencia fuzzy en el catálogo
                const listado = (typeof catalogoActual !== 'undefined' && catalogoActual.length > 0) ? catalogoActual : CATALOGO_MOCK;
                let mejorCoincidencia = null;
                let maximaSimilitud = 0;

                listado.forEach((cancion, index) => {
                    const similitudTitulo = calcularSimilitudFuzzy(query, cancion.titulo);
                    const similitudArtista = calcularSimilitudFuzzy(query, cancion.artista);
                    const similitudGenero = cancion.genero ? calcularSimilitudFuzzy(query, cancion.genero) : 0;
                    const similitudCombo1 = calcularSimilitudFuzzy(query, `${cancion.titulo} ${cancion.artista}`);
                    const similitudCombo2 = calcularSimilitudFuzzy(query, `${cancion.artista} ${cancion.titulo}`);

                    const similitudMax = Math.max(similitudTitulo, similitudArtista, similitudGenero, similitudCombo1, similitudCombo2);
                    if (similitudMax > maximaSimilitud) {
                        maximaSimilitud = similitudMax;
                        mejorCoincidencia = { cancion, index };
                    }
                });

                // Si la coincidencia supera el 45%, la reproducimos directamente
                if (mejorCoincidencia && maximaSimilitud > 0.45) {
                    if (searchInput) {
                        searchInput.value = mejorCoincidencia.cancion.titulo;
                        aplicarFiltrosBusqueda();
                    }

                    // Actualizar el índice y reproducir
                    indiceActual = mejorCoincidencia.index;

                    const gradientes = [
                        'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
                        'linear-gradient(135deg, #2e0854 0%, #8a2be2 100%)',
                        'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
                        'linear-gradient(135deg, #373b44 0%, #4286f4 100%)',
                        'linear-gradient(135deg, #fd746c 0%, #ff9068 100%)',
                        'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                        'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)',
                        'linear-gradient(135deg, #e55d87 0%, #5fc3e4 100%)'
                    ];
                    const gradiente = gradientes[mejorCoincidencia.index % gradientes.length];

                    reproducirCancion(mejorCoincidencia.cancion, gradiente);
                    mostrarToast(`🎙 Reproduciendo: "${mejorCoincidencia.cancion.titulo}" (${Math.round(maximaSimilitud * 100)}% coincidencia)`);
                } else {
                    // Si no hay coincidencia directa clara, hacer la búsqueda por texto normal
                    if (searchInput) {
                        searchInput.value = transcript;
                        aplicarFiltrosBusqueda();
                    }
                    mostrarToast(`🔍 Buscando coincidencias para: "${transcript}"`);
                }
            };

            recognizer.onerror = (event) => {
                let msg = '⚠ Error de voz';
                if (event.error === 'not-allowed') msg = '⚠ Permiso de micrófono denegado';
                else if (event.error === 'no-speech') msg = '⚠ No se detectó voz';
                mostrarToast(msg);
            };

            recognizer.onend = () => {
                escuchando = false;
                btnVoice.classList.remove('listening');
                btnVoice.title = 'Buscar por voz';
            };

            btnVoice.onclick = () => {
                if (escuchando) {
                    recognizer.stop();
                } else {
                    try { recognizer.start(); }
                    catch (e) { mostrarToast('⚠ Ya hay una sesión de voz activa'); }
                }
            };
        }
    }
}

// =========================================================================
// ARRANQUE
// =========================================================================
document.addEventListener("DOMContentLoaded", async () => {
    // Inicializar tareas de servidor en segundo plano
    asegurarAdminCreado();
    asegurarTablaComunidad();

    inicializarModal();
    inicializarReproductor();
    inicializarNavegacion();
    inicializarModalSubida();
    mostrarPerfil();
    inicializarScrollbarAutoOcultable();

    const btnForceIA = document.getElementById("btn-force-ia");
    if (btnForceIA) {
        btnForceIA.onclick = () => {
            if (typeof window.ejecutarIA === "function") window.ejecutarIA(true);
        };
    }

    // Avatar Dropdown
    const headerAvatar = document.getElementById("header-user-avatar");
    const userDropdown = document.getElementById("user-dropdown");
    if (headerAvatar && userDropdown) {
        headerAvatar.onclick = (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle("hidden");
        };
        document.addEventListener("click", (e) => {
            if (!document.getElementById("user-menu-wrapper").contains(e.target)) {
                userDropdown.classList.add("hidden");
            }
        });
    }

    // Filter Pills
    const pillsContainer = document.getElementById("filter-pills");
    if (pillsContainer) {
        pillsContainer.addEventListener("click", (e) => {
            const pill = e.target.closest(".pill");
            if (!pill) return;
            pillsContainer.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            const filter = pill.dataset.filter;
            const heading = document.getElementById("section-heading-rec");
            const pageTitle = document.getElementById("page-title");
            if (filter === "all") {
                if (heading) heading.innerHTML = 'Todas las canciones <span>›</span>';
                if (pageTitle) pageTitle.textContent = "Novedades y Lanzamientos";
                renderizarCanciones(catalogoActual);
            } else {
                const filtradas = catalogoActual.filter(c => c.genero === filter);
                if (heading) heading.innerHTML = `${filter} <span>›</span>`;
                if (pageTitle) pageTitle.textContent = filter;
                renderizarCanciones(filtradas);
            }
        });
    }

    // Cargar inmediatamente la última pestaña seleccionada (render rápido con caché)
    const activeTab = localStorage.getItem('aurabeat_active_tab') || 'btn-nav-inicio';
    const btnTab = document.getElementById(activeTab);
    if (btnTab) {
        btnTab.click();
    } else {
        const btnInicio = document.getElementById("btn-nav-inicio");
        if (btnInicio) btnInicio.click();
    }

    // Poblar el dropdown de artistas con el catálogo en caché
    const artistaDropdown = document.getElementById('search-artista');
    if (artistaDropdown && catalogoActual.length > 0) {
        const artistas = [...new Set(catalogoActual.map(c => c.artista))].sort((a, b) => a.localeCompare(b));
        artistas.forEach(artista => {
            const opt = document.createElement('option');
            opt.value = artista;
            opt.textContent = artista;
            artistaDropdown.appendChild(opt);
        });
    }

    // Cargar inmediatamente la última canción escuchada (render rápido con caché)
    let songLoaded = false;
    const savedSongStr = localStorage.getItem('aurabeat_current_song');
    if (savedSongStr) {
        try {
            const savedSong = JSON.parse(savedSongStr);
            const matchedSong = catalogoActual.find(c => c.id === savedSong.id);
            if (matchedSong) {
                cargarCancionEnPlayer(matchedSong);
                songLoaded = true;
            } else if (savedSong && savedSong.id) {
                cargarCancionEnPlayer(savedSong);
                songLoaded = true;
            }
        } catch (e) {
            console.error("Error loading saved song:", e);
        }
    }

    if (!songLoaded && catalogoActual && catalogoActual.length > 0) {
        cargarCancionEnPlayer(catalogoActual[0]);
    }

    // Cargar catálogo actualizado desde el servidor en segundo plano
    cargarCatalogo();
});

// =========================================================================
// FUNCIONES GLOBALES PARA PLAYLISTS Y LIKES EN LISTAS
// =========================================================================
window.alternarLikeFila = function (id, el) {
    if (!usuarioActivo || usuarioActivo.nombre === "Invitado") {
        mostrarToast("⚠ Inicia sesión para usar Me gusta");
        return;
    }
    const cancion = (typeof catalogoActual !== 'undefined' ? catalogoActual : []).find(c => c.id == id);
    if (!cancion) return;

    const realId = cancion.id;

    if (!usuarioActivo.likes) usuarioActivo.likes = [];
    const index = usuarioActivo.likes.findIndex(likeId => likeId == realId);
    if (index === -1) {
        usuarioActivo.likes.push(realId);
        el.textContent = "♥";
        el.style.color = "#ff2d55";
        el.classList.add("liked");
        registrarInteraccion(cancion, 'like');
    } else {
        usuarioActivo.likes.splice(index, 1);
        el.textContent = "♡";
        el.style.color = "";
        el.classList.remove("liked");
    }
    guardarEstadoUsuario();
    actualizarPlaylists();

    if (cancionActual && cancionActual.id == realId) {
        const mainLike = document.getElementById("btn-like");
        if (mainLike && mainLike !== el) {
            mainLike.textContent = index === -1 ? "♥" : "♡";
            mainLike.style.color = index === -1 ? "#ff2d55" : "";
        }
    }

    const rowLike = document.querySelector(`#track-${realId} .action-btn-like`);
    if (rowLike && rowLike !== el) {
        rowLike.textContent = index === -1 ? "♥" : "♡";
        if (index === -1) {
            rowLike.classList.add("liked");
        } else {
            rowLike.classList.remove("liked");
        }
    }
};

window.abrirModalPlaylists = function (cancionId) {
    if (!usuarioActivo || usuarioActivo.nombre === "Invitado") {
        mostrarToast("⚠ Debes iniciar sesión para usar playlists.");
        return;
    }

    const container = document.getElementById("playlists-list-modal");
    if (!container) return;
    container.innerHTML = "";

    const hasPlaylists = usuarioActivo.playlists && usuarioActivo.playlists.length > 0;

    if (!hasPlaylists) {
        container.innerHTML = "<p style='color:var(--text-muted); font-size: 13.5px; margin-bottom: 12px; line-height:1.4;'>No tienes playlists creadas aún.</p>";
    } else {
        usuarioActivo.playlists.forEach((pl) => {
            const btn = document.createElement("button");
            btn.style.cssText = "padding: 10px; background: #1a1a2e; color: white; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; text-align: left; font-size: 14px; transition: 0.2s;";

            if (pl.canciones.includes(cancionId)) {
                btn.textContent = `✓ ${pl.nombre}`;
                btn.style.color = "var(--accent-purple)";
                btn.style.borderColor = "var(--accent-purple)";
                btn.disabled = true;
            } else {
                btn.textContent = pl.nombre;
                btn.onmouseover = () => btn.style.background = "var(--bg-hover)";
                btn.onmouseout = () => btn.style.background = "#1a1a2e";
                btn.onclick = () => {
                    pl.canciones.push(cancionId);
                    guardarEstadoUsuario();
                    actualizarPlaylists();
                    mostrarToast(`✅ Añadida a "${pl.nombre}"`);
                    document.getElementById("modal-playlists").classList.add("hidden");
                };
            }
            container.appendChild(btn);
        });
    }

    // Agregar el botón para crear playlist al final (o como opción principal)
    const btnCrear = document.createElement("button");
    btnCrear.textContent = "＋ Crear Nueva Playlist";
    btnCrear.style.cssText = "padding: 12px; background: linear-gradient(135deg, #2e77d0, #8a2be2); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; text-align: center; margin-top: 14px; transition: background 0.2s, transform 0.1s;";
    btnCrear.onmouseover = () => { btnCrear.style.filter = "brightness(1.15)"; };
    btnCrear.onmouseout = () => { btnCrear.style.filter = "none"; };

    btnCrear.onclick = () => {
        // Guardamos la canción actual para añadirla después de crear la playlist
        window.cancionIdEnEspera = cancionId;

        // Ocultamos el modal actual de playlists
        document.getElementById("modal-playlists").classList.add("hidden");

        // Mostramos el modal de crear nueva playlist
        const modalNew = document.getElementById("modal-new-playlist");
        const inputNew = document.getElementById("new-playlist-name");
        if (modalNew && inputNew) {
            inputNew.value = "";
            modalNew.classList.remove("hidden");
            setTimeout(() => inputNew.focus(), 50);

            // Redefinimos temporalmente los botones del modal de nueva playlist
            const cerrar = () => {
                modalNew.classList.add("hidden");
                // Al cerrar, si hay canción en espera, reabrimos modal-playlists
                if (window.cancionIdEnEspera) {
                    window.abrirModalPlaylists(window.cancionIdEnEspera);
                    window.cancionIdEnEspera = null;
                }
            };

            document.getElementById("btn-cerrar-new-playlist").onclick = cerrar;
            document.getElementById("btn-cancel-new-playlist").onclick = cerrar;
            modalNew.onclick = (e) => { if (e.target === modalNew) cerrar(); };

            const crear = () => {
                const nombre = inputNew.value.trim();
                if (!nombre) {
                    inputNew.style.borderColor = "#ff4444";
                    setTimeout(() => inputNew.style.borderColor = "#2a2a2a", 1500);
                    return;
                }

                // Creamos la playlist
                usuarioActivo.playlists.push({ nombre, canciones: [] });
                guardarEstadoUsuario();
                actualizarPlaylists();
                mostrarToast(`🎶 Playlist "${nombre}" creada.`);
                modalNew.classList.add("hidden");

                // Como ya se creó, si hay canción en espera, abrimos el modal de playlists
                // para que el usuario pueda añadirla directamente a la nueva playlist
                if (window.cancionIdEnEspera) {
                    const tempId = window.cancionIdEnEspera;
                    window.cancionIdEnEspera = null;
                    window.abrirModalPlaylists(tempId);
                }
            };

            document.getElementById("btn-confirm-new-playlist").onclick = crear;
            inputNew.onkeydown = (e) => { if (e.key === "Enter") crear(); };
        }
    };

    container.appendChild(btnCrear);

    const modal = document.getElementById("modal-playlists");
    if (modal) modal.classList.remove("hidden");
};

function renderizarCancionesPlaylist(lista, playlist, playlistIdx) {
    const container = document.getElementById("songs-list");
    container.classList.remove("grid-view");
    const trackHeader = document.getElementById("track-header");
    if (trackHeader) trackHeader.style.display = "grid";
    container.innerHTML = "";

    // Ocultar pestañas de biblioteca
    const libTabs = document.getElementById("library-tabs");
    if (libTabs) {
        libTabs.style.display = "none";
        libTabs.classList.add("hidden");
    }

    // Configurar encabezado con botón de volver
    const heading = document.getElementById("section-heading-rec");
    const pageTitle = document.getElementById("page-title");
    if (pageTitle) pageTitle.textContent = `Playlist: ${playlist.nombre}`;
    if (heading) {
        heading.innerHTML = `
            <button id="btn-back-library-pl" style="background: transparent; border: 1px solid #444; color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-right: 12px; transition: background 0.2s;">
                ← Volver a Biblioteca
            </button>
            Playlist: ${playlist.nombre} <span>›</span>
        `;
        setTimeout(() => {
            const btnBack = document.getElementById("btn-back-library-pl");
            if (btnBack) {
                btnBack.onclick = () => {
                    if (pageTitle) pageTitle.textContent = "Tus Listas de Reproducción";
                    heading.innerHTML = 'Tus Playlists <span>›</span>';
                    if (libTabs) {
                        libTabs.style.display = "flex";
                        libTabs.classList.remove("hidden");
                    }
                    renderizarBibliotecaPlaylists();
                };
            }
        }, 50);
    }

    if (!lista || lista.length === 0) {
        container.innerHTML = "<p style='color:var(--text-muted); grid-column: 1 / -1; padding: 20px;'>Esta playlist está vacía. Añade canciones con el botón ➕</p>";
        return;
    }

    const listaOrdenada = [...lista].sort((a, b) => a.titulo.localeCompare(b.titulo));

    listaOrdenada.forEach((c, index) => {
        const div = document.createElement("div");
        div.className = "track-list-row";
        div.id = `track-${c.id}`;
        const gradient = gradientes[index % gradientes.length];
        const duration = `3:${(20 + index * 5) % 60}`.padEnd(4, '0');

        const coverUrl = obtenerCoverUrl(c.artista, c);

        div.innerHTML = `
            <div class="col-num">
                <span class="num-text">${index + 1}</span>
            </div>
            <div class="col-title">
                <div class="col-title-img" style="background: ${gradient}; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                    <img src="${coverUrl}" alt="Cover" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.src='https://whqxgrijuctfjwvydxpr.supabase.co/storage/v1/object/public/canciones/logodesinvoz.png';">
                </div>
                <div class="col-title-text">
                    <span class="list-title">${c.titulo}</span>
                    <span class="list-artist">${c.artista}</span>
                </div>
            </div>
            <div class="col-album">${c.genero}</div>
            <div class="col-duration">${duration}</div>
            <div class="col-actions">
                <span class="action-btn-like ${(usuarioActivo && usuarioActivo.likes && usuarioActivo.likes.includes(c.id)) ? 'liked' : ''}" onclick="event.stopPropagation(); alternarLikeFila('${c.id}', this)">
                    ${(usuarioActivo && usuarioActivo.likes && usuarioActivo.likes.includes(c.id)) ? '♥' : '♡'}
                </span>
                <span class="action-btn-add" onclick="event.stopPropagation(); quitarDePlaylist(${playlistIdx}, '${c.id}')" title="Quitar de playlist" style="cursor:pointer;">🗑</span>
            </div>
        `;

        div.onclick = () => {
            indiceActual = index;
            reproducirCancion(c, gradient);
        };

        container.appendChild(div);
    });
}

window.quitarDePlaylist = function (playlistIdx, cancionId) {
    if (!usuarioActivo || !usuarioActivo.playlists[playlistIdx]) return;

    const pl = usuarioActivo.playlists[playlistIdx];
    const idx = pl.canciones.indexOf(cancionId);
    if (idx !== -1) {
        pl.canciones.splice(idx, 1);
        guardarEstadoUsuario();
        actualizarPlaylists();

        const plSongs = (typeof catalogoActual !== 'undefined' ? catalogoActual : []).filter(c => pl.canciones.includes(c.id));
        const headerTitle = document.getElementById("section-heading-rec");
        if (headerTitle) headerTitle.textContent = pl.nombre;
        renderizarCancionesPlaylist(plSongs, pl, playlistIdx);

        mostrarToast(`🗑 Canción quitada de "${pl.nombre}"`);
    }
};

function inicializarScrollbarAutoOcultable() {
    document.addEventListener('scroll', (e) => {
        const target = e.target;
        if (target && target.classList && (
            target.classList.contains('main-area') ||
            target.classList.contains('right-sidebar') ||
            target.id === 'ia-log-container'
        )) {
            target.classList.add('is-scrolling');
            if (target._scrollTimeout) clearTimeout(target._scrollTimeout);
            target._scrollTimeout = setTimeout(() => {
                target.classList.remove('is-scrolling');
            }, 1000);
        }
    }, true);
}
// =========================================================================
// SISTEMA DE COMUNIDAD — Supabase + Real-time Polling
// =========================================================================

let comunidadReplying = null;  // { id, autor } — mensaje al que se responde
let comunidadPollInterval = null;
let comunidadUltimosIds = new Set();
let comunidadModoLocal = false;

// ── Helpers de avatar ──
function generarColorAvatar(nombre) {
    const colores = [
        'linear-gradient(135deg,#5e17eb,#8a2be2)',
        'linear-gradient(135deg,#007aff,#5e17eb)',
        'linear-gradient(135deg,#e91e8c,#8a2be2)',
        'linear-gradient(135deg,#00b4d8,#0077b6)',
        'linear-gradient(135deg,#f77f00,#e63946)',
        'linear-gradient(135deg,#06d6a0,#118577)',
        'linear-gradient(135deg,#ef233c,#d90429)',
        'linear-gradient(135deg,#48cae4,#023e8a)'
    ];
    let hash = 0;
    for (let i = 0; i < nombre.length; i++) hash = nombre.charCodeAt(i) + ((hash << 5) - hash);
    return colores[Math.abs(hash) % colores.length];
}

function formatearTiempoRelativo(fechaStr) {
    const fecha = new Date(fechaStr);
    const ahora = new Date();
    const diff = Math.floor((ahora - fecha) / 1000);
    if (diff < 60) return 'ahora mismo';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    return `hace ${Math.floor(diff / 86400)}d`;
}

// ── Helpers LocalStorage para la Comunidad ──
function obtenerMensajesLocales() {
    let locales = localStorage.getItem('aurabeat_local_mensajes');
    if (!locales) {
        const mensajesDemo = [];
        localStorage.setItem('aurabeat_local_mensajes', JSON.stringify(mensajesDemo));
        return mensajesDemo;
    }
    return JSON.parse(locales);
}

function guardarMensajeLocal(msg) {
    const mensajes = obtenerMensajesLocales();
    mensajes.push(msg);
    localStorage.setItem('aurabeat_local_mensajes', JSON.stringify(mensajes));
}

function actualizarLikesLocales(id, nuevosLikes) {
    const mensajes = obtenerMensajesLocales();
    const msg = mensajes.find(m => String(m.id) === String(id));
    if (msg) {
        msg.likes = nuevosLikes;
        localStorage.setItem('aurabeat_local_mensajes', JSON.stringify(mensajes));
    }
}

// ── Cargar mensajes desde Supabase (con fallback LocalStorage) ──
async function cargarMensajesComunidad() {
    if (comunidadModoLocal) {
        return obtenerMensajesLocales();
    }
    try {
        const res = await fetch('/api/comunidad');
        if (!res || !res.ok) {
            comunidadModoLocal = true;
            return obtenerMensajesLocales();
        }
        return await res.json();
    } catch (e) {
        comunidadModoLocal = true;
        return obtenerMensajesLocales();
    }
}

// ── Enviar mensaje a Supabase (con fallback LocalStorage) ──
async function enviarMensajeComunidad(texto, replyToId = null, replyToAutor = null) {
    const autor = (usuarioActivo && usuarioActivo.nombre !== 'Invitado') ? usuarioActivo.nombre : null;
    if (!autor) {
        mostrarToast('⚠ Debes iniciar sesión para comentar.');
        return false;
    }

    const payload = {
        autor,
        mensaje: texto,
        reply_to_id: replyToId ? String(replyToId) : null,
        reply_to_autor: replyToAutor,
        likes: 0,
        created_at: new Date().toISOString()
    };

    if (comunidadModoLocal) {
        payload.id = Date.now();
        guardarMensajeLocal(payload);
        return true;
    }

    try {
        const res = await fetch('/api/comunidad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res || !res.ok) {
            comunidadModoLocal = true;
            payload.id = Date.now();
            guardarMensajeLocal(payload);
        }
        return true;
    } catch (e) {
        comunidadModoLocal = true;
        payload.id = Date.now();
        guardarMensajeLocal(payload);
        return true;
    }
}

// ── Dar like a un mensaje ──
async function darLikeMensaje(id, likesActuales) {
    const nuevosLikes = (likesActuales || 0) + 1;
    if (comunidadModoLocal) {
        actualizarLikesLocales(id, nuevosLikes);
        return;
    }
    try {
        const res = await fetch(`/api/comunidad/like/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ likes: nuevosLikes })
        });
        if (!res || !res.ok) {
            actualizarLikesLocales(id, nuevosLikes);
        }
    } catch (e) {
        actualizarLikesLocales(id, nuevosLikes);
    }
}

// ── Renderizar un mensaje individual ──
function crearElementoMensaje(msg, esPropio) {
    const div = document.createElement('div');
    div.className = `comm-msg ${esPropio ? 'comm-msg-own' : ''}`;
    div.dataset.id = msg.id;

    const inicial = msg.autor ? msg.autor.charAt(0).toUpperCase() : '?';
    const colorBg = generarColorAvatar(msg.autor || '?');
    const tiempo = formatearTiempoRelativo(msg.created_at);
    const likes = msg.likes || 0;

    const replyBanner = msg.reply_to_autor
        ? `<div class="comm-msg-reply-ref">
                <span class="reply-icon-small">↩</span>
                Respondiendo a <strong>${escHtml(msg.reply_to_autor)}</strong>
           </div>`
        : '';

    div.innerHTML = `
        <div class="comm-msg-avatar" style="background:${colorBg}">${inicial}</div>
        <div class="comm-msg-body">
            <div class="comm-msg-header">
                <span class="comm-msg-author ${esPropio ? 'own-author' : ''}">${escHtml(msg.autor || 'Anónimo')}</span>
                <span class="comm-msg-time">${tiempo}</span>
            </div>
            ${replyBanner}
            <div class="comm-msg-text">${escHtml(msg.mensaje)}</div>
            <div class="comm-msg-actions">
                <button class="comm-like-btn" data-id="${msg.id}" data-likes="${likes}" title="Me gusta">
                    <span class="like-heart">♡</span>
                    <span class="like-count">${likes > 0 ? likes : ''}</span>
                </button>
                <button class="comm-reply-btn" data-id="${msg.id}" data-autor="${escHtml(msg.autor || 'Anónimo')}" title="Responder">
                    ↩ Responder
                </button>
            </div>
        </div>
    `;

    // Evento like
    div.querySelector('.comm-like-btn').onclick = async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const id = btn.dataset.id;
        const likesAct = parseInt(btn.dataset.likes) || 0;
        btn.dataset.likes = likesAct + 1;
        btn.querySelector('.like-heart').textContent = '♥';
        btn.querySelector('.like-heart').style.color = '#e22b7a';
        btn.querySelector('.like-count').textContent = likesAct + 1;
        await darLikeMensaje(id, likesAct);
    };

    // Evento responder
    div.querySelector('.comm-reply-btn').onclick = (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        comunidadReplying = { id: btn.dataset.id, autor: btn.dataset.autor };
        const banner = document.getElementById('comm-reply-banner');
        const bannerText = document.getElementById('comm-reply-to-text');
        if (banner) banner.classList.remove('hidden');
        if (bannerText) bannerText.textContent = `Respondiendo a ${comunidadReplying.autor}`;
        const input = document.getElementById('community-input');
        if (input) input.focus();
    };

    return div;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Renderizar lista completa de mensajes ──
function renderizarMensajesComunidad(mensajes) {
    const container = document.getElementById('community-messages');
    if (!container) return;

    // Eliminar spinner de carga inmediatamente
    const loading = document.getElementById('comm-loading');
    if (loading) loading.remove();

    if (!mensajes || mensajes.length === 0) {
        if (container.querySelectorAll('.comm-msg').length === 0) {
            container.innerHTML = `
                <div class="comm-empty">
                    <div style="font-size:52px;margin-bottom:12px;">💬</div>
                    <h3>¡Sé el primero en escribir!</h3>
                    <p>Comparte qué estás escuchando o inicia una conversación con la comunidad.</p>
                </div>
            `;
        }
        return;
    }

    const yo = usuarioActivo ? usuarioActivo.nombre : null;

    mensajes.forEach(msg => {
        if (!comunidadUltimosIds.has(msg.id)) {
            comunidadUltimosIds.add(msg.id);
            const empty = container.querySelector('.comm-empty');
            if (empty) empty.remove();
            const el = crearElementoMensaje(msg, msg.autor === yo);
            container.appendChild(el);
        }
    });

    const scrollDiff = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (scrollDiff < 150) {
        container.scrollTop = container.scrollHeight;
    }

    const unaHora = Date.now() - 3600000;
    const activos = new Set(mensajes.filter(m => new Date(m.created_at).getTime() > unaHora).map(m => m.autor)).size;
    const countEl = document.getElementById('comm-count-text');
    if (countEl) countEl.textContent = activos > 0 ? `${activos} activo${activos !== 1 ? 's' : ''}` : 'Activa';
}

// ── Inicializar comunidad ──
async function inicializarComunidad() {
    const isGuest = !usuarioActivo || usuarioActivo.nombre === 'Invitado';

    const inputSection = document.querySelector('#community-view .comm-input-section');
    if (inputSection) {
        inputSection.style.display = isGuest ? 'none' : 'block';
    }

    if (isGuest) {
        if (comunidadPollInterval) {
            clearInterval(comunidadPollInterval);
            comunidadPollInterval = null;
        }
        const container = document.getElementById('community-messages');
        if (container) {
            container.innerHTML = `
                <div class="comm-guest-lock" style="
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    min-height: 320px;
                    text-align: center;
                    color: var(--text-muted);
                    padding: 40px 20px;
                ">
                    <span style="font-size: 64px; margin-bottom: 16px; filter: drop-shadow(0 0 12px rgba(46,119,208,0.4));">🔒</span>
                    <h3 style="color: var(--text-main); margin-bottom: 10px; font-size: 20px; font-weight: 600; letter-spacing: 0.5px;">Acceso Restringido</h3>
                    <p style="font-size: 13px; max-width: 320px; line-height: 1.6; margin-bottom: 24px; color: var(--text-muted);">
                        Debes iniciar sesión con tu cuenta de usuario para poder ver las conversaciones y participar en la comunidad de AuraBeat.
                    </p>
                    <button onclick="document.getElementById('btn-open-login').click()" style="
                        padding: 12px 28px;
                        background: linear-gradient(135deg, #2e77d0, #8a2be2);
                        border: none;
                        border-radius: 20px;
                        color: white;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                        box-shadow: 0 4px 15px rgba(46,119,208,0.4);
                        transition: transform 0.2s, box-shadow 0.2s;
                    " onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
                        Iniciar Sesión
                    </button>
                </div>
            `;
        }
        return;
    }

    const myAvatar = document.getElementById('comm-my-avatar');
    if (myAvatar && usuarioActivo) {
        const inicial = usuarioActivo.nombre !== 'Invitado' ? usuarioActivo.nombre.charAt(0).toUpperCase() : '?';
        myAvatar.textContent = inicial;
        myAvatar.style.background = generarColorAvatar(usuarioActivo.nombre);
    }

    // Cargar mensajes iniciales
    const mensajes = await cargarMensajesComunidad();

    // Limpiar pantalla de bloqueo si existía
    const container = document.getElementById('community-messages');
    if (container && container.querySelector('.comm-guest-lock')) {
        container.innerHTML = '';
    }

    comunidadUltimosIds.clear();
    renderizarMensajesComunidad(mensajes);

    // Ocultar spinner si se carga
    const loading = document.getElementById('comm-loading');
    if (loading) loading.remove();

    const input = document.getElementById('community-input');
    const charCount = document.getElementById('comm-char-count');
    if (input && charCount) {
        input.oninput = () => {
            charCount.textContent = `${input.value.length}/500`;
            charCount.style.color = input.value.length > 450 ? '#e22b7a' : '';
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviarYRefrescar();
            }
        };
    }

    const sendBtn = document.getElementById('community-send-btn');
    if (sendBtn) {
        sendBtn.onclick = enviarYRefrescar;
    }

    const cancelReply = document.getElementById('comm-cancel-reply');
    if (cancelReply) {
        cancelReply.onclick = () => {
            comunidadReplying = null;
            const banner = document.getElementById('comm-reply-banner');
            if (banner) banner.classList.add('hidden');
        };
    }

    const emojiBtn = document.getElementById('comm-emoji-btn');
    const emojiPicker = document.getElementById('comm-emoji-picker');
    if (emojiBtn && emojiPicker && !window.comunidadEventsBound) {
        window.comunidadEventsBound = true;
        emojiBtn.onclick = (e) => {
            e.stopPropagation();
            emojiPicker.classList.toggle('hidden');
        };
        emojiPicker.querySelectorAll('.emoji-opt').forEach(span => {
            span.onclick = () => {
                const inp = document.getElementById('community-input');
                if (inp) {
                    inp.value += span.dataset.emoji;
                    inp.dispatchEvent(new Event('input'));
                    inp.focus();
                }
                emojiPicker.classList.add('hidden');
            };
        });
        document.addEventListener('click', (e) => {
            if (!emojiBtn.contains(e.target) && !emojiPicker.contains(e.target)) {
                emojiPicker.classList.add('hidden');
            }
        });
    }

    // Polling inteligente para rendimiento de red óptimo
    if (comunidadPollInterval) clearInterval(comunidadPollInterval);

    // Si estamos en modo local fallback, no necesitamos hacer polling de red inútil
    comunidadPollInterval = setInterval(async () => {
        if (!comunidadModoLocal) {
            const msgs = await cargarMensajesComunidad();
            renderizarMensajesComunidad(msgs);
        } else {
            // En modo local simplemente leemos localStorage de forma ultra rápida
            renderizarMensajesComunidad(obtenerMensajesLocales());
        }
    }, 6000);
}

async function enviarYRefrescar() {
    const input = document.getElementById('community-input');
    if (!input) return;
    const texto = input.value.trim();
    if (!texto) return;

    if (usuarioActivo && usuarioActivo.nombre === 'Invitado') {
        mostrarToast('⚠ Inicia sesión para escribir en la comunidad.');
        return;
    }

    const replyId = comunidadReplying ? comunidadReplying.id : null;
    const replyAutor = comunidadReplying ? comunidadReplying.autor : null;

    input.value = '';
    const charCount = document.getElementById('comm-char-count');
    if (charCount) charCount.textContent = '0/500';

    comunidadReplying = null;
    const banner = document.getElementById('comm-reply-banner');
    if (banner) banner.classList.add('hidden');

    const sendBtn = document.getElementById('community-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    const ok = await enviarMensajeComunidad(texto, replyId, replyAutor);
    if (sendBtn) sendBtn.disabled = false;

    if (ok) {
        const msgs = await cargarMensajesComunidad();
        renderizarMensajesComunidad(msgs);
    } else {
        mostrarToast('❌ No se pudo enviar el mensaje.');
    }
}
