from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
from pymongo import MongoClient
from bson.objectid import ObjectId
import os
import datetime

from dotenv import load_dotenv

# ---------- Load ENV ----------
load_dotenv()
MONGO_URI = os.getenv("MONGO_URI")

# ---------- Database ----------
client = MongoClient(MONGO_URI)
db = client["quiz_game"]
print("Connected to MongoDB ✅")
print("Collections:", db.list_collection_names())

app = Flask(__name__, static_folder='static', static_url_path='/')
CORS(app, supports_credentials=True, origins=["http://localhost:5173"])
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')


UPLOAD_DIR = os.path.join(os.getcwd(), 'backend', 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ---------- Helpers ----------
def serialize_doc(doc):
    if not doc:
        return None
    out = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime.datetime):
            out[k] = v.isoformat()
        elif isinstance(v, list):
            out[k] = [str(i) if isinstance(i, ObjectId) else i for i in v]
        else:
            out[k] = v
    if '_id' in out and not isinstance(out['_id'], str):
        out['_id'] = str(out['_id'])
    return out

def serialize_list(docs):
    return [serialize_doc(d) for d in docs]

# ---------- State ----------
state = {'round': 0, 'current_q_index': 0, 'round_questions': []}

# ---------- Admin ----------
@app.route('/api/admin/questions', methods=['GET','POST'])
def admin_questions():
    if request.method == 'GET':
        qs = list(db.questions.find({}))
        return jsonify(serialize_list(qs))
    
    data = request.json or {}
    q = {
        'text': data.get('text'),
        'options': data.get('options', []),
        'answerIndex': data.get('answerIndex'),
        'answerText': data.get('answerText', ''),
        'round': data.get('round', 1),
        'time': data.get('time', 15),
        'images': data.get('images', []),
        'code': data.get('code', '')
    }
    res = db.questions.insert_one(q)
    q['_id'] = str(res.inserted_id)
    return jsonify(q)

@app.route('/api/admin/upload', methods=['POST'])
def upload_image():
    f = request.files.get('file')
    if not f:
        return jsonify({'error': 'no file'}), 400
    safe_name = f"{int(datetime.datetime.utcnow().timestamp())}_{f.filename}"
    path = os.path.join(UPLOAD_DIR, safe_name)
    f.save(path)
    return jsonify({'filename': safe_name})

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# ---------- Player ----------
@app.route('/api/player/register', methods=['POST'])
def register_player():
    data = request.json
    name = data.get('name')

    if not name:
        return jsonify({'error': 'Name is required'}), 400

    existing = db.players.find_one({'name': name})
    if existing:
        return jsonify({'error': 'Name already taken'}), 400

    player = {
        'name': name,
        'points': 500,
        'round': 1,
        'createdAt': datetime.datetime.utcnow()
    }
    result = db.players.insert_one(player)
    player['_id'] = str(result.inserted_id)
    return jsonify(player), 200

@app.route('/api/player/bet', methods=['POST'])
def player_bet():
    data = request.json or {}
    playerId = data.get('playerId')
    bet = int(data.get('bet', 0))

    if not playerId:
        return jsonify({'error': 'playerId required'}), 400

    if not is_player_eligible(playerId):
        return jsonify({'error': 'Not eligible for this round'}), 403

    p = db.players.find_one({'_id': ObjectId(playerId)})
    if not p:
        return jsonify({'error': 'player not found'}), 404

    if bet > p.get('points', 0):
        return jsonify({'error': 'insufficient points'}), 400

    if db.round_bets.find_one({'round': state['round'], 'playerId': playerId}):
        return jsonify({'error': 'bet already placed'}), 400

    db.players.update_one({'_id': ObjectId(playerId)}, {'$inc': {'points': -bet}})
    db.round_bets.insert_one({
        'round': state['round'],
        'playerId': playerId,
        'bet': bet,
        'ts': datetime.datetime.utcnow()
    })

    p = db.players.find_one({'_id': ObjectId(playerId)})
    p_serial = serialize_doc(p)
    socketio.emit('points_update', p_serial)
    return jsonify({'ok': True, 'player': p_serial, 'bet': bet})

