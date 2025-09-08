import React, { useContext, useEffect, useState } from 'react'
import { SocketContext, UserContext } from './app.jsx'
import { useNavigate } from 'react-router-dom'
import logo from '../assets/logo.png'   // ✅ add your logo here

export default function WaitingRoom() {
  const socket = useContext(SocketContext)
  const { user } = useContext(UserContext)
  const [players, setPlayers] = useState([])
  const [shortlist, setShortlist] = useState([])
  const [status, setStatus] = useState('waiting')
  const navigate = useNavigate()

  useEffect(() => {
    socket.emit('get_waiting')

    socket.on('waiting_list', list => setPlayers(list))

    socket.on('game_started_round', ({ round }) => {
      if (round === 1) navigate('/round1')
      if (round === 2) navigate('/round2')
      if (round === 3) navigate('/round3')
    })

    socket.on('shortlist', list => {
      setShortlist(list)
      setStatus('shortlist')
    })

    return () => {
      socket.off('waiting_list')
      socket.off('game_started_round')
      socket.off('shortlist')
    }
  }, [socket, navigate])

  const listToShow = status === 'shortlist' ? shortlist : players

  // ✅ Sort players by points (descending)
  const sortedList = [...listToShow].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))

  return (
    <div
      className="vh-100 d-flex flex-column"
      style={{ backgroundColor: '#E8D6CB' }}
    >
      {/* Header */}
      <div className="p-3" style={{ backgroundColor: '#FFFFFF' }}>
        <img src={logo} alt="Logo" style={{ width: '200px' }} />
      </div>

      {/* Center Content */}
      <div className="flex-grow-1 d-flex flex-column align-items-center mt-5 pb-3" style={{ backgroundColor: '#E8D6CB' }}>
        <h5 className="fw-bold mb-4 text-center">
          {status === 'waiting'
            ? 'Hold on, other players will be here soon'
            : '✅ Shortlisted Players'}
        </h5>
        <div className="container">
          <div className="row g-4 justify-content-center">
            {sortedList.map((p, index) => (
              <div key={p._id || p.playerId} className="col-12 col-md-6">
                <div className="d-flex justify-content-between align-items-center px-4 py-3 bg-white rounded-pill shadow-sm">
                  <span className="fw-semibold">
                    {index + 1}] {p.name || p.playerId}
                  </span>
                  <span className="fw-semibold">{p.points ?? 0} points</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center p-3">
        <p className="fw-semibold mb-0" style={{ fontSize: '14px' }}>
          Want a smarter brain?
          <br />
          Play this game to increase your IQ
        </p>
      </div>
    </div>
  )
}
