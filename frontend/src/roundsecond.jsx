import React, { useContext, useEffect, useRef, useState } from "react";
import { SocketContext, UserContext } from "./app.jsx";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import logo from "../assets/logo.png";

export default function RoundSecond() {
  const socket = useContext(SocketContext);
  const { user } = useContext(UserContext);
  const navigate = useNavigate();

  const [question, setQuestion] = useState(null);
  const questionRef = useRef(null);
  const [timer, setTimer] = useState(0);
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState(100);
  const [answer, setAnswer] = useState("");
  const [eliminated, setEliminated] = useState(false);
  const [hasBet, setHasBet] = useState(false);

  // result states
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [correctAnswerText, setCorrectAnswerText] = useState(null);

  // track last submitted answer & question
  const [lastSubmittedAnswer, setLastSubmittedAnswer] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedForQuestionId, setSubmittedForQuestionId] = useState(null);

  // store server result until timer ends
  const [serverCorrectText, setServerCorrectText] = useState(null);

  // keep ref updated
  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  // normalization helper
  const normalizeForCompare = (s) => {
    if (!s) return "";
    return String(s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^0-9A-Za-z\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  };

  const getCorrectTextFrom = (res = {}, q = {}) => {
    const fields = [
      "correctAnswer",
      "correct_answer",
      "answerText",
      "answer_text",
      "answer",
      "solution",
      "correctAnswerText",
      "correctAns",
      "answerKey",
      "code",
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
    return null;
  };

  // ---------- socket lifecycle ----------
  useEffect(() => {
    if (!user?._id) return;

    socket.emit("join_waiting", { playerId: user._id, name: user.name });

    socket.on("round_question", (q) => {
      setQuestion(q);
      setTimer(q?.time ?? 30);
      setShowResult(false);
      setIsCorrect(null);
      setCorrectAnswerText(null);
      setLastSubmittedAnswer(null);
      setSubmitting(false);
      setSubmittedForQuestionId(null);
      setServerCorrectText(null);
    });

    socket.on("points_update", (p) => {
      if (p._id === user._id) setBalance(p.points);
    });

    socket.emit("get_player_state", user);
    socket.on("player_state", (ps) => {
      if (ps && ps.points !== undefined) setBalance(ps.points ?? 0);
    });

    socket.on("answer_result", (res) => {
      if (res.playerId && String(res.playerId) !== String(user._id)) return;

      const correctText = getCorrectTextFrom(res, questionRef.current);
      setServerCorrectText(correctText);
    });

    socket.on("round_ended", (data) => {
      if (data.round === 2) navigate("/waiting");
    });

    return () => {
      socket.off("round_question");
      socket.off("points_update");
      socket.off("player_state");
      socket.off("answer_result");
      socket.off("round_ended");
    };
  }, [socket, user, navigate]);

  // ---------- post answer ----------
  const postAnswerToServer = async (rawAnswer, qid) => {
    if (!user?._id || !qid) return null;
    const trimmed = String(rawAnswer || "").trim();

    setSubmittedForQuestionId(qid);
    setSubmitting(true);
    setLastSubmittedAnswer(trimmed);

    try {
      const resp = await axios.post(
        (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") + "/api/player/answer",
        { playerId: user._id, questionId: qid, answerText: trimmed },
        { timeout: 7000 }
      );

      const player = resp?.data?.player ?? null;
      if (player && player.points !== undefined) setBalance(player.points);

      const correctText =
        resp?.data?.correctAnswer ||
        getCorrectTextFrom(resp?.data ?? {}, questionRef.current ?? {});

      // store correct answer for later
      setServerCorrectText(correctText);

      return resp.data;
    } catch (err) {
      if (err?.response?.status === 403) setEliminated(true);
      else {
        const localCorrectText = getCorrectTextFrom({}, questionRef.current ?? {});
        setServerCorrectText(localCorrectText);
      }
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- timer effect ----------
  useEffect(() => {
    if (timer <= 0 && question && submittedForQuestionId === question._id && !showResult) {
      // compute correctness using normalized comparison
      const correctText = serverCorrectText ?? getCorrectTextFrom({}, question);
      const normalizedAnswer = normalizeForCompare(lastSubmittedAnswer);
      const normalizedCorrect = normalizeForCompare(correctText);
      const correct = normalizedAnswer === normalizedCorrect;

      setIsCorrect(correct);
      setCorrectAnswerText(correctText);
      setShowResult(true);

      setTimeout(() => {
        setShowResult(false);
        setIsCorrect(null);
        setCorrectAnswerText(null);
      }, 3000);
      return;
    }

    if (timer > 0) {
      const id = setInterval(() => setTimer((t) => t - 1), 1000);
      return () => clearInterval(id);
    }
  }, [timer, question, submittedForQuestionId, lastSubmittedAnswer, serverCorrectText, showResult]);

  // ---------- bet ----------
  const placeBet = async () => {
    if (eliminated || !user?._id) return;
    if (bet < 100) return alert("Minimum bet is 100");
    if (bet > balance) return alert("Bet exceeds your balance");

    try {
      await axios.post(
        (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") + "/api/player/bet",
        { playerId: user._id, bet }
      );
      setHasBet(true);
    } catch (err) {
      if (err.response?.status === 403) setEliminated(true);
      else alert("Bet failed");
    }
  };

  // ---------- submit ----------
  const submit = async () => {
    if (eliminated || !user?._id) return;
    if (!answer.trim()) return alert("Answer cannot be empty");
    if (!question?._id) return alert("No active question");
    if (submittedForQuestionId === question._id) return;

    await postAnswerToServer(answer, question._id);
    setAnswer("");
  };

  // ---------- UI ----------
  return (
    <div className="container-fluid p-0 mb-4">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center p-3 bg-white">
        <div className="d-flex align-items-center">
          <img src={logo} alt="Logo" style={{ width: "180px", marginRight: "10px" }} />
        </div>
        <div className="fw-bold d-flex align-items-center gap-3">
          {(!question || showResult) && (
            <span style={{ fontSize: "2.7rem", marginRight: "30px" }}>{balance}</span>
          )}
          {question && !showResult && (
            <div
              className="rounded-circle border border-3 border-dark d-flex justify-content-center align-items-center"
              style={{ width: "70px", height: "70px", fontSize: "1.5rem", fontWeight: "bold" }}
            >
              {timer}
            </div>
          )}
        </div>
      </div>

      {showResult ? (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center text-white text-center"
          style={{ backgroundColor: isCorrect ? "#00C851" : "#FF3131", zIndex: 2000 }}
        >
          <h1 className="display-1 fw-bold mb-4">
            {isCorrect ? "Correct" : "Wrong"}
          </h1>
          <span style={{ fontSize: "2.7rem", marginRight: "30px",fontWeight:"400" }}>{balance}</span>
          <div>
            <div className="mb-3">
              <strong>Correct answer:{correctAnswerText ?? "Not available"}</strong>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="mt-5 rounded-4 p-3 d-flex justify-content-center align-items-center"
          style={{ backgroundColor: "#EAD8CC" }}
        >
          {!user?._id ? (
            <p>Loading player data...</p>
          ) : eliminated ? (
            <p className="text-danger fw-bold">
              🚫 You are not shortlisted. Please wait for the next game.
            </p>
          ) : !hasBet ? (
            <div
              className="bg-white rounded-4 p-5 text-center mb-4"
              style={{ minWidth: "450px", marginTop: "100px" }}
            >
              <h2 className="fw-bold mb-4">Bet for Round 2</h2>
              <input
                type="number"
                className="form-control form-control-lg rounded-pill mb-3 text-center"
                placeholder="Start From 100"
                style={{
                  border: "2px solid black",
                  fontSize: "1.2rem",
                  height: "50px",
                  minWidth: "300px",
                }}
                value={bet}
                onChange={(e) => setBet(Number(e.target.value))}
                disabled={eliminated}
              />
              <button
                className="btn btn-dark w-100 rounded-pill fw-bold"
                style={{ fontSize: "1.3rem", height: "55px", minWidth: "300px" }}
                onClick={placeBet}
                disabled={eliminated}
              >
                Place Bet
              </button>
            </div>
          ) : question ? (
            <div
                style={{
                  backgroundColor: "#EAD8CC",
                  padding: "40px 20px",
                  borderRadius: "12px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "20px", // space between input and button
                }}
              >
                {/* Images Section */}
                <div className="d-flex gap-5 mb-4 flex-wrap justify-content-center">
                  {question.images?.map((img, i) => (
                    <div
                      key={i}
                      style={{
                        width: 200,
                        height: 200,
                        background: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <img
                        src={
                          (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
                          "/uploads/" +
                          img
                        }
                        alt={`img-${i}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                  ))}
                </div>

                {/* Input & Submit */}
                <input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value.toUpperCase())} // convert to uppercase
                  placeholder="Enter the name:"
                  disabled={eliminated || submitting}
                  className="form-control rounded-pill text-center"
                  style={{
                    width: "400px",
                    padding: "12px 20px",
                    fontSize: "16px",
                    fontWeight: "bold",
                  }}
                />

                <button
                  onClick={submit}
                  disabled={eliminated || submitting}
                  className="btn btn-dark rounded-pill fw-bold"
                  style={{
                    width: "400px",
                    padding: "12px 0",
                    fontSize: "16px",
                  }}
                >
                  {submitting ? "Submitting..." : "Submit"}
                </button>
              </div>

          ) : (
            <p>Waiting for Other players to Bet</p>
          )}
        </div>
      )}

      <style>
        {`
        body {
          background-color: #E8D6CB;
        }
        @media (min-width: 1592px) {
          img[alt="Logo"] {
            width: 400px !important;
          }
        }
        @media (min-width: 592px) {
          img[alt="Logo"] {
            width: 200px !important;
          }
        }
        `}
      </style>
    </div>
  );
}
