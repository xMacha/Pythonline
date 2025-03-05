import os
from flask import Flask, render_template, request, flash, redirect, url_for, jsonify
from flask_sqlalchemy import SQLAlchemy
import logging
import sys
from io import StringIO
from contextlib import redirect_stdout, redirect_stderr
from queue import Queue
import threading
import requests
from datetime import datetime

logging.basicConfig(level=logging.DEBUG)

# Discord webhooks – dla uproszczenia można też trzymać w zmiennych środowiskowych
CONTACT_WEBHOOK = os.environ.get("CONTACT_WEBHOOK", "https://discord.com/api/webhooks/...")
VISIT_WEBHOOK = os.environ.get("VISIT_WEBHOOK", "https://discord.com/api/webhooks/...")

db = SQLAlchemy()
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "default-secret-key")
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get("DATABASE_URL", "sqlite:///app.db")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# Import modeli – w tym przykładzie zostają niezmienione
from models import Script

# Przechowywanie kolejek wejściowych – dla funkcji input
input_queues = {}

def send_discord_message(webhook_url, content):
    try:
        requests.post(webhook_url, json={"content": content})
    except Exception as e:
        logging.error(f"Failed to send Discord message: {e}")

@app.before_request
def track_visit():
    if not request.path.startswith('/static'):
        user_agent = request.headers.get('User-Agent', 'Unknown')
        ip = request.remote_addr
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        message = f"🌐 New visit\nTime: {timestamp}\nPath: {request.path}\nIP: {ip}\nUser Agent: {user_agent}"
        send_discord_message(VISIT_WEBHOOK, message)

# Endpointy do zarządzania skryptami – usunięto logikę logowania, używamy stałego user_id (np. 1)
@app.route('/api/scripts', methods=['GET'])
def get_scripts():
    scripts = Script.query.all()
    return jsonify([{
        'id': script.id,
        'title': script.title,
        'content': script.content,
        'updated_at': script.updated_at.isoformat()
    } for script in scripts])

@app.route('/api/scripts', methods=['POST'])
def save_script():
    data = request.get_json()
    script = Script(
        title=data['title'],
        content=data['content'],
        user_id=1  # stała wartość
    )
    db.session.add(script)
    db.session.commit()
    return jsonify({
        'id': script.id,
        'title': script.title,
        'content': script.content,
        'updated_at': script.updated_at.isoformat()
    })

@app.route('/api/scripts/<int:script_id>', methods=['PUT'])
def update_script(script_id):
    script = Script.query.filter_by(id=script_id).first_or_404()
    data = request.get_json()
    script.title = data['title']
    script.content = data['content']
    db.session.commit()
    return jsonify({
        'id': script.id,
        'title': script.title,
        'content': script.content,
        'updated_at': script.updated_at.isoformat()
    })

@app.route('/api/scripts/<int:script_id>', methods=['DELETE'])
def delete_script(script_id):
    script = Script.query.filter_by(id=script_id).first_or_404()
    db.session.delete(script)
    db.session.commit()
    return '', 204

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/execute', methods=['POST'])
def execute_code():
    code = request.json.get('code', '')
    session_id = request.headers.get('X-Session-ID', 'default')
    input_queue = Queue()
    input_queues[session_id] = input_queue
    output_buffer = StringIO()
    error_buffer = StringIO()
    try:
        with redirect_stdout(output_buffer), redirect_stderr(error_buffer):
            def custom_input(prompt=""):
                print(prompt, end='')
                return input_queue.get()
            safe_globals = {
                '__builtins__': {
                    'print': print,
                    'input': custom_input,
                    'len': len,
                    'str': str,
                    'int': int,
                    'float': float,
                    'range': range,
                    'list': list,
                    'dict': dict,
                    'set': set,
                    'tuple': tuple,
                    'bool': bool,
                }
            }
            exec(code, safe_globals, {})
        output = output_buffer.getvalue()
        error = error_buffer.getvalue()
        return jsonify({
            'output': output or 'No output',
            'error': error if error else None,
        })
    except Exception as e:
        return jsonify({'output': None, 'error': str(e)})
    finally:
        output_buffer.close()
        error_buffer.close()
        input_queues.pop(session_id, None)

@app.route('/input', methods=['POST'])
def handle_input():
    session_id = request.headers.get('X-Session-ID', 'default')
    input_text = request.json.get('input', '')
    if session_id in input_queues:
        input_queues[session_id].put(input_text)
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'No active session'})

# Przy starcie aplikacji tworzymy tabele
with app.app_context():
    db.create_all()
