# AuraBeat AI — Reproductor Musical Inteligente

## Arquitectura

```
┌─────────────────────┐     HTTP/API      ┌──────────────────────────────┐
│  Frontend (HTML/CSS) │ ←─────────────→  │  Backend Python (Flask)       │
│  + JS mínimo (DOM)   │                  │  • Motor IA (scikit-learn)    │
│                      │                  │  • Árbol de decisión          │
│  Navegador           │                  │  • Red neuronal               │
└─────────────────────┘                   │  • API Supabase               │
                                          │  • Autenticación              │
                                          │  • Comunidad                  │
                                          └──────────┬───────────────────┘
                                                     │
                                                     ▼
                                          ┌──────────────────────┐
                                          │  Supabase (PostgreSQL │
                                          │  + Storage)           │
                                          └──────────────────────┘
```

## Estructura del Proyecto

```
musicaweb-main/
├── backend/                    ← Servidor Python
│   ├── app.py                  ← Servidor Flask (API REST)
│   ├── ia_engine.py            ← Motor de IA (scikit-learn, numpy)
│   ├── requirements.txt        ← Dependencias Python
│   └── venv/                   ← Entorno virtual (no subir a Git)
├── src/
│   ├── css/style.css           ← Estilos del reproductor
│   └── js/app.js               ← Frontend (solo UI y DOM)
├── assets/                     ← Logos e imágenes
├── index.html                  ← Interfaz principal
└── README.md
```

## Librerías de IA (Python equivalentes a Java)

| Python (pip)                              | Equivalente en Java                              |
|-------------------------------------------|--------------------------------------------------|
| `sklearn.tree.DecisionTreeClassifier`     | `weka.classifiers.trees.J48`                     |
| `sklearn.ensemble.RandomForestClassifier` | `weka.classifiers.trees.RandomForest`            |
| `sklearn.neural_network.MLPClassifier`    | `org.neuroph.nnet.MultiLayerPerceptron`          |
| `sklearn.metrics.pairwise.cosine_similarity` | `smile.math.distance.CosineDistance`         |
| `numpy` (ndarray, vectores, tensores)     | `org.nd4j.linalg.api.ndarray.INDArray`           |
| `sklearn.preprocessing.LabelEncoder`     | `weka.core.Attribute`                            |
| `sklearn.neighbors.NearestNeighbors`     | `org.apache.mahout.cf.taste.impl.recommender`    |

## API REST (Rutas del Backend)

| Ruta                     | Método   | Función                                    |
|--------------------------|----------|--------------------------------------------|
| `/`                      | GET      | Servir index.html                          |
| `/api/catalogo`          | GET      | Cargar catálogo de canciones               |
| `/api/login`             | POST     | Login de usuario                           |
| `/api/registro`          | POST     | Registro de nuevo usuario                  |
| `/api/usuario/estado`    | PATCH    | Guardar scores, likes, playlists           |
| `/api/usuario/refrescar` | POST     | Refrescar datos del usuario                |
| `/api/recomendar`        | POST     | Motor de IA — genera recomendaciones       |
| `/api/interaccion`       | POST     | ML por refuerzo (like +3, skip -1, play +1)|
| `/api/subir`             | POST     | Subir canciones (audio + imagen)           |
| `/api/eliminar/<id>`     | DELETE   | Eliminar canción                           |
| `/api/comunidad`         | GET/POST | Mensajes de comunidad                      |
| `/api/comunidad/like/<id>` | PATCH  | Dar like a un mensaje                      |
| `/api/admin/init`        | POST     | Inicializar usuario admin                  |

## Instalación y Ejecución

### 1. Crear entorno virtual e instalar dependencias

```bash
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

### 2. Ejecutar el servidor

```bash
cd backend
venv/bin/python app.py
```

### 3. Abrir en el navegador

```
http://localhost:5000
```

## Motor de IA — Algoritmos Implementados

1. **Árbol de Decisión (J48/C4.5):** `DecisionTreeClassifier` con `criterion='entropy'`
   - Función recursiva `evaluar_nodo_recursivo()` con recursividad pura
2. **Red Neuronal (MLP):** `MLPClassifier` con capa oculta de 4 neuronas y activación sigmoide
3. **Similitud Coseno:** `cosine_similarity` de sklearn + vectores NumPy
4. **Scoring Ponderado:** Sistema de puntuación por género, artista, mood, historial y likes
5. **ML por Refuerzo:** Actualización de scores (+3 like, +1 play, -1 skip)

## Seguridad

- Las credenciales de Supabase están **solo en el backend** (no expuestas en el navegador)
- El frontend solo hace llamadas HTTP a `/api/...` del servidor Python
- Las contraseñas se almacenan codificadas en base64
