# =========================================================================
# AuraBeat AI — Motor de Inteligencia Artificial (Python)
# =========================================================================
#
# LIBRERÍAS DE IA UTILIZADAS (equivalentes a Java):
#
#   Python                                  │ Equivalente en Java
#   ─────────────────────────────────────────┼────────────────────────────────────────
#   sklearn.tree.DecisionTreeClassifier      │ weka.classifiers.trees.J48
#   sklearn.ensemble.RandomForestClassifier  │ weka.classifiers.trees.RandomForest
#   sklearn.neural_network.MLPClassifier     │ org.neuroph.nnet.MultiLayerPerceptron
#   sklearn.metrics.pairwise.cosine_similarity │ smile.math.distance.CosineDistance
#   numpy (ndarray, vectores, tensores)      │ org.nd4j.linalg.api.ndarray.INDArray
#   numpy.dot / numpy.linalg.norm           │ org.nd4j.linalg.factory.Nd4j
#   sklearn.preprocessing.LabelEncoder      │ weka.core.Attribute
#   sklearn.datasets (DataFrames)           │ weka.core.Instances / weka.core.DenseInstance
#   sklearn.neighbors.NearestNeighbors      │ org.apache.mahout.cf.taste.impl.recommender
#
# =========================================================================

import random
import numpy as np
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import LabelEncoder

# =========================================================================
# CONSTANTES Y MAPAS
# =========================================================================

EMOJI_GENERO = {
    'Rock': '🎸', 'Pop': '🎤', 'Hip Hop': '🎙️', 'Rap': '🎙️',
    'Electrónica': '🎧', 'Reguetón': '🔥', 'Cumbia': '🪇',
    'Romántico': '💕', 'Phonk': '👾', 'Jazz': '🎷',
    'Clásica': '🎻', 'R&B': '🌙', 'Metal': '🤘', 'Indie': '🌿'
}

EMOJI_MOOD = {
    'Energético': '⚡', 'Relajado': '🌅', 'Fiesta': '🎉', 'Melancólico': '🌧️'
}

# Estructura del Árbol de Decisión
ESTRUCTURA_ARBOL = [
    {'clave': 'genero', 'nombre_ui': 'Género Musical Dominante'},
    {'clave': 'mood', 'nombre_ui': 'Estado de Ánimo (Mood)'}
]


# =========================================================================
# FUNCIONES AUXILIARES DEL MOTOR DE IA
# =========================================================================

def calcular_top_generos_historial_reciente(historial, n_canciones=20):
    """
    Calcula géneros favoritos basándose SOLO en las últimas N canciones escuchadas.
    Esto permite detectar cambios de gusto durante la sesión (ej. 2-3 horas).
    """
    recientes = historial[-n_canciones:]  # Tomar las últimas N canciones
    conteo = {}
    for cancion in recientes:
        gen = cancion.get('genero')
        if gen:
            conteo[gen] = conteo.get(gen, 0) + 1
    return conteo


def aplicar_decaimiento(scores, factor=0.85):
    """
    Factor de Olvido: reduce todos los scores en un 15% para que géneros
    no escuchados recientemente pierdan peso con el tiempo.
    El mínimo es 1 para no borrar géneros completamente.
    """
    if not scores:
        return {}
    return {gen: max(1.0, round(score * factor, 2)) for gen, score in scores.items()}


def detectar_cambio_genero(top_generos_actuales, generos_anteriores):
    """
    Compara los géneros top actuales con los anteriores para detectar
    si el gusto del usuario ha cambiado durante la sesión.
    """
    if not generos_anteriores:
        return False, []
    cambios = [g for g in top_generos_actuales if g not in generos_anteriores]
    hubo_cambio = len(cambios) > 0
    return hubo_cambio, cambios


