
import os
import json
import base64
import requests
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS

# Importar el motor de IA de AuraBeat
from ia_engine import (
    ejecutar_ia,
    registrar_interaccion,
    obtener_top_generos,
    calcular_mood_preferido
)

# =========================================================================
# CONFIGURACIÓN
# =========================================================================

# El folder estático apunta al directorio padre para servir index.html, src y assets
app = Flask(__name__, static_folder='../', static_url_path='')
CORS(app)

# Credenciales de Supabase
SUPABASE_URL = "https://whqxgrijuctfjwvydxpr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndocXhncmlqdWN0Zmp3dnlkeHByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzAzNjcsImV4cCI6MjA5NTU0NjM2N30.t-e-ipx2e4jxf37yHuwuXJ4HSReuF316L883jawV40A"

HEADERS_BASE = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}


def supabase_request(path, method="GET", data=None, headers_extra=None):
    url = f"{SUPABASE_URL}{path}"
    headers = {**HEADERS_BASE}
    if headers_extra:
        headers.update(headers_extra)

    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, timeout=10)
        elif method == "POST":
            resp = requests.post(url, headers=headers, json=data, timeout=10)
        elif method == "PATCH":
            resp = requests.patch(url, headers=headers, json=data, timeout=10)
        elif method == "DELETE":
            resp = requests.delete(url, headers=headers, timeout=10)
        else:
            resp = requests.get(url, headers=headers, timeout=10)

        return resp
    except requests.exceptions.RequestException as e:
        print(f"[Supabase] Error: {e}")
        return None


def supabase_upload(bucket_path, file_data, content_type):
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket_path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true"
    }
    try:
        resp = requests.post(url, headers=headers, data=file_data, timeout=30)
        return resp
    except requests.exceptions.RequestException as e:
        print(f"[Storage] Error: {e}")
        return None


# =========================================================================
# RUTAS — Servir Frontend
# =========================================================================

@app.route('/')
def index():
    return send_file(os.path.join(app.static_folder, 'index.html'))


# =========================================================================
# API — Catálogo de Canciones
# =========================================================================

@app.route('/api/catalogo', methods=['GET'])
def api_catalogo():
    resp = supabase_request("/rest/v1/canciones?select=*&order=id.asc")
    if resp and resp.ok:
        data = resp.json()
        data.sort(key=lambda c: c.get('titulo', ''))
        return jsonify(data)
    return jsonify([])


# =========================================================================
# API — Autenticación
# =========================================================================

@app.route('/api/login', methods=['POST'])
def api_login():
    body = request.get_json()
    nombre = body.get('nombre', '').strip()
    password = body.get('password', '')

    if not nombre or not password:
        return jsonify({"error": "Completa todos los campos."}), 400

    resp = supabase_request(
        f"/rest/v1/usuarios?nombre=eq.{requests.utils.quote(nombre)}"
    )
    if not resp or not resp.ok:
        return jsonify({"error": "Error de conexión."}), 500

    data = resp.json()
    if len(data) == 0:
        return jsonify({"error": "not_found"}), 404

    usuario = data[0]
    try:
        stored_pass = base64.b64decode(usuario.get('password', '')).decode('utf-8')
    except Exception:
        stored_pass = ''

    if stored_pass != password:
        return jsonify({"error": "wrong_password"}), 401

    return jsonify(usuario)


@app.route('/api/registro', methods=['POST'])
def api_registro():
    body = request.get_json()
    nombre = body.get('nombre', '').strip()
    password = body.get('password', '')
    genero_fav = body.get('generofav', 'Pop')

    if not nombre or not password:
        return jsonify({"error": "Completa todos los campos."}), 400

    check = supabase_request(
        f"/rest/v1/usuarios?nombre=eq.{requests.utils.quote(nombre)}"
    )
    if check and check.ok and len(check.json()) > 0:
        return jsonify({"error": "exists"}), 409

    nuevo_usuario = {
        "nombre": nombre,
        "password": base64.b64encode(password.encode('utf-8')).decode('utf-8'),
        "generofav": genero_fav,
        "scores": {genero_fav: 5},
        "likes": [],
        "playlists": []
    }

    try:
        test = supabase_request("/rest/v1/usuarios?select=role&limit=1")
        if test and test.ok:
            nuevo_usuario["role"] = "admin" if nombre.lower() == "alex" else "user"
    except Exception:
        pass

    insert = supabase_request(
        "/rest/v1/usuarios",
        method="POST",
        data=nuevo_usuario,
        headers_extra={"Prefer": "return=representation"}
    )

    if insert and insert.ok:
        result = insert.json()
        return jsonify(result[0] if isinstance(result, list) and result else nuevo_usuario)

    return jsonify({"error": "No se pudo crear el usuario."}), 500


