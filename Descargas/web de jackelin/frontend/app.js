// frontend/app.js

let API_BASE_URL;
if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
  // Desarrollo local
  API_BASE_URL = window.location.port === "5500" ? "http://127.0.0.1:8000" : window.location.origin;
} else {
  // Producción (Hugging Face, etc.)
  API_BASE_URL = window.location.origin;
}


// Estado de la aplicación
let state = {
  user: null,
  feedVideos: [],
  activePlayer: null,
  activeCardIndex: -1,
  watchTimer: null,
  watchStartTime: 0,
  videoDuration: 0,
  watchLogged: false,
  likedVideos: {},   // { videoId: videoObj }
  savedVideos: {},   // { videoId: videoObj }
  currentView: 'feed',
  commentsCache: {}  // Caché de comentarios para mejorar el rendimiento
};

// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", () => {
  // Verificar si hay sesión en localStorage
  const savedUser = localStorage.getItem("videorec_user");
  if (savedUser) {
    state.user = JSON.parse(savedUser);
    showAppScreen();
  } else {
    showAuthScreen();
  }
});

// --- PANTALLAS (SPA CONTROLLERS) ---
function showAuthScreen() {
  document.getElementById("auth-screen").style.display = "flex";
  document.getElementById("app-screen").style.display = "none";
}

function showAppScreen() {
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("app-screen").style.display =
    window.innerWidth > 768 ? "grid" : "flex";

  const isAdmin = state.user && state.user.role === "admin";
  const adminBtn = document.getElementById("admin-panel-btn");
  if (adminBtn) adminBtn.style.display = isAdmin ? "block" : "none";
  const sidebarAdminBtn = document.getElementById("sidebar-admin-btn");
  if (sidebarAdminBtn) sidebarAdminBtn.style.display = isAdmin ? "flex" : "none";

  // Cargar likes/guardados desde localStorage
  const savedLikes = localStorage.getItem("videorec_likes_" + state.user.id);
  if (savedLikes) state.likedVideos = JSON.parse(savedLikes);
  const savedSaved = localStorage.getItem("videorec_saved_" + state.user.id);
  if (savedSaved) state.savedVideos = JSON.parse(savedSaved);

  showView('feed');
}

// --- NAVEGACIÓN ENTRE VISTAS ---
function showView(view) {
  state.currentView = view;
  // Ocultar todos los paneles
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active-panel'));
  // Desactivar todos los nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  if (view === 'feed') {
    document.getElementById('tiktok-feed').classList.add('active-panel');
    document.getElementById('nav-parati')?.classList.add('active');
    if (state.feedVideos.length === 0) {
      document.getElementById('tiktok-feed').innerHTML = '<div class="video-loader"></div>';
      loadFeed();
    }
  } else if (view === 'likes') {
    document.getElementById('view-likes').classList.add('active-panel');
    document.getElementById('nav-likes')?.classList.add('active');
    renderCollectionGrid('likes-grid', state.likedVideos, '❤️ Aún no has dado like a ningún video.');
  } else if (view === 'saved') {
    document.getElementById('view-saved').classList.add('active-panel');
    document.getElementById('nav-saved')?.classList.add('active');
    renderCollectionGrid('saved-grid', state.savedVideos, '🔖 Aún no has guardado ningún video.');
  }
}

function renderCollectionGrid(gridId, videosObj, emptyMsg) {
  const grid = document.getElementById(gridId);
  const videos = Object.values(videosObj);
  if (videos.length === 0) {
    grid.innerHTML = `<div class="collection-empty">${emptyMsg}</div>`;
    return;
  }
  grid.innerHTML = videos.map(v => `
    <div class="collection-thumb" onclick="jumpToVideo('${v.id}')">
      <img src="https://img.youtube.com/vi/${v.id}/mqdefault.jpg"
           onerror="this.src='https://img.youtube.com/vi/${v.id}/default.jpg'"
           alt="${v.title}"/>
      <div class="thumb-play-icon">▶</div>
      <div class="thumb-info">
        <div class="thumb-title">${v.title}</div>
        <div class="thumb-channel">@${v.channel}</div>
      </div>
    </div>
  `).join('');
}

function jumpToVideo(videoId) {
  // Buscar el video en el feed y saltar a él
  const idx = state.feedVideos.findIndex(v => v.id === videoId);
  if (idx !== -1) {
    showView('feed');
    setTimeout(() => {
      const feed = document.getElementById('tiktok-feed');
      feed.scrollTop = idx * feed.clientHeight;
      setActiveVideo(idx);
    }, 100);
  } else {
    // No está en el feed actual, recargar y luego buscar
    showView('feed');
  }
}



