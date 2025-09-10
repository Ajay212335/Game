
import eventlet
eventlet.monkey_patch()   # MUST come before any other imports

import base64
import random
import os
import datetime

from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
from pymongo import MongoClient
from bson.objectid import ObjectId
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

# Allow frontend - include localhost for dev convenience
CORS(
    app,
    resources={r"/api/*": {"origins": ["https://guyura-123790.web.app", "http://localhost:5173", "http://localhost:3000"]}},
    supports_credentials=True,
    methods=["GET", "POST", "OPTIONS"]
)

socketio = SocketIO(
    app,
    cors_allowed_origins=["https://guyura-123790.web.app", "http://localhost:5173", "http://localhost:3000"],
    async_mode="eventlet"
)

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

def create_player_round_order(playerId, round_no):
    """
    Create or ensure a shuffled question order for a player for the given round.
    Called when player places a bet (so shuffle happens after bet, as requested).
    """
    pr = db.player_rounds.find_one({'playerId': playerId, 'round': round_no})
    if pr:
        return pr

    questions = list(db.questions.find({'round': round_no}, {'_id': 1}))
    q_ids = [str(q['_id']) for q in questions]
    random.shuffle(q_ids)

    doc = {
        'playerId': playerId,
        'round': round_no,
        'questionOrder': q_ids,
        'currentIndex': 0,
        'createdAt': datetime.datetime.utcnow()
    }
    db.player_rounds.insert_one(doc)
    return db.player_rounds.find_one({'playerId': playerId, 'round': round_no})

def pop_next_question_for_player(playerId, round_no):
    """
    Return next question document for player, increment pointer.
    If finished, returns None and does not increment beyond length.
    """
    pr = db.player_rounds.find_one({'playerId': playerId, 'round': round_no})
    if not pr:
        return None

    idx = pr.get('currentIndex', 0)
    order = pr.get('questionOrder', [])
    if idx >= len(order):
        return None

    q_id = order[idx]
    # increment index
    db.player_rounds.update_one({'playerId': playerId, 'round': round_no}, {'$inc': {'currentIndex': 1}})
    q = db.questions.find_one({'_id': ObjectId(q_id)})
    return q

# ---------- State ----------
state = {'round': 0, 'current_q_index': 0, 'round_questions': []}


@app.route('/api/questions/round/<int:round_no>', methods=['GET'])
def get_questions_by_round(round_no):
    qs = list(db.questions.find({'round': round_no}))
    if not qs:
        return jsonify({'error': f'No questions found for round {round_no}'}), 404
    return jsonify(serialize_list(qs))

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
        'images': data.get('images', []),   # list of base64 strings
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
    
    # convert to base64
    file_bytes = f.read()
    encoded = base64.b64encode(file_bytes).decode('utf-8')

    # optional: store in its own collection
    img_doc = {
        'filename': f.filename,
        'contentType': f.mimetype,
        'data': encoded,
        'createdAt': datetime.datetime.utcnow()
    }
    res = db.images.insert_one(img_doc)

    return jsonify({
        'imageId': str(res.inserted_id),
        'data': encoded,
        'contentType': f.mimetype
    })

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

# --- Store Round 3 codes ---
@app.route('/api/player/enter_code', methods=['POST'])
def player_enter_code():
    """
    Player submits a 5-digit code (digits 0-9). Each digit maps to a question index
    using the rule digit -> index+1 (so digit 1 -> 2nd question, 5 -> 6th, etc).
    Store selected question IDs and currentIndex for the player in round3_codes.
    """
    data = request.json or {}
    playerId = data.get('playerId')
    code = str(data.get('code', '')).strip()

    if not playerId or not code or len(code) != 5 or not code.isdigit():
        return jsonify({'error': 'Invalid code, must be 5 digits'}), 400

    # Fetch all round 3 questions ordered consistently (use insertion order or _id sort)
    # To be deterministic, sort by _id string
    questions = list(db.questions.find({'round': 3}).sort('_id', 1))
    if not questions:
        return jsonify({'error': 'No round 3 questions available'}), 400

    if len(questions) < 10:
        # optional: you required 10 questions for mapping; warn if fewer
        # still proceed but mapping may refer to out-of-range indices.
        pass

    selected_q_ids = []
    # mapping: digit d -> question index d + 1 (0-based -> +1)
    for digit in code:
        idx = int(digit)  # 0..9
        q_index = idx + 1  # as per your mapping request
        # ensure index is within bounds (0-based list length)
        if 0 <= q_index < len(questions):
            selected_q_ids.append(str(questions[q_index]['_id']))
        else:
            # If out of bounds, skip that digit (alternative behaviour: wrap or map)
            # We'll skip invalid mapping so selected_q_ids may be <5
            continue

    if len(selected_q_ids) == 0:
        return jsonify({'error': 'Code did not map to valid questions'}), 400

    # Store in round3_codes (with currentIndex)
    rec = {
        'playerId': playerId,
        'code': code,
        'selectedQuestions': selected_q_ids,
        'currentIndex': 0,
        'used': False,
        'createdAt': datetime.datetime.utcnow()
    }
    db.round3_codes.update_one({'playerId': playerId}, {'$set': rec}, upsert=True)

    return jsonify({'ok': True, 'selectedQuestions': selected_q_ids})

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

    # If round 3, require that player entered a code
    if state['round'] == 3:
        code_doc = db.round3_codes.find_one({'playerId': playerId})
        if not code_doc:
            return jsonify({'error': 'Must enter round-3 code before betting'}, 400)

    # prevent double bet for the *same* round
    if db.round_bets.find_one({'round': state['round'], 'playerId': playerId}):
        return jsonify({'error': 'bet already placed'}), 400

    # deduct immediately
    db.players.update_one({'_id': ObjectId(playerId)}, {'$inc': {'points': -bet}})
    db.round_bets.insert_one({
        'round': state['round'],
        'playerId': playerId,
        'bet': bet,
        'ts': datetime.datetime.utcnow()
    })

    # Create a shuffled order for this player AFTER bet (as requested) - but only for non-3 rounds
    if state['round'] and state['round'] > 0 and state['round'] != 3:
        create_player_round_order(playerId, state['round'])

    p = db.players.find_one({'_id': ObjectId(playerId)})
    p_serial = serialize_doc(p)
    socketio.emit('points_update', p_serial)
    return jsonify({'ok': True, 'player': p_serial, 'bet': bet})