# =========================================================================
# API — Estado del Usuario
# =========================================================================

@app.route('/api/usuario/estado', methods=['PATCH'])
def api_usuario_estado():
    body = request.get_json()
    nombre = body.get('nombre', '').strip()

    if not nombre or nombre == "Invitado":
        return jsonify({"ok": False}), 400

    update_data = {}
    if 'scores' in body:
        update_data['scores'] = body['scores']
    if 'likes' in body:
        update_data['likes'] = body['likes']
    if 'playlists' in body:
        update_data['playlists'] = body['playlists']
    if 'recomendacion1' in body:
        update_data['recomendacion1'] = body['recomendacion1']
    if 'recomendacion2' in body:
        update_data['recomendacion2'] = body['recomendacion2']

    resp = supabase_request(
        f"/rest/v1/usuarios?nombre=eq.{requests.utils.quote(nombre)}",
        method="PATCH",
        data=update_data
    )

    if resp and resp.ok:
        return jsonify({"ok": True})
    return jsonify({"ok": False}), 500


@app.route('/api/usuario/refrescar', methods=['POST'])
def api_usuario_refrescar():
    body = request.get_json()
    nombre = body.get('nombre', '').strip()

    if not nombre:
        return jsonify({"error": "Nombre requerido."}), 400

    resp = supabase_request(
        f"/rest/v1/usuarios?nombre=eq.{requests.utils.quote(nombre)}"
    )
    if resp and resp.ok:
        data = resp.json()
        if data:
            return jsonify(data[0])
    return jsonify({"error": "No encontrado."}), 404


# =========================================================================
# API — Motor de IA (Recomendaciones)
# =========================================================================

@app.route('/api/recomendar', methods=['POST'])
def api_recomendar():
    body = request.get_json()
    scores = body.get('scores', {})
    likes = body.get('likes', [])
    historial = body.get('historial', [])

    resp = supabase_request("/rest/v1/canciones?select=*&order=id.asc")
    catalogo = []
    if resp and resp.ok:
        catalogo = resp.json()

    resultado = ejecutar_ia(catalogo, scores, likes, historial)

    nombre = body.get('nombre')
    if nombre and nombre != "Invitado":
        top_generos = resultado.get('top_generos', [])
        update_data = {
            'recomendacion1': top_generos[0] if len(top_generos) > 0 else None,
            'recomendacion2': top_generos[1] if len(top_generos) > 1 else None
        }
        supabase_request(
            f"/rest/v1/usuarios?nombre=eq.{requests.utils.quote(nombre)}",
            method="PATCH",
            data=update_data
        )

    return jsonify(resultado)


@app.route('/api/interaccion', methods=['POST'])
def api_interaccion():
    body = request.get_json()
    scores = body.get('scores', {})
    genero = body.get('genero', '')
    accion = body.get('accion', 'play')

    scores_actualizados = registrar_interaccion(scores, genero, accion)

    return jsonify({"scores": scores_actualizados})


# =========================================================================
# API — Subir Canciones
# =========================================================================

@app.route('/api/subir', methods=['POST'])
def api_subir():
    audio_file = request.files.get('audio')
    image_file = request.files.get('imagen')
    titulo = request.form.get('titulo', '')
    artista = request.form.get('artista', '')
    genero = request.form.get('genero', 'Pop')
    mood = request.form.get('mood', 'Energético')

    if not audio_file:
        return jsonify({"error": "No se proporcionó archivo de audio."}), 400

    import unicodedata
    import re

    def sanear(nombre):
        nombre = unicodedata.normalize("NFD", nombre)
        nombre = ''.join(c for c in nombre if unicodedata.category(c) != 'Mn')
        nombre = re.sub(r'[^a-zA-Z0-9.\-]', '_', nombre)
        nombre = re.sub(r'_+', '_', nombre)
        return nombre

    import time
    timestamp = int(time.time() * 1000)

    nombre_audio = f"{timestamp}_{sanear(audio_file.filename)}"
    resp_audio = supabase_upload(
        f"canciones/{nombre_audio}",
        audio_file.read(),
        audio_file.content_type or "audio/mpeg"
    )

    if not resp_audio or not resp_audio.ok:
        return jsonify({"error": "Error al subir el audio."}), 500

    url_audio = f"{SUPABASE_URL}/storage/v1/object/public/canciones/{nombre_audio}"

    # Si el cliente ya nos envía una URL de imagen previa (para subidas en lote/álbum), la reutilizamos
    url_imagen = request.form.get('imagen_url')
    if not url_imagen and image_file:
        nombre_imagen = f"{timestamp}_{sanear(image_file.filename)}"
        resp_img = supabase_upload(
            f"canciones/{nombre_imagen}",
            image_file.read(),
            image_file.content_type or "image/jpeg"
        )
        if resp_img and resp_img.ok:
            url_imagen = f"{SUPABASE_URL}/storage/v1/object/public/canciones/{nombre_imagen}"

    cancion_data = {
        "titulo": titulo,
        "artista": artista,
        "genero": genero,
        "mood": mood,
        "url_audio": url_audio,
        "url_imagen": url_imagen
    }

    resp_insert = supabase_request(
        "/rest/v1/canciones",
        method="POST",
        data=cancion_data,
        headers_extra={"Prefer": "return=representation"}
    )

    if resp_insert and resp_insert.ok:
        return jsonify({"ok": True, "cancion": cancion_data})
    return jsonify({"error": "Error al guardar en la base de datos."}), 500


