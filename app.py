from flask import Flask, request, jsonify, send_from_directory
import sqlite3
import pandas as pd
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

DB_NAME = 'vocabulary.db'

def init_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS words
                 (id INTEGER PRIMARY KEY, en TEXT, zh TEXT, is_root BOOLEAN)''')
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY, username TEXT UNIQUE)''')
    c.execute('''CREATE TABLE IF NOT EXISTS error_bank
                 (user_id INTEGER, word_id INTEGER, error_count INTEGER,
                  FOREIGN KEY(user_id) REFERENCES users(id),
                  FOREIGN KEY(word_id) REFERENCES words(id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS test_records
                 (id INTEGER PRIMARY KEY, user_id INTEGER, score INTEGER, total_questions INTEGER, 
                  test_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY(user_id) REFERENCES users(id))''')
    conn.commit()
    conn.close()

init_db()

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/static/<path:path>')
def send_static(path):
    return send_from_directory('static', path)

@app.route('/import_words', methods=['POST'])
def import_words():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file:
        df = pd.read_excel(file)
        conn = sqlite3.connect(DB_NAME)
        df.to_sql('words', conn, if_exists='replace', index=False)
        conn.close()
        return jsonify({'message': 'Words imported successfully'}), 200

@app.route('/words', methods=['GET'])
def get_words():
    conn = sqlite3.connect(DB_NAME)
    df = pd.read_sql_query("SELECT * FROM words", conn)
    conn.close()
    return jsonify(df.to_dict('records'))

@app.route('/users', methods=['POST'])
def create_user():
    data = request.json
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    try:
        c.execute("INSERT INTO users (username) VALUES (?)", (data['username'],))
        conn.commit()
        user_id = c.lastrowid
        return jsonify({'id': user_id, 'username': data['username']}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Username already exists'}), 400
    finally:
        conn.close()

@app.route('/error_bank/<int:user_id>', methods=['GET', 'POST'])
def error_bank(user_id):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    if request.method == 'GET':
        c.execute('''SELECT w.*, e.error_count FROM words w
                     JOIN error_bank e ON w.id = e.word_id
                     WHERE e.user_id = ?''', (user_id,))
        rows = c.fetchall()
        conn.close()
        return jsonify([{'id': r[0], 'en': r[1], 'zh': r[2], 'is_root': r[3], 'error_count': r[4]} for r in rows])
    elif request.method == 'POST':
        data = request.json
        c.execute('''INSERT OR REPLACE INTO error_bank (user_id, word_id, error_count)
                     VALUES (?, ?, COALESCE((SELECT error_count FROM error_bank
                     WHERE user_id = ? AND word_id = ?), 0) + 1)''',
                  (user_id, data['word_id'], user_id, data['word_id']))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Error bank updated'}), 200

@app.route('/test_records', methods=['POST'])
def save_test_record():
    data = request.json
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('''INSERT INTO test_records (user_id, score, total_questions)
                 VALUES (?, ?, ?)''', (data['user_id'], data['score'], data['total_questions']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Test record saved'}), 200

if __name__ == '__main__':
    app.run(debug=True)