@app.route('/api/player/next_question', methods=['POST'])
def api_player_next_question():
    """
    Unified endpoint for fetching the next question.
    - Round 1 -> shuffled per player
    - Round 2 -> shuffled per player
    - Round 3 -> code-based mapping
    """
    data = request.json or {}
    playerId = data.get('playerId')
    round_no = int(data.get('round', state['round']))

    if not playerId:
        return jsonify({'error': 'playerId required'}), 400

    # ---------- ROUND 3 (code-selected questions) ----------
    if round_no == 3:
        code_doc = db.round3_codes.find_one({'playerId': playerId})
        if not code_doc:
            return jsonify({'error': 'No code set for this player'}), 400

        selected = code_doc.get('selectedQuestions', [])
        idx = code_doc.get('currentIndex', 0)

        if idx >= len(selected):
            return jsonify({'done': True, 'message': 'All code-selected questions completed'})

        qid = selected[idx]
        q = db.questions.find_one({'_id': ObjectId(qid)})
        if not q:
            # increment to avoid infinite loop
            db.round3_codes.update_one({'playerId': playerId}, {'$inc': {'currentIndex': 1}})
            return jsonify({'error': 'Question not found for selected id'}), 404

        # increment for next fetch
        db.round3_codes.update_one({'playerId': playerId}, {'$inc': {'currentIndex': 1}})
        return jsonify({'question': serialize_doc(q)})

    # ---------- ROUND 1 & 2 (shuffle per player) ----------
    pr = db.player_rounds.find_one({'playerId': playerId, 'round': round_no})

    if not pr:
        # Create player round order if missing
        questions = list(db.questions.find({'round': round_no}))
        random.shuffle(questions)  # shuffle for each player
        question_ids = [str(q['_id']) for q in questions]

        pr = {
            'playerId': playerId,
            'round': round_no,
            'order': question_ids,
            'currentIndex': 0
        }
        db.player_rounds.insert_one(pr)
        pr = db.player_rounds.find_one({'playerId': playerId, 'round': round_no})

    order = pr['order']
    idx = pr['currentIndex']

    if idx >= len(order):
        return jsonify({'done': True, 'message': f'All round {round_no} questions completed'})

    qid = order[idx]
    q = db.questions.find_one({'_id': ObjectId(qid)})
    if not q:
        db.player_rounds.update_one({'_id': pr['_id']}, {'$inc': {'currentIndex': 1}})
        return jsonify({'error': 'Question not found'}), 404

    # increment for next fetch
    db.player_rounds.update_one({'_id': pr['_id']}, {'$inc': {'currentIndex': 1}})

    return jsonify({'question': serialize_doc(q)})


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

    existing_answer = db.answers.find_one({'playerId': playerId, 'questionId': questionId})
    if existing_answer:
        return jsonify({'error': 'answer already submitted'}), 400

    q = db.questions.find_one({'_id': ObjectId(questionId)})
    if not q:
        return jsonify({'error': 'invalid questionId'}), 400

    bet_doc = db.round_bets.find_one({'round': state['round'], 'playerId': playerId})
    if not bet_doc:
        return jsonify({'error': 'no bet found'}), 400

    total_questions = len(state['round_questions']) if state['round_questions'] else 1
    per_q = bet_doc['bet'] // total_questions if total_questions > 0 else 0

    reward, correct, bonus, rank = 0, False, 0, None

    if q.get('round', 1) == 1:
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
        reward = per_q * 2
        total_players = db.players.count_documents({})
        already_correct_count = db.answers.count_documents({'questionId': questionId, 'correct': True})
        rank = already_correct_count + 1
        bonus = max((total_players - rank + 1), 0) * 2
        reward += bonus

    if reward:
        db.players.update_one({'_id': ObjectId(playerId)}, {'$inc': {'points': reward}})

    db.answers.insert_one({
        'playerId': playerId,
        'questionId': questionId,
        'answerIndex': answerIndex if q.get('round',1) == 1 else None,
        'answerText': answerText if q.get('round',1) != 1 else None,
        'correct': correct,
        'earned': reward,
        'bonus': bonus,
        'rank': rank,
        'ts': datetime.datetime.utcnow()
    })

    p = db.players.find_one({'_id': ObjectId(playerId)})
    p_serial = serialize_doc(p)

    # notify this player of result
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

    # reset
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
    collections_to_clear = ['players', 'answers', 'leaderboards', 'shortlist', 'waiting', 'round_bets', 'player_rounds', 'round3_codes']
    for col in collections_to_clear:
        db[col].delete_many({})
    return jsonify({'ok': True, 'msg': 'All player-related data cleared'})

# ---------- Run ----------
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 5001)), debug=True)
