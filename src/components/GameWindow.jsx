import React, { useState, useRef, useEffect } from 'react'
import './GameWindow.css'
import Card from './Card.jsx'

// Generate a 30-card sample deck (no visible names). Mix types and stats for variety.
// Helper to normalize filename: lowercase, remove diacritics and non-alphanumerics
function normalizeFileName(name = '') {
  // Remove accents/diacritics using NFD decomposition and range of combining marks
  const noDiacritics = name.normalize ? name.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : name
  // Lowercase, replace spaces with '_' and remove characters that could break filenames
  return noDiacritics.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, '')
}

// NOTE: removed fallback generator to avoid allocating sample card objects on mount.
// If loading fails we now keep the deck empty (no in-memory fallback data).

export default function GameWindow({ onClose }) {
  // Initialize deck empty to avoid keeping generated sample cards in memory.
  const [deck, setDeck] = useState([])
  const [hand, setHand] = useState([])
  const [table, setTable] = useState([])
  // start with a sample Evento and a sample Iniciativa so UI shows the slots
  const [playerEvents, setPlayerEvents] = useState([])
  const [playerTalents, setPlayerTalents] = useState([])
  const [availableInitiatives, setAvailableInitiatives] = useState([])
  // activeIniciativaId helps keep the displayed iniciativa in sync immediately
  const [activeIniciativaId, setActiveIniciativaId] = useState(null)
  // derive a single talento card (if any) for the team slot
  const talentoCard = (playerTalents && playerTalents.find && playerTalents.find(p => p.type === 'talento')) || null
  const iniciativaCard = (() => {
    const byPlayer = (playerTalents && playerTalents.find && playerTalents.find(p => p.type === 'iniciativa')) || null
    if (activeIniciativaId) {
      const fromPlayer = (playerTalents || []).find(p => p.id === activeIniciativaId) || null
      if (fromPlayer) return fromPlayer
      const fromAvail = (availableInitiatives || []).find(p => p.id === activeIniciativaId) || null
      if (fromAvail) return fromAvail
    }
    return byPlayer
  })()
  const [days, setDays] = useState(0)
  const [zombies, setZombies] = useState(0)
  const [log, setLog] = useState([])
  const [hoveredIndex, setHoveredIndex] = useState(null)
  // Game step system (single-player focused)
  const [currentStep, setCurrentStep] = useState('') // '', 'preparacion','encuentro','decision','riesgo','defensa','viaje'
  const [travelCount, setTravelCount] = useState(0)
  const [fatigueCount, setFatigueCount] = useState(0)
  const roundRestartingRef = useRef(false)
  const [conflictAlert, setConflictAlert] = useState(false)
  const [encounterActionsToday, setEncounterActionsToday] = useState(0)
  // Número de encuentros (revelaciones) por paso de encuentro. Por defecto 1.
  // Algunos personajes/efectos pueden incrementar este valor en el futuro.
  const [encountersPerTurn, setEncountersPerTurn] = useState(1)

  // mini-menu state for hand cards
  const [menuCard, setMenuCard] = useState(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [previewCard, setPreviewCard] = useState(null)
  const [showInitiativeOptions, setShowInitiativeOptions] = useState(false)
  const [hoveredInitiativeIndex, setHoveredInitiativeIndex] = useState(null)
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

  // Load cards from JSON files in public/ and build deck + player slots
  useEffect(() => {
    let cancelled = false
    async function loadExcel() {
      try {
        // fetch the four JSON files in parallel
        const [pRes, eRes, tRes, iRes] = await Promise.all([
          fetch('/PERSONAJES.json'),
          fetch('/EVENTOS.json'),
          fetch('/TALENTOS.json'),
          fetch('/INICIATIVAS.json')
        ])
        if (!pRes.ok || !eRes.ok || !tRes.ok || !iRes.ok) throw new Error('No se pudieron leer los archivos JSON de datos')
        const [pJson, eJson, tJson, iJson] = await Promise.all([pRes.json(), eRes.json(), tRes.json(), iRes.json()])

        const personajes = []
        const eventos = []
        const talentos = []
        const iniciativas = []

        // Instead of probing many filename variants (which generates many 404s),
        // build a single predictable path for each card image. This reduces
        // requests at startup and relies on the browser to load images when
        // they're actually rendered. If a different naming convention is used
        // in the future, consider adding a server-side mapping or storing the
        // image path in the JSON data.
        function getImagePath(baseName) {
          if (!baseName) return null
          const baseNoDiacritics = baseName && baseName.normalize ? baseName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : String(baseName || '').toLowerCase()
          return `/images/${encodeURIComponent(baseNoDiacritics)}.bmp`
        }

        // Map personajes from PERSONAJES.json
        if (pJson && pJson.Personajes) {
          for (const [name, obj] of Object.entries(pJson.Personajes)) {
            const idNum = obj && obj.id !== undefined ? obj.id : null
            const card = {
              id: idNum !== null ? `personaje-${idNum}` : `personaje-${normalizeFileName(name)}`,
              name,
              type: 'personaje',
              img: null,
              risk: obj && (obj.Amenaza !== undefined ? Number(obj.Amenaza) : (obj.amenaza !== undefined ? Number(obj.amenaza) : 0)),
              conflict: obj && (obj.Conflicto !== undefined ? Number(obj.Conflicto) : (obj.conflicto !== undefined ? Number(obj.conflicto) : 0)),
              keywords: obj && obj.keywords ? obj.keywords : []
            }
            // assign a single predictable image path (no probing)
            card.img = getImagePath(name)
            personajes.push(card)
          }
        }

        // Map eventos
        if (eJson && eJson.Eventos) {
          for (const [name, obj] of Object.entries(eJson.Eventos)) {
            const card = {
              id: `evento-${normalizeFileName(name)}`,
              name,
              type: 'evento',
              img: null,
              risk: 0,
              conflict: 0,
              keywords: obj && obj.keywords ? obj.keywords : []
            }
            card.img = getImagePath(name)
            eventos.push(card)
          }
        }

        // Map talentos
        if (tJson && tJson.Talentos) {
          for (const [name, obj] of Object.entries(tJson.Talentos)) {
            const card = {
              id: `talento-${normalizeFileName(name)}`,
              name,
              type: 'talento',
              img: null,
              risk: 0,
              conflict: 0,
              keywords: obj && obj.keywords ? obj.keywords : []
            }
            card.img = getImagePath(name)
            talentos.push(card)
          }
        }

        // Map iniciativas
        if (iJson && iJson.Iniciativa) {
          for (const [name, obj] of Object.entries(iJson.Iniciativa)) {
            const card = {
              id: `iniciativa-${normalizeFileName(name)}`,
              name,
              type: 'iniciativa',
              img: null,
              risk: 0,
              conflict: 0,
              keywords: obj && obj.keywords ? obj.keywords : []
            }
            card.img = getImagePath(name)
            iniciativas.push(card)
          }
        }

        // image paths assigned deterministically earlier; no probing here.

        // Build deck: only personajes and eventos, then shuffle
        let newDeck = [...personajes, ...eventos]
        for (let i = newDeck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]]
        }

        if (!cancelled) {
          if (newDeck.length > 0) setDeck(newDeck)
          // store available iniciativas (they come from the data but are not part of the playable deck)
          setAvailableInitiatives(iniciativas || [])
          // give one talento + one iniciativa randomly
          const chosenTalento = talentos.length ? talentos[Math.floor(Math.random() * talentos.length)] : null
          const chosenIniciativa = iniciativas.length ? iniciativas[Math.floor(Math.random() * iniciativas.length)] : null
          const pt = []
          if (chosenTalento) pt.push(chosenTalento)
          if (chosenIniciativa) pt.push(chosenIniciativa)
          setPlayerTalents(pt)
          try { if (chosenIniciativa && typeof setActiveIniciativaId === 'function') setActiveIniciativaId(chosenIniciativa.id) } catch (e) {}
          setPlayerEvents([])
        }
      } catch (err) {
        console.error('Error loading JSON data:', err)
        setDeck([])
        setPlayerTalents([])
        setPlayerEvents([])
      }
    }
    loadExcel()
    return () => { cancelled = true }
  }, [])

  // Loading overlay state: show a short loader before revealing the game UI
  const [showLoading, setShowLoading] = useState(true)
  const [loadingFade, setLoadingFade] = useState(false)
  useEffect(() => {
    const visibleMs = 2000
    const fadeMs = 420
    const t1 = setTimeout(() => setLoadingFade(true), visibleMs)
    const t2 = setTimeout(() => setShowLoading(false), visibleMs + fadeMs)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  // recruit modal state: when a Personaje is revealed, show this modal and let user roll a die
  const [recruitCard, setRecruitCard] = useState(null)
  const [isRolling, setIsRolling] = useState(false)
  const [rollResult, setRollResult] = useState(null)
  // Decision roll modal state (animated die when resolving decisiones)
  const [decisionModalCard, setDecisionModalCard] = useState(null)
  const [isDecisionRolling, setIsDecisionRolling] = useState(false)
  const [decisionRollResult, setDecisionRollResult] = useState(null)
  const [selectedForDecision, setSelectedForDecision] = useState(null)
  const [decisionRoundParticipants, setDecisionRoundParticipants] = useState([])
  const [gameOver, setGameOver] = useState(false)
  const latestTableRef = useRef(table)
  useEffect(() => { latestTableRef.current = table }, [table])
  // When recruitCard is a personaje and user tries to close by clicking outside,
  // show a warning animation on the die briefly.
  const [recruitWarn, setRecruitWarn] = useState(false)
  // modal for Evento reveals (simple acknowledge)
  const [eventModalCard, setEventModalCard] = useState(null)
  // discard pile state + modal
  const [discardPile, setDiscardPile] = useState([])
  

  function addToDiscard(card) {
    if (!card) return
    // prevent duplicates in discard by id (or name fallback)
    const key = card.id || card.name || JSON.stringify(card)
    setDiscardPile(d => {
      try {
        if (d && d.some(x => (x && (x.id || x.name)) && (x.id === card.id || x.name === card.name))) return d
      } catch (e) {
        // ignore and proceed to add
      }
      return [card, ...d]
    })
  }

  function pushLog(msg) {
    setLog(l => [msg, ...l].slice(0, 8))
  }
  // ---- Paso system implementation (single-player minimal) ----
  function pasoPreparacion() {
    setCurrentStep('preparacion')
    // reduce fatigue counters by 1 (not below 0)
    setFatigueCount(f => Math.max(0, f - 1))
    pushLog('Paso de Preparación: contadores de cansancio reducidos')
    // player with iniciativa gets an additional reduction — single-player always has iniciativa
    setFatigueCount(f => Math.max(0, f - 1))
    pushLog('Iniciativa aplicada: reducción adicional de cansancio')
    // Allow personajes to be interactable again for decisión (se limpia marca por día)
    setTable(t => (t || []).map(c => ({ ...c, processedDecision: false, awaitingDecision: false })))
  }

  async function pasoEncuentro() {
    setCurrentStep('encuentro')
    // limit to 3 encuentro actions per day
    if (encounterActionsToday >= 3) {
      pushLog('Ya alcanzaste 3 acciones de encuentro hoy')
      return
    }

    // Repetir la acción de mostrar carta tantas veces como indique `encountersPerTurn`.
    // Usamos una variable local `actions` para mantener un conteo consistente
    // al iterar y actualizar el estado `encounterActionsToday`.
    const count = Math.max(1, Number(encountersPerTurn) || 1)
    let actions = Number(encounterActionsToday) || 0
    for (let i = 0; i < count; i++) {
      if (actions >= 3) {
        pushLog('Ya alcanzaste 3 acciones de encuentro hoy')
        break
      }
      actions++
      setEncounterActionsToday(actions)
      pushLog(`Paso de Encuentro: mostrando carta ${i + 1} de ${count}`)
      // Reusar comportamiento existente de showCard (es async y puede abrir modales)
      // Esperamos a que cada revelación termine antes de continuar a la siguiente.
      // Nota: showCard gestiona su propio bloqueo para evitar revelaciones concurrentes.
      // re-use existing showCard behaviour (await because showCard is async)
      // eslint-disable-next-line no-await-in-loop
      await showCard()
    }
  }

  function pasoDecision() {
    setCurrentStep('decision')
    const personajes = (table || []).filter(c => c.type === 'personaje')
    if (!personajes || personajes.length === 0) {
      pushLog('Paso de Decisión: no hay personajes en mesa')
      return
    }

    // mark personajes as awaiting decision (visual red border) unless already processed
    setTable(t => (t || []).map(c => (c.type === 'personaje' && !c.processedDecision) ? { ...c, awaitingDecision: true, interactedThisRound: false, inConflict: false } : c))
    // initialize round participants with the IDs of personajes that must be processed this round
    setDecisionRoundParticipants(personajes.filter(p => !p.processedDecision).map(p => p.id))
    pushLog('Paso de Decisión: los personajes en mesa esperan resolución. Haz click en un personaje y pulsa "Conflicto"')
  }

  function pasoRiesgo() {
    setCurrentStep('riesgo')
    const die = rollDice()
    // sum allied personajes risk (table items allied = !errant)
    const alliedRisk = table.filter(c => c.type === 'personaje' && !c.errant).reduce((s, x) => s + (Number(x.risk) || 0), 0)
    const delta = die + alliedRisk
    setZombies(z => z + delta)
    pushLog(`Paso de Riesgo: dado ${die} + riesgo aliado ${alliedRisk} => +${delta} amenaza`) 
  }

  function pasoDefensa() {
    setCurrentStep('defensa')
    const die = rollDice()
    // subtract from zombies
    setZombies(z => {
      const next = Math.max(0, z - die)
      return next
    })
    // every elimination step adds a fatigue counter
    setFatigueCount(f => f + 1)
    pushLog(`Paso de Defensa: lanzaste d6: ${die} (resta ${die} zombies), se añadió 1 cansancio a todos`) 
  }

  function pasoViaje() {
    setCurrentStep('viaje')
    setTravelCount(t => {
      const next = t + 1
      if (next >= 20) pushLog('¡Contador de viaje alcanzó 20 — victoria!')
      else pushLog(`Paso de Viaje: contador de viaje = ${next}`)
      return next
    })
    // End of day cleanup: reset encounter actions
    setEncounterActionsToday(0)
    // Clear per-day temporary abilities (not modeled in detail here)
  }

  // Resolve conflict with a personaje (simplified single-player algorithm)
  function resolveConflict(character) {
    if (!character) return
    const conflictValue = Number(character.conflict) || 0
    // continue rolling until result >= conflictValue
    let attempts = 0
    while (true) {
      attempts++
      const r = rollDice()
      pushLog(`Conflicto: tirada ${r} (meta ${conflictValue})`)
      if (r > conflictValue) {
        // success: return personaje to deck
        setTable(t => t.filter(x => x !== character))
        setDeck(d => [character, ...d])
        pushLog('Resultado mayor: el personaje regresa a la baraja de encuentros')
        break
      } else if (r === conflictValue) {
        // equal: stays errant
        pushLog('Resultado igual: el personaje permanece errante')
        break
      } else {
        // less: add X zombies (X = result) and roll again
        setZombies(z => z + r)
        pushLog(`Resultado menor: se añaden ${r} zombies y se vuelve a tirar`) 
        // safety: limit infinite loops
        if (attempts > 12) { pushLog('Demasiados intentos en conflicto; se detiene') ; break }
      }
    }
  }

  function drawCard() {
    // legacy: kept for compatibility; use showCard for flip animation
    if (deck.length === 0) { pushLog('El mazo está vacío') ; return }
    const [top, ...rest] = deck
    setDeck(rest)
    // If the top is an Evento, assign to player's event (replace previous)
    if (top && top.type === 'evento') {
      // show a simple modal so the player can acknowledge the new Evento
      setEventModalCard(top)
      pushLog('Robaste un Evento (pulsa continuar para aplicarlo)')
    } else {
      setHand(h => [...h, top])
      pushLog('Robaste una carta')
    }
  }

  function openPreview(card, e) {
    e && e.stopPropagation && e.stopPropagation()
    // show modal immediately so the UI appears fast; animation will be decorative
    setPreviewCard(card)
    // Temporarily reduce modal transition so it appears visually instant to the user.
    // We add a short-lived class 'fast-show' which CSS maps to much shorter durations.
    try {
      requestAnimationFrame(() => {
        const bd = document.querySelector('.card-modal-backdrop')
        if (bd) bd.classList.add('fast-show')
        // remove the class shortly after so subsequent interactions use normal polish
        setTimeout(() => { if (bd) bd.classList.remove('fast-show') }, 180)
      })
    } catch (err) {
      // ignore
    }
    // If we have an element target, animate a visual clone from the card to the center
    try {
      const srcEl = e && e.currentTarget
      if (srcEl && srcEl.getBoundingClientRect) {
        const { clone, rect } = createFixedClone(srcEl)
        // target: prefer the actual modal content position so the clone animates to where the popup will appear
        const modalEl = document.querySelector('.card-modal-content')
        let dx = 0
        let dy = 0
        let scale = 1
        if (modalEl && modalEl.getBoundingClientRect) {
          const destRect = modalEl.getBoundingClientRect()
          const scaleX = destRect.width / rect.width
          const scaleY = destRect.height / rect.height
          dx = destRect.left - rect.left
          dy = destRect.top - rect.top
          // Keep the source card visually in its popped state during the animation
          let srcCardRoot = null
          try {
            srcCardRoot = (e && e.currentTarget && (e.currentTarget.querySelector && e.currentTarget.querySelector('.card-root'))) || null
            if (!srcCardRoot && e && e.currentTarget && e.currentTarget.classList && e.currentTarget.classList.contains('card-root')) srcCardRoot = e.currentTarget
            if (srcCardRoot) srcCardRoot.classList.add('preview-source')
          } catch (err) {
            srcCardRoot = null
          }

          // Professional, fluid keyframes with slight overshoot and rotation for depth
          const fromTransform = window.getComputedStyle(clone).transform || 'none'
          const anim = clone.animate([
            { transform: fromTransform, opacity: 1 },
            { transform: `translate3d(${dx * 0.9}px, ${dy * 0.9}px, 0) scale(${scaleX * 1.06}, ${scaleY * 1.06}) rotateZ(-2deg)`, offset: 0.72, opacity: 1 },
            { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scaleX}, ${scaleY}) rotateZ(0deg)`, offset: 1, opacity: 1 }
          ], { duration: 520, easing: 'cubic-bezier(.2,.9,.28,1)', fill: 'forwards' })

          anim.onfinish = () => {
            try { clone.remove() } catch (er) {}
            if (srcCardRoot) srcCardRoot.classList.remove('preview-source')
            // modal already shown; no need to setPreviewCard again
          }
          return
        } else {
          // fallback: center of viewport
          const vw = window.innerWidth
          const vh = window.innerHeight
          const destLeft = (vw - Math.min(420, vw * 0.8)) / 2
          const destTop = (vh - Math.min(600, vh * 0.8)) / 2
          const destWidth = Math.min(420, vw * 0.8)
          scale = destWidth / rect.width
          dx = destLeft - rect.left
          dy = destTop - rect.top

          clone.animate([
            { transform: window.getComputedStyle(clone).transform || 'none', opacity: 1 },
            { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`, opacity: 1 }
          ], { duration: 420, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'forwards' }).onfinish = () => {
            try { clone.remove() } catch (er) {}
            // modal already shown; no need to setPreviewCard again
          }
          return
        }
      }
    } catch (err) {
      // fallback to instant preview if animation fails
      console.error('Preview animation failed', err)
    }
  }

  // Replace current iniciativa with a selected iniciativa card from the deck
  function changeInitiativeTo(newCard) {
    if (!newCard) return

    // Only allow swapping iniciativa during Preparación
    if (currentStep !== 'preparacion') {
      pushLog('Sólo puedes cambiar la iniciativa durante el Paso de Preparación')
      // close the chooser to avoid confusion
      setShowInitiativeOptions(false)
      return
    }

    const current = iniciativaCard

  // Keep the availableInitiatives unchanged so all other iniciativas remain selectable
  // Discard the previous iniciativa (the user requested the old iniciativa be discarded)
  if (current) addToDiscard(current)

    // Replace iniciativa in playerTalents: remove any previous iniciativa and add the new one
    setPlayerTalents(pt => {
      const withoutOldInitiative = (pt || []).filter(x => !(x && x.type === 'iniciativa'))
      return [...withoutOldInitiative, newCard]
    })

    // make sure the UI picks up the change immediately
    try { setActiveIniciativaId(newCard.id) } catch (e) {}

    // Ensure the newly selected iniciativa doesn't remain duplicated in other collections
    setDeck(d => (d || []).filter(x => !(x && x.id === newCard.id)))
    setHand(h => (h || []).filter(x => !(x && x.id === newCard.id)))
    setTable(t => (t || []).filter(x => !(x && x.id === newCard.id)))

    pushLog(`Iniciativa cambiada: ahora ${newCard.name || 'Iniciativa'}`)

    // Close chooser and the preview popup so the modal disappears upon selection
    setShowInitiativeOptions(false)
    setPreviewCard(null)
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
  // resolve function for an in-progress showCard() so pasoEncuentro can await modal resolution
  const showCardResolveRef = useRef(null)
  // Visibility toggle for the entire team bar (Equipo, Evento, Talento, Iniciativa)
  const [teamVisible, setTeamVisible] = useState(true)

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

    // Return a promise that resolves when the reveal completes and any modal-triggered
    // user interaction finishes (so pasoEncuentro can await mandatory actions).
    return new Promise((resolve) => {
      const half = clone.animate([
        { transform: 'rotateY(0deg)' },
        { transform: 'rotateY(90deg)' }
      ], { duration: 260, easing: 'cubic-bezier(.22,.9,.3,1)' })

      half.onfinish = () => {
        clone.innerHTML = ''
        clone.classList.add('revealed-clone')
        const front = document.createElement('div')
        front.style.width = `${rect.width}px`
        front.style.height = `${rect.height}px`
        front.style.display = 'block'
        front.style.borderRadius = '10px'
        front.style.overflow = 'hidden'
        if (topRef.current && topRef.current.img) {
          const art = document.createElement('img')
          art.src = topRef.current.img
          art.alt = topRef.current.name || ''
          art.style.width = '100%'
          art.style.height = '100%'
          art.style.objectFit = 'cover'
          art.style.display = 'block'
          front.appendChild(art)
        } else {
          front.style.background = 'linear-gradient(180deg,#0f1315,#061013)'
        }
        clone.appendChild(front)

        // finish flip to show front
        clone.animate([
          { transform: 'rotateY(90deg)' },
          { transform: 'rotateY(0deg)' }
        ], { duration: 240, easing: 'cubic-bezier(.22,.9,.3,1)' })

        // after small delay, place the card on the table and remove clone with a pop animation
        setTimeout(() => {
          try {
            if (topRef.current && topRef.current.type === 'evento') {
              setEventModalCard(topRef.current)
              pushLog('Mostraste un Evento (pulsa continuar para aplicarlo)')
              // Defer resolution until user closes the event modal
              showCardResolveRef.current = resolve
            } else if (topRef.current && topRef.current.type === 'personaje') {
              setRecruitCard(topRef.current)
              pushLog('Mostraste un Personaje: lanza el dado para intentar reclutarlo')
              // Defer resolution until user completes the recruit roll
              showCardResolveRef.current = resolve
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
              // No modal opened — resolve immediately after reveal
              resolve()
            }
          } catch (e) {
            // ensure we still clear the lock below
            console.error('Error placing card after reveal', e)
            resolve()
          }

          clone.animate([
            { transform: 'translateY(0px) scale(1)', opacity: 1 },
            { transform: 'translateY(20px) scale(0.9)', opacity: 0 }
          ], { duration: 420, easing: 'cubic-bezier(.22,.9,.3,1)' }).onfinish = () => {
            clone.remove()
            // clear showing lock (note: if we deferred, resolution will happen via handlers)
            isShowingRef.current = false
            setIsShowing(false)
            topRef.current = null
          }
        }, 420)
      }
    })
    
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
    // Fix size and transform origin so scale/translate animations are predictable
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
    clone.style.transformOrigin = 'top left'
    // visual polish for animation: rounded corners, shadow and clipping
    clone.style.borderRadius = '10px'
    clone.style.overflow = 'hidden'
    clone.style.boxShadow = '0 24px 60px rgba(2,6,23,0.6)'
    clone.style.willChange = 'transform,opacity'
    // allow callers to override or add styles
    Object.assign(clone.style, extraStyles)
    document.body.appendChild(clone)
    return { clone, rect }
  }
  // panning state for table area
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const panRef = useRef({ x: 0, y: 0 })
  // When user finishes panning the table we set this to ignore the next click
  const panIgnoreClickRef = useRef(false)
  // Track pointer-down state and initial position so short clicks don't count as pan
  const panPointerDownRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    function onMove(e) {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY

      // If pointer is down but we haven't started a drag yet, check threshold
      if (panPointerDownRef.current && !isDraggingRef.current) {
        const dxStart = clientX - panStartRef.current.x
        const dyStart = clientY - panStartRef.current.y
        if (Math.hypot(dxStart, dyStart) < 6) return // still a click
        // start dragging
        isDraggingRef.current = true
        setIsDragging(true)
        lastPosRef.current = { x: clientX, y: clientY }
        return
      }

      if (!isDraggingRef.current) return

      const dx = clientX - lastPosRef.current.x
      const dy = clientY - lastPosRef.current.y
      lastPosRef.current = { x: clientX, y: clientY }
      panRef.current.x += dx
      panRef.current.y += dy
      setPan({ x: panRef.current.x, y: panRef.current.y })
    }

    function onUp() {
      const wasDragging = isDraggingRef.current
      isDraggingRef.current = false
      panPointerDownRef.current = false
      setIsDragging(false)
      if (wasDragging) {
        // Ignore the immediate next click after finishing a pan to avoid opening previews
        panIgnoreClickRef.current = true
        setTimeout(() => { panIgnoreClickRef.current = false }, 60)
      }
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
        // If a preview modal is open, close it and prevent outer handlers
        if (previewCard) {
          try { closePreview() } catch (er) {}
          e.stopPropagation && e.stopPropagation()
          e.preventDefault && e.preventDefault()
          return
        }
        // otherwise prevent Escape from bubbling to parent components
        e.stopPropagation && e.stopPropagation()
        e.preventDefault && e.preventDefault()
      }
    }
    // use capture phase to intercept before other listeners
    window.addEventListener('keydown', stopEsc, true)
    return () => window.removeEventListener('keydown', stopEsc, true)
  }, [previewCard])

  // Close the iniciativa chooser if the game step changes away from preparacion
  useEffect(() => {
    if (currentStep !== 'preparacion' && showInitiativeOptions) {
      setShowInitiativeOptions(false)
    }
  }, [currentStep, showInitiativeOptions])

  function startPan(e) {
    e.stopPropagation && e.stopPropagation()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    // mark pointer down; only start dragging after movement threshold
    panPointerDownRef.current = true
    panStartRef.current = { x: clientX, y: clientY }
    lastPosRef.current = { x: clientX, y: clientY }
  }

  // Zoom with mouse wheel when over the table (desktop). Uses a gentle step and clamps range.
  function onTableWheel(e) {
    // ignore on mobile views
    if (isMobileView) return
    // Prevent page scroll when zooming
    e.preventDefault && e.preventDefault()
    // slightly larger step for a more responsive zoom feel
    const step = 0.0025
    // invert so wheel up zooms in
    const delta = -e.deltaY
    let next = zoom + delta * step
    // widen allowed zoom range: allow farther out and closer in
    next = Math.max(0.4, Math.min(3.0, next))
    if (Math.abs(next - zoom) < 0.0001) return
    setZoom(next)
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
      // recenter view so newly added cards appear centered
      setTimeout(() => { setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 } }, 40)
    } else if (c.type === 'evento') {
      // Playing an Evento replaces the player's current event -> move previous to discard
      setPlayerEvents(prev => {
        if (prev && prev.length) addToDiscard(prev[0])
        return [c]
      })
      pushLog('Evento en juego con el jugador (reemplazado)')
      // recenter if event affects table layout
      setTimeout(() => { setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 } }, 40)
    } else if (c.type === 'talento' || c.type === 'iniciativa') {
      setPlayerTalents(t => [...t, c])
      pushLog('Talento asignado')
      setTimeout(() => { setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 } }, 40)
    } else {
      setTable(t => [...t, c])
      pushLog('Carta jugada en mesa')
      setTimeout(() => { setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 } }, 40)
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

  // Animate a decision roll using a modal die similar to recruit modal.
  // Show the modal for a decision but do NOT start the roll until user clicks the die
  function showDecisionModal(card) {
    setDecisionModalCard(card)
    setIsDecisionRolling(false)
    setDecisionRollResult(null)
    // clear any selection
    setSelectedForDecision(null)
  }

  // Start the animated die roll for the currently shown decision modal
  function startDecisionRoll() {
    return new Promise((resolve) => {
      const card = decisionModalCard
      if (!card) { resolve(null); return }
      setIsDecisionRolling(true)
      setDecisionRollResult(null)
      const interval = setInterval(() => {
        setDecisionRollResult(Math.floor(Math.random() * 6) + 1)
      }, 80)
      setTimeout(() => {
        clearInterval(interval)
        const final = rollDice()
        setDecisionRollResult(final)
        // small delay so user sees final
        setTimeout(() => {
          setIsDecisionRolling(false)
          setDecisionModalCard(null)
          setDecisionRollResult(null)
          // resolve the decision for this card
          resolve({ card, final })
        }, 420)
      }, 720)
    })
  }

  // Apply the decision result to the given card
  function resolveDecisionForCard(card, raw) {
    if (!card) return
    const adjusted = Math.max(0, raw - (Number(fatigueCount) || 0))
    const conflictVal = Number(card.conflict) || 0
    const riskVal = Number(card.risk) || 0
    pushLog(`Decisión para ${card.name || 'Personaje'}: tirada ${raw} - cansancio ${fatigueCount} => ${adjusted} (conflicto ${conflictVal})`)

    if (adjusted > conflictVal) {
      // discard
      setTable(t => t.filter(x => x !== card))
      addToDiscard(card)
      pushLog(`${card.name || 'Personaje'}: resultado mayor — descartado`)
    } else if (adjusted === conflictVal) {
      setZombies(z => z + riskVal)
      // mark as processed and not in conflict
      setTable(t => t.map(x => x === card ? { ...x, processedDecision: true, awaitingDecision: false, inConflict: false, interactedThisRound: true } : x))
      pushLog(`${card.name || 'Personaje'}: resultado igual — permanece en mesa y se suma su amenaza (${riskVal}) a la amenaza total`)
    } else {
      setZombies(z => z + riskVal)
      // mark as still in conflict; it will be revisited in next round
      setTable(t => t.map(x => x === card ? { ...x, processedDecision: false, awaitingDecision: false, inConflict: true, interactedThisRound: true } : x))
      pushLog(`${card.name || 'Personaje'}: resultado menor — se suma su amenaza (${riskVal}) y queda en conflicto (se volverá a intentar).`)
    }

    // After resolving this card, check if the current round (decisionRoundParticipants) is complete
    setTimeout(() => {
      try {
        setDecisionRoundParticipants(current => {
          const tbl = latestTableRef.current || []
          const remaining = (current || []).filter(id => {
            // if card was discarded, it's not present; treat as done
            const found = tbl.find(t => t.id === id)
            if (!found) return false
            // if found and interactedThisRound true => done
            return !found.interactedThisRound
          })
          if (!remaining || remaining.length === 0) {
            // round finished: check if any characters remain IN CONFLICT
            const tblNow = latestTableRef.current || []
            const stillInConflict = tblNow.filter(c => c.inConflict)
            if (stillInConflict && stillInConflict.length > 0) {
              // start a new round with these ids and add 1 fatigue for having to retry
              // Guard with a ref so this increment only happens once even if multiple
              // callbacks race to detect the round end.
              if (!roundRestartingRef.current) {
                roundRestartingRef.current = true
                setFatigueCount(f => {
                  const next = f + 1
                  pushLog('Fin de ronda de conflicto: +1 cansancio por reiniciar la ronda')
                  if (next >= 6) {
                    pushLog('Has alcanzado 6 de cansancio: has perdido.')
                    setGameOver(true)
                  }
                  return next
                })
                // release the guard shortly after — by then the new round state will be queued
                setTimeout(() => { roundRestartingRef.current = false }, 200)
              }
              setDecisionRoundParticipants(stillInConflict.map(c => c.id))
              // mark them awaitingDecision and reset interactedThisRound
              setTable(t => (t || []).map(x => x.inConflict ? { ...x, awaitingDecision: true, interactedThisRound: false } : x))
            } else {
              // no more conflicts: clear round participants and awaiting flags
              setDecisionRoundParticipants([])
              setTable(t => (t || []).map(x => ({ ...x, awaitingDecision: false, interactedThisRound: false, inConflict: false })))
              pushLog('Todos los conflictos resueltos para hoy')
            }
          }
          return remaining
        })
      } catch (err) {
        console.error('Error comprobando fin de ronda', err)
      }
    }, 80)
  }

  // Advance to the next step in the day (single dynamic button)
  function startGame() {
    // explicit start action: run preparacion and set current step
    try {
      pasoPreparacion()
    } catch (e) {
      console.error('Error starting game', e)
    }
    setCurrentStep('preparacion')
  }

  async function nextStep() {
    // Prevent advancing while a card reveal animation or an encuentro modal is active
    if (isShowingRef.current || isShowing) {
      pushLog('Esperando a que termine la revelación de la carta antes de avanzar')
      return
    }
    if (eventModalCard || recruitCard) {
      pushLog('Cierra el modal de Encuentro antes de avanzar')
      return
    }

    if (gameOver) {
      pushLog('Juego terminado. No puedes avanzar más pasos.')
      return
    }
    const order = ['preparacion','encuentro','decision','riesgo','defensa','viaje']
    const idx = currentStep ? order.indexOf(currentStep) : -1
    let nextIdx = idx + 1
    if (nextIdx >= order.length) nextIdx = 0
    const next = order[nextIdx]
    // If currently in decision phase, prevent leaving it while any personajes are still
    // pending resolution: either the decision round participants list is non-empty,
    // or any personaje on the table is awaitingDecision, inConflict, or not yet processed.
    const tableHasPendingPersonajes = (table && table.some && table.some(c => c && c.type === 'personaje' && (!c.processedDecision || c.awaitingDecision || c.inConflict)))
    const hasPending = (decisionRoundParticipants && decisionRoundParticipants.length > 0) || tableHasPendingPersonajes
    if (currentStep === 'decision' && hasPending) {
      pushLog('Hay conflictos pendientes: resuélvelos antes de avanzar de Decisión')
      // flash a visual alert on awaiting cards to indicate why advancing is blocked
      try {
        setConflictAlert(true)
        setTimeout(() => setConflictAlert(false), 700)
      } catch (e) {}
      return
    }

    // No blocking detected — update step and run associated logic
    setCurrentStep(next)
    try {
      if (next === 'preparacion') pasoPreparacion()
      else if (next === 'encuentro') await pasoEncuentro()
      else if (next === 'decision') await pasoDecision()
      else if (next === 'riesgo') pasoRiesgo()
      else if (next === 'defensa') pasoDefensa()
      else if (next === 'viaje') {
        pasoViaje()
        // increment day counter at end of day
        setDays(d => d + 1)
      }
    } catch (e) {
      console.error('Error advancing step', e)
    }
  }

  // (Removed game-phase helper functions: pasoDecision, pasoRiesgo, pasoDefensa, endDay)
  // These controls and their logic were removed per request to simplify the UI.

  // Reset pan/zoom to initial state and clear any pressed/hover visuals
  function resetView() {
    setPan({ x: 0, y: 0 })
    panRef.current = { x: 0, y: 0 }
    setZoom(1)
    try { window.dispatchEvent(new Event('clearCardPressed')) } catch (e) {}
    pushLog('Vista reiniciada')
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
        } else if (final === 3) {
          // result 3: returns to encounter deck and its risk is added to zombies
          setDeck(d => [recruitCard, ...d])
          setZombies(z => z + (recruitCard.risk || 0))
          pushLog(`El dado salió 3: el personaje volvió a la baraja y su riesgo (${recruitCard.risk || 0}) se añadió a la amenaza`)
        } else if (final === 4) {
          // result 4: remains errant on the table and adds its risk to zombies
          setTable(t => [...t, { ...recruitCard, errant: true }])
          setZombies(z => z + (recruitCard.risk || 0))
          pushLog(`El dado salió 4: el personaje quedó errante en mesa y su riesgo (${recruitCard.risk || 0}) se añadió a la amenaza`)
        } else {
          // default: placed on table (not errant)
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
        // If showCard() was awaiting this recruit modal, resolve it so pasoEncuentro can continue
        try {
          if (showCardResolveRef.current) {
            showCardResolveRef.current()
            showCardResolveRef.current = null
          }
        } catch (e) {}
      }, 380)
    }, 720)
  }

  function handleEventContinue() {
    if (!eventModalCard) return
    try {
      // move previous event to discard pile (if any) and apply new event
      setPlayerEvents(prev => {
        if (prev && prev.length) addToDiscard(prev[0])
        return [eventModalCard]
      })
      pushLog('Evento aplicado: reemplazaste el evento anterior')
    } finally {
      setEventModalCard(null)
        // If showCard() was awaiting this event modal, resolve it so pasoEncuentro can continue
        try {
          if (showCardResolveRef.current) {
            showCardResolveRef.current()
            showCardResolveRef.current = null
          }
        } catch (e) {}
    }
  }

  // compute whether the main advance button should be disabled (reveal in progress, modals open, game over, or pending decisions)
  const tableHasPendingPersonajes = (table && table.some && table.some(c => c && c.type === 'personaje' && (!c.processedDecision || c.awaitingDecision || c.inConflict)))
  const advanceDisabled = Boolean(
    isShowingRef.current || isShowing ||
    eventModalCard || recruitCard ||
    gameOver ||
    (currentStep === 'decision' && ((decisionRoundParticipants && decisionRoundParticipants.length > 0) || tableHasPendingPersonajes))
  )

  return (
    <>
      {showLoading && (
        <div className={`loading-overlay ${loadingFade ? 'fade-out' : ''}`} role="status" aria-live="polite">
          <div className="loading-box">
            <div className="loading-spinner" />
            <div className="loading-label">Cargando...</div>
            <div className="loading-sub">Preparando la partida</div>
          </div>
        </div>
      )}
      <div className={`gw-root ${(showLoading && !loadingFade) ? 'hidden-during-loading' : ''}`} role="dialog" aria-modal="true" onClick={() => { closeCardMenu(); setSelectedForDecision(null) }}>
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
            {/* 'Mostrar' and 'Cartas descartadas' buttons removed per request; 'showCard' still used by pasoEncuentro */}
          </div>
          {/* Extra controls centered beneath the deck-stack */}
          <div className="deck-extra-controls" aria-hidden={false}>
            <button className="deck-extra-btn" onClick={() => { closeCardMenu(); resetView() }}>Restablecer vista</button>
            <button className="deck-extra-btn" onClick={() => { setTeamVisible(v => !v); closeCardMenu(); }} aria-pressed={!teamVisible}>{teamVisible ? 'Ocultar equipo' : 'Revelar equipo'}</button>
          </div>
          
        </div>
      </div>

      {/* Surrender button moved to top-right of the overlay for easier access */}
      <button className="surrender-global-btn" onClick={onClose} aria-label="Rendirse">Rendirse</button>

  <div className={`gw-window ${conflictAlert ? 'conflict-alert' : ''}`}>
        {/* Single dynamic step button: advances through the day's steps internally */}
        <div className="floating-controls" style={{ flexDirection: 'column', gap: 8 }}>
          {!currentStep ? (
            <button className="deck-extra-btn" onClick={() => { startGame() }} disabled={advanceDisabled} aria-busy={advanceDisabled ? 'true' : 'false'}>Iniciar</button>
          ) : (
            <button className="deck-extra-btn" onClick={() => { nextStep() }} disabled={advanceDisabled} aria-busy={advanceDisabled ? 'true' : 'false'}>Siguiente paso</button>
          )}
          <div style={{ color: '#cfe9f7', fontSize: 12, marginTop: 6 }}>
            <div>Paso: {currentStep || '—'}</div>
            <div>Viaje: {travelCount} • Cansancio: {fatigueCount} • Encuentros hoy: {encounterActionsToday}</div>
          </div>
        </div>

        <div className="gw-board">
          <div className="table-column">
            <div className={`table-pan ${isDragging ? 'grabbing' : ''}`} onMouseDown={startPan} onTouchStart={startPan} onWheel={onTableWheel}>
              <div className="table-pan-inner" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}>
                <div className="table-cards" ref={tableRef}>
                  {table.map((c, i) => {
                const isAwaiting = !!c.awaitingDecision && !c.processedDecision && currentStep === 'decision'
                const isSelected = selectedForDecision && selectedForDecision.id === c.id
                return (
                  <div className={`table-slot ${isAwaiting ? 'awaiting-decision' : ''} ${isSelected ? 'selected-decision' : ''}`} key={c.id || i} onClick={(e) => { e.stopPropagation(); if (panIgnoreClickRef.current) { return } if (gameOver) return; if (currentStep === 'decision' && isAwaiting) { setSelectedForDecision(c) ; return } openPreview(c, e) }}>
                        <Card
                          type={c.type}
                          risk={c.risk}
                          conflict={c.conflict}
                          allied={!c.errant}
                          errant={c.errant}
                          name={c.name}
                          img={c.img}
                          rot={0}
                        />
                        {/* Decision overlay: show 'Conflicto' button when this card is selected during decision step */}
                        {isAwaiting && isSelected && (
                          <div className="decision-overlay" onClick={(ev) => { ev.stopPropagation() }}>
                            <button className="deck-extra-btn" onClick={() => { showDecisionModal(c) }}>Conflicto</button>
                            <button className="deck-extra-btn" style={{ marginLeft: 8 }} onClick={() => { setSelectedForDecision(null) }}>Cancelar</button>
                          </div>
                        )}
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
        {/* Floating controls removed: Paso de decisión / Riesgo / Defensa / Final día */}

  {/* footer removed: only surrender button in header remains to exit */}
      </div>

      {/* Team bar moved outside the main game window so it can be positioned independently */}
      {teamVisible && (
        <div className="team-bar" role="region" aria-label="Barra del equipo">
          <div className="team-sections">
          <div className="team-equipo">
            <div className="hand-label">Equipo</div>
            <div className="hand-area" ref={handRef}>
              {hand.map((c, i) => {
            let tx = 0
            let ty = 0
            let scale = 1
            const gap = 80
            if (hoveredIndex !== null) {
              if (i > hoveredIndex) tx = gap
            }
            const style = { transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`, zIndex: i === hoveredIndex ? 9999 : 200 + i }
              return (
              <div className="hand-slot" key={i} style={style} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}>
                <Card type={c.type} risk={c.risk} conflict={c.conflict} name={c.name} img={c.img} rot={0}
                  onClick={(e) => { if (ignoreClickRef.current) { e.stopPropagation(); return } e.stopPropagation(); openPreview(c, e) }}
                  onContextMenu={(e) => { openCardMenu(c, e, i) }} />
              </div>
            )
            })}
              </div>
            </div>

          <div className="team-side-slots">
            {isMobileView ? (
              <div className="team-side-swiper" onTouchStart={(e) => { sideTouchStartRef.current = e.touches[0].clientX; sideTouchDeltaRef.current = 0 }} onTouchMove={(e) => { if (sideTouchStartRef.current == null) return; const dx = e.touches[0].clientX - sideTouchStartRef.current; sideTouchDeltaRef.current = dx; setSideTranslate(dx); e.preventDefault && e.preventDefault() }} onTouchEnd={() => { const dx = sideTouchDeltaRef.current || 0; sideTouchStartRef.current = null; sideTouchDeltaRef.current = 0; setSideTranslate(0); const threshold = 40; if (dx > threshold) setSideIndex(i => Math.max(0, i - 1)); else if (dx < -threshold) setSideIndex(i => Math.min(2, i + 1)); }}>
                {(() => {
                  const sideCards = [playerEvents[0] || null, talentoCard || null, iniciativaCard || null]
                  const sideLabels = ['Evento', 'Talento', 'Iniciativa']
                  const current = sideCards[sideIndex]
                  return (
                    <div className="side-slot-viewport">
                      <div className="side-slot-label">{sideLabels[sideIndex]}</div>
                      <div className="side-slot-body" style={{ transform: `translateX(${sideTranslate}px)` }}>
                        {current ? (
                          <div onContextMenu={(e) => { openCardMenu(current, e, null) }}>
                            <Card name={current.name} img={current.img} type={current.type} risk={current.risk} conflict={current.conflict} rot={0} onClick={(e) => { e.stopPropagation(); openPreview(current, e) }} onContextMenu={(e) => { openCardMenu(current, e, null) }} />
                          </div>
                        ) : (
                          <div className="empty-slot">—</div>
                        )}
                      </div>
                      <div className="side-dots">{[0,1,2].map(i => <span key={i} className={`dot ${i === sideIndex ? 'active' : ''}`} />)}</div>
                    </div>
                  )
                })()}
              </div>
            ) : (
              <>
                <div className="team-slot team-evento">
                  <div className="slot-label">Evento</div>
                  <div className="slot-body">
                    {playerEvents[0] ? (
                      <div onContextMenu={(e) => { openCardMenu(playerEvents[0], e, null) }}>
                        <Card name={playerEvents[0].name} img={playerEvents[0].img} type={playerEvents[0].type} risk={playerEvents[0].risk} conflict={playerEvents[0].conflict} rot={0} onClick={(e) => { e.stopPropagation(); openPreview(playerEvents[0], e) }} onContextMenu={(e) => { openCardMenu(playerEvents[0], e, null) }} />
                      </div>
                    ) : <div className="empty-slot">—</div>}
                  </div>
                </div>

                <div className="team-slot team-talento">
                  <div className="slot-label">Talento</div>
                  <div className="slot-body">
                    {talentoCard ? (
                      <div onContextMenu={(e) => { openCardMenu(talentoCard, e, null) }}>
                        <Card name={talentoCard.name} img={talentoCard.img} type={talentoCard.type} risk={talentoCard.risk} conflict={talentoCard.conflict} rot={0} onClick={(e) => { e.stopPropagation(); openPreview(talentoCard, e) }} onContextMenu={(e) => { openCardMenu(talentoCard, e, null) }} />
                      </div>
                    ) : <div className="empty-slot">—</div>}
                  </div>
                </div>

                <div className="team-slot team-iniciativa">
                  <div className="slot-label">Iniciativa</div>
                  <div className="slot-body">
                    {iniciativaCard ? (
                      <div onContextMenu={(e) => { openCardMenu(iniciativaCard, e, null) }}>
                        <Card name={iniciativaCard.name} img={iniciativaCard.img} type={iniciativaCard.type} risk={iniciativaCard.risk} conflict={iniciativaCard.conflict} rot={0} onClick={(e) => { e.stopPropagation(); openPreview(iniciativaCard, e) }} onContextMenu={(e) => { openCardMenu(iniciativaCard, e, null) }} />
                      </div>
                    ) : <div className="empty-slot">—</div>}
                  </div>
                </div>
              </>) }
          </div>
          </div>
        </div>
      )}
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
            <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <Card name={previewCard.name} img={previewCard.img} type={previewCard.type} risk={previewCard.risk} conflict={previewCard.conflict} rot={0} />
                {/* If this is an iniciativa during preparacion, allow swapping with other iniciativas from the excel */}
                {currentStep === 'preparacion' && previewCard.type === 'iniciativa' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="deck-extra-btn" onClick={() => setShowInitiativeOptions(s => !s)}>{showInitiativeOptions ? 'Cerrar' : 'Cambiar'}</button>
                  </div>
                )}
              </div>

              {/* Sliding chooser panel shown beside the preview when requested */}
              <div className={`initiative-slider ${showInitiativeOptions ? 'open' : ''}`} role="region" aria-hidden={!showInitiativeOptions} onClick={(e) => e.stopPropagation()}>
                <div style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 800, color: '#eaf5ff' }}>Iniciativas disponibles</div>
                  <button className="deck-extra-btn" onClick={() => setShowInitiativeOptions(false)}>Cerrar</button>
                </div>
                <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                  {(!availableInitiatives || availableInitiatives.filter(d => d.type === 'iniciativa').filter(d => d.id !== previewCard.id).length === 0) ? (
                    <div style={{ color: '#cfe9f7' }}>No hay iniciativas disponibles</div>
                  ) : (() => {
                    const candidates = (availableInitiatives || []).filter(d => d.type === 'iniciativa').filter(d => d.id !== previewCard.id)
                    return candidates.map((c, i) => {
                      // compute shift based on hovered index so other options move aside
                      let shift = 0
                      if (hoveredInitiativeIndex !== null) {
                        if (i < hoveredInitiativeIndex) shift = -36
                        else if (i > hoveredInitiativeIndex) shift = 36
                        else shift = 0
                      }
                      const style = { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', padding: 6, borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)', background: 'linear-gradient(180deg, rgba(10,14,18,0.02), rgba(8,10,12,0.02))', transform: `translateX(${shift}px) scale(${hoveredInitiativeIndex === i ? 1.04 : 1})`, transition: 'transform 220ms cubic-bezier(.2,.9,.3,1)' }
                      return (
                        <div key={c.id || i} className="initiative-option" style={style} onMouseEnter={() => setHoveredInitiativeIndex(i)} onMouseLeave={() => setHoveredInitiativeIndex(null)}>
                                  <div style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); changeInitiativeTo(c) }}>
                                    <Card name={c.name} img={c.img} type={c.type} risk={c.risk} conflict={c.conflict} rot={0} />
                                  </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Recruit modal for Personaje reveal */}
      <div className={`card-modal-backdrop ${recruitCard ? 'show' : ''}`} role="dialog" aria-hidden={recruitCard ? 'false' : 'true'} onClick={(e) => {
              // If there is a recruitCard and it's a personaje, prevent closing by clicking outside
              if (recruitCard && recruitCard.type === 'personaje') {
                // trigger a temporary warning animation on the die
                setRecruitWarn(true)
                setTimeout(() => setRecruitWarn(false), 520)
                return
              }
              closeRecruit()
            }}>
            <div className="card-modal-content" onClick={(e) => e.stopPropagation()}>
          {recruitCard && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <Card name={recruitCard.name} img={recruitCard.img} type={recruitCard.type} risk={recruitCard.risk} conflict={recruitCard.conflict} rot={0} />
                  <button
                    className={`recruit-die ${recruitWarn ? 'shake-red' : ''}`}
                    onClick={() => handleRecruitRoll()}
                    disabled={isRolling}
                    aria-label="Lanzar dado"
                  >
                    {isRolling ? (rollResult || '...') : '🎲'}
                  </button>
              <div style={{ color: '#e6eef6', fontSize: 13, textAlign: 'center' }}>
                Haz clic en el dado. Si sale 1, el personaje se une al equipo; si no, va a la mesa.
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Evento acknowledge modal: simple card + Continue button */}
      <div className={`card-modal-backdrop ${eventModalCard ? 'show' : ''}`} onClick={() => { if (eventModalCard) handleEventContinue() }} role="dialog" aria-hidden={eventModalCard ? 'false' : 'true'}>
        <div className="card-modal-content" onClick={(e) => e.stopPropagation()}>
          {eventModalCard && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <Card name={eventModalCard.name} img={eventModalCard.img} type={eventModalCard.type} risk={eventModalCard.risk} conflict={eventModalCard.conflict} rot={0} />
              <button className="recruit-die" onClick={() => handleEventContinue()} aria-label="Continuar">Continuar</button>
            </div>
          )}
        </div>
      </div>
      {/* Decision roll modal (animated die used during pasoDecision) */}
      <div className={`card-modal-backdrop ${decisionModalCard ? 'show' : ''}`} role="dialog" aria-hidden={decisionModalCard ? 'false' : 'true'} onClick={(e) => {
        // don't allow closing while animation is active
        if (isDecisionRolling) return
        setDecisionModalCard(null)
      }}>
        <div className="card-modal-content" onClick={(e) => e.stopPropagation()}>
          {decisionModalCard && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <Card name={decisionModalCard.name} img={decisionModalCard.img} type={decisionModalCard.type} risk={decisionModalCard.risk} conflict={decisionModalCard.conflict} rot={0} />
              <button className={`recruit-die`} aria-label="Tirada de decisión" disabled={isDecisionRolling} onClick={async () => {
                // start the animated roll and then resolve the decision for this card
                if (isDecisionRolling) return
                const res = await startDecisionRoll()
                if (res && res.card) resolveDecisionForCard(res.card, res.final)
              }}>
                {isDecisionRolling ? (decisionRollResult || '...') : '🎲'}
              </button>
              <div style={{ color: '#e6eef6', fontSize: 13, textAlign: 'center' }}>
                Resolviendo decisión para {decisionModalCard.name || 'Personaje'}...
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Discard pile viewer removed per request */}
      {/* Game over modal: shown when fatigueCount >= 6 and gameOver is true */}
      <div className={`card-modal-backdrop ${gameOver ? 'show' : ''}`} role="dialog" aria-hidden={gameOver ? 'false' : 'true'} onClick={(e) => { /* block clicks outside to force explicit choice */ }}> 
        <div className="card-modal-content" onClick={(e) => e.stopPropagation()}>
          <div style={{ width: 'min(420px, 92vw)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <h2 style={{ margin: 0, color: '#ffd6d6' }}>Has alcanzado 6 de cansancio</h2>
            <div style={{ color: '#e6eef6', textAlign: 'center' }}>Tus personajes están demasiado cansados. La partida ha terminado.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button className="deck-extra-btn" onClick={() => { try { window.location.reload() } catch (e) { /* fallback: reset game state if reload blocked */ } }}>Reiniciar partida</button>
              <button className="deck-extra-btn" onClick={() => { if (onClose) onClose() }}>Salir</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