@app.route('/api/player/answer', methods=['POST'])
def player_answer():
    data = request.json or {}
    playerId = data.get('playerId')
    questionId = data.get('questionId')
    answerIndex = data.get('answerIndex')
    answerText = (data.get('answerText') or '').strip()

    if not playerId or not questionId:
        return jsonify({'error': 'playerId and questionId required'}), 400

    if not is_player_eligible(playerId):
        return jsonify({'error': 'Not eligible for this round'}), 403

    # Prevent duplicate answer submissions for the same question by same player
    existing_answer = db.answers.find_one({'playerId': playerId, 'questionId': questionId})
    if existing_answer:
        return jsonify({'error': 'answer already submitted for this question by player'}), 400

    q = db.questions.find_one({'_id': ObjectId(questionId)})
    if not q:
        return jsonify({'error': 'invalid questionId'}), 400

    bet_doc = db.round_bets.find_one({'round': state['round'], 'playerId': playerId})
    if not bet_doc:
        return jsonify({'error': 'no bet found for this round'}), 400

    total_questions = len(state['round_questions']) if state['round_questions'] else 1
    per_q = bet_doc['bet'] // total_questions if total_questions > 0 else 0

    reward = 0
    correct = False
    bonus = 0
    rank = None  # position among correct answerers

    # Determine correctness
    if q['round'] == 1:
        # For round 1 use option index compare (ensure type alignment)
        try:
            submitted_index = int(answerIndex) if answerIndex is not None else None
        except Exception:
            submitted_index = None
        if submitted_index is not None and submitted_index == q.get('answerIndex'):
            correct = True
    else:
        if answerText and answerText.lower() == q.get('answerText','').strip().lower():
            correct = True

    if correct:
        # Base reward:
        reward = per_q * 2

        # Order-based bonus:
        #total active players - counts all players in collection
        total_players = db.players.count_documents({})

        # how many correct answers already recorded for this question
        already_correct_count = db.answers.count_documents({'questionId': questionId, 'correct': True})
        # current player's correct position (1-based)
        rank = already_correct_count + 1

        # bonus formula: (total_players - rank + 1) * 2
        bonus = max((total_players - rank + 1), 0) * 2

        # add bonus to reward
        reward += bonus

    # update player's points
    if reward:
        db.players.update_one({'_id': ObjectId(playerId)}, {'$inc': {'points': reward}})

    # store answer record including bonus and rank
    db.answers.insert_one({
        'playerId': playerId,
        'questionId': questionId,
        'answerIndex': answerIndex if q['round'] == 1 else None,
        'answerText': answerText if q['round'] != 1 else None,
        'correct': correct,
        'earned': reward,
        'bonus': bonus,
        'rank': rank,
        'ts': datetime.datetime.utcnow()
    })

    # fetch updated player for response
    p = db.players.find_one({'_id': ObjectId(playerId)})
    p_serial = serialize_doc(p)

    # Emit points update and answer result to frontend (only to player)
    socketio.emit('points_update', p_serial)
    socketio.emit('answer_result', {
        'playerId': playerId,
        'selectedIndex': answerIndex,
        'correctIndex': q.get('answerIndex'),
        'correct': correct,
        'earned': reward,
        'bonus': bonus,
        'rank': rank
    }, room=str(playerId))

    return jsonify({'ok': True, 'earned': reward, 'bonus': bonus, 'rank': rank, 'player': p_serial})

# ---------- Game control ----------
def is_player_eligible(playerId):
    r = state['round']
    if r == 1:
        return True
    prev_round = r - 1
    return db.shortlist.find_one({'round': prev_round, 'playerId': playerId}) is not None

@app.route('/api/admin/start_round', methods=['POST'])
def start_round():
    r = int((request.json or {}).get('round', 1))
    state['round'] = r
    qs = list(db.questions.find({'round': r}))
    state['round_questions'] = qs
    state['current_q_index'] = 0

    if r == 1:
        waiting = list(db.waiting.find({}))
        for w in waiting:
            db.players.update_one({'_id': ObjectId(w['playerId'])}, {'$set': {'points': 500}})
        socketio.emit('game_started_round', {'round': 1})
    else:
        shortlisted = list(db.shortlist.find({'round': r-1}))
        for s in shortlisted:
            db.players.update_one({'_id': ObjectId(s['playerId'])}, {'$inc': {'points': 500}})
        socketio.emit('game_started_round', {'round': r})

    return jsonify({'ok': True})

