import React, { useState, useRef, useEffect } from 'react'
import './GameWindow.css'
import Card from './Card.jsx'

// Generate a 30-card sample deck (no visible names). Mix types and stats for variety.
function generateDeck() {
  // Only personaje (P) and evento (E) can appear in the deck per request
  // Weight towards more personajes so cards show varied numbers (few zeros)
  const types = ['personaje','personaje','personaje','evento'] // ~75% personaje, 25% evento
  const deck = []
  for (let i = 0; i < 50; i++) {
    const type = types[Math.floor(Math.random() * types.length)]
    // Make the numbers more varied.
    // Personaje: risk in range [-2, 4], conflict in range [1,5]
    // Evento: small modifiers, give risk in [-1,2] and conflict 0
    let risk = 0
    let conflict = 0
    if (type === 'personaje') {
      risk = Math.floor(Math.random() * 7) - 2 // -2..4
      conflict = Math.floor(Math.random() * 5) + 1 // 1..5
    } else {
      risk = Math.floor(Math.random() * 4) - 1 // -1..2
      conflict = 0
    }
    deck.push({ type, risk, conflict })
  }
  return deck
}
const sampleDeck = generateDeck()

export default function GameWindow({ onClose }) {
  // Initialize deck and hand without mutating the same array
  const initialDeck = sampleDeck.slice()
  // start with 5 cards in hand instead of 3
  const [deck, setDeck] = useState(initialDeck.slice(5))
  const [hand, setHand] = useState(initialDeck.slice(0, 5))
  const [table, setTable] = useState([])
  // start with a sample Evento and a sample Iniciativa so UI shows the slots
  const [playerEvents, setPlayerEvents] = useState([{ type: 'evento', risk: 0, conflict: 0 }])
  const [playerTalents, setPlayerTalents] = useState([
    { type: 'talento', risk: 0, conflict: 0 },
    { type: 'iniciativa', risk: 0, conflict: 0 }
  ])
  // derive a single talento card (if any) for the team slot
  const talentoCard = (playerTalents && playerTalents.find && playerTalents.find(p => p.type === 'talento')) || null
  const iniciativaCard = (playerTalents && playerTalents.find && playerTalents.find(p => p.type === 'iniciativa')) || null
  const [days, setDays] = useState(0)
  const [zombies, setZombies] = useState(0)
  const [log, setLog] = useState([])
  const [hoveredIndex, setHoveredIndex] = useState(null)

  // mini-menu state for hand cards
  const [menuCard, setMenuCard] = useState(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [previewCard, setPreviewCard] = useState(null)
  // Side-slot carousel state (mobile swipe between Evento / Talento / Iniciativa)
  const [sideIndex, setSideIndex] = useState(0) // 0:evento,1:talento,2:iniciativa
  const sideTouchStartRef = useRef(null)
  const sideTouchDeltaRef = useRef(0)
  const [sideTranslate, setSideTranslate] = useState(0)
  // Detect mobile / small-screen to enable swipe-only behavior there
  const [isMobileView, setIsMobileView] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width:768px)').matches
    } catch (e) { return false }
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width:768px)')
    const handler = (ev) => setIsMobileView(ev.matches)
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    setIsMobileView(mq.matches)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])
  // recruit modal state: when a Personaje is revealed, show this modal and let user roll a die
  const [recruitCard, setRecruitCard] = useState(null)
  const [isRolling, setIsRolling] = useState(false)
  const [rollResult, setRollResult] = useState(null)

  function pushLog(msg) {
    setLog(l => [msg, ...l].slice(0, 8))
  }

  function drawCard() {
    // legacy: kept for compatibility; use showCard for flip animation
    if (deck.length === 0) { pushLog('El mazo está vacío') ; return }
    const [top, ...rest] = deck
    setDeck(rest)
    // If the top is an Evento, assign to player's event (replace previous)
    if (top && top.type === 'evento') {
      setPlayerEvents([top])
      pushLog('Robaste un Evento y reemplazaste el evento anterior')
    } else {
      setHand(h => [...h, top])
      pushLog('Robaste una carta')
    }
  }

  function openPreview(card, e) {
    e && e.stopPropagation && e.stopPropagation()
    setPreviewCard(card)
  }

  function closePreview() {
    setPreviewCard(null)
  }

  function closeRecruit() {
    if (isRolling) return // prevent closing while rolling
    setRecruitCard(null)
    setRollResult(null)
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
  const { clone, rect } = createFixedClone(deckEl)

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
    // top already removed from deck; place into table or event slot
  try {
        if (topRef.current && topRef.current.type === 'evento') {
      // replace player's event with the new one
      setPlayerEvents([topRef.current])
      pushLog('Mostraste un Evento y reemplazaste el evento anterior')
        } else if (topRef.current && topRef.current.type === 'personaje') {
          // show recruit modal: player must roll a die to try to recruit
          setRecruitCard(topRef.current)
          pushLog('Mostraste un Personaje: lanza el dado para intentar reclutarlo')
          // do not place it yet; will be placed after roll
        } else {
          setTable(t => [...t, topRef.current])
          pushLog('Mostraste una carta y la colocaste en mesa')
          // animate a movement from deck -> table using the existing helper
          try {
            const dest = tableRef.current
            if (dest) animateCardToTarget(deckEl, dest, () => {})
          } catch (e) {
            // ignore animation failures
          }
    }
  } catch (e) {
    // ensure we still clear the lock below
    console.error('Error placing card after reveal', e)
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
  // drag-to-scroll state for the team hand scrollbar
  const isHandDraggingRef = useRef(false)
  const handDragStartXRef = useRef(0)
  const handScrollStartRef = useRef(0)
  const handPointerDownRef = useRef(false)
  const ignoreClickRef = useRef(false)

  function onHandDrag(e) {
    if (!handPointerDownRef.current) return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const dx = clientX - handDragStartXRef.current
    // start dragging after small threshold so clicks still work
    if (!isHandDraggingRef.current) {
      if (Math.abs(dx) < 6) return
      isHandDraggingRef.current = true
      if (handRef.current) handRef.current.classList.add('dragging')
    }
    if (handRef.current) {
      handRef.current.scrollLeft = Math.max(0, handScrollStartRef.current - dx)
    }
    e.preventDefault && e.preventDefault()
  }

  function endHandDrag() {
    const wasDragging = isHandDraggingRef.current
    isHandDraggingRef.current = false
    handPointerDownRef.current = false
    if (handRef.current) handRef.current.classList.remove('dragging')
    // if we were dragging, ignore the next click event to avoid opening preview
    if (wasDragging) {
      ignoreClickRef.current = true
      setTimeout(() => { ignoreClickRef.current = false }, 50)
    }
    window.removeEventListener('mousemove', onHandDrag)
    window.removeEventListener('mouseup', endHandDrag)
    window.removeEventListener('touchmove', onHandDrag)
    window.removeEventListener('touchend', endHandDrag)
  }

  function startHandDrag(e) {
    // record pointer down; do not mark as dragging until move threshold passed
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    handPointerDownRef.current = true
    handDragStartXRef.current = clientX
    handScrollStartRef.current = handRef.current ? handRef.current.scrollLeft : 0
    window.addEventListener('mousemove', onHandDrag)
    window.addEventListener('mouseup', endHandDrag)
    window.addEventListener('touchmove', onHandDrag, { passive: false })
    window.addEventListener('touchend', endHandDrag)
  }
  
  // Helper: create a fixed-position visual clone of an element and append to body.
  // Returns { clone, rect } where rect is the source element's bounding rect.
  function createFixedClone(el, extraStyles = {}) {
    const rect = el.getBoundingClientRect()
    const clone = el.cloneNode(true)
    clone.style.position = 'fixed'
    clone.style.left = `${rect.left}px`
    clone.style.top = `${rect.top}px`
    clone.style.margin = '0'
    clone.style.pointerEvents = 'none'
    clone.style.zIndex = 99999
    clone.style.transformStyle = 'preserve-3d'
    // allow callers to override or add styles
    Object.assign(clone.style, extraStyles)
    document.body.appendChild(clone)
    return { clone, rect }
  }
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

  // close preview on Esc
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && previewCard) closePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewCard])

  // Prevent Escape from bubbling to parent (so Esc doesn't close the whole game)
  useEffect(() => {
    function stopEsc(e) {
      if (e.key === 'Escape') {
        // stop propagation so parent components won't interpret Esc as exit
        e.stopPropagation && e.stopPropagation()
        e.preventDefault && e.preventDefault()
      }
    }
    // use capture phase to intercept before other listeners
    window.addEventListener('keydown', stopEsc, true)
    return () => window.removeEventListener('keydown', stopEsc, true)
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
      // Playing an Evento replaces the player's current event
      setPlayerEvents([c])
      pushLog('Evento en juego con el jugador (reemplazado)')
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
    const { clone, rect: srcRect } = createFixedClone(srcEl)
    const destRect = destEl.getBoundingClientRect()

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

  // Handle recruit die roll from the recruit modal
  function handleRecruitRoll() {
    if (!recruitCard || isRolling) return
    setIsRolling(true)
    setRollResult(null)

    // quick visual animation: show random faces for ~700ms
    const interval = setInterval(() => {
      setRollResult(Math.floor(Math.random() * 6) + 1)
    }, 80)

    setTimeout(() => {
      clearInterval(interval)
      const final = rollDice()
      setRollResult(final)

      // small delay so the user sees the final number
      setTimeout(() => {
        if (final === 1) {
          // recruited into player's hand (equipo) so it becomes visible in the team bar
          setHand(h => [...h, recruitCard])
          pushLog('¡Reclutaste al personaje y se unió al equipo!')
        } else {
          // placed on table
          setTable(t => [...t, recruitCard])
          pushLog(`El dado salió ${final}: el personaje fue colocado en mesa`)
        }
        // close modal and cleanup
        setIsRolling(false)
        setRecruitCard(null)
        setRollResult(null)
        // clear the show lock if any
        isShowingRef.current = false
        setIsShowing(false)
        topRef.current = null
      }, 380)
    }, 720)
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
            <button className="draw-btn" disabled={isShowing || deck.length === 0} title={deck.length === 0 ? 'Mazo vacío' : ''} onClick={() => { closeCardMenu(); showCard() }}>Mostrar</button>
            <div className="discard">Descartar (0)</div>
          </div>
        </div>
      </div>

      <div className="gw-window">
          <div className="gw-header">
          <div className="gw-meta">Mazo: <strong>{deck.length}</strong> • Desc.: <strong>{0}</strong></div>
          {/* Surrender button - only way to exit the game */}
          <button className="gw-close surrender-btn" onClick={onClose} aria-label="Rendirse">Rendirse</button>
        </div>

        <div className="gw-board">
          <div className="table-column">
            <div className={`table-pan ${isDragging ? 'grabbing' : ''}`} onMouseDown={startPan} onTouchStart={startPan}>
              <div className="table-pan-inner" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}>
                <div className="table-cards" ref={tableRef}>
                  {table.map((c, i) => {
                return (
                  <div className="table-slot" key={c.id || i}>
                      <Card type={c.type} risk={c.risk} conflict={c.conflict} allied={!c.errant} errant={c.errant} rot={0} onClick={(e) => openPreview(c, e)} />
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
              // Behavior: move only cards that are on top of the hovered card (i > hoveredIndex).
              // Use translate3d for GPU acceleration and remove stagger so the right-side cards
              // move as a group (no individual delays). Hovered card lifts and scales.
              let tx = 0
              let ty = 0
              let scale = 1
              const gap = 80
              if (hoveredIndex !== null) {
                // Move all cards to the right of the hovered card by the same amount (group move)
                if (i > hoveredIndex) tx = gap
                // Do NOT lift the hovered card; only shift the other cards sideways
                // (keeps hovered card visually stable so animations are easier to follow)
              }
              const style = {
                transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
                zIndex: i === hoveredIndex ? 9999 : 200 + i
              }
              return (
                <div
                  className="hand-slot"
                  key={i}
                  style={style}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={(e) => { if (ignoreClickRef.current) { e.stopPropagation(); return } e.stopPropagation(); openPreview(c, e) }}
                  onContextMenu={(e) => { openCardMenu(c, e, i) }}
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
              {isMobileView ? (
                // Mobile: single swipeable slot (touch only)
                <div
                  className="team-side-swiper"
                  onTouchStart={(e) => { sideTouchStartRef.current = e.touches[0].clientX; sideTouchDeltaRef.current = 0 }}
                  onTouchMove={(e) => { if (sideTouchStartRef.current == null) return; const dx = e.touches[0].clientX - sideTouchStartRef.current; sideTouchDeltaRef.current = dx; setSideTranslate(dx); e.preventDefault && e.preventDefault() }}
                  onTouchEnd={() => {
                    const dx = sideTouchDeltaRef.current || 0
                    sideTouchStartRef.current = null
                    sideTouchDeltaRef.current = 0
                    setSideTranslate(0)
                    const threshold = 40
                    if (dx > threshold) setSideIndex(i => Math.max(0, i - 1))
                    else if (dx < -threshold) setSideIndex(i => Math.min(2, i + 1))
                  }}
                >
                  {(() => {
                    const sideCards = [playerEvents[0] || null, talentoCard || null, iniciativaCard || null]
                    const sideLabels = ['Evento', 'Talento', 'Iniciativa']
                    const current = sideCards[sideIndex]
                    return (
                      <div className="side-slot-viewport">
                        <div className="side-slot-label">{sideLabels[sideIndex]}</div>
                        <div className="side-slot-body" style={{ transform: `translateX(${sideTranslate}px)` }}>
                          {current ? (
                            <div onClick={(e) => { e.stopPropagation(); openPreview(current, e) }} onContextMenu={(e) => { openCardMenu(current, e, null) }}>
                              <Card type={current.type} risk={current.risk} conflict={current.conflict} rot={0} />
                            </div>
                          ) : (
                            <div className="empty-slot">—</div>
                          )}
                        </div>
                        <div className="side-dots">
                          {[0,1,2].map(i => <span key={i} className={`dot ${i === sideIndex ? 'active' : ''}`} />)}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              ) : (
                // Desktop / large screens: show the three separate slots as before
                <>
                  <div className="team-slot team-evento">
                    <div className="slot-label">Evento</div>
                    <div className="slot-body">
                      {playerEvents[0] ? (
                        <div onClick={(e) => { e.stopPropagation(); openPreview(playerEvents[0], e) }} onContextMenu={(e) => { openCardMenu(playerEvents[0], e, null) }}>
                          <Card type={playerEvents[0].type} risk={playerEvents[0].risk} conflict={playerEvents[0].conflict} rot={0} />
                        </div>
                      ) : <div className="empty-slot">—</div>}
                    </div>
                  </div>

                  <div className="team-slot team-talento">
                    <div className="slot-label">Talento</div>
                    <div className="slot-body">
                      {talentoCard ? (
                        <div onClick={(e) => { e.stopPropagation(); openPreview(talentoCard, e) }} onContextMenu={(e) => { openCardMenu(talentoCard, e, null) }}>
                          <Card type={talentoCard.type} risk={talentoCard.risk} conflict={talentoCard.conflict} rot={0} />
                        </div>
                      ) : <div className="empty-slot">—</div>}
                    </div>
                  </div>

                  <div className="team-slot team-iniciativa">
                    <div className="slot-label">Iniciativa</div>
                    <div className="slot-body">
                      {iniciativaCard ? (
                        <div onClick={(e) => { e.stopPropagation(); openPreview(iniciativaCard, e) }} onContextMenu={(e) => { openCardMenu(iniciativaCard, e, null) }}>
                          <Card type={iniciativaCard.type} risk={iniciativaCard.risk} conflict={iniciativaCard.conflict} rot={0} />
                        </div>
                      ) : <div className="empty-slot">—</div>}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

  {/* footer removed: only surrender button in header remains to exit */}
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
      {/* Card preview modal */}
      <div className={`card-modal-backdrop ${previewCard ? 'show' : ''}`} onClick={() => closePreview()} role="dialog" aria-hidden={previewCard ? 'false' : 'true'}>
        <div className="card-modal-content" onClick={(e) => e.stopPropagation()}>
          {previewCard && (
            <div>
              <Card type={previewCard.type} risk={previewCard.risk} conflict={previewCard.conflict} rot={0} />
            </div>
          )}
        </div>
      </div>
      {/* Recruit modal for Personaje reveal */}
      <div className={`card-modal-backdrop ${recruitCard ? 'show' : ''}`} onClick={() => closeRecruit()} role="dialog" aria-hidden={recruitCard ? 'false' : 'true'}>
        <div className="card-modal-content" onClick={(e) => e.stopPropagation()}>
          {recruitCard && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <Card type={recruitCard.type} risk={recruitCard.risk} conflict={recruitCard.conflict} rot={0} />
              <button className="recruit-die" onClick={() => handleRecruitRoll()} disabled={isRolling} aria-label="Lanzar dado">
                {isRolling ? (rollResult || '...') : '🎲'}
              </button>
              <div style={{ color: '#e6eef6', fontSize: 13, textAlign: 'center' }}>
                Haz clic en el dado. Si sale 1, el personaje se une al equipo; si no, va a la mesa.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
