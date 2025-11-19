import React, { useRef, useState, useEffect } from 'react'
import './Card.css'

// Card visual focused on numbers (riesgo / conflicto). No nombres visibles por petición.
export default function Card({ type = 'personaje', risk = 0, conflict = 0, allied = false, errant = false, onClick, rot = 0, name = '', img = null, ...rest }) {
  const typeClass = type ? String(type).toLowerCase() : ''
  const badge = type === 'personaje' ? 'P' : type === 'evento' ? 'E' : type === 'talento' ? 'T' : type === 'iniciativa' ? 'I' : 'C'
  const innerRef = useRef(null)
  const animatingRef = useRef(false)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    // reset error if img prop changes
    setImgError(false)
  }, [img])

  function handleClick(e) {
    // Prevent multiple animations
    if (animatingRef.current) return
    const node = innerRef.current
    // play a smooth 'disappear backwards and reappear' animation
    if (node && node.animate) {
      animatingRef.current = true
      // keyframes: normal -> backward+fade -> normal
      const kf = [
        { transform: getComputedStyle(node).transform || 'none', opacity: 1 },
        { transform: 'translateZ(-48px) scale(0.86) rotateX(12deg)', opacity: 0 },
        { transform: 'rotateX(22deg) translateZ(-2px)', opacity: 1 }
      ]
      const anim = node.animate(kf, { duration: 620, easing: 'cubic-bezier(.22,.9,.3,1)' })
      // disable pointer events on node during animation to avoid re-clicks
      try { node.style.pointerEvents = 'none' } catch (er) {}
      // Call the provided onClick callback immediately so UI responds without waiting
      if (onClick) {
        try {
          // ensure animation has been scheduled before calling callback
          requestAnimationFrame(() => onClick(e))
        } catch (err) {
          onClick(e)
        }
      }
      anim.onfinish = () => {
        animatingRef.current = false
        try { node.style.pointerEvents = '' } catch (er) {}
      }
    } else {
      if (onClick) onClick(e)
    }
  }

  return (
    <div
      className={`card-root ${typeClass} ${allied ? 'allied' : ''} ${errant ? 'errant' : ''}`}
      onClick={handleClick}
      style={{ transform: `rotate(${rot}deg)` }}
      role="button"
      tabIndex={0}
      {...rest}
    >
      <div className="card-inner" ref={innerRef}>
        <div className="card-face card-front">
          {/* full-bleed artwork behind overlays */}
          {img && !imgError ? (
            <img src={img} alt={name || ''} className="card-art-img" loading="lazy" onError={(e) => { try { setImgError(true) } catch (er) {} }} />
          ) : (
            <div className="card-art" aria-hidden="true">{name ? name : '🂠'}</div>
          )}

          <div className="card-badge">{badge}</div>

          <div className="card-risk">{risk}</div>

          <div className="card-conflict">{conflict}</div>
        </div>

        <div className="card-face card-back" aria-hidden="true">
          <div className="card-back-art">🂠</div>
        </div>
      </div>
    </div>
  )
}