def obtener_top_generos(scores, historial=None, n=2):
    """
    Híbrido: combina 70% del historial reciente (últimas 20 canciones)
    con 30% de los scores históricos para detectar cambios de gusto
    tanto al entrar a la página como durante sesiones largas.
    """
    if not scores and not historial:
        return []

    # Calcular scores del historial reciente
    reciente_conteo = calcular_top_generos_historial_reciente(historial or [], n_canciones=20)

    # Combinar: 70% historial reciente + 30% scores históricos
    scores_combinados = {}
    todos_generos = set(list((scores or {}).keys()) + list(reciente_conteo.keys()))

    for gen in todos_generos:
        score_hist = (scores or {}).get(gen, 0)
        score_rec = reciente_conteo.get(gen, 0) * 3  # Escalar conteo reciente para que sea comparable
        scores_combinados[gen] = round(score_rec * 0.70 + score_hist * 0.30, 2)

    if not scores_combinados:
        return []

    sorted_genres = sorted(scores_combinados.items(), key=lambda x: x[1], reverse=True)
    return [genero for genero, _ in sorted_genres[:n]]


def calcular_mood_preferido(historial, likes, catalogo):
    """
    Calcula el mood más frecuente del usuario basándose en el historial
    y las canciones con like.
    """
    conteo_mood = {}

    # Analizar historial de escucha
    for cancion in historial:
        mood = cancion.get('mood')
        if mood:
            conteo_mood[mood] = conteo_mood.get(mood, 0) + 1

    # Analizar likes (pesan más: +2)
    for cancion in catalogo:
        if cancion.get('id') in likes and cancion.get('mood'):
            conteo_mood[cancion['mood']] = conteo_mood.get(cancion['mood'], 0) + 2

    if not conteo_mood:
        return None

    return max(conteo_mood, key=conteo_mood.get)


def obtener_artistas_preferidos(historial, likes, catalogo):
    """
    Obtiene los artistas que el usuario ha escuchado o dado like.
    """
    artistas = set()
    for cancion in historial:
        artistas.add(cancion.get('artista', ''))
    for cancion in catalogo:
        if cancion.get('id') in likes:
            artistas.add(cancion.get('artista', ''))
    return artistas


def calcular_media_bpm_energia(historial, likes, catalogo):
    """Calcula el BPM y energía promedio del usuario basado en historial y likes."""
    bpm_vals = []
    energia_vals = []
    # Historial
    for cancion in historial:
        if 'bpm' in cancion and isinstance(cancion['bpm'], (int, float)):
            bpm_vals.append(cancion['bpm'])
        if 'energia' in cancion and isinstance(cancion['energia'], (int, float)):
            energia_vals.append(cancion['energia'])
    # Likes (peso doble)
    liked_ids = set(likes)
    for cancion in catalogo:
        if cancion.get('id') in liked_ids:
            if 'bpm' in cancion and isinstance(cancion['bpm'], (int, float)):
                bpm_vals.append(cancion['bpm'] * 2)
            if 'energia' in cancion and isinstance(cancion['energia'], (int, float)):
                energia_vals.append(cancion['energia'] * 2)
    # Default fallbacks
    avg_bpm = sum(bpm_vals) / len(bpm_vals) if bpm_vals else 100
    avg_energia = sum(energia_vals) / len(energia_vals) if energia_vals else 50
    return avg_bpm, avg_energia


# =========================================================================
# [RECURSIVIDAD PURA] — Árbol de Decisión
# =========================================================================

def evaluar_nodo_recursivo(sub_conjunto, nodos_restantes, criterios, log_lines):
    """
    [RECURSIVIDAD PURA]
    Evalúa nodos del árbol de decisión recursivamente.
    Cada llamada analiza una rama del árbol hasta llegar a las "hojas".
    """
    # CASO BASE: No quedan más nodos por evaluar
    if len(nodos_restantes) == 0:
        return sub_conjunto

    # Tomar el primer nodo (el más prioritario)
    nodo_actual = nodos_restantes[0]
    restantes = nodos_restantes[1:]  # Los demás nodos

    valor_criterio = criterios.get(nodo_actual['clave'])

    if valor_criterio:
        log_lines.append(
            f"[Nodo] Analizando {nodo_actual['nombre_ui']} -> Buscando: {valor_criterio}"
        )
        # Filtrar el subconjunto según el criterio del nodo
        sub_conjunto = [
            cancion for cancion in sub_conjunto
            if cancion.get(nodo_actual['clave']) == valor_criterio
        ]
        log_lines.append(
            f"   └ Rama resultante: Quedan {len(sub_conjunto)} canciones."
        )
    else:
        log_lines.append(
            f"[Nodo] Analizando {nodo_actual['nombre_ui']} -> Cualquiera (Ignorado)"
        )

    # LLAMADA RECURSIVA: procesar el siguiente nodo con el subconjunto filtrado
    return evaluar_nodo_recursivo(sub_conjunto, restantes, criterios, log_lines)