function switchAuthTab(tab) {
  const loginForm = document.getElementById("login-form");
  const regForm = document.getElementById("register-form");
  const loginBtn = document.getElementById("tab-login-btn");
  const regBtn = document.getElementById("tab-register-btn");
  const errorMsg = document.getElementById("auth-error");

  errorMsg.classList.remove("visible");

  if (tab === "login") {
    loginForm.style.display = "block";
    regForm.style.display = "none";
    loginBtn.classList.add("active");
    regBtn.classList.remove("active");
  } else {
    loginForm.style.display = "none";
    regForm.style.display = "block";
    loginBtn.classList.remove("active");
    regBtn.classList.add("active");
  }
}

// --- AUTENTICACIÓN ---
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errorMsg = document.getElementById("auth-error");

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Error al iniciar sesión");
    }

    state.user = { id: data.user_id, username: data.username, role: data.role };
    localStorage.setItem("videorec_user", JSON.stringify(state.user));
    showAppScreen();
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.classList.add("visible");
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById("register-username").value.trim();
  const password = document.getElementById("register-password").value;
  const errorMsg = document.getElementById("auth-error");

  if (password.length < 6) {
    errorMsg.textContent = "La contraseña debe tener al menos 6 caracteres";
    errorMsg.classList.add("visible");
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Error al registrarse");
    }

    state.user = { id: data.user_id, username: data.username, role: data.role };
    localStorage.setItem("videorec_user", JSON.stringify(state.user));
    showAppScreen();
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.classList.add("visible");
  }
}

function handleLogout() {
  destroyPlayer();
  state.user = null;
  localStorage.removeItem("videorec_user");
  showAuthScreen();
}

