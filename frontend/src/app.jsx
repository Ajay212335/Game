import React, { createContext, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import io from 'socket.io-client'
import Login from './login.jsx'
import WaitingRoom from './waitingroom.jsx'
import RoundOne from './roundone.jsx'
import RoundSecond from './roundsecond.jsx'
import RoundThird from './roundthird.jsx'
import LabResult from './labresult.jsx'
import AdminPanel from './adminpanel.jsx'

export const SocketContext = createContext(null)
export const UserContext = createContext({})

const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001')

export default function App(){
  const [user, setUser] = useState(null)

  useEffect(()=> {
    socket.on('connect', ()=> console.log('connected', socket.id))
  },[])

  return (
    <SocketContext.Provider value={socket}>
      <UserContext.Provider value={{user, setUser}}>
        <BrowserRouter>
          <Routes>
            <Route path='/' element={<Login/>} />
            <Route path='/waiting' element={<WaitingRoom/>} />
            <Route path='/round1' element={<RoundOne/>} />
            <Route path='/round2' element={<RoundSecond/>} />
            <Route path='/round3' element={<RoundThird/>} />
            <Route path='/results' element={<LabResult/>} />
            <Route path='/naorukanadiprasheethaalumech' element={<AdminPanel/>} />
          </Routes>
        </BrowserRouter>
      </UserContext.Provider>
    </SocketContext.Provider>
  )
}
