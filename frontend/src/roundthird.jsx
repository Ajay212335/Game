import React, { useContext, useEffect, useState, useRef } from "react";
import { SocketContext, UserContext } from "./app.jsx";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import logo from "../assets/logo.png";

export default function RoundThird() {
  const socket = useContext(SocketContext);
  const { user } = useContext(UserContext);
  const navigate = useNavigate();

  const [question, setQuestion] = useState(null);
  const [timer, setTimer] = useState(0);
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState(100);
  const [answer, setAnswer] = useState("");
  const [isShortlisted, setIsShortlisted] = useState(true);
  const [answered, setAnswered] = useState(false);
  const [hasBet, setHasBet] = useState(false);

  // Result states
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [serverCorrectText, setServerCorrectText] = useState(null);
  const [lastSubmittedAnswer, setLastSubmittedAnswer] = useState(null);
  const [timerRunning, setTimerRunning] = useState(false);

  const questionRef = useRef(null);
  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  // ---------------- Helpers ----------------
  const getCorrectTextFrom = (res = {}, q = {}) => {
    const fields = [
      "answerText",
      "answer_text",
      "correctAnswer",
      "correct_answer",
      "answer",
      "solution",
      "correctAnswerText",
      "correctAns",
      "answerKey",
    ];
    for (const k of fields) {
      const val = (res && res[k]) ?? (q && q[k]);
      if (typeof val === "string" && val.trim()) return val.trim();
    }
    if (res?.correctIndex !== undefined && Array.isArray(res.options)) {
      return res.options[res.correctIndex];
    }
    if (q?.correctIndex !== undefined && Array.isArray(q.options)) {
      return q.options[q.correctIndex];
    }
    return "";
  };

  // ---------------- socket lifecycle ----------------
  useEffect(() => {
    if (!user?._id) return;

    socket.on("round_question", (q) => {
      if (q) {
        setQuestion(q);
        setTimer(q?.time ?? 20);
        setAnswered(false);
        setAnswer("");
        setShowResult(false);
        setIsCorrect(null);
        setLastSubmittedAnswer(null);
        setServerCorrectText(getCorrectTextFrom({}, q));
        setTimerRunning(true);
      } else {
        setIsShortlisted(false);
      }
    });

    socket.on("points_update", (p) => {
      if (p._id === user._id) setBalance(p.points);
    });

    socket.on("answer_result", (res) => {
      if (res?.playerId && String(res.playerId) !== String(user._id)) return;
      const correctText = getCorrectTextFrom(res, questionRef.current);
      if (correctText) setServerCorrectText(correctText);
    });

    socket.emit("get_player_state", user);
    socket.on("player_state", (ps) => setBalance(ps.points || 0));

    // ✅ End round → go to results
    socket.on("round_ended", (data) => {
      if (data.round === 3) navigate("/results");
    });

    // ✅ Admin sends next question → clear result overlay
    socket.on("next_question", () => {
      setShowResult(false);
      setIsCorrect(null);
      setLastSubmittedAnswer(null);
      setServerCorrectText(null);
      setAnswered(false);
      setAnswer("");
      setTimerRunning(false);
    });

    return () => {
      socket.off("round_question");
      socket.off("points_update");
      socket.off("answer_result");
      socket.off("player_state");
      socket.off("round_ended");
      socket.off("next_question");
    };
  }, [socket, user, navigate]);

  // ---------------- timer effect ----------------
  useEffect(() => {
    if (timer <= 0) {
      setTimerRunning(false);

      if (answered && lastSubmittedAnswer !== null) {
        const correctText = serverCorrectText || getCorrectTextFrom({}, question) || "";

        // ✅ Strict match: keep case-insensitive, but preserve symbols
        const correct =
          lastSubmittedAnswer.trim().toUpperCase() === correctText.trim().toUpperCase();

        setIsCorrect(correct);
        setShowResult(true); // stays until admin moves
      }
      return;
    }

    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer, answered, lastSubmittedAnswer, serverCorrectText, question]);

  // ---------------- actions ----------------
  const placeBet = async () => {
    if (bet < 100) return alert("Minimum bet 100");
    if (bet > balance) return alert("Bet exceeds balance");
    try {
      await axios.post(
        (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
          "/api/player/bet",
        { playerId: user._id, bet }
      );
      setHasBet(true);
    } catch (err) {
      console.error(err);
      alert("Bet failed");
    }
  };

  const submit = async () => {
    if (answered || !question?._id) return;
    try {
      const trimmedAnswer = answer.trim();
      const resp = await axios.post(
        (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
          "/api/player/answer",
        { playerId: user._id, questionId: question._id, answerText: trimmedAnswer }
      );

      setAnswered(true);
      setLastSubmittedAnswer(trimmedAnswer);

      const returnedCorrect = getCorrectTextFrom(resp?.data ?? {}, question ?? {});
      if (returnedCorrect) setServerCorrectText(returnedCorrect);
      else setServerCorrectText(getCorrectTextFrom({}, question ?? {}));

      setAnswer("");
    } catch (e) {
      console.error(e);
      alert("Failed to submit answer");
    }
  };

  // ---------------- UI ----------------
  return (
    <div className="container-fluid p-0 mb-4">
      {/* header */}
      <div className="d-flex justify-content-between align-items-center p-3 bg-white">
        <div className="d-flex align-items-center">
          <img
            src={logo}
            alt="Logo"
            style={{ width: "180px", marginRight: "10px" }}
          />
        </div>
        <div className="fw-bold d-flex align-items-center gap-3">
          <span style={{ fontSize: "2.7rem", marginRight: "30px" }}>
            {balance}
          </span>
          {question && (
            <div
              className="rounded-circle border border-3 border-dark d-flex justify-content-center align-items-center"
              style={{
                width: "70px",
                height: "70px",
                fontSize: "1.5rem",
                fontWeight: "bold",
              }}
            >
              {timer}
            </div>
          )}
        </div>
      </div>

      {/* content */}
      <div
        className="container mt-4 d-flex justify-content-center align-items-center"
        style={{ minHeight: "70vh" }}
      >
        {!isShortlisted ? (
          <div className="alert alert-warning">
            🚫 You were not shortlisted for this round.
          </div>
        ) : !hasBet ? (
          <div
            className="bg-white rounded-4 p-5 text-center"
            style={{ maxWidth: "450px", width: "100%" }}
          >
            <h2 className="fw-bold mb-4">Bet for Round 3</h2>
            <input
              type="number"
              className="form-control form-control-lg rounded-pill mb-3 text-center"
              placeholder="Start From 100"
              style={{
                border: "2px solid black",
                fontSize: "1.2rem",
                height: "50px",
                maxWidth: "300px",
                margin: "0 auto",
              }}
              value={bet}
              onChange={(e) => setBet(Number(e.target.value))}
            />
            <button
              className="btn btn-dark rounded-pill fw-bold"
              style={{
                fontSize: "1.3rem",
                height: "55px",
                maxWidth: "300px",
                width: "100%",
                margin: "0 auto",
              }}
              onClick={placeBet}
            >
              Place Bet
            </button>
          </div>
        ) : (
          <div
            className="card p-3 text-center position-relative"
            style={{ maxWidth: "720px", width: "100%" }}
          >
            {question ? (
              <>
                <h4 className="fw-bold mb-4">{question.text}</h4>
                <pre
                  style={{
                    background: "#f6f6f6",
                    padding: "15px",
                    borderRadius: "12px",
                    fontSize: "1rem",
                    border: "1px solid #ddd",
                    textAlign: "left",
                  }}
                >
                  {question.code}
                </pre>

                {!showResult && (
                  <>
                    <input
                      className="form-control form-control-lg rounded-pill text-center mb-3"
                      style={{
                        fontSize: "1.1rem",
                        border: "2px solid black",
                        height: "50px",
                      }}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value.toUpperCase().replace(/\s+/g, ''))} 
                      placeholder="Describe the bug or corrected line"
                      disabled={answered || !timerRunning}
                    />
                    <button
                      className="btn btn-dark w-100 rounded-pill fw-bold"
                      style={{ fontSize: "1.2rem", height: "55px" }}
                      onClick={submit}
                      disabled={answered}
                    >
                      {answered ? "Submitted" : "Submit Answer"}
                    </button>
                  </>
                )}

                {/* Full-screen result overlay */}
                {showResult && (
                  <div
                    className="d-flex flex-column justify-content-center align-items-center text-center"
                    style={{
                      position: "fixed",
                      top: 0,
                      left: 0,
                      width: "100vw",
                      height: "100vh",
                      backgroundColor: isCorrect
                        ? "rgba(0, 200, 80, 1)"
                        : "rgba(255, 49, 49, 1)",
                      color: "#fff",
                      zIndex: 2000,
                      padding: 20,
                    }}
                  >
                    <h1 style={{ fontSize: "4rem", marginBottom: 12 }}>
                      {isCorrect ? "Correct" : "Wrong"}
                    </h1>
                    <span style={{ fontSize: "2.7rem", marginRight: "30px",fontWeight:"400" }}>{balance}</span>
                    <div style={{ maxWidth: 900, textAlign: "center" }}>
                      
                      <p style={{ marginTop: 8, fontSize: "1.1rem" }}>
                        <strong>Correct answer:</strong>{" "}
                        {serverCorrectText ?? getCorrectTextFrom({}, question)}
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p>Waiting for Other Player to bet</p>
            )}
          </div>
        )}
      </div>

      <style>
        {`
          body { background-color: #E8D6CB; }
          @media (min-width: 1592px) { img[alt="Logo"] { width: 400px !important; } }
          @media (min-width: 592px) { img[alt="Logo"] { width: 200px !important; } }
        `}
      </style>
    </div>
  );
}
