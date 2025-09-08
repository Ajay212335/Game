import React, { useContext, useEffect, useState } from 'react'
import { SocketContext } from './app.jsx'
import logo from '../assets/logo.png'   // ✅ Import logo image

export default function LabResult() {
  const socket = useContext(SocketContext)
  const [leaders, setLeaders] = useState([])

  useEffect(() => {
    socket.on('leaderboard', data => setLeaders(data))
    socket.emit('get_leaderboard')
    return () => { socket.off('leaderboard') }
  }, [socket])

  // ✅ Sort by points (descending) and take top 3
  const topThree = [...leaders]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)

  return (
    <div
      className="vh-100 vw-100 d-flex flex-column"
      style={{ backgroundColor: '#e9d6ca' }}
    >
      {/* Header with white background */}
      <div className="p-3 bg-white shadow-sm">
        <img src={logo} alt="Logo" style={{ width: "200px" }} />
      </div>

      {/* Winners Section */}
      <div className="flex-grow-1 d-flex flex-column justify-content-start align-items-center">
        <h3 className="fw-bold my-4">IQ - Winners</h3>

        <div style={{ minWidth: '420px' }}>
          {topThree.map((p, index) => (
            <div
              key={p._id}
              className="d-flex justify-content-between align-items-center bg-white rounded-4 p-3 mb-3 fs-5 fw-bold"
            >
              <span>{index + 1}] {p.name}</span>
              <span>{p.points} Points</span>
            </div>
          ))}

          {/* If less than 3 winners, fill placeholders */}
          {topThree.length < 3 &&
            [...Array(3 - topThree.length)].map((_, i) => (
              <div
                key={`empty-${i}`}
                className="d-flex justify-content-between align-items-center bg-white rounded-4 p-3 mb-3 fs-5 fw-bold text-muted"
              >
                <span>{topThree.length + i + 1}]</span>
                <span>Points</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
