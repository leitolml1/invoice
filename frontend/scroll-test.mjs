import { chromium } from '@playwright/test'

const URL = process.env.URL ?? 'http://127.0.0.1:5173/'
const W = 1280
const H = 800

const ok = (c) => (c ? 'OK  ' : 'FALLA')
let fallas = 0
const check = (cond, label, extra = '') => {
  if (!cond) fallas++
  console.log(`  [${ok(cond)}] ${label}${extra ? '  ' + extra : ''}`)
}

// De una matrix() o matrix3d() saca el factor de escala en X.
const escalaDe = (transform) => {
  if (!transform || transform === 'none') return 1
  const n = transform.match(/matrix(3d)?\(([^)]+)\)/)
  if (!n) return null
  return parseFloat(n[2].split(',')[0].trim())
}

const browser = await chromium.launch()

/* ------------------------------------------------------------------ */
console.log('\n=== 1. Estado inicial (desktop 1280x800) ===')
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.goto(URL, { waitUntil: 'networkidle' })
// Dejar terminar el fade-in de ruta (260ms) para no medirlo por error.
await page.waitForTimeout(600)

const inicial = await page.evaluate(() => {
  const hero = document.querySelector('.hero')
  const cs = getComputedStyle(hero)
  const r = hero.getBoundingClientRect()
  return {
    existe: !!hero,
    position: cs.position,
    transform: cs.transform,
    opacity: cs.opacity,
    ancho: Math.round(r.width),
    alto: Math.round(r.height),
    overflow: cs.overflow,
    zIndexHero: cs.zIndex,
    zIndexLanding: getComputedStyle(document.querySelector('.landing')).zIndex,
    fondoLanding: getComputedStyle(document.querySelector('.landing')).backgroundColor,
    animName: cs.animationName,
    animTimeline: cs.animationTimeline,
    heroFueraDeLanding: !document.querySelector('.landing .hero'),
  }
})

check(inicial.existe, 'el hero existe')
check(inicial.ancho === W, 'ocupa el ancho completo de la ventana', `${inicial.ancho}px de ${W}px`)
check(inicial.alto === H, 'ocupa el alto completo de la ventana', `${inicial.alto}px de ${H}px`)
check(inicial.position === 'sticky', 'esta pinneado', `position: ${inicial.position}`)
check(inicial.heroFueraDeLanding, 'el hero quedo fuera de .landing')
check(escalaDe(inicial.transform) === 1, 'arranca sin escalar', `scale ${escalaDe(inicial.transform)}`)
check(inicial.opacity === '1', 'arranca opaco', `opacity ${inicial.opacity}`)
check(inicial.animTimeline.includes('scroll'), 'tiene timeline de scroll', inicial.animTimeline)
check(
  Number(inicial.zIndexLanding) > Number(inicial.zIndexHero),
  '.landing pinta por encima del hero',
  `landing z=${inicial.zIndexLanding} hero z=${inicial.zIndexHero}`,
)
check(
  inicial.fondoLanding !== 'rgba(0, 0, 0, 0)',
  '.landing es opaco (tapa al hero)',
  inicial.fondoLanding,
)

/* ------------------------------------------------------------------ */
console.log('\n=== 2. El scale sigue al scroll (scrub) ===')
const muestras = []
for (const y of [0, 100, 200, 400, 600, 800, 1000, 1400]) {
  await page.evaluate((v) => window.scrollTo(0, v), y)
  await page.waitForTimeout(120)
  const m = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.hero'))
    return { transform: cs.transform, opacity: parseFloat(cs.opacity), scrollY: window.scrollY }
  })
  muestras.push({ y: m.scrollY, escala: escalaDe(m.transform), opacidad: m.opacity })
}
console.log('  scrollY -> escala / opacidad')
for (const m of muestras) {
  console.log(`    ${String(m.y).padStart(4)}px -> ${m.escala.toFixed(4)} / ${m.opacidad.toFixed(3)}`)
}

const esc = muestras.map((m) => m.escala)
check(esc[0] === 1, 'en scrollY=0 la escala es exactamente 1')
const monotona = esc.every((v, i) => i === 0 || v <= esc[i - 1] + 1e-9)
check(monotona, 'la escala nunca crece al bajar (sin saltos hacia atras)')
const enRango = muestras.at(-1).escala >= 0.8 && muestras.at(-1).escala <= 0.85
check(enRango, 'la escala final cae en el rango pedido (0.7-0.85)', `${muestras.at(-1).escala.toFixed(3)}`)
const intermedia = esc[3] < 1 && esc[3] > esc.at(-1)
check(intermedia, 'hay valores intermedios (es scrub, no un salto binario)', `a 400px: ${esc[3].toFixed(4)}`)
const pasos = new Set(esc.map((v) => v.toFixed(4)))
check(pasos.size >= 5, 'multiples valores distintos de escala', `${pasos.size} valores unicos`)