// --- CARGA DEL FEED ---
async function loadFeed() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/feed?user_id=${state.user.id}`);
    const data = await res.json();
    state.feedVideos = data.videos;

    // Mostrar información del algoritmo
    const algoBadge = document.getElementById("algo-indicator");
    if (data.algorithm === "points_based_genre") {
      algoBadge.textContent = "📊 IA: Recomendación por Puntos de Género";
      algoBadge.style.color = "var(--secondary)";
    } else {
      algoBadge.textContent = "🎲 IA: Exploración Inicial (Aleatorio)";
      algoBadge.style.color = "#ffb86c";
    }

    renderFeed();
  } catch (err) {
    console.error("Error al cargar el feed:", err);
    document.getElementById("tiktok-feed").innerHTML = '<div style="padding:2rem;text-align:center;">Error al conectar con el backend de Python. ¿Está corriendo?</div>';
  }
}

function renderFeed() {
  const feed = document.getElementById("tiktok-feed");
  feed.innerHTML = "";

  if (state.feedVideos.length === 0) {
    feed.innerHTML = '<div style="padding:3rem;text-align:center;">No hay videos en la base de datos.</div>';
    return;
  }

  state.feedVideos.forEach((video, index) => {
    const card = document.createElement("div");
    card.className = "tiktok-card";
    card.id = `card-${index}`;
    card.setAttribute("data-index", index);
    card.style.cursor = "pointer";
    card.onclick = togglePlayPause;

    const isLiked = !!state.likedVideos[video.id];
    const isSaved = !!state.savedVideos[video.id];
    card.innerHTML = `
      <!-- Contenedor del video -->
      <div class="video-wrapper" id="player-container-${index}">
        <div class="video-loader"></div>
      </div>

      <!-- Ícono flotante de play/pausa -->
      <div class="play-pause-overlay" id="play-pause-${index}">▶</div>

      <!-- Barra lateral de acciones: stopPropagation evita que los clics lleguen al video-wrapper -->
      <div class="video-actions-sidebar">
        <div class="action-item ${isLiked ? 'liked' : ''}" id="like-btn-${index}" onclick="event.stopPropagation(); handleLike('${video.id}', ${index})">
          <div class="action-circle-btn like-circle">❤️</div>
          <span id="like-count-${index}">${isLiked ? 'Liked' : 'Me gusta'}</span>
        </div>
        <div class="action-item" onclick="event.stopPropagation(); openComments('${video.id}')">
          <div class="action-circle-btn">💬</div>
          <span>Comentar</span>
        </div>
        <div class="action-item ${isSaved ? 'saved' : ''}" id="save-btn-${index}" onclick="event.stopPropagation(); handleSave('${video.id}', ${index})">
          <div class="action-circle-btn save-circle">🔖</div>
          <span id="save-label-${index}">${isSaved ? 'Guardado' : 'Guardar'}</span>
        </div>
      </div>

      <!-- Info del video (izquierda) -->
      <div class="video-info-overlay">
        <div class="video-author">@${video.channel} <span>✓</span></div>
        <div class="video-title">${video.title}</div>
        <div class="video-category-tag">#${video.category}</div>
      </div>
    `;
    feed.appendChild(card);
  });

  // Configurar IntersectionObserver para detectar el video activo de forma muy eficiente
  setupFeedObserver();
}

// --- REPRODUCTOR DE YOUTUBE - IFRAME POR CARD ---
let feedObserver = null;
let isTransitioning = false;
let globalPlayer = null;       // mantenemos por compatibilidad con togglePlayPause
let globalPlayerReady = false;
let pendingVideoId = null;
let globalPlayerContainer = null;
let currentActiveIframe = null; // referencia al iframe activo actual

function setActiveVideo(index) {
  if (index < 0 || index >= state.feedVideos.length) return;
  if (isTransitioning) return;
  isTransitioning = true;

  logSkipIfEarly();
  state.activeCardIndex = index;
  state.watchLogged = false;
  state.watchStartTime = Date.now();

  const video = state.feedVideos[index];

  // Actualizar ambient glow
  const ambientGlow = document.getElementById("bg-ambient-glow");
  if (ambientGlow && video && video.id) {
    ambientGlow.style.backgroundImage = `url(https://img.youtube.com/vi/${video.id}/hqdefault.jpg)`;
  }

  const container = document.getElementById(`player-container-${index}`);
  if (!container) { isTransitioning = false; return; }

  // Quitar el iframe del card anterior (si existe)
  document.querySelectorAll(".tiktok-card .yt-embed-iframe").forEach(el => {
    const parentCard = el.closest(".tiktok-card");
    const cardIndex = parentCard ? parseInt(parentCard.getAttribute("data-index"), 10) : -1;
    if (cardIndex !== index) {
      el.remove();
    }
  });

  // Si este container ya tiene un iframe activo, no hacer nada
  if (container.querySelector(".yt-embed-iframe")) {
    globalPlayerReady = true;
    isTransitioning = false;
    fetchComments(video.id);
    return;
  }

  // Insertar nuevo iframe embed de YouTube directamente en el container
  const iframe = document.createElement("iframe");
  iframe.className = "yt-embed-iframe";
  iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&controls=1&rel=0&modestbranding=1&loop=1&playlist=${video.id}&enablejsapi=1`;
  iframe.allow = "autoplay; encrypted-media; fullscreen";
  iframe.setAttribute("allowfullscreen", "");
  iframe.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:none;z-index:10;pointer-events:none;";

  container.innerHTML = ""; // limpiar loader
  container.appendChild(iframe);

  currentActiveIframe = iframe;
  globalPlayerReady = true;
  state.activePlayer = null; // no usamos YT API, el iframe controla
  isPlaying = true;

  // Iniciar timer de retención
  clearInterval(state.watchTimer);
  state.watchTimer = setInterval(() => {
    checkWatchRetention();
  }, 1000);

  setTimeout(() => { isTransitioning = false; }, 400);
  fetchComments(video.id);
}

function destroyPlayer() {
  clearInterval(state.watchTimer);
  // Con iframes directos, no hay nada que destruir globalmente
}



function setupFeedObserver() {
  if (feedObserver) feedObserver.disconnect();

  feedObserver = new IntersectionObserver((entries) => {
    let bestEntry = null;
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
          bestEntry = entry;
        }
      }
    });
    if (bestEntry) {
      const index = parseInt(bestEntry.target.getAttribute("data-index"), 10);
      if (index !== state.activeCardIndex && !isTransitioning) {
        setActiveVideo(index);
      }
    }
  }, {
    root: document.getElementById("tiktok-feed"),
    threshold: [0.7, 0.8, 0.9]
  });

  document.querySelectorAll(".tiktok-card").forEach(card => feedObserver.observe(card));
}

function handleFeedScroll() {}

// Track play state manually since we don't have YT Player API access
let isPlaying = true;

function togglePlayPause() {
  if (!currentActiveIframe) return;

  const index = state.activeCardIndex;
  const overlay = document.getElementById(`play-pause-${index}`);

  if (isPlaying) {
    // Pausar: enviar postMessage al iframe de YouTube
    currentActiveIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    if (overlay) {
      overlay.textContent = "▶";
      overlay.classList.add("visible");
    }
    isPlaying = false;
  } else {
    // Reanudar
    currentActiveIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
    if (overlay) {
      overlay.classList.remove("visible");
    }
    isPlaying = true;
  }
}

// Con iframes embed, no recibimos eventos de estado directamente.
// Usamos un timer simple basado en el tiempo de permanencia para tracking de retención.
function handlePlayerStateChange(event) {
  // No se usa con iframes directos, mantenemos por compatibilidad
}

// --- SISTEMA DE LOGGING DE FEEDBACK (Métricas de la IA) ---

function checkWatchRetention() {
  if (state.watchLogged) return;

  try {
    const elapsed = (Date.now() - state.watchStartTime) / 1000;

    // Si ve más del 80% del video o más de 60 segundos, registramos reproducción completa
    if (state.videoDuration > 0 && elapsed >= state.videoDuration * 0.8) {
      state.watchLogged = true;
      logInteraction(state.feedVideos[state.activeCardIndex].id, "complete");
    } else if (elapsed >= 60) {
      // Fallback: si no tenemos duración pero lleva 60s viendo, es "complete"
      state.watchLogged = true;
      logInteraction(state.feedVideos[state.activeCardIndex].id, "complete");
    }
  } catch (e) {
    clearInterval(state.watchTimer);
  }
}


function logSkipIfEarly() {
  // Si pasa de video muy rápido (antes de 5 segundos o del 20% del video), es un skip (negativo)
  if (state.activeCardIndex === -1 || state.watchLogged) return;

  const elapsed = (Date.now() - state.watchStartTime) / 1000;
  const video = state.feedVideos[state.activeCardIndex];

  if (elapsed < 5 || (state.videoDuration > 0 && elapsed < state.videoDuration * 0.2)) {
    state.watchLogged = true;
    logInteraction(video.id, "skip");
  }
}

async function logInteraction(videoId, type) {
  try {
    await fetch(`${API_BASE_URL}/api/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: state.user.id,
        video_id: videoId,
        interaction_type: type
      })
    });
    console.log(`Interaction logged: ${type} for video ${videoId}`);
  } catch (e) {
    console.error("Error logging interaction:", e);
  }
}

