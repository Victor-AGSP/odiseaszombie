import React from 'react'
import './Card.css'

// Card visual focused on numbers (riesgo / conflicto). No nombres visibles por petición.
export default function Card({ type = 'personaje', risk = 0, conflict = 0, allied = false, errant = false, onClick, rot = 0 }) {
  return (
    <div
      className={`card-root ${allied ? 'allied' : ''} ${errant ? 'errant' : ''}`}
      onClick={onClick}
      style={{ transform: `rotate(${rot}deg)` }}
      role="button"
      tabIndex={0}
    >
      <div className="card-inner">
        <div className="card-face card-front">
          <div className="card-badge">{type === 'personaje' ? 'P' : type === 'evento' ? 'E' : 'T'}</div>

          <div className="card-risk">{risk}</div>

          <div className="card-conflict">{conflict}</div>

          <div className="card-art" aria-hidden="true">🂠</div>
        </div>

        <div className="card-face card-back" aria-hidden="true">
          <div className="card-back-art">🂠</div>
        </div>
      </div>
    </div>
  )
}
