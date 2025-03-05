import os
from flask import Flask, render_template, request, flash, redirect, url_for, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, current_user, login_user, logout_user, login_required
import logging
import sys
from io import StringIO
from contextlib import redirect_stdout, redirect_stderr
from queue import Queue
import threading
import requests
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Discord webhooks
CONTACT_WEBHOOK = "https://discord.com/api/webhooks/1346855093076496516/nwNGKLKywWjT6C8SqlVB8YXU3ahPaR3lzXalXuGGwSZkMNxinxsdBF0Z_npVNA9jWrcO"
VISIT_WEBHOOK = "https://discord.com/api/webhooks/1346855358978723873/t2gCdE7MChP2INTpkkpDTwIkaO261uMA_xI3IVcHz2plSROV0V4V6PTIWowJ-VhfR0Xi"

# Initialize Flask extensions
db = SQLAlchemy()
login_manager = LoginManager()

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "default-secret-key")
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get("DATABASE_URL", "sqlite:///app.db")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
db.init_app(app)
login_manager.init_app(app)
login_manager.login_view = 'login'

# Import models after db initialization
from models import User, Script

# Store for input queues
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

@login_manager.user_loader
def load_user(id):
    return User.query.get(int(id))

# Script management endpoints
@app.route('/api/scripts', methods=['GET'])
@login_required
def get_scripts():
    scripts = Script.query.filter_by(user_id=current_user.id).all()
    return jsonify([{
        'id': script.id,
        'title': script.title,
        'content': script.content,
        'updated_at': script.updated_at.isoformat()
    } for script in scripts])

@app.route('/api/scripts', methods=['POST'])
@login_required
def save_script():
    data = request.get_json()
    script = Script(
        title=data['title'],
        content=data['content'],
        user_id=current_user.id
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
@login_required
def update_script(script_id):
    script = Script.query.filter_by(id=script_id, user_id=current_user.id).first_or_404()
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
@login_required
def delete_script(script_id):
    script = Script.query.filter_by(id=script_id, user_id=current_user.id).first_or_404()
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

    # Create input queue for this session
    input_queue = Queue()
    input_queues[session_id] = input_queue

    # Create string buffers to capture output
    output_buffer = StringIO()
    error_buffer = StringIO()

    try:
        # Redirect stdout and stderr to our buffers
        with redirect_stdout(output_buffer), redirect_stderr(error_buffer):
            # Create a custom input function
            def custom_input(prompt=""):
                print(prompt, end='')
                # Signal that we need input
                return input_queue.get()

            # Create a safe globals dict with our custom input
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

            # Execute the code
            exec(code, safe_globals, {})

        # Get the output
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
        # Clean up the input queue
        input_queues.pop(session_id, None)

@app.route('/input', methods=['POST'])
def handle_input():
    session_id = request.headers.get('X-Session-ID', 'default')
    input_text = request.json.get('input', '')

    if session_id in input_queues:
        input_queues[session_id].put(input_text)
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'No active session'})

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))

    if request.method == 'POST':
        user = User.query.filter_by(email=request.form.get('email')).first()
        if user and user.check_password(request.form.get('password')):
            login_user(user)
            flash('Successfully logged in!', 'success')
            return redirect(url_for('index'))
        flash('Invalid email or password', 'danger')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))

    if request.method == 'POST':
        if User.query.filter_by(email=request.form.get('email')).first():
            flash('Email already registered', 'danger')
            return redirect(url_for('register'))

        if User.query.filter_by(username=request.form.get('username')).first():
            flash('Username already taken', 'danger')
            return redirect(url_for('register'))

        user = User(
            username=request.form.get('username'),
            email=request.form.get('email')
        )
        user.set_password(request.form.get('password'))
        db.session.add(user)
        db.session.commit()
        flash('Registration successful! Please login.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('index'))

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/contact', methods=['GET', 'POST'])
def contact():
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        message = request.form.get('message')

        if not all([name, email, message]):
            flash('All fields are required!', 'danger')
        else:
            # Send message to Discord
            discord_message = f"""📬 New Contact Form Submission
From: {name}
Email: {email}
Message:
{message}"""
            send_discord_message(CONTACT_WEBHOOK, discord_message)

            flash('Thank you for your message! We will respond as soon as possible.', 'success')
            return redirect(url_for('contact'))

    return render_template('contact.html')

# Create tables
with app.app_context():
    db.create_all()
