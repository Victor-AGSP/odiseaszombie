import React, { useState, useRef, useEffect } from 'react'
import './GameWindow.css'
import Card from './Card.jsx'

// Generate a 30-card sample deck (no visible names). Mix types and stats for variety.
function generateDeck() {
  const types = ['personaje', 'evento', 'talento']
  const deck = []
  for (let i = 0; i < 30; i++) {
    const type = types[Math.floor(Math.random() * types.length)]
    const risk = type === 'personaje' ? Math.floor(Math.random() * 5) - 1 : 0
    const conflict = type === 'personaje' ? Math.max(1, Math.floor(Math.random() * 4)) : 0
    deck.push({ type, risk, conflict })
  }
  return deck
}
const sampleDeck = generateDeck()

export default function GameWindow({ onClose }) {
  // Initialize deck and hand without mutating the same array
  const initialDeck = sampleDeck.slice()
  const [deck, setDeck] = useState(initialDeck.slice(3))
  const [hand, setHand] = useState(initialDeck.slice(0, 3))
  const [table, setTable] = useState([])
  // start with a sample Evento and a sample Iniciativa so UI shows the slots
  const [playerEvents, setPlayerEvents] = useState([{ type: 'evento', risk: 0, conflict: 0 }])
  const [playerTalents, setPlayerTalents] = useState([{ type: 'talento', risk: 0, conflict: 0 }])
  const [days, setDays] = useState(0)
  const [zombies, setZombies] = useState(0)
  const [log, setLog] = useState([])
  const [hoveredIndex, setHoveredIndex] = useState(null)

  // mini-menu state for hand cards
  const [menuCard, setMenuCard] = useState(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })

  function pushLog(msg) {
    setLog(l => [msg, ...l].slice(0, 8))
  }

  function drawCard() {
    // legacy: kept for compatibility; use showCard for flip animation
    if (deck.length === 0) { pushLog('El mazo está vacío') ; return }
    const [top, ...rest] = deck
    setDeck(rest)
    setHand(h => [...h, top])
    pushLog('Robaste una carta')
  }

  // New: show (reveal) top card with flip animation and then add to hand
  const deckRef = useRef(null)
  const topRef = useRef(null)
  const isShowingRef = useRef(false)
  const [isShowing, setIsShowing] = useState(false)

  async function showCard() {
    // prevent concurrent reveals
    if (isShowingRef.current) return

    // lock immediately so rapid UI clicks disable the button right away
    isShowingRef.current = true
    setIsShowing(true)

    // safer: read top card from current state synchronously
    if (!deck || deck.length === 0) {
      pushLog('El mazo está vacío')
      isShowingRef.current = false
      setIsShowing(false)
      topRef.current = null
      return
    }

    const top = deck[0]
    // remove top from deck
    setDeck(d => d.slice(1))
    topRef.current = top

    const deckEl = deckRef.current && deckRef.current.querySelector('.deck-card')
    if (!deckEl) {
      // fallback: instant reveal (we already consumed top)
      try {
        setHand(h => [...h, topRef.current])
        pushLog('Mostraste una carta')
      } finally {
        isShowingRef.current = false
        setIsShowing(false)
        topRef.current = null
      }
      return
    }

    // create a visual clone for the flip animation
    const rect = deckEl.getBoundingClientRect()
    const clone = deckEl.cloneNode(true)
    clone.style.position = 'fixed'
    clone.style.left = `${rect.left}px`
    clone.style.top = `${rect.top}px`
    clone.style.margin = '0'
    clone.style.pointerEvents = 'none'
    clone.style.zIndex = 99999
    clone.style.transformStyle = 'preserve-3d'
    document.body.appendChild(clone)

    // flip in place (rotateY). At mid-point, swap content to show card front
    const half = clone.animate([
      { transform: 'rotateY(0deg)' },
      { transform: 'rotateY(90deg)' }
    ], { duration: 260, easing: 'cubic-bezier(.22,.9,.3,1)' })

  half.onfinish = () => {
      // replace clone inner with a simple front face using Card markup
      // keep it lightweight: show risk/conflict text
  clone.innerHTML = ''
  clone.classList.add('revealed-clone')
  const front = document.createElement('div')
  front.style.width = '120px'
  front.style.height = '170px'
  front.style.display = 'flex'
  front.style.flexDirection = 'column'
  front.style.alignItems = 'center'
  front.style.justifyContent = 'center'
  front.style.borderRadius = '10px'
  front.style.background = 'linear-gradient(180deg,#0f1315,#061013)'
  front.style.color = '#e6eef6'
  front.innerHTML = `<div style="font-weight:800;font-size:28px;color:#ffe9b3;margin-bottom:8px">${topRef.current.risk}</div><div style="font-size:14px;color:#ffb0b0">${topRef.current.conflict}</div>`
  clone.appendChild(front)

      // finish flip to show front
      clone.animate([
        { transform: 'rotateY(90deg)' },
        { transform: 'rotateY(0deg)' }
      ], { duration: 240, easing: 'cubic-bezier(.22,.9,.3,1)' })

      // after small delay, place the card on the table and remove clone with a pop animation
        setTimeout(() => {
  // top already removed from deck; place into table
  try {
    setTable(t => [...t, topRef.current])
    pushLog('Mostraste una carta y la colocaste en mesa')
  } catch (e) {
    // ensure we still clear the lock below
    console.error('Error placing card after reveal', e)
  }

        // animate a movement from deck -> table using the existing helper
        try {
          const dest = tableRef.current
          if (dest) animateCardToTarget(deckEl, dest, () => {})
        } catch (e) {
          // ignore animation failures
        }

            clone.animate([
              { transform: 'translateY(0px) scale(1)', opacity: 1 },
              { transform: 'translateY(20px) scale(0.9)', opacity: 0 }
            ], { duration: 420, easing: 'cubic-bezier(.22,.9,.3,1)' }).onfinish = () => {
              clone.remove()
              // clear showing lock
              isShowingRef.current = false
              setIsShowing(false)
              topRef.current = null
            }
      }, 420)
    }
  }

  const tableRef = useRef(null)
  const handRef = useRef(null)
  // panning state for table area
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const panRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    function onMove(e) {
      if (!isDraggingRef.current) return
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY
      const dx = clientX - lastPosRef.current.x
      const dy = clientY - lastPosRef.current.y
      lastPosRef.current = { x: clientX, y: clientY }
      panRef.current.x += dx
      panRef.current.y += dy
      setPan({ x: panRef.current.x, y: panRef.current.y })
    }

    function onUp() {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      setIsDragging(false)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
    }
  }, [])

  function startPan(e) {
    e.stopPropagation && e.stopPropagation()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    isDraggingRef.current = true
    setIsDragging(true)
    lastPosRef.current = { x: clientX, y: clientY }
  }

  // Play a card with a "fly to target" animation. event is passed from the Card's onClick.
  function playCard(index, event) {
    const c = hand[index]
    // try to find source element: prefer event.currentTarget, fallback to handRef slot
    let srcEl = event?.currentTarget
    if (!srcEl && handRef && handRef.current) {
      const slots = handRef.current.querySelectorAll('.hand-slot')
      const slot = slots && slots[index]
      srcEl = slot ? (slot.firstElementChild || slot) : null
    }
    const destEl = tableRef.current

    // remove from hand immediately for UX, but we'll add to target after animation
    setHand(h => h.filter((_, i) => i !== index))

    if (srcEl && destEl) {
      animateCardToTarget(srcEl, destEl, () => {
        placeCardAfterPlay(c)
      })
    } else {
      placeCardAfterPlay(c)
    }
  }


  function placeCardAfterPlay(c) {
    if (c.type === 'personaje') {
      // personaje: puede volverse errante al ser encontrado/jugado
      const becomesErrant = Math.random() < 0.35
      setTable(t => [...t, { ...c, errant: becomesErrant }])
      pushLog(`Personaje ${becomesErrant ? 'errante' : 'aliado'} en mesa`)
    } else if (c.type === 'evento') {
      setPlayerEvents(ev => [...ev, c])
      pushLog('Evento en juego con el jugador')
    } else if (c.type === 'talento' || c.type === 'iniciativa') {
      setPlayerTalents(t => [...t, c])
      pushLog('Talento asignado')
    } else {
      setTable(t => [...t, c])
      pushLog('Carta jugada en mesa')
    }
  }

  // Helper: animate a clone of srcEl to the center of destEl, then call cb
  function animateCardToTarget(srcEl, destEl, cb) {
    const srcRect = srcEl.getBoundingClientRect()
    const destRect = destEl.getBoundingClientRect()
    const clone = srcEl.cloneNode(true)
    const body = document.body
    // ensure clone renders above everything and preserves 3D transforms
    clone.style.position = 'fixed'
    clone.style.left = `${srcRect.left}px`
    clone.style.top = `${srcRect.top}px`
    clone.style.margin = '0'
    clone.style.zIndex = 99999
    clone.style.pointerEvents = 'none'
    clone.style.transformStyle = 'preserve-3d'

    // If the card has an inner 3D transform (card-inner), copy that computed transform
    const inner = clone.querySelector && (clone.querySelector('.card-inner') || clone.querySelector('.card-root'))
    try {
      if (inner) {
        const innerStyle = window.getComputedStyle(inner)
        clone.style.transform = innerStyle.transform && innerStyle.transform !== 'none' ? innerStyle.transform : window.getComputedStyle(srcEl).transform || 'none'
        clone.style.transformOrigin = innerStyle.transformOrigin || 'center center'
      } else {
        clone.style.transform = window.getComputedStyle(srcEl).transform || 'none'
      }
    } catch (e) {
      // fallback
      clone.style.transform = window.getComputedStyle(srcEl).transform || 'none'
    }

    body.appendChild(clone)

    const dx = destRect.left + destRect.width / 2 - (srcRect.left + srcRect.width / 2)
    const dy = destRect.top + destRect.height / 2 - (srcRect.top + srcRect.height / 2)
    const dz = 0
    const scale = 0.9

    const from = clone.style.transform || 'none'
    const to = `translate3d(${dx}px, ${dy}px, ${dz}px) scale(${scale})`

    const anim = clone.animate([
      { transform: from },
      { transform: to }
    ], { duration: 600, easing: 'cubic-bezier(.22,.9,.3,1)' })

    anim.onfinish = () => {
      clone.remove()
      cb && cb()
    }
  }

  function rollDice() { return Math.floor(Math.random() * 6) + 1 }

  // Paso de decisión: si hay personajes errantes en mesa, se resuelve el primero
  function pasoDecision() {
    const errants = table.filter(c => c.type === 'personaje' && c.errant)
    if (errants.length === 0) { pushLog('No hay personajes errantes') ; return }
    const p = errants[0]
    const r = rollDice()
    pushLog(`Decisión: tiraste ${r}`)
    if (p.conflict && r >= p.conflict) {
      // resuelto: personaje vuelve a la baraja
      setTable(t => t.filter(x => x !== p))
      setDeck(d => [p, ...d])
      pushLog('Conflicto resuelto: personaje retirado a la baraja')
    } else if (r < p.conflict) {
      setZombies(z => z + r)
      pushLog(`Conflicto fallido: se agregaron ${r} zombies`) 
    }
  }

  // Paso de riesgo: todos los jugadores (simplificado: 1) tiran y suman
  function pasoRiesgo() {
    const r = rollDice()
    // aliados suman su risk positivo
    const allies = table.filter(c => c.type === 'personaje' && !c.errant)
    const alliesSum = allies.reduce((s, c) => s + (c.risk || 0), 0)
    const add = r + alliesSum
    setZombies(z => z + add)
    pushLog(`Riesgo: tiraste ${r} + aliados ${alliesSum} => +${add} zombies`)
  }

  // Paso de defensa: cada jugador tira para reducir amenaza (simplificado: 1 jugador)
  function pasoDefensa() {
    const r = rollDice()
    setZombies(z => Math.max(0, z - r))
    pushLog(`Defensa: tiraste ${r} => -${r} zombies`) 
  }

  function endDay() {
    setDays(d => d + 1)
    pushLog('Final del día: contadores actualizados')
  }

  function openCardMenu(card, event, index) {
    // prevent the root onClick from immediately closing the menu
    event && event.stopPropagation && event.stopPropagation()
    // position the menu centered above the clicked card if possible
    let x = event?.clientX || (window.innerWidth / 2)
    let y = event?.clientY || (window.innerHeight / 2)
    const srcEl = event?.currentTarget || (handRef.current && handRef.current.querySelectorAll('.hand-slot')[index])
    if (srcEl && srcEl.getBoundingClientRect) {
      const r = srcEl.getBoundingClientRect()
      x = r.left + r.width / 2
      y = r.top
    }
    setMenuCard({ card, index })
    setMenuPos({ x, y })
  }

  function closeCardMenu() {
    setMenuCard(null)
  }

  function useCardAbility() {
    if (!menuCard) return
    pushLog('Usaste la habilidad de la carta')
    const c = menuCard.card
    if (c && c.risk && c.risk < 0) setZombies(z => Math.max(0, z + c.risk))
    closeCardMenu()
  }

  return (
    <div className="gw-root" role="dialog" aria-modal="true" onClick={() => { closeCardMenu() }}>
      <div className="gw-overlay-stats">
        <div className="stats-box">
          <div>dias</div>
          <div className="stat-value">{days}</div>
        </div>
        <div className="stats-box">
          <div>zombies</div>
          <div className="stat-value">{zombies}</div>
        </div>
        <div className="deck-hud" ref={deckRef}>
          <div className="deck-stack" aria-hidden>
            <div className="deck-card">🂠</div>
            <div className="deck-count">{deck.length}</div>
          </div>
          <div className="deck-controls">
            <button className="draw-btn" disabled={isShowing || deck.length === 0} title={deck.length === 0 ? 'Mazo vacío' : ''} onClick={() => { closeCardMenu(); showCard() }}>{isShowing ? 'Mostrando…' : 'Mostrar'}</button>
            <div className="discard">Descartar (0)</div>
          </div>
        </div>
      </div>

      <div className="gw-window">
        <div className="gw-header">
          <div className="gw-meta">Mazo: <strong>{deck.length}</strong> • Desc.: <strong>{0}</strong></div>
          <button className="gw-close" onClick={onClose} aria-label="Cerrar ventana">✕</button>
        </div>

        <div className="gw-board">
          <div className="table-column">
            <div className="table-pan" onMouseDown={startPan} onTouchStart={startPan}>
              <div className="table-pan-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
                <div className="table-cards" ref={tableRef}>
                  {table.map((c, i) => {
                return (
                  <div className="table-slot" key={c.id || i}>
                    <Card type={c.type} risk={c.risk} conflict={c.conflict} allied={!c.errant} errant={c.errant} rot={0} />
                  </div>
                )
              })}
                </div>
              </div>
            </div>
          </div>

          {/* side-column removed per user request (player-events) */}
        </div>

        {/* Floating controls top-right */}
        <div className="floating-controls">
          <button onClick={() => { closeCardMenu(); pasoDecision() }}>Paso de decisión</button>
          <button onClick={() => { closeCardMenu(); pasoRiesgo() }}>Riesgo</button>
          <button onClick={() => { closeCardMenu(); pasoDefensa() }}>Defensa</button>
          <button onClick={() => { closeCardMenu(); endDay() }}>Final día</button>
        </div>

        <div className="team-bar">
          <div className="team-sections">
            <div className="team-equipo">
              <div className="hand-label">Equipo</div>
              <div className="hand-area" ref={handRef}>
                {hand.map((c, i) => {
              // Behavior: only move cards to the right of the hovered card so
              // the hovered card is fully visible. Left-side cards stay overlapped.
              let tx = 0
              let ty = 0
              let scale = 1
              // No rotation: rotate made the card hard to read. We'll use lift + scale only.
              const gap = 80 // lateral offset applied to cards on the right; large enough to reveal hovered card
              if (hoveredIndex !== null) {
                if (i > hoveredIndex) {
                  // shift right enough to reveal the hovered card
                  tx = gap * (i - hoveredIndex)
                }
                if (i === hoveredIndex) {
                  ty = -34 // lift hovered card a bit
                  scale = 1.12
                }
              }
              // only stagger the right-side slide so animation feels natural
              const delay = hoveredIndex !== null && i > hoveredIndex ? (i - hoveredIndex) * 60 : 0
              const style = {
                transform: `translateX(${tx}px) translateY(${ty}px) scale(${scale})`,
                zIndex: i === hoveredIndex ? 9999 : 200 + i,
                transitionDelay: `${delay}ms`
              }
              return (
                <div
                  className="hand-slot"
                  key={i}
                  style={style}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={(e) => openCardMenu(c, e, i)}
                >
                  <Card
                    type={c.type}
                    risk={c.risk}
                    conflict={c.conflict}
                    rot={0}
                  />
                </div>
              )
              })}
            </div>
              </div>

            <div className="team-side-slots">
              <div className="team-slot team-evento">
                <div className="slot-label">Evento</div>
                <div className="slot-body">
                  {playerEvents[0] ? (
                    <div onClick={(e) => openCardMenu(playerEvents[0], e, null)}>
                      <Card type={playerEvents[0].type} risk={playerEvents[0].risk} conflict={playerEvents[0].conflict} rot={0} />
                    </div>
                  ) : <div className="empty-slot">—</div>}
                </div>
              </div>

              <div className="team-slot team-iniciativa">
                <div className="slot-label">Iniciativa</div>
                <div className="slot-body">
                  {playerTalents[0] ? (
                    <div onClick={(e) => openCardMenu(playerTalents[0], e, null)}>
                      <Card type={playerTalents[0].type} risk={playerTalents[0].risk} conflict={playerTalents[0].conflict} rot={0} />
                    </div>
                  ) : <div className="empty-slot">—</div>}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="gw-footer">Presiona Esc o clic en ✕ para volver al menú</div>
      </div>
      {menuCard && (
        <div
          className="card-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
          onMouseLeave={closeCardMenu}
          onClick={(e) => { e.stopPropagation(); }}
        >
          <div style={{ fontWeight: 700, color: '#eaf6f7', marginBottom: 6 }}>Acciones</div>
          <button onClick={() => { closeCardMenu(); playCard(menuCard.index) }}>Jugar carta</button>
          <button onClick={() => { closeCardMenu(); useCardAbility() }}>Usar habilidad</button>
          <div className="sep" />
          <button onClick={() => { closeCardMenu(); pushLog('Mostrar detalles de la carta') }}>Ver detalles</button>
        </div>
      )}
    </div>
  )
}