// --- ACCIONES ---

function handleLike(videoId, index) {
  const btn = document.getElementById(`like-btn-${index}`);
  const label = document.getElementById(`like-count-${index}`);
  const isLiked = btn.classList.contains('liked');
  const video = state.feedVideos[index];

  if (isLiked) {
    btn.classList.remove('liked');
    delete state.likedVideos[videoId];
    if (label) label.textContent = 'Me gusta';
  } else {
    btn.classList.add('liked');
    state.likedVideos[videoId] = video;
    if (label) label.textContent = 'Liked';
    logInteraction(videoId, 'like');
  }
  localStorage.setItem('videorec_likes_' + state.user.id, JSON.stringify(state.likedVideos));
}

function handleSave(videoId, index) {
  const btn = document.getElementById(`save-btn-${index}`);
  const label = document.getElementById(`save-label-${index}`);
  const isSaved = btn.classList.contains('saved');
  const video = state.feedVideos[index];

  if (isSaved) {
    btn.classList.remove('saved');
    delete state.savedVideos[videoId];
    if (label) label.textContent = 'Guardar';
  } else {
    btn.classList.add('saved');
    state.savedVideos[videoId] = video;
    if (label) label.textContent = 'Guardado';
    logInteraction(videoId, 'save');
  }
  localStorage.setItem('videorec_saved_' + state.user.id, JSON.stringify(state.savedVideos));
}

// --- COMENTARIOS (SIDE PANEL / DRAWER) ---
let activeCommentVideoId = null;

function toggleComments(open) {
  const drawer = document.getElementById("comment-drawer");
  const overlay = document.getElementById("drawer-overlay");

  if (open) {
    drawer.classList.add("open");
    overlay.classList.add("open");
  } else {
    drawer.classList.remove("open");
    overlay.classList.remove("open");
    activeCommentVideoId = null;
  }
}

async function openComments(videoId) {
  activeCommentVideoId = videoId;
  toggleComments(true);
  await fetchComments(videoId);
}