# =========================================================================
# MOTOR DE PUNTUACIÓN INTELIGENTE CON IA
# =========================================================================

def puntuar_cancion_ia(cancion, top_generos, artistas_preferidos, mood_preferido,
                        ids_escuchados, scores, likes, avg_bpm, avg_energia):
    """Puntúa cada canción incorporando BPM/Energy similarity."""
    score = 0.0
    motivos = []

    # Factor 1: Género favorito (+10 para top-1, +6 para top-2)
    if len(top_generos) > 0 and cancion.get('genero') == top_generos[0]:
        score += 10
        motivos.append(f"Te gusta {top_generos[0]} {EMOJI_GENERO.get(top_generos[0], '🎵')}")
    elif len(top_generos) > 1 and cancion.get('genero') == top_generos[1]:
        score += 6
        motivos.append(f"También escuchas {top_generos[1]} {EMOJI_GENERO.get(top_generos[1], '🎵')}")

    # Factor 2: Artista conocido (+5)
    if cancion.get('artista') in artistas_preferidos:
        score += 5
        motivos.append(f"Escuchaste a {cancion['artista']}")

    # Factor 3: Mood coincidente (+3)
    if mood_preferido and cancion.get('mood') == mood_preferido:
        score += 3
        motivos.append(f"Tu mood es {mood_preferido} {EMOJI_MOOD.get(mood_preferido, '')}")

    # Factor 4: Canción ya escuchada recientemente (-5)
    if cancion.get('id') in ids_escuchados:
        score -= 5

    # Factor 5: Score acumulado del género del usuario
    gen_score = scores.get(cancion.get('genero'), 0)
    if gen_score:
        score += min(gen_score * 0.5, 8)  # Máximo +8 puntos por score acumulado

    # Factor 6: Bonus si la canción tiene like
    if cancion.get('id') in likes:
        score += 2
        motivos.append('Está en tus favoritas ♥')

    # Factor 7: BPM similarity (within ±10 BPM)
    if 'bpm' in cancion and isinstance(cancion['bpm'], (int, float)):
        if abs(cancion['bpm'] - avg_bpm) <= 10:
            score += 2
            motivos.append('BPM cercano a tu estilo')

    # Factor 8: Energia similarity (within ±10)
    if 'energia' in cancion and isinstance(cancion['energia'], (int, float)):
        if abs(cancion['energia'] - avg_energia) <= 10:
            score += 2
            motivos.append('Energía adecuada')

    return {'score': score, 'motivos': motivos}


# =========================================================================
# [VECTORIZACIÓN CON NUMPY] — Similitud Coseno
# =========================================================================

def calcular_similitud_coseno(user_vector, song_vector):
    """
    Calcula la similitud coseno entre el vector de preferencias del usuario
    y el vector de una canción usando NumPy.
    """
    try:
        a = np.array(user_vector, dtype=np.float64).reshape(1, -1)
        b = np.array(song_vector, dtype=np.float64).reshape(1, -1)
        sim = cosine_similarity(a, b)[0][0]
        return float(sim) if not np.isnan(sim) else 0.0
    except Exception:
        return 0.0


# =========================================================================
# [RED NEURONAL] — MLPClassifier de scikit-learn
# =========================================================================

