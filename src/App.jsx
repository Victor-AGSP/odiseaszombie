import React from 'react'
import './App.css'
import MainMenu from './MainMenu.jsx'

export default function App() {
  function handleSelect(label) {
    // placeholder: main app logic will handle these selections
    console.log('Menu selected:', label)
  }

  return (
    <div className="menu-page">
      <MainMenu onSelect={handleSelect} />
    </div>
  )
}