# =========================================================================
# API — Eliminar Canciones
# =========================================================================

@app.route('/api/eliminar/<int:cancion_id>', methods=['DELETE'])
def api_eliminar(cancion_id):
    resp = supabase_request(f"/rest/v1/canciones?id=eq.{cancion_id}")
    if resp and resp.ok:
        data = resp.json()
        if data:
            cancion = data[0]
            url_audio = cancion.get('url_audio', '')
            if url_audio:
                nombre_archivo = url_audio.split('/')[-1]
                headers_del = {
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}"
                }
                try:
                    requests.delete(
                        f"{SUPABASE_URL}/storage/v1/object/canciones/{nombre_archivo}",
                        headers=headers_del,
                        timeout=10
                    )
                except Exception:
                    pass

    resp_del = supabase_request(
        f"/rest/v1/canciones?id=eq.{cancion_id}",
        method="DELETE"
    )

    if resp_del and resp_del.ok:
        return jsonify({"ok": True})
    return jsonify({"error": "Error al eliminar."}), 500


# =========================================================================
# API — Comunidad
# =========================================================================

@app.route('/api/comunidad', methods=['GET'])
def api_comunidad_get():
    resp = supabase_request(
        "/rest/v1/comunidad_mensajes?select=*&order=created_at.asc&limit=100"
    )
    if resp and resp.ok:
        return jsonify(resp.json())
    return jsonify([])


@app.route('/api/comunidad', methods=['POST'])
def api_comunidad_post():
    body = request.get_json()

    payload = {
        "autor": body.get('autor'),
        "mensaje": body.get('mensaje', ''),
        "reply_to_id": body.get('reply_to_id'),
        "reply_to_autor": body.get('reply_to_autor'),
        "likes": 0
    }

    resp = supabase_request(
        "/rest/v1/comunidad_mensajes",
        method="POST",
        data=payload,
        headers_extra={"Prefer": "return=representation"}
    )

    if resp and resp.ok:
        return jsonify({"ok": True})
    return jsonify({"error": "Error al enviar mensaje."}), 500


@app.route('/api/comunidad/like/<int:msg_id>', methods=['PATCH'])
def api_comunidad_like(msg_id):
    body = request.get_json()
    nuevos_likes = body.get('likes', 1)

    resp = supabase_request(
        f"/rest/v1/comunidad_mensajes?id=eq.{msg_id}",
        method="PATCH",
        data={"likes": nuevos_likes}
    )

    if resp and resp.ok:
        return jsonify({"ok": True})
    return jsonify({"error": "Error al dar like."}), 500


# =========================================================================
# API — Admin (inicialización)
# =========================================================================

@app.route('/api/admin/init', methods=['POST'])
def api_admin_init():
    check = supabase_request("/rest/v1/usuarios?nombre=eq.alex")
    if check and check.ok:
        data = check.json()
        if len(data) == 0:
            admin = {
                "nombre": "alex",
                "password": base64.b64encode("tello".encode()).decode(),
                "generofav": "Pop",
                "scores": {"Pop": 5},
                "likes": [],
                "playlists": []
            }
            try:
                test = supabase_request("/rest/v1/usuarios?select=role&limit=1")
                if test and test.ok:
                    admin["role"] = "admin"
            except Exception:
                pass

            supabase_request("/rest/v1/usuarios", method="POST", data=admin)
            return jsonify({"created": True})
        else:
            alex = data[0]
            update = {"password": base64.b64encode("tello".encode()).decode()}
            try:
                test = supabase_request("/rest/v1/usuarios?select=role&limit=1")
                if test and test.ok:
                    update["role"] = "admin"
            except Exception:
                pass

            supabase_request(
                "/rest/v1/usuarios?nombre=eq.alex",
                method="PATCH",
                data=update
            )
            return jsonify({"updated": True})

    return jsonify({"ok": True})


# =========================================================================
# ARRANQUE DEL SERVIDOR
# =========================================================================

if __name__ == '__main__':
    print("=" * 60)
    print("  AuraBeat AI — Servidor Python (Flask) en backend/")
    print("  Abre tu navegador en: http://localhost:5000")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=True)
