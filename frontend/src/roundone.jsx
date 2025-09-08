import React, { useContext, useEffect, useState, useRef } from "react";
import { SocketContext, UserContext } from "./app.jsx";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";

export default function RoundOne() {
  const socket = useContext(SocketContext);
  const { user } = useContext(UserContext);

  const [question, setQuestion] = useState(null);
  const [timer, setTimer] = useState(0);
  const [balance, setBalance] = useState(0);
  const [bet, setBet] = useState(100);
  const [hasBet, setHasBet] = useState(false);

  const [selectedIndex, setSelectedIndex] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [correctIndex, setCorrectIndex] = useState(null);

  const backendCorrectRef = useRef(null);
  const timerRef = useRef(null);
  const navigate = useNavigate();

  // ------------------ SOCKET LISTENERS ------------------
  useEffect(() => {
    // New question
    socket.on("round_question", (q) => {
      setQuestion(q);
      setTimer(q?.time || 15);
      setSelectedIndex(null);
      setShowResult(false);
      setCorrectIndex(null);

      backendCorrectRef.current = q.answerIndex ?? 0;

      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            // Reveal result when timer ends
            setSelectedIndex((prevSelected) =>
              prevSelected === null ? -1 : prevSelected
            );
            setCorrectIndex(backendCorrectRef.current ?? q.answerIndex ?? 0);
            setShowResult(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    });

    // Update points
    socket.on("points_update", (p) => {
      if (p._id === user._id) setBalance(p.points);
    });

    socket.emit("get_player_state", user);

    socket.on("player_state", (ps) => setBalance(ps.points || 0));

    socket.on("answer_result", (res) => {
      if (res.correctIndex !== undefined) backendCorrectRef.current = res.correctIndex;
      if (selectedIndex === null) setSelectedIndex(res.selectedIndex ?? -1);
    });

    // Trigger next question from admin
    socket.on("next_question", () => {
      // Reset state for next question
      setQuestion(null);
      setTimer(0);
      setSelectedIndex(null);
      setCorrectIndex(null);
      setShowResult(false);
    });

    socket.on("round_ended", () => {
      setQuestion(null);
      setTimer(0);
      setHasBet(false);
      setSelectedIndex(null);
      setShowResult(false);
      setCorrectIndex(null);
      backendCorrectRef.current = null;
      navigate("/waiting");
    });

    return () => {
      socket.off("round_question");
      socket.off("points_update");
      socket.off("player_state");
      socket.off("answer_result");
      socket.off("next_question");
      socket.off("round_ended");
    };
  }, [socket, user, navigate, selectedIndex]);

  // ------------------ PLACE BET ------------------
  const placeBet = async () => {
    if (hasBet) return alert("You already placed a bet this round!");
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

  // ------------------ ANSWER SUBMISSION ------------------
  const answer = (idx) => {
    if (selectedIndex !== null) return;
    setSelectedIndex(idx);

    axios
      .post(
        (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
          "/api/player/answer",
        { playerId: user._id, questionId: question._id, answerIndex: idx }
      )
      .catch(console.error);
  };

  // ------------------ RENDER ------------------
  return (
    <div className="vh-100 d-flex flex-column" style={{ backgroundColor: "#EAD8CC" }}>
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center p-3 bg-white">
        <div className="d-flex align-items-center">
          <img src={logo} alt="Logo" style={{ width: "180px", marginRight: "10px" }} />
        </div>
        <div className="fw-bold d-flex align-items-center gap-3">
          {(!question || showResult) && (
            <span style={{ fontSize: "2.7rem", marginRight: "30px",fontWeight:"400" }}>{balance}</span>
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

      <div className="flex-grow-1 d-flex justify-content-center align-items-center">
        <div className="px-3">
          {/* Betting */}
          {!hasBet && !question && (
            <div className="bg-white rounded-4 shadow p-5 text-center mb-4" style={{ minWidth: "450px" }}>
              <h2 className="fw-bold mb-4" style={{ fontSize: "2rem" }}>Bet for Round 1</h2>
              <input
                type="number"
                className="form-control form-control-lg rounded-pill mb-3 text-center"
                placeholder="Start From 100"
                style={{ border: "2px solid black", fontSize: "1.2rem", height: "50px" }}
                value={bet}
                onChange={(e) => setBet(Number(e.target.value))}
              />
              <button className="btn btn-dark w-100 rounded-pill fw-bold" style={{ fontSize: "1.3rem", height: "55px" }} onClick={placeBet}>
                Bet
              </button>
            </div>
          )}

          {/* Waiting */}
          {hasBet && !question && (
            <div className="rounded-4 shadow p-5 text-center mb-4">
              <h2 className="fw-bold mb-0">Waiting for other players to bet...</h2>
            </div>
          )}

          {/* Question */}
          {question && !showResult && (
            <div className="container-fluid d-flex justify-content-center align-items-center min-vw-100">
              <div className="w-100 col-md-8 col-lg-6">
                <div className="w-100 text-white fw-bold rounded-4 p-4 mb-4 fs-4 text-center" style={{ backgroundColor: "#004AAD" }}>
                  {question.text}
                </div>
                <div className="row g-3">
                  {question.options?.map((o, i) => {
                    const colors = ["#FF914D", "#FF3131", "#FFDE59", "#00BF63"];
                    let bgColor = colors[i]; let textColor = "white";

                    if (selectedIndex !== null) { 
                      if (selectedIndex === i) {
                         bgColor = "black";
                          textColor = "white"; 
                        } else {
                           bgColor = "white";  
                           textColor = "black";
                           } }
                    return (
                      <div key={i} className="col-12 col-md-6">
                        <button
                          className="w-100 fw-bold fs-5 rounded-4 p-4 border-0"
                          style={{ backgroundColor: bgColor, color: textColor, fontSize: "1.3rem", height: "100px", transition: "all 0.3s ease" }}
                          onClick={() => answer(i)}
                          disabled={selectedIndex !== null}
                        >
                          {o}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Show Result Overlay */}
          {showResult && question && (
            <div
              className="position-fixed top-0 start-0 w-100 h-100 d-flex flex-column justify-content-center align-items-center text-white text-center"
              style={{
                backgroundColor: selectedIndex === correctIndex ? "#00C851" : "#FF3131",
                zIndex: 2000,
                transition: "background-color 0.3s ease",
              }}
            >
              <h1 className="display-1 fw-bold mb-4">
                {selectedIndex === correctIndex ? "Correct" : "Wrong"}
              </h1>
              <span style={{ fontSize: "2.7rem", marginRight: "30px",fontWeight:"400" }}>{balance}</span>
              {selectedIndex !== correctIndex && correctIndex !== null && (
                <h2 className="fw-bold">
                  Correct Answer: <span className="text-warning">{question.options[correctIndex]}</span>
                </h2>
              )}
              
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