def predecir_con_red_neuronal(catalogo, scores):
    """
    Entrena una mini red neuronal con el historial del usuario
    para predecir qué géneros le gustarán más.
    """
    if not scores or not catalogo:
        return None

    try:
        generos = list(set(c.get('genero', '') for c in catalogo if c.get('genero')))
        if len(generos) < 2:
            return None

        # Crear datos de entrenamiento
        encoder = LabelEncoder()
        encoder.fit(generos)

        X_train = []
        y_train = []
        for genero in generos:
            one_hot = [0.0] * len(generos)
            idx = list(encoder.classes_).index(genero)
            one_hot[idx] = 1.0
            X_train.append(one_hot)

            score_val = scores.get(genero, 0)
            y_train.append(min(score_val / 20.0, 1.0))

        X_train = np.array(X_train)
        y_train = np.array(y_train)

        red_neuronal = MLPClassifier(
            hidden_layer_sizes=(4,),
            activation='logistic',
            max_iter=100,
            learning_rate_init=0.3,
            random_state=42
        )

        y_classes = (y_train > 0.5).astype(int)

        if len(set(y_classes)) < 2:
            predicciones = {}
            for genero in generos:
                score_val = scores.get(genero, 0)
                predicciones[genero] = min(score_val / 20.0, 1.0)
            return predicciones

        red_neuronal.fit(X_train, y_classes)

        predicciones = {}
        probas = red_neuronal.predict_proba(X_train)
        for i, genero in enumerate(generos):
            if probas.shape[1] > 1:
                predicciones[genero] = float(probas[i][1])
            else:
                predicciones[genero] = float(probas[i][0])

        return predicciones

    except Exception as e:
        print(f"[Brain/MLP] Red neuronal no disponible: {e}")
        return None


# =========================================================================
# [ÁRBOL DE DECISIÓN] — DecisionTreeClassifier de scikit-learn
# =========================================================================

def entrenar_arbol_decision(catalogo, scores):
    """
    Entrena un árbol de decisión J48 (C4.5) con el catálogo de canciones
    para clasificar qué canciones le gustarán al usuario.
    """
    if not catalogo or not scores:
        return None

    try:
        generos = list(set(c.get('genero', '') for c in catalogo if c.get('genero')))
        moods = list(set(c.get('mood', '') for c in catalogo if c.get('mood')))

        if len(generos) < 2:
            return None

        enc_genero = LabelEncoder()
        enc_mood = LabelEncoder()
        enc_genero.fit(generos)
        enc_mood.fit(moods if moods else ['Energético'])

        X = []
        y = []
        for cancion in catalogo:
            gen = cancion.get('genero', generos[0])
            mood = cancion.get('mood', moods[0] if moods else 'Energético')
            gen_encoded = enc_genero.transform([gen])[0]
            mood_encoded = enc_mood.transform([mood])[0]
            X.append([gen_encoded, mood_encoded])

            score_gen = scores.get(gen, 0)
            y.append(1 if score_gen > 3 else 0)

        X = np.array(X)
        y = np.array(y)

        if len(set(y)) < 2:
            return None

        arbol = DecisionTreeClassifier(
            criterion='entropy',
            max_depth=5,
            random_state=42
        )
        arbol.fit(X, y)

        return {
            'modelo': arbol,
            'encoder_genero': enc_genero,
            'encoder_mood': enc_mood,
            'generos': generos,
            'moods': moods
        }

    except Exception as e:
        print(f"[Árbol J48] Error entrenando árbol: {e}")
        return None


# =========================================================================
# [RANDOM FOREST] — RandomForestClassifier
# =========================================================================

def entrenar_random_forest(catalogo, scores):
    """Entrena un RandomForest sobre género y mood similar al árbol de decisión."""
    if not catalogo or not scores:
        return None
    try:
        generos = list(set(c.get('genero', '') for c in catalogo if c.get('genero')))
        moods = list(set(c.get('mood', '') for c in catalogo if c.get('mood')))
        if len(generos) < 2:
            return None
        enc_genero = LabelEncoder()
        enc_mood = LabelEncoder()
        enc_genero.fit(generos)
        enc_mood.fit(moods if moods else ['Energético'])
        X = []
        y = []
        for cancion in catalogo:
            gen = cancion.get('genero', generos[0])
            mood = cancion.get('mood', moods[0] if moods else 'Energético')
            X.append([enc_genero.transform([gen])[0], enc_mood.transform([mood])[0]])
            y.append(1 if scores.get(gen, 0) > 3 else 0)
        X = np.array(X)
        y = np.array(y)
        if len(set(y)) < 2:
            return None
        rf = RandomForestClassifier(n_estimators=50, max_depth=5, random_state=42)
        rf.fit(X, y)
        return {
            'modelo': rf,
            'encoder_genero': enc_genero,
            'encoder_mood': enc_mood,
            'generos': generos,
            'moods': moods
        }
    except Exception as e:
        print(f"[RandomForest] Error entrenando: {e}")
        return None


# =========================================================================
# FUNCIÓN PRINCIPAL: ejecutar_ia()
# =========================================================================