async function fetchComments(videoId) {
  const list = document.getElementById("comment-list");

  // 1. Mostrar comentarios en caché de forma instantánea si existen
  if (state.commentsCache[videoId]) {
    renderCommentsList(state.commentsCache[videoId], list);
  } else {
    list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;font-size:0.9rem;">Cargando comentarios...</div>';
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/comments?video_id=${videoId}`);
    const data = await res.json();

    // 2. Guardar en caché y actualizar la vista
    state.commentsCache[videoId] = data.comments;
    renderCommentsList(data.comments, list);
  } catch (e) {
    console.error("Error al cargar comentarios:", e);
  }
}

function renderCommentsList(comments, listElement) {
  listElement.innerHTML = "";

  if (comments.length === 0) {
    listElement.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;font-size:0.9rem;">Sé el primero en comentar...</div>';
    return;
  }

  comments.forEach(c => {
    const item = document.createElement("div");
    item.className = "comment-item";

    const date = new Date(c.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="comment-user">@${c.username}</div>
      <div class="comment-text">${c.comment_text}</div>
      <div class="comment-time">${timeStr}</div>
    `;
    listElement.appendChild(item);
  });
}

async function submitComment(e) {
  e.preventDefault();
  if (!activeCommentVideoId || !state.user) return;

  const input = document.getElementById("new-comment-input");
  const text = input.value.trim();
  if (!text) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: state.user.id,
        video_id: activeCommentVideoId,
        username: state.user.username,
        comment_text: text
      })
    });

    if (res.ok) {
      input.value = "";
      // Recargar comentarios
      fetchComments(activeCommentVideoId);
    }
  } catch (e) {
    console.error("Error al enviar comentario:", e);
  }
}

// --- PANEL DE ADMINISTRACIÓN (CRUD DE VIDEOS) ---

function toggleAdminPanel(open) {
  const drawer = document.getElementById("admin-drawer");
  const overlay = document.getElementById("admin-overlay");
  if (open) {
    drawer.classList.add("open");
    overlay.classList.add("open");
    loadAdminCatalog();
  } else {
    drawer.classList.remove("open");
    overlay.classList.remove("open");
  }
}

async function loadAdminCatalog() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/videos`);
    const data = await res.json();
    const list = document.getElementById("admin-video-list");
    list.innerHTML = "";

    if (!data.videos || data.videos.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:1.5rem;font-size:0.9rem;">El catálogo está vacío.</div>';
      return;
    }

    data.videos.forEach(v => {
      const item = document.createElement("div");
      item.className = "admin-video-item";
      item.innerHTML = `
        <div class="admin-video-details">
          <div class="title">${v.title}</div>
          <div class="meta">@${v.channel} <span>#${v.category}</span></div>
        </div>
        <button class="admin-video-delete-btn" onclick="handleDeleteVideo('${v.id}')">🗑️</button>
      `;
      list.appendChild(item);
    });
  } catch (e) {
    console.error("Error al cargar catálogo de administración:", e);
  }
}

async function handleAddVideo(e) {
  e.preventDefault();
  const url = document.getElementById("admin-video-url").value.trim();
  const title = document.getElementById("admin-video-title").value.trim();
  const channel = document.getElementById("admin-video-channel").value.trim();
  const category = document.getElementById("admin-video-category").value;

  try {
    const res = await fetch(`${API_BASE_URL}/api/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title, channel, category })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Error al agregar video");
    }

    // Limpiar formulario
    document.getElementById("add-video-form").reset();
    alert("¡Video agregado con éxito al catálogo de Supabase! 🎉");

    // Recargar catálogo y feed
    loadAdminCatalog();
    loadFeed();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function handleDeleteVideo(videoId) {
  if (!confirm("¿Estás seguro de que deseas eliminar este video del catálogo de Supabase?")) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/videos/${videoId}`, {
      method: "DELETE"
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Error al eliminar video");
    }

    alert("¡Video eliminado con éxito de Supabase! 🗑️");

    // Recargar catálogo y feed
    loadAdminCatalog();
    loadFeed();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// Adaptar la interfaz dinámicamente si se redimensiona la ventana
window.addEventListener("resize", () => {
  const appScreen = document.getElementById("app-screen");
  if (appScreen && appScreen.style.display !== "none") {
    if (window.innerWidth > 768) {
      appScreen.style.display = "grid";
    } else {
      appScreen.style.display = "flex";
    }
  }
});
