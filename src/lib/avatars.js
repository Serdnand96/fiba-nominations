// Avatares ilustrados (DiceBear), la alternativa a subir una foto de perfil.
//
// Se generan en el navegador a partir de un estilo y una semilla: misma semilla,
// mismo dibujo. No hay servicio externo ni costo. El SVG resultante se pasa a
// PNG con canvas antes de subirlo por el mismo endpoint que la foto
// (/api/me/avatar): el backend rechaza SVG a propósito porque el bucket es
// público, y así el avatar queda como cualquier otra imagen.
//
// Este módulo se importa con `import()` desde ProfileModal para que las
// librerías de estilos (varios cientos de KB) no entren al bundle inicial.
// Cada estilo pesa entre 130 y 300 KB: antes de agregar uno, mirá el chunk
// `avatars-*.js` del build. Notionists y Open Peeps quedaron afuera por peso.
//
// Licencias: el código de todos los paquetes es MIT. Los diseños de
// avataaars y bottts son de Pablo Stanley, "free for personal and commercial
// use"; el resto de los estilos elegidos son MIT/CC0. No se usan estilos que
// exijan atribución.
import { createAvatar } from '@dicebear/core'
import * as avataaars from '@dicebear/avataaars'
import * as lorelei from '@dicebear/lorelei'
import * as pixelArt from '@dicebear/pixel-art'
import * as thumbs from '@dicebear/thumbs'
import * as bottts from '@dicebear/bottts'

export const AVATAR_STYLES = [
  { key: 'avataaars', label: 'Avataaars', style: avataaars },
  { key: 'lorelei', label: 'Lorelei', style: lorelei },
  { key: 'pixel-art', label: 'Pixel Art', style: pixelArt },
  { key: 'thumbs', label: 'Thumbs', style: thumbs },
  { key: 'bottts', label: 'Bottts', style: bottts },
]

// Fondos suaves para que el avatar no quede flotando sobre blanco.
const BACKGROUNDS = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf']

export function avatarSvg(styleKey, seed, size = 128) {
  const entry = AVATAR_STYLES.find(s => s.key === styleKey) || AVATAR_STYLES[0]
  return createAvatar(entry.style, {
    seed,
    size,
    backgroundColor: BACKGROUNDS,
    backgroundType: ['solid'],
  }).toString()
}

export function svgDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function randomSeed() {
  return Math.random().toString(36).slice(2, 10)
}

export function randomSeeds(n) {
  return Array.from({ length: n }, randomSeed)
}

// SVG → PNG cuadrado. El SVG de DiceBear es autocontenido (sin referencias
// externas), así que un <img> con data URI lo dibuja sin problemas de CORS.
export async function svgToPngFile(svg, side = 512) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('decode'))
    i.src = svgDataUri(svg)
  })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = side
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, side, side)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('encode')
  return new File([blob], 'avatar.png', { type: 'image/png' })
}
