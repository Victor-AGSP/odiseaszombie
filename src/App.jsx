import React, { useState, useEffect } from 'react'
import './App.css'
import MainMenu from './MainMenu.jsx'
import GameWindow from './components/GameWindow.jsx'

export default function App() {
  const [view, setView] = useState('menu') // 'menu' | 'game'

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && view === 'game') setView('menu')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  function handleSelect(label) {
    if (label === 'Nuevo juego') setView('game')
    else console.log('Menu selected:', label)
  }

  return (
    <div className="menu-page">
      {view === 'menu' && <MainMenu onSelect={handleSelect} />}
      {view === 'game' && <GameWindow onClose={() => setView('menu')} />}
    </div>
  )
}
