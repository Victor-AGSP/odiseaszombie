import React, { useEffect } from 'react'
import './App.css'

export default function Credits({ onClose = () => {} }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="credits-page">
      <div className="credits-card">
        <header className="credits-header">
          <div className="credits-brand">
            <div className="credits-logo" aria-hidden>🧟</div>
            <div>
              <h1>Odisea Zombie</h1>
              <div className="credits-sub">Créditos</div>
            </div>
          </div>
          <div className="credits-actions">
            <button className="deck-extra-btn" onClick={() => onClose()}>Volver</button>
          </div>
        </header>

        <section className="credits-body">
          <div className="credits-grid">
            <div className="credits-section">
              <h3>Desarrollo</h3>
              <p className="credits-name">Victor-AGSP</p>
            </div>

            <div className="credits-section">
              <h3>Arte & Gráficos</h3>
              <p className="credits-name">Nombre del artista</p>
              <p className="credits-note">Recursos: assets libres / contribuciones</p>
            </div>

            <div className="credits-section">
              <h3>Música & FX</h3>
              <p className="credits-name">Nombre del compositor</p>
            </div>

            <div className="credits-section">
              <h3>Playtesters</h3>
              <ul className="credits-list">
                <li>Colaborador 1</li>
                <li>Colaborador 2</li>
                <li>Colaborador 3</li>
              </ul>
            </div>

            <div className="credits-section wide">
              <h3>Agradecimientos</h3>
              <p>Gracias a la comunidad y a todos los que aportaron ideas, arte y pruebas. Este proyecto fue posible gracias al apoyo y la pasión compartida.</p>
            </div>
          </div>

          <footer className="credits-footer">
            <div>Versión del juego: 1.0.0</div>
            <div className="small">© {new Date().getFullYear()} Victor-AGSP — Todos los derechos reservados</div>
          </footer>
        </section>
      </div>
    </div>
  )
}
