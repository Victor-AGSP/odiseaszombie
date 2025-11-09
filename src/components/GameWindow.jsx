import React, { useState, useRef, useEffect } from 'react'
import './GameWindow.css'
import Card from './Card.jsx'
import * as XLSX from 'xlsx'

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

  // Load cards from public/datacards.xlsx and build deck + player slots
  useEffect(() => {
    let cancelled = false
    async function loadExcel() {
      try {
        const resp = await fetch('/datacards.xlsx')
        if (!resp.ok) throw new Error('No se pudo leer datacards.xlsx')
        const ab = await resp.arrayBuffer()
        const wb = XLSX.read(new Uint8Array(ab), { type: 'array' })
        const firstSheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' })

        const personajes = []
        const eventos = []
        const talentos = []
        const iniciativas = []

        // small helper to test for image existence by trying candidate paths
        async function findExistingImage(baseName) {
          const candidates = []
          const n1 = normalizeFileName(baseName)
          // also try a diacritics-removed version but preserving spaces (some files use spaces)
          const baseNoDiacritics = baseName && baseName.normalize ? baseName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : baseName.toLowerCase()
          const variants = [
            n1, // normalized (underscores)
            n1.replace(/_/g, '-'),
            n1.replace(/_/g, ''),
            baseName.toLowerCase().replace(/\s+/g, '_'),
            baseNoDiacritics, // preserves spaces
            encodeURIComponent(baseNoDiacritics) // URL-encoded (spaces -> %20)
          ]
          const exts = ['bmp', 'png', 'jpg', 'jpeg']
          const prefixes = ['', '/images']
          for (const p of prefixes) {
            for (const v of variants) {
              for (const e of exts) {
                candidates.push(`${p}/${v}.${e}`)
              }
            }
          }
          // try candidates in order and return first that responds OK
          for (let c of candidates) {
            try {
              // Try to actually load the image via an Image object so we know the browser can decode it
              const ok = await new Promise((resolve) => {
                const img = new Image()
                img.onload = () => resolve(true)
                img.onerror = () => resolve(false)
                img.src = c
              })
              if (ok) return c
            } catch (e) {
              // ignore and try next candidate
            }
          }
          // nothing found
          console.debug('findExistingImage: no candidate matched for', baseName, 'tried candidates:', candidates)
          return null
        }

        const imgPromises = []
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          // support both header names 'Nombre','Tipo','Json' or lowercased
          const nombre = row.Nombre || row.nombre || row.Name || row.name || ''
          const tipoRaw = row.Tipo || row.tipo || row.Type || row.type || ''
          const jsonRaw = row.Json || row.json || ''
          const tipo = String(tipoRaw).trim().toLowerCase()
          const id = `r-${i}`
          // Attempt to resolve an existing bmp path. We'll try several candidate patterns.
          const candidateBase = String(nombre || '')
          // findExistingImage is async; for now set placeholder and resolve below
          let img = null
          // parse JSON details if present
          let parsed = {}
          try { parsed = jsonRaw ? (typeof jsonRaw === 'object' ? jsonRaw : JSON.parse(String(jsonRaw))) : {} } catch (e) { parsed = {} }

          const card = {
            id,
            name: nombre,
            type: tipo.startsWith('p') || tipo === 'personaje' ? 'personaje' : tipo.startsWith('e') || tipo === 'evento' ? 'evento' : tipo.startsWith('t') || tipo === 'talento' ? 'talento' : tipo.startsWith('i') || tipo === 'iniciativa' ? 'iniciativa' : 'otro',
            img,
            // map JSON fields: Amenaza => risk, Conflicto => conflict
            risk: parsed && (parsed.Amenaza !== undefined ? Number(parsed.Amenaza) : parsed.Amenaza) || (parsed.Amenaza === 0 ? 0 : (parsed.amenaza !== undefined ? Number(parsed.amenaza) : 0)),
            conflict: parsed && (parsed.Conflicto !== undefined ? Number(parsed.Conflicto) : parsed.Conflicto) || (parsed.Conflicto === 0 ? 0 : (parsed.conflicto !== undefined ? Number(parsed.conflicto) : 0))
          }

          if (card.type === 'personaje') personajes.push(card)
          else if (card.type === 'evento') eventos.push(card)
          else if (card.type === 'talento') talentos.push(card)
          else if (card.type === 'iniciativa') iniciativas.push(card)
          // enqueue promise to resolve image path for this card
          imgPromises.push(
            (async () => {
              try {
                const found = await findExistingImage(candidateBase)
                return { id: card.id, found }
              } catch (e) {
                return { id: card.id, found: null }
              }
            })()
          )
        }
        // await image resolution for all rows before constructing deck/state so React sees imgs
        const imgsResolved = await Promise.all(imgPromises)
        // apply found images to cards
        for (const r of imgsResolved) {
          if (!r || !r.id) continue
          const allLists = [personajes, eventos, talentos, iniciativas]
          for (const list of allLists) {
            const c = list.find(x => x.id === r.id)
            if (c) {
              if (r.found) c.img = r.found
              else console.warn(`Carta sin imagen encontrada para: ${c.name} (buscado como .bmp)`)
              break
            }
          }
        }

        // If any card still lacks an img, try the exact normalized path (user said images follow this naming)
        const allLists2 = [personajes, eventos, talentos, iniciativas]
        for (const list of allLists2) {
          for (const c of list) {
            if (!c.img && c.name) {
              const candidate = `/${normalizeFileName(c.name)}.bmp`
              c.img = candidate
            }
          }
        }

        // Build deck: only personajes and eventos, then shuffle
        let newDeck = [...personajes, ...eventos]
        for (let i = newDeck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]]
        }

        if (!cancelled) {
          if (newDeck.length > 0) setDeck(newDeck)
          // remove any Evento from player's slot and instead give one talento + one iniciativa randomly
          const chosenTalento = talentos.length ? talentos[Math.floor(Math.random() * talentos.length)] : null
          const chosenIniciativa = iniciativas.length ? iniciativas[Math.floor(Math.random() * iniciativas.length)] : null
          const pt = []
          if (chosenTalento) pt.push(chosenTalento)
          if (chosenIniciativa) pt.push(chosenIniciativa)
          setPlayerTalents(pt)
          setPlayerEvents([])
        }
        } catch (err) {
        console.error('Error loading datacards.xlsx:', err)
        // fallback: keep deck empty to avoid allocating sample objects
        setDeck([])
        setPlayerTalents([])
        setPlayerEvents([])
      }
    }
    loadExcel()
    return () => { cancelled = true }
  }, [])
  // recruit modal state: when a Personaje is revealed, show this modal and let user roll a die
  const [recruitCard, setRecruitCard] = useState(null)
  const [isRolling, setIsRolling] = useState(false)
  const [rollResult, setRollResult] = useState(null)
  // When recruitCard is a personaje and user tries to close by clicking outside,
  // show a warning animation on the die briefly.
  const [recruitWarn, setRecruitWarn] = useState(false)
  // modal for Evento reveals (simple acknowledge)
  const [eventModalCard, setEventModalCard] = useState(null)
  // discard pile state + modal
  const [discardPile, setDiscardPile] = useState([])
  const [discardModalOpen, setDiscardModalOpen] = useState(false)

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
  front.style.width = `${rect.width}px`
  front.style.height = `${rect.height}px`
  front.style.display = 'block'
  front.style.borderRadius = '10px'
  front.style.overflow = 'hidden'
  // If the card has an artwork image, show it full-bleed; otherwise use a neutral gradient
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
    // top already removed from deck; place into table or event slot
  try {
        if (topRef.current && topRef.current.type === 'evento') {
      // show a simple modal to acknowledge the Evento before applying it
      setEventModalCard(topRef.current)
      pushLog('Mostraste un Evento (pulsa continuar para aplicarlo)')
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
    const step = 0.0018
    // invert so wheel up zooms in
    const delta = -e.deltaY
    let next = zoom + delta * step
    next = Math.max(0.6, Math.min(1.8, next))
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
    } else if (c.type === 'evento') {
      // Playing an Evento replaces the player's current event -> move previous to discard
      setPlayerEvents(prev => {
        if (prev && prev.length) addToDiscard(prev[0])
        return [c]
      })
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
    }
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
            <button className="deck-discard-btn" onClick={() => { closeCardMenu(); setDiscardModalOpen(true) }} title="Ver cartas descartadas">Cartas descartadas ({discardPile.length})</button>
          </div>
          {/* Extra controls centered beneath the deck-stack */}
          <div className="deck-extra-controls" aria-hidden={false}>
            <button className="deck-extra-btn" onClick={() => { closeCardMenu(); resetView() }}>Restablecer vista</button>
            <button className="deck-extra-btn" onClick={() => { setTeamVisible(v => !v); closeCardMenu(); }} aria-pressed={!teamVisible}>{teamVisible ? 'Ocultar equipo' : 'Revelar equipo'}</button>
          </div>
        </div>
      </div>

      <div className="gw-window">
          <div className="gw-header">
          <div className="gw-meta">Mazo: <strong>{deck.length}</strong> • Desc.: <strong>{discardPile.length}</strong></div>
          {/* Surrender button - only way to exit the game */}
          <button className="gw-close surrender-btn" onClick={onClose} aria-label="Rendirse">Rendirse</button>
        </div>

        <div className="gw-board">
          <div className="table-column">
            <div className={`table-pan ${isDragging ? 'grabbing' : ''}`} onMouseDown={startPan} onTouchStart={startPan} onWheel={onTableWheel}>
              <div className="table-pan-inner" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}>
                <div className="table-cards" ref={tableRef}>
                  {table.map((c, i) => {
                return (
                  <div className="table-slot" key={c.id || i}>
                        <Card
                          type={c.type}
                          risk={c.risk}
                          conflict={c.conflict}
                          allied={!c.errant}
                          errant={c.errant}
                          name={c.name}
                          img={c.img}
                          rot={0}
                          onClick={(e) => { if (panIgnoreClickRef.current) { e.stopPropagation(); return } openPreview(c, e) }}
                        />
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
            <div>
              <Card name={previewCard.name} img={previewCard.img} type={previewCard.type} risk={previewCard.risk} conflict={previewCard.conflict} rot={0} />
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
      {/* Discard pile modal */}
      <div className={`card-modal-backdrop ${discardModalOpen ? 'show' : ''}`} onClick={() => setDiscardModalOpen(false)} role="dialog" aria-hidden={discardModalOpen ? 'false' : 'true'}>
        <div className="card-modal-content" onClick={(e) => e.stopPropagation()}>
          <div style={{ width: 'min(520px, 92vw)', maxHeight: '70vh', overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#eaf5ff' }}>Cartas descartadas</h3>
              <div style={{ color: '#cfe9f7' }}>{discardPile.length} total</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {discardPile.length === 0 ? (
                <div style={{ color: '#cfe9f7' }}>No hay cartas descartadas</div>
              ) : discardPile.map((c, i) => (
                <div key={c.id || i} style={{ background: 'linear-gradient(180deg, rgba(12,20,24,0.06), rgba(10,14,18,0.04))', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.03)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 48, height: 68, borderRadius: 6, overflow: 'hidden', background: '#07111a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {c.img ? <img src={c.img} alt={c.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ color: '#eaf5ff', fontSize: 20 }}>🂠</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontWeight: 700, color: '#eaf5ff' }}>{c.name || '(sin nombre)'}</div>
                    <div style={{ fontSize: 12, color: '#cfe9f7' }}>{c.type || ''} {c.risk !== undefined ? `• R:${c.risk}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="deck-extra-btn" onClick={() => setDiscardModalOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