/* ------------------------------------------------------------------ */
console.log('\n=== 2b. Las secciones de cards crecen al entrar ===')
const maxScroll = await page.evaluate(
  () => document.documentElement.scrollHeight - window.innerHeight,
)
const trayectoria = []
for (const frac of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
  const y = Math.round(maxScroll * frac)
  await page.evaluate((v) => window.scrollTo(0, v), y)
  await page.waitForTimeout(180)
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('.landing__inner > .section')].map((s) => {
      const cs = getComputedStyle(s)
      return { transform: cs.transform, op: parseFloat(cs.opacity) }
    }),
  )
  trayectoria.push({ y, secs: r.map((s) => ({ e: escalaDe(s.transform), o: s.op })) })
}
console.log('  scrollY   seccion 1        seccion 2')
for (const p of trayectoria) {
  const f = (s) => `${s.e.toFixed(3)} / op ${s.o.toFixed(2)}`
  console.log(`  ${String(p.y).padStart(5)}px   ${f(p.secs[0])}   ${f(p.secs[1])}`)
}

for (const i of [0, 1]) {
  const serie = trayectoria.map((p) => p.secs[i])
  const crece = serie.every((s, j) => j === 0 || s.e >= serie[j - 1].e - 1e-9)
  check(crece, `seccion ${i + 1}: la escala nunca decrece al bajar`)
  check(serie[0].e < 1, `seccion ${i + 1}: arranca mas chica que 1`, `${serie[0].e.toFixed(3)}`)
}

// Lo mas importante: que terminen exactamente en 1. Si se quedan cortas,
// las cards viven atenuadas para siempre y parece un bug, no un efecto.
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
await page.waitForTimeout(500)
const finales = await page.evaluate(() =>
  [...document.querySelectorAll('.landing__inner > .section')].map((s) => {
    const cs = getComputedStyle(s)
    return { transform: cs.transform, op: parseFloat(cs.opacity) }
  }),
)
finales.forEach((s, i) => {
  check(
    Math.abs(escalaDe(s.transform) - 1) < 0.002,
    `seccion ${i + 1}: llega a escala 1 exacta`,
    `${escalaDe(s.transform).toFixed(4)}`,
  )
  check(Math.abs(s.op - 1) < 0.01, `seccion ${i + 1}: llega a opacidad 1 exacta`, `${s.op.toFixed(3)}`)
})

/* ------------------------------------------------------------------ */
console.log('\n=== 3. Frames durante un scroll real con la rueda ===')
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(300)

await page.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  window.__stop = false
  const tick = (t) => {
    window.__frames.push(t - last)
    last = t
    if (!window.__stop) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

await page.mouse.move(W / 2, H / 2)
for (let i = 0; i < 40; i++) {
  await page.mouse.wheel(0, 60)
  await page.waitForTimeout(16)
}
await page.evaluate(() => {
  window.__stop = true
})
await page.waitForTimeout(100)

const frames = await page.evaluate(() => window.__frames.slice(1))
const largos = frames.filter((f) => f > 32)
const promedio = frames.reduce((a, b) => a + b, 0) / frames.length
const p95 = frames.slice().sort((a, b) => a - b)[Math.floor(frames.length * 0.95)]
console.log(`  frames medidos: ${frames.length}`)
console.log(`  intervalo promedio: ${promedio.toFixed(2)}ms`)
console.log(`  p95: ${p95.toFixed(2)}ms`)
console.log(`  frames > 32ms (2 frames perdidos a 60Hz): ${largos.length}`)
console.log(`  peor frame: ${Math.max(...frames).toFixed(2)}ms`)
check(largos.length / frames.length < 0.1, 'menos del 10% de frames largos', `${largos.length}/${frames.length}`)

const scrollFinal = await page.evaluate(() => window.scrollY)
check(scrollFinal > 0, 'la rueda efectivamente scrolleo la pagina', `scrollY=${scrollFinal}`)

/* ------------------------------------------------------------------ */
console.log('\n=== 4. El resto de la pagina sigue accesible ===')
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(200)
await page.click('.hero__actions a[href="#como-funciona"]')
await page.waitForTimeout(700)
const anchor = await page.evaluate(() => {
  const s = document.querySelector('#como-funciona')
  const r = s.getBoundingClientRect()
  return { scrollY: window.scrollY, top: Math.round(r.top), visible: r.top < window.innerHeight && r.bottom > 0 }
})
check(anchor.scrollY > 0, 'el ancla #como-funciona movio el scroll', `scrollY=${anchor.scrollY}`)
check(anchor.visible, 'la seccion Como funciona quedo visible', `top=${anchor.top}px`)

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(400)
const pie = await page.evaluate(() => {
  const f = document.querySelector('.landing-footer')
  const r = f.getBoundingClientRect()
  const cardsTapadas = [...document.querySelectorAll('.benefit-card')].filter((c) => {
    const cr = c.getBoundingClientRect()
    const el = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2)
    return el && !c.contains(el) && el !== c
  }).length
  return { visible: r.top < window.innerHeight && r.bottom > 0, cardsTapadas }
})
check(pie.visible, 'el footer es alcanzable scrolleando')
check(pie.cardsTapadas === 0, 'ninguna benefit card queda tapada por el hero', `${pie.cardsTapadas} tapadas`)

