import React, { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SocketContext, UserContext } from './app.jsx'
import axios from 'axios'
import logo from '../assets/logo.png'

export default function Login() {
  const socket = useContext(SocketContext)
  const { setUser } = useContext(UserContext)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')        // For popup message
  const [showMessage, setShowMessage] = useState(false)
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    if (!name) return showPopup('Enter name')

    try {
      const res = await axios.post(
        (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001') + '/api/player/register',
        { name }
      )
      const player = res.data
      setUser(player)
      socket.emit('join_waiting', player)
      navigate('/waiting')
    } catch (err) {
      console.error(err)
      if (err.response && err.response.data?.error === 'Name already taken') {
        showPopup('This name is already used. Please choose another one.')
      } else {
        showPopup('Failed to register. Try again.')
      }
    }
  }

  const showPopup = (msg) => {
    setMessage(msg)
    setShowMessage(true)
    setTimeout(() => setShowMessage(false), 3000)   // Hide after 3s
  }

  return (
    <div
      className="vh-100 d-flex flex-column"
      style={{ background: 'linear-gradient(to right, #FFFFFF 50%, #E8D6CB 50%)' }}
    >
      {/* Header */}
      <div className="p-3">
        <img src={logo} alt="Logo" className="img-fluid" style={{ width: '200px' }} />
      </div>

      {/* Center Section */}
      <div className="flex-grow-1 d-flex justify-content-center align-items-center">
        <div
          className="card shadow p-4 text-center"
          style={{
            background: 'linear-gradient(to right, #E8D6CB 50%, #FFFFFF 50%)',
            borderRadius: '12px',
            minWidth: '450px',
            marginTop: '-100px',
          }}
        >
          <h4 className="fw-bold mt-4 mb-4">Player Name</h4>
          <form onSubmit={submit}>
            <div className="mb-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter the Name :"
                className="form-control rounded-pill"
                style={{ color: '#8e7464ff', padding: '10px 20px', fontSize: '16px', fontWeight: 'bold' }}
              />
            </div>
            <button type="submit" className="btn btn-dark w-100 rounded-pill mb-4">
              Enter
            </button>
          </form>
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

      {/* Popup message */}
      {showMessage && (
        <div
          className="position-fixed top-20 start-50 translate-middle-x alert alert-warning shadow"
          style={{ zIndex: 9999, minWidth: '250px', textAlign: 'center' }}
        >
          {message}
        </div>
      )}

      <style>
        {`
          @media (min-width: 1492px) { img[alt="Logo"] { width: 400px !important; } }
          @media (min-width: 592px) { img[alt="Logo"] { width: 300px !important; } }
        `}
      </style>
    </div>
  )
}
