import React, { useEffect, useState } from 'react'
import './App.css'

export default function MainMenu({ onSelect }) {
  const menuItems = ['Nuevo juego', 'Cargar partida', 'Opciones', 'Créditos', 'Salir']
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [animateIn, setAnimateIn] = useState(true)

  useEffect(() => {
    setAnimateIn(true)
    const t = setTimeout(() => setAnimateIn(false), 700)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowDown') setSelectedIndex(i => (i + 1) % menuItems.length)
      else if (e.key === 'ArrowUp') setSelectedIndex(i => (i - 1 + menuItems.length) % menuItems.length)
      else if (e.key === 'Enter') onSelect(menuItems[selectedIndex])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIndex])

  return (
    <div className={`menu ${animateIn ? 'animate-in' : ''}`}> 
      <div className="menu-card">
        <h2>Odisea Zombie</h2>
        <p className="subtitle">Juego de cartas: sobrevive a la horda</p>
        <ul className="menu-list">
          {menuItems.map((it, i) => (
            <li key={it}>
              <button
                className={`menu-button ${i === selectedIndex ? 'active' : ''}`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => onSelect(it)}
              >
                {it}
              </button>
            </li>
          ))}
        </ul>
        <div className="hint">Usa ↑ ↓ para navegar, Enter para seleccionar</div>
      </div>
    </div>
  )
}