const clickable = await page.evaluate(() => {
  const cta = document.querySelector('.hero__actions .btn--cta')
  const r = cta.getBoundingClientRect()
  return { fueraDeVista: r.bottom < 0 || r.top > window.innerHeight }
})
check(true, 'CTA del hero medido al final del scroll', `fuera de vista: ${clickable.fueraDeVista}`)

await page.screenshot({ path: 'shot-desktop-fondo.png' })

/* ------------------------------------------------------------------ */
console.log('\n=== 5. Capturas a distintas alturas de scroll ===')
for (const [nombre, y] of [['top', 0], ['medio', 400], ['revelado', 900]]) {
  await page.evaluate((v) => window.scrollTo(0, v), y)
  await page.waitForTimeout(350)
  await page.screenshot({ path: `shot-desktop-${nombre}.png` })
  console.log(`  shot-desktop-${nombre}.png (scrollY=${y})`)
}
await page.close()

/* ------------------------------------------------------------------ */
console.log('\n=== 6. Mobile 390x844: el efecto tiene que estar desactivado ===')
const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await mob.goto(URL, { waitUntil: 'networkidle' })
await mob.waitForTimeout(600)
const m0 = await mob.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.hero'))
  return { position: cs.position, animName: cs.animationName, ancho: Math.round(document.querySelector('.hero').getBoundingClientRect().width) }
})
await mob.evaluate(() => window.scrollTo(0, 500))
await mob.waitForTimeout(300)
const m1 = await mob.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.hero'))
  return { transform: cs.transform, opacity: cs.opacity }
})
check(m0.position !== 'sticky', 'en mobile el hero NO esta pinneado', `position: ${m0.position}`)
check(m0.animName === 'none', 'en mobile no hay animacion de shrink', `animation-name: ${m0.animName}`)
check(escalaDe(m1.transform) === 1, 'en mobile la escala se mantiene en 1 al scrollear')
check(m0.ancho === 390, 'en mobile el hero ocupa el ancho completo', `${m0.ancho}px`)
const mobScroll = await mob.evaluate(() => {
  window.scrollTo(0, document.body.scrollHeight)
  return { y: window.scrollY, alto: document.body.scrollHeight }
})
check(mobScroll.y > 0, 'en mobile la pagina scrollea normal', `scrollY=${mobScroll.y}`)
await mob.screenshot({ path: 'shot-mobile-top.png' })
await mob.close()

/* ------------------------------------------------------------------ */
console.log('\n=== 7. prefers-reduced-motion: reduce ===')
const rm = await browser.newPage({ viewport: { width: W, height: H } })
await rm.emulateMedia({ reducedMotion: 'reduce' })
await rm.goto(URL, { waitUntil: 'networkidle' })
await rm.waitForTimeout(400)
await rm.evaluate(() => window.scrollTo(0, 600))
await rm.waitForTimeout(300)
const r0 = await rm.evaluate(() => {
  const hero = getComputedStyle(document.querySelector('.hero'))
  const antes = getComputedStyle(document.querySelector('.hero'), '::before')
  return { animName: hero.animationName, transform: hero.transform, driftName: antes.animationName }
})
check(r0.animName === 'none', 'sin shrink cuando se pide menos movimiento', `animation-name: ${r0.animName}`)
check(escalaDe(r0.transform) === 1, 'el hero no se escala con reduced-motion')
check(r0.driftName === 'none', 'la deriva del fondo tambien se apaga', `::before animation: ${r0.driftName}`)
const rmScroll = await rm.evaluate(() => {
  window.scrollTo(0, document.body.scrollHeight)
  return window.scrollY
})
check(rmScroll > 0, 'con reduced-motion la pagina sigue scrolleando')
await rm.close()

/* ------------------------------------------------------------------ */
console.log('\n=== 8. Las otras rutas no se tocaron ===')
for (const ruta of ['app', 'historial', 'about']) {
  const p2 = await browser.newPage({ viewport: { width: W, height: H } })
  const errores = []
  p2.on('pageerror', (e) => errores.push(e.message))
  p2.on('console', (m) => m.type() === 'error' && errores.push(m.text()))
  await p2.goto(`${URL}${ruta}`, { waitUntil: 'networkidle' })
  await p2.waitForTimeout(500)
  const r = await p2.evaluate(() => ({
    hayHero: !!document.querySelector('.hero'),
    hayContenido: document.body.innerText.trim().length > 50,
    h1: document.querySelector('h1')?.textContent?.slice(0, 40) ?? null,
  }))
  check(!r.hayHero, `/${ruta}: no tiene hero (el efecto es solo del Home)`)
  check(r.hayContenido, `/${ruta}: renderiza contenido`, `h1: ${r.h1}`)
  check(errores.length === 0, `/${ruta}: sin errores de consola`, errores.slice(0, 1).join(''))
  await p2.close()
}

await browser.close()

console.log(`\n${'='.repeat(52)}`)
console.log(fallas === 0 ? 'TODOS LOS CHECKS PASARON' : `${fallas} CHECK(S) FALLARON`)
console.log('='.repeat(52))
process.exit(fallas === 0 ? 0 : 1)
