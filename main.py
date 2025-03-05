from flask import Flask, request, jsonify, render_template
import subprocess
import os

app = Flask(__name__)

@app.route('/')
def index():
    return render_template("index.html")

@app.route('/run', methods=['POST'])
def run_code():
    code = request.json.get("code", "")
    
    if not code:
        return jsonify({"error": "Brak kodu do wykonania."})
    
    try:
        result = subprocess.run(["python3", "-c", code], capture_output=True, text=True, timeout=5)
        output = result.stdout + result.stderr
    except Exception as e:
        output = str(e)
    
    return jsonify({"output": output})

if __name__ == "__main__":
    app.run(debug=True)
