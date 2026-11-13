/**
 * Index.css's motion multiplier for animations run from script: 1 by
 * default, less or none from Customize's Motion, and none when the system
 * asks for less motion, since what these animate is travel.
 */
export function motion(): number {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
  const m = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--m'))
  return Number.isNaN(m) ? 1 : m
}
