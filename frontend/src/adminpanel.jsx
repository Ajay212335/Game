import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:5001");

export default function AdminPanel() {
  const [players, setPlayers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [round, setRound] = useState(0);
  const [activeTab, setActiveTab] = useState(1); // ✅ default Round 1 tab
  const [newQ, setNewQ] = useState({
    text: "",
    options: [],
    answerIndex: 0,
    round: 1,
    time: 15,
    imageFiles: [],
    code: "",
    answerText: "",
  });

  const navigate = useNavigate();

  useEffect(() => {
    fetchAll();
    socket.on("waiting_list", (list) => setPlayers(list));
    socket.on("leaderboard", (lb) => setPlayers(lb));
    socket.on("round_update", (r) => setRound(r));
    return () => {
      socket.off("waiting_list");
      socket.off("leaderboard");
      socket.off("round_update");
    };
  }, []);

  const fetchAll = async () => {
    const res = await axios.get(
      (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
        "/api/admin/questions"
    );
    setQuestions(res.data);
  };

  const createQuestion = async () => {
    let payload = { ...newQ };

    // ✅ Set round-specific time
    if (newQ.round === 1) payload.time = 15;
    if (newQ.round === 2) payload.time = 30;
    if (newQ.round === 3) payload.time = 20;

    // Round 2 & 3: remove answers so players can submit freely
    if (newQ.round !== 1) {
      delete payload.options;
      delete payload.answerIndex;
    }

    // Round 2: handle multiple image uploads
    if (newQ.round === 2 && newQ.imageFiles?.length > 0) {
      let uploadedImages = [];
      for (let file of newQ.imageFiles) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await axios.post(
          (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
            "/api/admin/upload",
          fd,
          { headers: { "Content-Type": "multipart/form-data" } }
        );
        uploadedImages.push(up.data.filename);
      }
      payload.images = uploadedImages;
    }

    // Round 3: only store code
    if (newQ.round === 3) {
      delete payload.images;
    }

    await axios.post(
      (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
        "/api/admin/questions",
      payload
    );

    // reset form
    setNewQ({
      text: "",
      options: [],
      answerIndex: 0,
      round: 1,
      time: 15,
      imageFiles: [],
      code: "",
      answerText: "",
    });
    fetchAll();
  };

  const startRound = async (r) => {
    await axios.post(
      (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
        "/api/admin/start_round",
      { round: r }
    );
  };

  const nextQ = async () =>
    axios.post(
      (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
        "/api/admin/next_question"
    );
  const pause = async () =>
    axios.post(
      (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
        "/api/admin/pause"
    );
  const end = async () =>
    axios.post(
      (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
        "/api/admin/end_round"
    );

  return (
    <div className="container mt-4">
      <h3 className="mb-3 text-center">Admin Panel</h3>

      {/* ✅ Large responsive round control buttons */}
      <div className="d-grid gap-2 mb-3">
        <button className="btn btn-success btn-lg" onClick={() => startRound(1)}>
          ▶️ Start Round 1
        </button>
        <button className="btn btn-success btn-lg" onClick={() => startRound(2)}>
          ▶️ Start Round 2
        </button>
        <button className="btn btn-success btn-lg" onClick={() => startRound(3)}>
          ▶️ Start Round 3
        </button>
        <button className="btn btn-secondary btn-lg" onClick={nextQ}>
          ⏭️ Next Question
        </button>
        <button className="btn btn-warning btn-lg" onClick={pause}>
          ⏸️ Pause
        </button>
        <button className="btn btn-danger btn-lg" onClick={end}>
          ⏹️ End Round
        </button>
      </div>

      {/* Create Question */}
      <div className="card p-3 mb-3">
        <h5>Create Question</h5>
        <div className="mb-2">
          <input
            className="form-control"
            placeholder="Text / Instruction"
            value={newQ.text}
            onChange={(e) => setNewQ({ ...newQ, text: e.target.value })}
          />
        </div>

        {newQ.round === 1 && (
          <>
            <div className="mb-2">
              <input
                className="form-control"
                placeholder="Comma separated options"
                value={newQ.options.join(",")}
                onChange={(e) =>
                  setNewQ({ ...newQ, options: e.target.value.split(",") })
                }
              />
            </div>
            <div className="mb-2">
              <input
                className="form-control"
                placeholder="Answer index (0-based)"
                value={newQ.answerIndex}
                onChange={(e) =>
                  setNewQ({ ...newQ, answerIndex: Number(e.target.value) })
                }
              />
            </div>
          </>
        )}

        {newQ.round === 2 && (
          <>
            <div className="mb-2">
              <label className="form-label">Upload Images (Optional)</label>
              {newQ.imageFiles.map((file, idx) => (
                <div key={idx} className="d-flex align-items-center mb-2">
                  <input
                    type="file"
                    className="form-control"
                    onChange={(e) => {
                      const filesCopy = [...newQ.imageFiles];
                      filesCopy[idx] = e.target.files[0];
                      setNewQ({ ...newQ, imageFiles: filesCopy });
                    }}
                  />
                  <button
                    className="btn btn-danger ms-2"
                    onClick={() => {
                      const filesCopy = newQ.imageFiles.filter(
                        (_, i) => i !== idx
                      );
                      setNewQ({ ...newQ, imageFiles: filesCopy });
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="btn btn-outline-primary"
                onClick={() =>
                  setNewQ({ ...newQ, imageFiles: [...newQ.imageFiles, null] })
                }
              >
                + Add Image
              </button>
            </div>

            <div className="mb-2">
              <label className="form-label">Correct Answer</label>
              <input
                type="text"
                className="form-control"
                placeholder="Type the correct answer"
                value={newQ.answerText || ""}
                onChange={(e) =>
                  setNewQ({
                    ...newQ,
                    answerText: e.target.value.toUpperCase().replace(/\s+/g, ""),
                  })
                }
              />
            </div>
          </>
        )}

        {newQ.round === 3 && (
          <>
            <div className="mb-2">
              <label className="form-label">Buggy Code</label>
              <textarea
                className="form-control"
                rows="5"
                placeholder="Paste buggy code here..."
                value={newQ.code || ""}
                onChange={(e) => setNewQ({ ...newQ, code: e.target.value })}
              />
            </div>
            <div className="mb-2">
              <label className="form-label">Correct Answer / Output</label>
              <input
                type="text"
                className="form-control"
                placeholder="Expected Answer"
                value={newQ.answerText || ""}
                onChange={(e) =>
                  setNewQ({
                    ...newQ,
                    answerText: e.target.value.toUpperCase().replace(/\s+/g, ""),
                  })
                }
              />
            </div>
          </>
        )}

        <div className="mb-2">
          <select
            className="form-select"
            value={newQ.round}
            onChange={(e) =>
              setNewQ({ ...newQ, round: Number(e.target.value) })
            }
          >
            <option value={1}>Round 1 (MCQ)</option>
            <option value={2}>Round 2 (Image)</option>
            <option value={3}>Round 3 (Debug)</option>
          </select>
        </div>
        <div>
          <button className="btn btn-primary" onClick={createQuestion}>
            Save Question
          </button>
        </div>
      </div>

      {/* ✅ Tabbed Questions View */}
      <h5 className="mb-3">Existing Questions</h5>
      <div className="nav nav-pills mb-3">
        {[1, 2, 3].map((r) => (
          <button
            key={r}
            className={`nav-link ${activeTab === r ? "active" : ""}`}
            onClick={() => setActiveTab(r)}
          >
            Round {r}
          </button>
        ))}
      </div>

      <ul className="list-group mb-3">
        {questions
          .filter((q) => q.round === activeTab)
          .map((q) => (
            <li key={q._id} className="list-group-item">
              {q.text} (Round {q.round}, {q.time}s)
              {q.images?.length > 0 && (
                <div style={{ marginTop: "5px" }}>
                  {q.images.map((img, i) => (
                    <img
                      key={i}
                      src={
                        (import.meta.env.VITE_BACKEND_URL ||
                          "http://localhost:5001") +
                        "/uploads/" +
                        img
                      }
                      alt={`q-${i}`}
                      style={{ maxWidth: "150px", marginRight: "5px" }}
                    />
                  ))}
                </div>
              )}
              {q.code && (
                <pre
                  style={{
                    background: "#f8f9fa",
                    padding: "5px",
                    marginTop: "5px",
                  }}
                >
                  {q.code}
                </pre>
              )}
            </li>
          ))}
      </ul>

      <button
        className="btn btn-danger w-100"
        onClick={async () => {
          if (
            window.confirm("Are you sure? This will delete all player data!")
          ) {
            await axios.post(
              (import.meta.env.VITE_BACKEND_URL || "http://localhost:5001") +
                "/api/admin/clear_players"
            );
            alert("All player data cleared!");
            setPlayers([]);
            socket.emit("get_leaderboard");
            socket.emit("get_waiting");
          }
        }}
      >
        🗑️ Clear All Players Data
      </button>
    </div>
  );
}