@app.route('/api/admin/next_question', methods=['POST'])
def next_question():
    idx = state['current_q_index']
    if idx >= len(state['round_questions']):
        return jsonify({'ok': False, 'msg': 'no more questions'})
    q = state['round_questions'][idx]
    state['current_q_index'] += 1

    q_payload = {
        '_id': str(q['_id']),
        'text': q.get('text'),
        'options': q.get('options', []),
        'answerIndex': q.get('answerIndex'),
        'answerText': q.get('answerText', ''),
        'images': q.get('images', []),
        'code': q.get('code', ''),
        'time': q.get('time', 15)
    }

    if state['round'] == 1:
        socketio.emit('round_question', q_payload)
    else:
        shortlisted = list(db.shortlist.find({'round': state['round']-1}))
        for s in shortlisted:
            socketio.emit('round_question', q_payload, room=str(s['playerId']))

    return jsonify({'ok': True})

@app.route('/api/admin/end_round', methods=['POST'])
def end_round():
    players = list(db.players.find({}))
    players_sorted = sorted(players, key=lambda p: p.get('points', 0), reverse=True)
    players_serialized = serialize_list(players_sorted)

    db.leaderboards.insert_one({
        'round': state['round'],
        'snapshot': players_serialized,
        'ts': datetime.datetime.utcnow()
    })

    topn = max(1, len(players_serialized) // 2)
    db.shortlist.delete_many({'round': state['round']})
    for p in players_serialized[:topn]:
        db.shortlist.insert_one({
            'round': state['round'],
            'playerId': p['_id'],
            'points': p.get('points', 0)
        })

    socketio.emit('leaderboard', players_serialized)
    socketio.emit('round_ended', {'round': state['round']})

    state['round'] = 0
    state['current_q_index'] = 0
    state['round_questions'] = []
    return jsonify({'ok': True, 'shortlisted': topn})

# ---------- SocketIO ----------
@socketio.on('join_waiting')
def handle_join_waiting(data):
    pid = data.get('_id') or data.get('playerId')
    name = data.get('name', '')
    if not pid:
        return
    join_room(str(pid))
    db.waiting.update_one({'playerId': pid}, {'$set': {'playerId': pid, 'name': name}}, upsert=True)
    waiting = list(db.waiting.find({}))
    out = []
    for w in waiting:
        p = db.players.find_one({'_id': ObjectId(w['playerId'])})
        pts = p.get('points', 0) if p else 0
        out.append({'_id': w['playerId'], 'name': w['name'], 'points': pts})
    emit('waiting_list', out, broadcast=True)

@socketio.on('get_waiting')
def handle_get_waiting():
    waiting = list(db.waiting.find({}))
    out = []
    for w in waiting:
        p = db.players.find_one({'_id': ObjectId(w['playerId'])})
        pts = p.get('points', 0) if p else 0
        out.append({'_id': w['playerId'], 'name': w['name'], 'points': pts})
    emit('waiting_list', out)

@socketio.on('get_leaderboard')
def handle_get_lb():
    lb = list(db.leaderboards.find().sort([('_id', -1)]).limit(1))
    emit('leaderboard', lb[0]['snapshot'] if lb else [])

@socketio.on('get_player_state')
def handle_player_state(data):
    if not data or '_id' not in data:
        emit('player_state', {'error': 'missing player id'})
        return
    try:
        p = db.players.find_one({'_id': ObjectId(data['_id'])})
        emit('player_state', serialize_doc(p) if p else {'error': 'not found'})
    except Exception as e:
        emit('player_state', {'error': str(e)})

@app.route('/api/admin/clear_players', methods=['POST'])
def clear_players():
    collections_to_clear = ['players', 'answers', 'leaderboards', 'shortlist', 'waiting', 'round_bets']
    for col in collections_to_clear:
        db[col].delete_many({})
    return jsonify({'ok': True, 'msg': 'All player-related data cleared'})

# ---------- Run ----------
if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