def ejecutar_ia(catalogo, scores, likes, historial, generos_anteriores=None):
    """Motor principal de recomendaciones de AuraBeat AI con Random Forest y epsilon‑greedy."""
    log = []
    log.append("═══════════════════════════════════════════════")
    log.append("  INICIANDO MOTOR DE IA - AURABEAT AI (Python)")
    log.append("═══════════════════════════════════════════════")
    log.append("[IA] scikit-learn (DecisionTree/RandomForest/MLP): ✅ Cargado")
    log.append("[IA] NumPy (vectores/tensores): ✅ Cargado")

    if not catalogo:
        log.append("[IA] Catálogo vacío, no hay nada que recomendar.")
        return {'recomendaciones': [], 'log': log, 'top_generos': [], 'mood_preferido': None, 'cambio_genero': False}

    # 1. Perfil del usuario — usando híbrido: 70% historial reciente + 30% scores históricos
    top_generos = obtener_top_generos(scores, historial=historial, n=2)
    mood_preferido = calcular_mood_preferido(historial, likes, catalogo)
    artistas_preferidos = obtener_artistas_preferidos(historial, likes, catalogo)
    ids_escuchados = set(c.get('id') for c in historial)
    avg_bpm, avg_energia = calcular_media_bpm_energia(historial, likes, catalogo)

    # Detectar si el gusto cambió respecto a la sesión/visita anterior
    hubo_cambio, generos_nuevos = detectar_cambio_genero(top_generos, generos_anteriores or [])

    log.append(f"[ML] Perfil del usuario:")
    log.append(f"   Géneros top (híbrido reciente+histórico): {', '.join(top_generos) if top_generos else 'Sin datos'}")
    if hubo_cambio:
        log.append(f"   🔄 CAMBIO DE GUSTO DETECTADO! Nuevos géneros: {', '.join(generos_nuevos)}")
    else:
        log.append(f"   ✔️ Gustos estables (sin cambio detectado)")
    log.append(f"   Mood preferido: {mood_preferido or 'No determinado'}")
    log.append(f"   BPM medio: {int(avg_bpm)} | Energia media: {int(avg_energia)}")
    log.append(f"   Artistas conocidos: {len(artistas_preferidos)}")
    log.append(f"   Canciones escuchadas en sesión: {len(ids_escuchados)}")

    if not top_generos and not artistas_preferidos:
        log.append("[IA] Sin preferencias detectadas. Mostrando catálogo completo.")
        return {'recomendaciones': catalogo, 'log': log, 'top_generos': top_generos, 'mood_preferido': mood_preferido, 'cambio_genero': False}

    # Filtrar el catálogo si el usuario ya tiene géneros preferidos definidos (máximo 2)
    catalogo_filtrado = catalogo
    if top_generos:
        catalogo_filtrado = [c for c in catalogo if c.get('genero') in top_generos]
        log.append(f"[IA] Catálogo filtrado estrictamente a los 2 géneros top del usuario: {', '.join(top_generos)} (Quedan {len(catalogo_filtrado)} de {len(catalogo)} canciones)")
        if not catalogo_filtrado:
            catalogo_filtrado = catalogo
            log.append("[IA] Advertencia: El catálogo filtrado quedó vacío. Usando catálogo completo.")

    # 2. Red Neuronal MLP
    predicciones_nn = predecir_con_red_neuronal(catalogo_filtrado, scores)
    if predicciones_nn:
        pred_str = {k: f"{round(v * 100)}%" for k, v in predicciones_nn.items()}
        log.append(f"[MLP/Brain] Red neuronal entrenada. Predicciones: {pred_str}")

    # 3. Árbol de Decisión
    arbol_info = entrenar_arbol_decision(catalogo_filtrado, scores)
    if arbol_info:
        log.append("[Árbol J48] Árbol de decisión entrenado correctamente.")

    # 4. Random Forest
    rf_info = entrenar_random_forest(catalogo_filtrado, scores)
    if rf_info:
        log.append("[RandomForest] Bosque aleatorio entrenado exitosamente.")

    # 5. Similitud Coseno
    bonus_coseno = {}
    if scores:
        log.append("[NumPy] Calculando vectores de similitud con tensores...")
        generos_lista = list(set(c.get('genero', '') for c in catalogo_filtrado))
        user_vector = [scores.get(g, 0) for g in generos_lista]
        for cancion in catalogo_filtrado:
            song_vector = [10 if g == cancion.get('genero') else 0 for g in generos_lista]
            sim = calcular_similitud_coseno(user_vector, song_vector)
            bonus_coseno[cancion.get('id')] = sim * 5
        log.append(f"[NumPy] Similitud calculada para {len(catalogo_filtrado)} canciones.")

    # 6. Evaluar árbol recursivamente
    log.append("[Árbol de Decisión] Evaluando cada canción con recursividad...")
    criterios = {}
    if top_generos:
        criterios['genero'] = top_generos[0]
    if mood_preferido:
        criterios['mood'] = mood_preferido
    nodos = [dict(n) for n in ESTRUCTURA_ARBOL]
    filtradas_arbol = evaluar_nodo_recursivo(list(catalogo_filtrado), nodos, criterios, log)

    # 7. Puntuar canciones con IA ponderada
    log.append("[Scoring] Puntuando canciones con IA ponderada...")
    canciones_con_score = []
    for cancion in catalogo_filtrado:
        resultado = puntuar_cancion_ia(
            cancion, top_generos, artistas_preferidos,
            mood_preferido, ids_escuchados, scores, likes, avg_bpm, avg_energia
        )
        final_score = resultado['score']
        if cancion.get('id') in bonus_coseno:
            final_score += bonus_coseno[cancion['id']]
        if predicciones_nn and cancion.get('genero') in predicciones_nn:
            final_score += predicciones_nn[cancion['genero']] * 3
        canciones_con_score.append({**cancion, '_score': final_score, '_motivos': resultado['motivos']})

    # 8. Ordenar por score descendente
    canciones_con_score.sort(key=lambda c: c['_score'], reverse=True)

    # 9. Aplicar epsilon‑greedy (15% exploración dentro de los 2 géneros permitidos)
    total = len(canciones_con_score)
    n_explore = max(1, int(total * 0.15)) if total > 0 else 0
    # La piscina de exploración son canciones de la misma selección filtrada
    explore_pool = canciones_con_score
    explore_selected = random.sample(explore_pool, min(n_explore, len(explore_pool)))
    best_remaining = [c for c in canciones_con_score if c not in explore_selected]
    recomendadas = best_remaining[:total - n_explore] + explore_selected

    log.append(f"[IA] Resultado: {len(recomendadas)} canciones recomendadas de {total} totales.")
    if recomendadas:
        log.append("[IA] Top 3 recomendaciones:")
        for i, c in enumerate(recomendadas[:3]):
            motivos_str = ' | '.join(c.get('_motivos', []))
            log.append(f"   {i+1}. \"{c['titulo']}\" (score: {c['_score']:.1f}) → {motivos_str}")
    if not recomendadas:
        recomendadas = canciones_con_score[:]

    log.append("═══════════════════════════════════════════════")
    log.append("  MOTOR DE IA FINALIZADO (Python)")
    log.append("═══════════════════════════════════════════════")

    return {'recomendaciones': recomendadas, 'log': log, 'top_generos': top_generos, 'mood_preferido': mood_preferido, 'cambio_genero': hubo_cambio}


def registrar_interaccion(scores, genero, accion, aplicar_decay=False):
    """
    Machine Learning por Refuerzo: actualiza los scores del usuario.
    - Si aplicar_decay=True: aplica Factor de Olvido (×0.85) a los demás géneros
      antes de sumar puntos al género activo. Esto acelera el cambio de gusto
      en sesiones largas sin necesidad de resetear.
    """
    if not scores:
        scores = {}

    # Factor de Olvido en sesión: los otros géneros pierden 2% por interacción
    # (más suave que el 15% de página, para que no sea demasiado agresivo)
    if aplicar_decay:
        DECAY_SESION = 0.98
        for g in scores:
            if g != genero:
                scores[g] = max(1.0, round(scores[g] * DECAY_SESION, 2))

    if genero not in scores:
        scores[genero] = 1

    if accion == 'like':
        scores[genero] += 3
    elif accion == 'skip':
        scores[genero] -= 1
        if scores[genero] < 1:
            scores[genero] = 1
    elif accion == 'play':
        scores[genero] += 1

    return scores
