import { useId } from 'react'
import { motion } from '../lib/motion'
import type { Stamp } from '../lib/rewards'
import { MOTIFS } from '../lib/stampWords'
import { STAMP_INKS, type Ground, type Rarity } from '../lib/stampbook'
import { shortDay } from '../lib/time'

/** Each motif in lib/stampWords' MOTIFS, in that order, drawn in a 28-unit square about the middle. */
const DRAWN: string[] = [
  // A nib, point down, with its slit and breather hole.
  'M0 13 L-7 0 Q-7 -7 -4 -13 H4 Q7 -7 7 0 Z M0 13 V1 M1.8 -2 a1.8 1.8 0 1 1 -3.6 0 a1.8 1.8 0 1 1 3.6 0',
  // An inkpot.
  'M-10 0 Q-10 -3 -7 -3 H7 Q10 -3 10 0 V9 Q10 12 7 12 H-7 Q-10 12 -10 9 Z M-4 -3 V-8 H4 V-3 M-5 -11 H5 V-8 H-5 Z',
  // A crescent moon.
  'M8.5 -11 A12 12 0 1 0 8.5 11 A12 12 0 0 1 8.5 -11 Z',
  // The sun.
  'M5 0 a5 5 0 1 1 -10 0 a5 5 0 1 1 10 0 M8 0 H12 M5.7 5.7 L8.5 8.5 M0 8 V12 M-5.7 5.7 L-8.5 8.5 M-8 0 H-12 M-5.7 -5.7 L-8.5 -8.5 M0 -8 V-12 M5.7 -5.7 L8.5 -8.5',
  // A leaf.
  'M-10 10 Q-11 -9 10 -10 Q9 11 -10 10 Z M-10 10 L5 -5',
  // Waves.
  'M-13 -4.5 q3.25 -5 6.5 0 t6.5 0 t6.5 0 t6.5 0 M-13 4.5 q3.25 -5 6.5 0 t6.5 0 t6.5 0 t6.5 0',
  // A star.
  'M0 -11 L2.94 -3.05 L11.41 -2.71 L4.76 2.55 L7.05 10.71 L0 6 L-7.05 10.71 L-4.76 2.55 L-11.41 -2.71 L-2.94 -3.05 Z',
  // Mountains.
  'M-13 8.5 L-4 -8.5 L2 1.5 L6 -3.5 L13 8.5 Z M-7 -3 L-4 -1.5 L-1.5 -3.5',
  // A cup of tea, steaming.
  'M-9.5 -3 H6.5 V2 A8 8 0 0 1 -9.5 2 Z M6.5 -1 H8.5 A3 3 0 0 1 8.5 5 H5.5 M-4.5 -7 q-1.5 -2 0 -4 M1.5 -7 q-1.5 -2 0 -4 M-11.5 11 H8.5',
  // An open book.
  'M0 -7 Q-6 -10 -12 -7 V9 Q-6 6 0 9 Q6 6 12 9 V-7 Q6 -10 0 -7 Z M0 -7 V9',
  // A feather.
  'M-10 12 L9 -11 M10 -12 C2 -11 -6 -4 -6 6 C2 6 9 -2 10 -12 Z',
  // A key.
  'M-2 0 a5 5 0 1 1 -10 0 a5 5 0 1 1 10 0 M-2 0 H12 M8 0 V4 M11 0 V3',

  // The doors, 1 to 24 December.
  // A snowflake.
  'M0 -12 V12 M-10.4 -6 L10.4 6 M-10.4 6 L10.4 -6 M-3 -10 L0 -7 L3 -10 M-3 10 L0 7 L3 10 M7.16 7.6 L6.06 3.5 L10.16 2.4 M-10.16 -2.4 L-6.06 -3.5 L-7.16 -7.6 M10.16 -2.4 L6.06 -3.5 L7.16 -7.6 M-7.16 7.6 L-6.06 3.5 L-10.16 2.4',
  // A bright star.
  'M0 -13 L3 -3 L13 0 L3 3 L0 13 L-3 3 L-13 0 L-3 -3 Z',
  // A bell.
  'M-9 8.5 Q-8 0.5 -6 -3.5 Q-4 -8.5 0 -8.5 Q4 -8.5 6 -3.5 Q8 0.5 9 8.5 Z M-11 8.5 H11 M-2 8.5 Q0 12.5 2 8.5 M0 -8.5 V-10.5',
  // A Christmas tree.
  'M0 -13 L-6 -5 H-3 L-9 3 H-5 L-11 10 H11 L5 3 H9 L3 -5 H6 Z M-2 10 V13 H2 V10',
  // A mitten.
  'M-3.5 12.5 V1.5 Q-9.5 -1.5 -7.5 -5.5 Q-5.5 -8.5 -2.5 -4.5 V-7.5 Q-2.5 -12.5 2.5 -12.5 Q8.5 -12.5 8.5 -6.5 V12.5 Z M-3.5 8.5 H8.5',
  // A candle.
  'M-4 -2 H4 V12 H-4 Z M0 -2 V-5 M0 -6 Q-3 -9 0 -13 Q3 -9 0 -6 Z',
  // A present.
  'M-10 -3 H10 V12 H-10 Z M-11 -7 H11 V-3 H-11 Z M0 -7 V12 M0 -7 Q-6 -14 -7 -9 Q-6 -7 0 -7 M0 -7 Q6 -14 7 -9 Q6 -7 0 -7',
  // Holly.
  'M0 4 Q-4 0 -12 2 Q-10 4 -11 7 Q-6 7 0 4 M0 4 Q4 0 12 2 Q10 4 11 7 Q6 7 0 4 M-0.5 -1 a2 2 0 1 1 -4 0 a2 2 0 1 1 4 0 M4.5 -1 a2 2 0 1 1 -4 0 a2 2 0 1 1 4 0 M2 -4.5 a2 2 0 1 1 -4 0 a2 2 0 1 1 4 0',
  // A snowman.
  'M4 -6 a4 4 0 1 1 -8 0 a4 4 0 1 1 8 0 M7 6 a7 7 0 1 1 -14 0 a7 7 0 1 1 14 0 M-4 -10 H4 M-2 -10 V-13 H2 V-10',
  // A stocking.
  'M-2 -11.5 H7 V3.5 Q7 11.5 -1 11.5 Q-8 11.5 -8 6.5 Q-8 2.5 -2 1.5 Z M-3 -7.5 H8',
  // A candy cane, striped.
  'M3 13.5 V-5.5 Q3 -9.5 0 -9.5 Q-3 -9.5 -3 -6.5 H-7 Q-7 -13.5 0 -13.5 Q7 -13.5 7 -5.5 V13.5 Z M3 -0.5 L7 -3.5 M3 5.5 L7 2.5 M3 11.5 L7 8.5 M-3 -8.5 L0 -12.5',
  // A wreath.
  'M10 -1.5 a10 10 0 1 1 -20 0 a10 10 0 1 1 20 0 M6 -1.5 a6 6 0 1 1 -12 0 a6 6 0 1 1 12 0 M0 6.5 L-4 11.5 M0 6.5 L4 11.5',
  // A gingerbread figure.
  'M4 -9 a4 4 0 1 1 -8 0 a4 4 0 1 1 8 0 M-3 -5 H3 L10 -2 L9 1 L4 0 L6 12 L2 12 L0 5 L-2 12 L-6 12 L-4 0 L-9 1 L-10 -2 Z',
  // A pine cone.
  'M0 -12 Q-8 -4 -6 6 Q-4 12 0 13 Q4 12 6 6 Q8 -4 0 -12 Z M-5 -2 L5 2 M-6 4 L6 8 M-3 -7 L4 -4',
  // A bauble.
  'M9 3 a9 9 0 1 1 -18 0 a9 9 0 1 1 18 0 M-3 -6 V-9 H3 V-6 M0 -9 V-12 M-9 3 Q0 7 9 3',
  // A robin.
  'M-8.5 0 Q-8.5 -10 0.5 -10 Q6.5 -10 8.5 -6 L12.5 -5 L8.5 -3 Q8.5 6 -0.5 6 Q-4.5 6 -8.5 0 Z M-8.5 0 L-12.5 4 M0.5 6 V10 M3.5 6 V10',
  // The moon and a star.
  'M-0.5 -10 A10 10 0 1 0 -0.5 10 A10 10 0 0 1 -0.5 -10 Z M6.5 -6 L7.5 -3 L10.5 -3 L8 -1 L9 2 L6.5 0 L4 2 L5 -1 L2.5 -3 L5.5 -3 Z',
  // A sled, with its rope.
  'M-12 7 H8 Q12 7 12 3 Q12 0 9 0 M-8 7 V3 M5 7 V3 M-11 3 H8 V0 H-11 Z M9 0 L13 -6',
  // A mug of cocoa.
  'M-9.5 -4 H4.5 V8 Q4.5 11 1.5 11 H-6.5 Q-9.5 11 -9.5 8 Z M4.5 -1 H6.5 Q9.5 -1 9.5 3 Q9.5 6 4.5 6 M-6.5 -4 V-7 H-3.5 V-4 M-1.5 -7 q-1.5 -2 0 -4',
  // A scarf: the loop round the neck, and its two fringed ends.
  'M-11 -10.5 Q0 -4.5 11 -10.5 V-6.5 Q0 -0.5 -11 -6.5 Z M-2 -3.5 L-5 8.5 H-1 L1 -3.5 M2 -3.5 L4 7.5 H8 L5 -4.5 M-5 8.5 V10.5 M-3 8.5 V10.5 M-1 8.5 V10.5 M4 7.5 V9.5 M6 7.5 V9.5 M8 7.5 V9.5',
  // A lantern.
  'M-6 -6 H6 V9 H-6 Z M-8 -6 H8 M-8 9 H8 M-3 -6 Q0 -12 3 -6 M0 0 Q-2 3 0 5 Q2 3 0 0 Z',
  // A house in winter.
  'M-11 -0.5 L0 -10.5 L11 -0.5 M-8 -3.5 V10.5 H8 V-3.5 M-3 10.5 V3.5 H3 V10.5 M4 -6.5 V-10.5 H7 V-3.5',
  // An ice skate.
  'M-10.5 -11 H-3.5 V-1 Q3.5 -1 8.5 3 V7 H-10.5 Z M-12.5 11 H10.5 Q12.5 11 12.5 9 M-7.5 7 V11 M5.5 7 V11',
  // A star over the hills.
  'M-13 12 Q-6 3 1 12 M-3 12 Q5 4 13 12 M0 -13 L1.5 -8.5 L6 -8 L2.5 -5 L3.5 -0.5 L0 -3 L-3.5 -0.5 L-2.5 -5 L-6 -8 L-1.5 -8.5 Z M-9 -8 V-6 M-10 -7 H-8 M9 -4 V-2 M8 -3 H10',

  // Christmas Day: a gold star, shining.
  'M0 -8 L2.9 -1.3 L10.3 -1.3 L4.4 3.3 L6.5 10.6 L0 6.2 L-6.5 10.6 L-4.4 3.3 L-10.3 -1.3 L-2.9 -1.3 Z M0 -12 V-10 M11.5 -7 L10 -6 M-11.5 -7 L-10 -6 M11 12 L9.5 11 M-11 12 L-9.5 11',

  // First steps: two footprints, the right one ahead: a narrow heel, a wide ball, and the toes, the big one inside.
  'M-5.5 12 C-7.6 12 -8.6 9.6 -8.4 6.4 C-8.2 2.6 -7.4 -0.4 -4.8 -0.4 C-2.4 -0.4 -1.8 2.4 -2.2 5.8 C-2.5 9.2 -3.3 12 -5.5 12 Z M-2.3 -2.7 a1.25 1.25 0 1 1 -2.5 0 a1.25 1.25 0 1 1 2.5 0 M-5.2 -3.3 a0.9 0.9 0 1 1 -1.8 0 a0.9 0.9 0 1 1 1.8 0 M-7.2 -2.6 a0.8 0.8 0 1 1 -1.6 0 a0.8 0.8 0 1 1 1.6 0 M-8.7 -1.2 a0.7 0.7 0 1 1 -1.4 0 a0.7 0.7 0 1 1 1.4 0 M5.5 4 C7.6 4 8.6 1.6 8.4 -1.6 C8.2 -5.4 7.4 -8.4 4.8 -8.4 C2.4 -8.4 1.8 -5.6 2.2 -2.2 C2.5 1.2 3.3 4 5.5 4 Z M4.8 -10.7 a1.25 1.25 0 1 1 -2.5 0 a1.25 1.25 0 1 1 2.5 0 M7 -11.3 a0.9 0.9 0 1 1 -1.8 0 a0.9 0.9 0 1 1 1.8 0 M8.8 -10.6 a0.8 0.8 0 1 1 -1.6 0 a0.8 0.8 0 1 1 1.6 0 M10.1 -9.2 a0.7 0.7 0 1 1 -1.4 0 a0.7 0.7 0 1 1 1.4 0',

  // The stampbook's drawings (lib/stampbook).
  // A pencil, point down to the left: its lead, the sharpened wood, a facet, the ferrule and a rubber.
  'M-11 11 L-9.2 5.7 L7.2 -10.8 A2.55 2.55 0 0 1 10.8 -7.2 L-5.7 9.2 Z M-9.2 5.7 L-5.7 9.2 M5.2 -8.8 L8.8 -5.2 M-7.45 7.45 L7 -7 M-10.4 9.4 L-9.4 10.4',
  // An envelope, from the back: its flap and folds.
  'M-12 -8 H12 V9 H-12 Z M-12 -8 L0 2 L12 -8 M-12 9 L-3.5 -0.9 M12 9 L3.5 -0.9',
  // A lighthouse: a striped tower, its gallery and lamp room, a door, and the beams.
  'M-6 12 L-4 -4 H4 L6 12 Z M-6.5 -4 H6.5 M-3 -4 V-9 H3 V-4 M-4.5 -9 L0 -13 L4.5 -9 Z M-5.4 7 H5.4 M-4.7 2 H4.7 M-1.5 12 V9 H1.5 V12 M-11 12 H-6 M6 12 H11 M5.5 -7.5 L12.5 -10 M5.5 -5.5 L12.5 -3 M-5.5 -7.5 L-12.5 -10 M-5.5 -5.5 L-12.5 -3',
  // A paper boat on the water.
  'M-12 0 H12 L7 7 H-7 Z M-8 0 L0 -12 L8 0 M0 -12 V0 M-12 11 q2 -2 4 0 t4 0 t4 0 t4 0 t4 0 t4 0',
  // A typewriter: a sheet in, written on, the carriage and its knobs, the keys and the space bar.
  'M-6 -3 V-12 H6 V-3 M-3.5 -9 H3.5 M-3.5 -6 H2 M-11 -3 H11 V0 H-11 Z M-13 -1.5 H-11 M11 -1.5 H13 M-10 0 H10 L13 12 H-13 Z M-8 4.5 h0.01 M-4 4.5 h0.01 M0 4.5 h0.01 M4 4.5 h0.01 M8 4.5 h0.01 M-6 7.5 h0.01 M-2 7.5 h0.01 M2 7.5 h0.01 M6 7.5 h0.01 M-4 10 H4',
  // A desk lamp: its base, a jointed arm, the shade, the bulb and its light.
  'M-12.5 11.5 H-0.5 Q-0.5 8.5 -6.5 8.5 Q-12.5 8.5 -12.5 11.5 Z M-6.5 8.5 L-10.5 -1.5 L-2 -10 M-9.1 -1.5 a1.4 1.4 0 1 1 -2.8 0 a1.4 1.4 0 1 1 2.8 0 M-2.56 -9.44 L-0.44 -11.56 L8.4 -7.6 L1.4 -0.6 Z M6.31 -5.51 A2 2 0 0 1 3.49 -2.69 M8.5 0 L10.5 2 M5 2.1 L5.9 4.7 M9.7 -3.7 L12.1 -3.1',
  // A rain cloud, and two rows of rain.
  'M-9 1 A4 4 0 0 1 -8 -7 A6 6 0 0 1 4 -8 A5 5 0 0 1 9 1 Z M-6 4.5 L-7.5 8 M-1 4.5 L-2.5 8 M4 4.5 L2.5 8 M-3.5 10.5 L-4.3 12.5 M1.5 10.5 L0.7 12.5 M6.5 10.5 L5.7 12.5',
  // An umbrella: a scalloped canopy, its ribs, and a crook handle.
  'M-12 0 A12 11 0 0 1 12 0 Q10 -2.5 8 0 Q6 -2.5 4 0 Q2 -2.5 0 0 Q-2 -2.5 -4 0 Q-6 -2.5 -8 0 Q-10 -2.5 -12 0 Z M0 -11 V-13 M0 0 V9 Q0 12 -3 12 Q-6 12 -6 9 M0 -11 Q-5 -7 -4 0 M0 -11 Q5 -7 4 0',
  // A bicycle: two wheels, the frame, a saddle, the handlebars and a pedal.
  'M-2 4 a5 5 0 1 1 -10 0 a5 5 0 1 1 10 0 M12 4 a5 5 0 1 1 -10 0 a5 5 0 1 1 10 0 M-7 4 H0 L-2.5 -4 Z M-2.5 -4 H4.5 L0 4 M4.5 -4 L7 4 M4.5 -4 L3.5 -7.5 H7 M-5 -5 H-0.5 M-1.5 2 L1.5 6',
  // A cat, sitting: ears, eyes, nose and whiskers, and its tail round its feet.
  'M-8 -4 L-8 -12 L-4 -8.5 H0 L4 -12 L4 -4 Q4 1 -2 1 Q-8 1 -8 -4 Z M-6 0.5 Q-11 4 -10 12 H6 Q7 4 2 0.5 M6 12 Q11 12 10.5 6 M-4.6 -4.5 h0.01 M0.6 -4.5 h0.01 M-2.8 -2.2 H-1.2 L-2 -1.3 Z M-6 -2 L-11 -3 M2 -2 L7 -3',
  // A swallow, from above: swept wings and a forked tail.
  'M0 -11 Q2 -11 2 -7 Q7 -8 13 -3 Q7 -4 2 -1 L1.5 4 L5 12 L0 6 L-5 12 L-1.5 4 L-2 -1 Q-7 -4 -13 -3 Q-7 -8 -2 -7 Q-2 -11 0 -11 Z M3 -5 L9 -4 M-3 -5 L-9 -4',
  // A fish: an eye, a gill, scales and fins.
  'M-11.5 2 Q-3.5 -7 5.5 2 Q-3.5 11 -11.5 2 Z M5.5 2 L11.5 -3 V7 Z M-6.5 0.8 h0.01 M-3.5 -1.5 Q-1.5 2 -3.5 5.5 M0.5 0 q1.5 2 0 4 M-2.5 -2.4 L0.5 -6.5 L3 -1.2',
  // A tree: a round crown, a trunk branching into it, and the ground.
  'M-3 6 Q-11 7 -10 0 Q-13 -6 -6 -8 Q-4 -13 1 -12 Q7 -13 8 -7 Q13 -4 10 1 Q11 7 3 6 Z M-2 6 L-2.5 12 H2.5 L2 6 M0 6 V2 L-3 -1 M0 3 L3 0 M-9 12 H9',
  // A tulip, with two leaves.
  'M-6 -10.5 L-3 -6.5 L0 -11.5 L3 -6.5 L6 -10.5 Q7 -0.5 0 0.5 Q-7 -0.5 -6 -10.5 Z M0 0.5 V11.5 M0 8.5 Q-8 7.5 -8 -0.5 Q-2 1.5 0 8.5 M0 6.5 Q7 5.5 8 -2.5 Q2 0.5 0 6.5',
  // A mushroom: a spotted cap on its stem.
  'M-12 0 Q-12 -11 0 -11 Q12 -11 12 0 Z M-4 0 Q-5 10 -4.5 12 H4.5 Q5 10 4 0 M-4.5 -5.5 a1.6 1.6 0 1 1 -3.2 0 a1.6 1.6 0 1 1 3.2 0 M3.6 -7 a1.8 1.8 0 1 1 -3.6 0 a1.8 1.8 0 1 1 3.6 0 M9.4 -3 a1.3 1.3 0 1 1 -2.6 0 a1.3 1.3 0 1 1 2.6 0 M-10 12 H10',
  // An alarm clock: its face and hands, two bells, a hammer and feet.
  'M9 1 a9 9 0 1 1 -18 0 a9 9 0 1 1 18 0 M0 1 V-4.5 M0 1 L4 3 M0 -6 V-5.2 M7 1 H6.2 M0 8 V7.2 M-7 1 H-6.2 M-10 -6 A4 4 0 0 1 -5 -11 Z M10 -6 A4 4 0 0 0 5 -11 Z M-6 8 L-8 12 M6 8 L8 12 M0 -8 V-10 M-2 -10 H2',
  // An hourglass, running: sand above, a thread falling, a heap below.
  'M-8 -12 H8 M-8 12 H8 M-6 -12 Q-6 -3 -1 0 Q-6 3 -6 12 M6 -12 Q6 -3 1 0 Q6 3 6 12 M-3.5 -5 H3.5 L0 -1.5 Z M0 1.5 V5 M-4.5 11 Q0 6.5 4.5 11 Z',
  // A compass rose in its ring, with the half points marked.
  'M12 0 a12 12 0 1 1 -24 0 a12 12 0 1 1 24 0 M0 -10 L2.5 -2.5 L10 0 L2.5 2.5 L0 10 L-2.5 2.5 L-10 0 L-2.5 -2.5 Z M8.5 -8.5 L7.1 -7.1 M-8.5 -8.5 L-7.1 -7.1 M8.5 8.5 L7.1 7.1 M-8.5 8.5 L-7.1 7.1 M0 0 h0.01',
  // A paper plane, its folds, and the air behind it.
  'M-13 0 L12 -10 L4 10 L-1 4 Z M12 -10 L-1 4 L-2 10 L1 6.4 M-13 7 H-8 M-12 11 H-6',
  // A hot-air balloon: its gores and band, the ropes and the basket.
  'M0 -13 C8 -13 10 -6 8 -1 C6.5 3 3 5 2.5 7 H-2.5 C-3 5 -6.5 3 -8 -1 C-10 -6 -8 -13 0 -13 Z M0 -13 C-4.5 -8 -4 2 -1.5 7 M0 -13 C4.5 -8 4 2 1.5 7 M-8.8 -3 Q0 -1 8.8 -3 M-2.5 7 V9.5 M2.5 7 V9.5 M-3.5 9.5 H3.5 L3 13 H-3 Z',
  // A sailboat: hull, mast, mainsail and jib, on the water.
  'M-11 5 H11 L8 10 H-8 Z M0 5 V-13 M1.5 -12 L10 3 H1.5 Z M-1.5 -10 L-9 3 H-1.5 Z M-12 13 q2 -2 4 0 t4 0 t4 0 t4 0 t4 0 t4 0',
  // An anchor: ring, stock, shank, arms and flukes.
  'M2 -10 a2 2 0 1 1 -4 0 a2 2 0 1 1 4 0 M0 -8 V11 M-5 -5 H5 M-10 3 Q-9 11 0 11 Q9 11 10 3 M-12.5 5.5 L-10 2.5 L-7.5 5 M12.5 5.5 L10 2.5 L7.5 5',
  // A spiral shell, ribbed: half turns, each wider than the last.
  'M-2 1 A2 2 0 0 1 2 1 A4 4 0 0 1 -6 1 A6 6 0 0 1 6 1 A8 8 0 0 1 -10 1 A10 10 0 0 1 10 1 M0 -5 V-9 M4.24 -3.24 L7.07 -6.07 M-4.24 -3.24 L-7.07 -6.07 M-2 5 V9 M0.83 3.83 L3.66 6.66 M-4.83 3.83 L-7.66 6.66',
  // A bee: head, eye and feelers, a striped body, wings and sting.
  'M-6 4 a3 3 0 1 1 -6 0 a3 3 0 1 1 6 0 M-6 4 Q-6 -1 2 -1 Q10 -1 11 4 Q10 9 2 9 Q-6 9 -6 4 Z M0 -0.8 V8.8 M4.5 -0.4 V8.4 M11 4 H13 M-1 -1 Q-6 -10 0 -10 Q3 -10 2 -1 M3 -1 Q4 -9 9 -8 Q12 -6 5 -0.5 M-10 1 Q-11 -3 -13 -4 M-8.5 1 Q-8 -3 -6 -4 M-10 3.5 h0.01',
  // A butterfly: body and feelers, four wings, and their spots.
  'M0 -4.5 V9.5 M0 -5.5 Q-1 -9.5 -4 -10.5 M0 -5.5 Q1 -9.5 4 -10.5 M-0.5 -1.5 C-3 -9.5 -12 -10.5 -12 -4.5 C-12 0.5 -5 1.5 -0.5 1.5 Z M0.5 -1.5 C3 -9.5 12 -10.5 12 -4.5 C12 0.5 5 1.5 0.5 1.5 Z M-0.5 2.5 C-6 2.5 -10 5.5 -8 9.5 C-6 12.5 -2 9.5 -0.5 5.5 Z M0.5 2.5 C6 2.5 10 5.5 8 9.5 C6 12.5 2 9.5 0.5 5.5 Z M-7 -4.5 h0.01 M7 -4.5 h0.01 M-5 6.5 h0.01 M5 6.5 h0.01',
  // An apple: its stalk, a leaf, and the light on it.
  'M0 -5 C-4 -8 -11 -7 -11 1 C-11 8 -5 12 -2 11 Q0 10 2 11 C5 12 11 8 11 1 C11 -7 4 -8 0 -5 Z M0 -5 Q0 -9 2 -11 M1 -8 Q5 -12 8 -10 Q5 -7 1 -8 Z M-7 -1 Q-7 -4 -4.5 -4.5',
  // A pair of glasses: two lenses catching the light, the bridge and the arms.
  'M11 0 a5 5 0 1 1 -10 0 a5 5 0 1 1 10 0 M-1 0 a5 5 0 1 1 -10 0 a5 5 0 1 1 10 0 M-1 -1 Q0 -2.5 1 -1 M-11 -1.5 L-13 -5 M11 -1.5 L13 -5 M-8.5 -2 Q-8 -3.4 -6.6 -3.8 M3.5 -2 Q4 -3.4 5.4 -3.8',
  // A stack of three books, spines and titles.
  'M-11 3 H9 V9 H-11 Z M-9 -3 H11 V3 H-9 Z M-10 -9 H8 V-3 H-10 Z M-8 3 V9 M8 -3 V3 M-7 -9 V-3 M-5 6 H4 M-4 0 H6 M-4 -6 H4',
  // A camera: body, lens, viewfinder, flash and shutter button.
  'M-10 -5 H10 Q12 -5 12 -3 V8 Q12 10 10 10 H-10 Q-12 10 -12 8 V-3 Q-12 -5 -10 -5 Z M-5 -5 L-3 -9 H3 L5 -5 M6 2.5 a6 6 0 1 1 -12 0 a6 6 0 1 1 12 0 M3 2.5 a3 3 0 1 1 -6 0 a3 3 0 1 1 6 0 M8 -2.5 H10 M-10 -7 H-7 V-5',
  // A wax seal: the wax spread in bumps round its edge, a ring, and an N.
  seal(),
  // A kite: its spars, and a tail with bows.
  'M0 -14 L8 -5 L0 4 L-8 -5 Z M0 -14 V4 M-8 -5 H8 M0 4 Q-4 7 0 9 Q4 11 1 13 M-3.5 5.5 L-0.8 7.5 M-3.5 7.5 L-0.8 5.5 M1.2 9.6 L3.8 11.4 M1.2 11.4 L3.8 9.6',
  // An owl: ear tufts, round eyes, a beak and a feathered breast.
  'M-8 12 Q-11 0 -8 -7 L-9 -12 L-4 -9 Q0 -10 4 -9 L9 -12 L8 -7 Q11 0 8 12 Z M-0.8 -3 a3 3 0 1 1 -6 0 a3 3 0 1 1 6 0 M6.8 -3 a3 3 0 1 1 -6 0 a3 3 0 1 1 6 0 M-3.8 -3 h0.01 M3.8 -3 h0.01 M-1 0.5 L0 3 L1 0.5 M-3 6 q1.5 1.5 3 0 q1.5 1.5 3 0 M-1.5 9 q1.5 1.5 3 0',
  // A snail: a spiral shell on its back, its foot, and its feelers up.
  'M1 -2 A1.5 1.5 0 0 1 4 -2 A3 3 0 0 1 -2 -2 A4.5 4.5 0 0 1 7 -2 A6 6 0 0 1 -5 -2 A7.5 7.5 0 0 1 10 -2 L10.5 4 M-6 4 Q-9 0 -10.5 0 Q-12 0 -11.5 4 Q-11 8 -7 8 H11 Q14 8 12 5 L9 4 Z M-11 0 L-12.5 -6 M-9.5 0 L-8 -6',
  // A cactus in a pot, with two arms.
  'M-3 7 V-9 Q-3 -12 0 -12 Q3 -12 3 -9 V7 M-3 1 H-6 Q-8 1 -8 -1 V-5 Q-8 -7 -6.5 -7 Q-5 -7 -5 -5 V-1 H-3 M3 -2 H5 V-5 Q5 -7 6.5 -7 Q8 -7 8 -5 V-2 Q8 2 5 2 H3 M0 -9 V5 M-7 7 H7 L6 13 H-6 Z',
  // A whale, spouting: its eye, mouth, belly and tail.
  'M-12.5 3.5 Q-12.5 -4.5 -3.5 -4.5 Q5.5 -4.5 7.5 2.5 L11.5 -2.5 Q10.5 1.5 10 3 Q11.5 4.5 12.5 7.5 L7.5 5.5 Q3.5 10.5 -4.5 9.5 Q-12.5 9.5 -12.5 3.5 Z M-5.5 -5.5 V-9.5 M-5.5 -8 Q-7.5 -10.5 -9.5 -10 M-5.5 -8 Q-3.5 -10.5 -1.5 -10 M-8.5 1.5 h0.01 M-12.5 5 Q-8.5 6 -4.5 4.5 M-8.5 7.5 Q-4.5 8.5 -0.5 8',
  // A ringed planet, tilted, and stars.
  'M7 0 a7 7 0 1 1 -14 0 a7 7 0 1 1 14 0 M-12.56 3.36 A13 4 -15 0 1 12.56 -3.36 A13 4 -15 0 1 -12.56 3.36 M-10 -9 h0.01 M10 8 h0.01 M11 -10 h0.01 M-11 9 h0.01',
  // An acorn: a scaled cup, its stalk, and the nut.
  'M-8 -2 Q-8 -9 0 -9 Q8 -9 8 -2 Z M0 -9 Q0 -12 2 -13 M-6.5 -2 Q-7 7 0 12 Q7 7 6.5 -2 M-5 -2.5 L-3 -7.5 M-1 -2.5 L1 -8.5 M3 -2.5 L5 -7 M-3.5 1 Q-3.5 5 -1.5 7.5',
  // A seedling in a pot: two leaves, their veins.
  'M-6 4 H6 L5 11 H-5 Z M-7 2 H7 V4 H-7 Z M0 2 V-4 M0 -4 Q-9 -4 -10 -11 Q-2 -12 0 -4 Z M0 -1 Q8 -1 10 -7 Q2 -8 0 -1 Z M-2 -6 L-7 -9.5 M2 -3 L7 -6',

  // Each legendary and mythic stamp's own.
  // A laurel wreath, tied with a bow.
  laurel(),
  // A crown: five points, a jewel on each of three, a band set with stones.
  'M-11 7 L-12 -4 L-6 2 L0 -8 L6 2 L12 -4 L11 7 Z M-11 7 H11 V11 H-11 Z M-10.6 -5.8 a1.4 1.4 0 1 1 -2.8 0 a1.4 1.4 0 1 1 2.8 0 M1.4 -9.8 a1.4 1.4 0 1 1 -2.8 0 a1.4 1.4 0 1 1 2.8 0 M13.4 -5.8 a1.4 1.4 0 1 1 -2.8 0 a1.4 1.4 0 1 1 2.8 0 M-6 9 h0.01 M0 9 h0.01 M6 9 h0.01 M0 -2 L1.8 1 L0 4 L-1.8 1 Z',
  // A trophy: a cup with a star on it, two handles, a stem and a stepped base.
  'M-8 -12 H8 V-6 Q8 3 0 3 Q-8 3 -8 -6 Z M-8 -9 H-11 Q-12 -9 -12 -7 Q-12 -2 -6.5 -0.5 M8 -9 H11 Q12 -9 12 -7 Q12 -2 6.5 -0.5 M-1.5 3 V7 M1.5 3 V7 M-5 7 H5 V9 H-5 Z M-7 9 H7 V12 H-7 Z M0 -9.5 L1 -7 L3.5 -6.8 L1.6 -5.2 L2.2 -2.8 L0 -4.1 L-2.2 -2.8 L-1.6 -5.2 L-3.5 -6.8 L-1 -7 Z',
  // A tall ship: two masts under full sail, pennants, portholes, and the sea.
  'M-13 3 H13 L10 9 H-10 Z M-5 3 V-14 M5 3 V-14 M-8.5 -10.5 Q-5 -9 -1.5 -10.5 L-1 -6.5 Q-5 -5 -9 -6.5 Z M-9.5 -4.5 Q-5 -3 -0.5 -4.5 L0 1 Q-5 2.5 -10 1 Z M1.5 -10.5 Q5 -9 8.5 -10.5 L9 -6.5 Q5 -5 1 -6.5 Z M0.5 -4.5 Q5 -3 9.5 -4.5 L10 1 Q5 2.5 0 1 Z M5 -14 L8.5 -13.2 L5 -12.4 M-5 -14 L-8.5 -13.2 L-5 -12.4 M-7 6 h0.01 M-3 6 h0.01 M1 6 h0.01 M5 6 h0.01 M-13 12 q2 -2 4 0 t4 0 t4 0 t4 0 t4 0 t4 0',
  // A treasure chest: a domed lid, iron bands, a lock, and a glint.
  'M-9.5 -0.5 V-4.5 Q-9.5 -10.5 1.5 -10.5 Q12.5 -10.5 12.5 -4.5 V-0.5 Z M-9.5 -0.5 H12.5 V12.5 H-9.5 Z M-5.5 -9.5 V12.5 M8.5 -9.5 V12.5 M-1 -2.5 H4 V3.5 H-1 Z M1.5 0 V1.5 M-9.5 5.5 H-5.5 M8.5 5.5 H12.5 M-9.5 -12.5 l0.7 1.8 l1.8 0.7 l-1.8 0.7 l-0.7 1.8 l-0.7 -1.8 l-1.8 -0.7 l1.8 -0.7 Z',
  // A castle: two towers and a keep, battlements, a gate, windows and a flag.
  'M-12 13 V-7 H-10 V-5 H-8 V-7 H-6 V-1 H-3 V-11 H-1 V-9 H1 V-11 H3 V-1 H6 V-7 H8 V-5 H10 V-7 H12 V13 Z M-3 13 V7 Q0 3 3 7 V13 M-9 -1 V2 M9 -1 V2 M0 -6 V-3 M0 -11 V-14 L3.5 -13 L0 -12',
  // A phoenix: wings raised, a crested head, and a tail of flame.
  'M0 -6 Q2.5 -3 2 2 Q1 5 0 6 Q-1 5 -2 2 Q-2.5 -3 0 -6 Z M1.8 -8 a1.8 1.8 0 1 1 -3.6 0 a1.8 1.8 0 1 1 3.6 0 M1.6 -8.7 L4 -8 L1.6 -7.3 M-0.6 -9.6 Q-1.6 -12 -3.6 -12.4 M0.2 -9.8 Q0.4 -12.6 -1 -14 M-1.5 -3 C-4 -8 -8 -11 -12 -13 C-11.5 -10 -12.5 -8.5 -13 -7.5 C-11.5 -7 -11.5 -5.5 -12.5 -3.5 C-10.5 -3.5 -10 -2 -10.5 -0.5 C-7.5 -1 -4 -0.5 -1.5 0 M-3 -2.5 L-10.5 -10 M-3 -1.5 L-11 -6 M-3 -0.7 L-9.5 -2.2 M1.5 -3 C4 -8 8 -11 12 -13 C11.5 -10 12.5 -8.5 13 -7.5 C11.5 -7 11.5 -5.5 12.5 -3.5 C10.5 -3.5 10 -2 10.5 -0.5 C7.5 -1 4 -0.5 1.5 0 M3 -2.5 L10.5 -10 M3 -1.5 L11 -6 M3 -0.7 L9.5 -2.2 M0 6 C-2 8 -5 9 -6 13 C-4 11.5 -2.5 11.5 -1.5 13 C-1 11 0 10 0 9 C0 10 1 11 1.5 13 C2.5 11.5 4 11.5 6 13 C5 9 2 8 0 6',
  // A unicorn's head: the twisted horn, an ear, eye and nostril, and a flowing mane.
  'M6 13.5 Q4 5.5 0 1.5 L-7 4.5 Q-10 6 -11.5 4 Q-13 1.5 -11 -0.5 L-4 -6.5 Q-2 -8.5 0 -8.5 Q7 -7.5 8 1.5 Q9 8.5 11 13.5 M-3.5 -8 L-8 -13.5 L-1.5 -9.3 M0 -8.5 L0.5 -12.5 L2.5 -8.1 M2 -8.1 Q7 -11.5 8.5 -6.5 Q11.5 -4.5 10 -0.5 Q12.5 2.5 11 5.5 Q13 8.5 11.5 11.5 M-5 -2.5 h0.01 M-10.3 2.1 h0.01 M-5.3 -10.5 L-4 -9.9 M-6.6 -11.9 L-5.4 -11.3',
  // A comet: a bright head, its long tail, and stars.
  'M10.5 -7 a3.5 3.5 0 1 1 -7 0 a3.5 3.5 0 1 1 7 0 M4.5 -9.5 Q-3 -5 -13 6 M4 -5 Q-2 1 -9 12 M3.6 -7.3 Q-4 -2 -12 10 M-7 -11 l0.6 1.6 l1.6 0.6 l-1.6 0.6 l-0.6 1.6 l-0.6 -1.6 l-1.6 -0.6 l1.6 -0.6 Z M9 5 l0.6 1.6 l1.6 0.6 l-1.6 0.6 l-0.6 1.6 l-0.6 -1.6 l-1.6 -0.6 l1.6 -0.6 Z M-1 -12 h0.01 M12 1 h0.01',
  // A winged nib: Nib's own nib, with a wing either side.
  'M0 9.5 L-4.5 1 Q-4.5 -3.5 -2.6 -7.5 H2.6 Q4.5 -3.5 4.5 1 Z M0 9.5 V1.5 M1.2 -0.5 a1.2 1.2 0 1 1 -2.4 0 a1.2 1.2 0 1 1 2.4 0 M-4.2 -3 Q-7 -9 -13 -10 Q-11 -8 -13 -6 Q-10 -5.5 -12.5 -2.5 Q-9 -2.5 -10.5 0.5 Q-7 0 -4.5 1 M-5 -2 L-10.5 -7.5 M-5 -0.5 L-10 -4 M4.2 -3 Q7 -9 13 -10 Q11 -8 13 -6 Q10 -5.5 12.5 -2.5 Q9 -2.5 10.5 0.5 Q7 0 4.5 1 M5 -2 L10.5 -7.5 M5 -0.5 L10 -4',

  // The holidays' (lib/holidays), and Nib's birthday.
  fireworks(),
  dove(),
  // A heart, an arrow through it.
  'M0 9 C-6 4 -11 1 -11 -4 C-11 -8 -8 -10 -5.5 -10 C-3 -10 -1 -8.5 0 -6.5 C1 -8.5 3 -10 5.5 -10 C8 -10 11 -8 11 -4 C11 1 6 4 0 9 Z M-13 8 L13 -9 M13 -9 L9 -8.5 M13 -9 L12 -5 M-13 8 L-12.6 11.2 M-13 8 L-9.8 8.4 M-11.3 6.9 L-10.9 10.1 M-11.3 6.9 L-8.1 7.3',
  // A hall with columns: a pediment and its flag, six columns, and steps.
  'M-12 -4 L0 -11 L12 -4 Z M-12 -4 H12 V-2 H-12 Z M-9 -2 V9 M-5.4 -2 V9 M-1.8 -2 V9 M1.8 -2 V9 M5.4 -2 V9 M9 -2 V9 M-12 9 H12 V11 H-12 Z M-13 11 H13 V13 H-13 Z M0 -11 V-14 L3 -13 L0 -12',
  shamrock(),
  // A painted egg: a zigzag band, a wavy one, and dots.
  'M0 -12 C6 -12 9 -2 9 3 C9 9 5 12 0 12 C-5 12 -9 9 -9 3 C-9 -2 -6 -12 0 -12 Z M-8.4 -1 L-6 -3.5 L-3 -1 L0 -3.5 L3 -1 L6 -3.5 L8.4 -1 M-9 5 Q-6 3 -3 5 T3 5 T9 5 M-3 -7.5 h0.01 M3 -7.5 h0.01 M0 -9.5 h0.01 M-4 9 h0.01 M0 9.5 h0.01 M4 9 h0.01',
  bouquet(),
  poppy(),
  // A necktie under a shirt collar, striped.
  'M-2.5 -12 H2.5 L1.8 -8 H-1.8 Z M-1.8 -8 L-4.5 7 L0 12 L4.5 7 L1.8 -8 M-2.5 -12 L-7.5 -13 L-5.5 -7.5 L-2 -10.5 M2.5 -12 L7.5 -13 L5.5 -7.5 L2 -10.5 M-2.3 -4.2 L2.5 -6.4 M-3.1 0.3 L3.3 -2.6 M-3.9 4.8 L4.1 1.4',
  juneteenth(),
  // A flag on its pole, waving: the canton with its stars, and stripes.
  'M-12 -13.5 V13 M-11 -11 Q-5 -14 0 -11 Q5 -8 11 -11 V3 Q5 6 0 3 Q-5 0 -11 3 Z M-11 -4 Q-6.5 -6.7 -2 -4.94 V-11.94 M-2 -8.44 Q-1 -8 0 -7.5 Q5 -4.5 11 -7.5 M-2 -4.94 Q-1 -4.5 0 -4 Q5 -1 11 -4 M-11 -0.5 Q-5 -3.5 0 -0.5 Q5 2.5 11 -0.5 M-8.6 -9 h0.01 M-5 -9.6 h0.01 M-7 -6.8 h0.01 M-3.8 -7.3 h0.01',
  // A hard hat: its dome, a ridge over it, and the brim.
  'M-10 5 Q-10 -8 0 -8 Q10 -8 10 5 Z M-13 5 H13 Q13 8 10 8 H-10 Q-13 8 -13 5 Z M-2 -7.8 Q-2.6 -1 -2 5 M2 -7.8 Q2.6 -1 2 5',
  // A globe: its lines of latitude and longitude, on a stand.
  'M10 -2.5 a9 9 0 1 1 -18 0 a9 9 0 1 1 18 0 M1 -11.5 A4.5 9 0 0 0 1 6.5 A4.5 9 0 0 0 1 -11.5 M1 -11.5 V6.5 M-8 -2.5 H10 M-6.8 -7 H8.8 M-6.8 2 H8.8 M-10 -2.5 A11 11 0 0 0 8.8 5.3 M1 8.5 V10.5 M-4 11.5 H6',
  // A jack-o'-lantern: its stem, ribs, three-cornered eyes and a toothy grin.
  'M0 -6 C-5 -8 -12 -6 -12 2 C-12 9 -6 12 0 11 C6 12 12 9 12 2 C12 -6 5 -8 0 -6 Z M-1 -6 Q-1 -10 2 -11 L3 -9.5 Q1 -9 1 -6 M-7 -6.5 Q-10 2 -7 10.5 M7 -6.5 Q10 2 7 10.5 M-6.5 0 L-4.5 -3.5 L-2.5 0 Z M2.5 0 L4.5 -3.5 L6.5 0 Z M-6.5 3.5 Q0 9.5 6.5 3.5 L4 4.6 L3 6.4 L1.5 5.2 L0 6.8 L-1.5 5.2 L-3 6.4 L-4 4.6 Z',
  medal(),
  turkey(),
  cake(),

  // Added with the stampbook's 300 (lib/stampbook): drawings for every day, then the new legendary and mythic stamps' own, then the keepsakes'.
  // A spiral notebook: its rings, and lines written.
  'M-8 -12 H10 Q11 -12 11 -11 V11 Q11 12 10 12 H-8 Z M-11 -8 H-5 M-11 -3 H-5 M-11 2 H-5 M-11 7 H-5 M-1.5 -6 H7 M-1.5 -1.5 H7 M-1.5 3 H4.5',
  // A paperclip, its wire turned three times.
  'M2 -4 V6 A2.5 2.5 0 0 1 -3 6 V-9 A4 4 0 0 1 5 -9 V8 A5.5 5.5 0 0 1 -6 8 V-3',
  // A pair of scissors, open: two finger loops, the blades crossing at the pivot.
  scissors(),
  // A teapot: its lid and knob, the spout, the handle and a band.
  'M-7 -4 C-10 -1 -9.5 7 -5 7.5 H5 C9.5 7 10 -1 7 -4 Z M-6.2 -4 Q0 -10.5 6.2 -4 M1.2 -8.6 a1.2 1.2 0 1 1 -2.4 0 a1.2 1.2 0 1 1 2.4 0 M-8.6 0 Q-11.5 -1 -13 -6.5 Q-10.5 -5.5 -8.4 -3.2 M8.3 -2 Q13 -3 12.5 1.5 Q12 5 7.6 5.2 M-8.8 2 H8.8 M-7 10 H7',
  // A light bulb, lit: its glass, the filament, the screw cap and the light.
  'M-4 7 C-4 4.5 -5 3.5 -6.5 2 C-10 -2 -9.5 -11 0 -11 C9.5 -11 10 -2 6.5 2 C5 3.5 4 4.5 4 7 Z M-4 7 H4 M-4 9.4 H4 M-3 11.6 H3 M-1.4 13.4 H1.4 M-2 7 V1 L-1 -2 L0 1 L1 -2 L2 1 V7 M-11.5 -3 H-13.5 M11.5 -3 H13.5 M-9.6 -10.6 L-11.2 -12.2 M9.6 -10.6 L11.2 -12.2',
  // A magnifying glass: the lens catching the light, and its handle.
  `${circle(7, -4.5, -4.5)} M-9.1 -5.1 A4.6 4.6 0 0 1 -5.1 -9.1 M0.45 0.45 L2.5 2.5 M3.77 1.23 L11.27 8.73 A1.8 1.8 0 0 1 8.73 11.27 L1.23 3.77 Z`,
  // A folded map: three panels, a way marked in dots, and a cross.
  'M-12 -9 L-4 -12 L4 -9 L12 -12 V9 L4 12 L-4 9 L-12 12 Z M-4 -12 V9 M4 -9 V12 M-9 6 h0.01 M-7 3.2 h0.01 M-4.5 1.6 h0.01 M-1.5 2.5 h0.01 M1.4 3 h0.01 M4 1.2 h0.01 M6.2 -1 h0.01 M7 -6.5 L10 -3.5 M10 -6.5 L7 -3.5',
  // A ticket: notched sides, a tear line, what it’s for, and a star.
  `M-12 -7 H12 V-2.5 A2.5 2.5 0 0 0 12 2.5 V7 H-12 V2.5 A2.5 2.5 0 0 0 -12 -2.5 Z M5 -5 h0.01 M5 -2.5 h0.01 M5 0 h0.01 M5 2.5 h0.01 M5 5 h0.01 M-8 -2.5 H1.5 M-8 1 H-1 M-8 4 H0.5 ${star(5, 2.3, 1, 8.6, 0)}`,
  // A rose: the bloom furled at its heart, two leaves and a thorn or two.
  `M-6 -9 C-7 -4 -3 -2 0 -2 C3 -2 7 -4 6 -9 C4 -7.4 2 -7.2 0 -8 C-2 -7.2 -4 -7.4 -6 -9 Z M-5.2 -8.4 C-5.6 -13 -1 -13.8 0 -11.2 C1 -13.8 5.6 -13 5.2 -8.4 M-2 -8.6 C-2.2 -11 2.2 -11 2 -8.8 C1.8 -7.6 0 -7.6 -0.4 -8.8 M0 -2 V13 ${leaf(0, 6, -Math.PI * 0.82, 7.5, 2.6)} ${leaf(0, 2.5, -Math.PI * 0.2, 6.5, 2.4)} M0 9.5 L-1.8 8.5 M0 -0.2 L1.6 -1.2`,
  // A rainbow, three bands, from cloud to cloud.
  'M-12 3.5 A12 12 0 0 1 12 3.5 M-8.5 3.5 A8.5 8.5 0 0 1 8.5 3.5 M-5 3.5 A5 5 0 0 1 5 3.5 M-13.5 8.5 Q-14 5.5 -11.5 5.5 Q-11 3 -8.2 3.9 Q-5.8 3.7 -5.8 6.1 Q-4.4 6.9 -5.2 8.5 Z M13.5 8.5 Q14 5.5 11.5 5.5 Q11 3 8.2 3.9 Q5.8 3.7 5.8 6.1 Q4.4 6.9 5.2 8.5 Z',
  // An armchair: a buttoned back, rolled arms, the cushion and its legs.
  'M-8 -1 V-9 Q-8 -12 -5 -12 H5 Q8 -12 8 -9 V-1 M-12 7 V-1 Q-12 -4 -10 -4 Q-8 -4 -8 -1 V7 Z M12 7 V-1 Q12 -4 10 -4 Q8 -4 8 -1 V7 Z M-8 2 Q0 0 8 2 V7 H-8 Z M-12 7 H12 V9 H-12 Z M-10.5 9 V12 M10.5 9 V12 M-3 -7.5 h0.01 M3 -7.5 h0.01 M0 -4.5 h0.01',
  // A fountain pen: the cap posted on the end, its clip, the grip and the nib.
  'M-4 -11.5 Q-4 -13.5 -1 -13.5 Q2 -13.5 2 -11.5 V-1.5 H-4 Z M2 -12 H3.8 V-3.5 Q3.8 -2.2 2.6 -2.2 M-4 -1.5 H2 V3 H-4 Z M-4 3 L-3.2 6.5 H1.2 L2 3 M-3.2 6.5 L-1 13 L1.2 6.5 M-1 13 V9.6 M-1 8.6 h0.01',
  // A telescope on its tripod, pointed at a star.
  telescope(),
  // A scroll on its two rollers, written, with a seal.
  'M-10 -13 H10 A2 2 0 0 1 10 -9 H-10 A2 2 0 0 1 -10 -13 Z M-8 -9 V9 M8 -9 V9 M-10 9 H10 A2 2 0 0 1 10 13 H-10 A2 2 0 0 1 -10 9 Z M-5 -5.5 H5 M-5 -2 H5 M-5 1.5 H3 M-5 5 H0 M5.2 5 a1.8 1.8 0 1 1 -3.6 0 a1.8 1.8 0 1 1 3.6 0',
  // A printing press: its frame, the screw and its bar, the platen, and a sheet on the bed.
  `M-11 -13 H11 V-10 H-11 Z M-9 -10 V12.5 M9 -10 V12.5 M-12.5 12.5 H12.5 M-1.2 -10 V-3 M1.2 -10 V-3 M-1.2 -8.6 L1.2 -7.6 M-1.2 -6.4 L1.2 -5.4 M1.2 -6.6 L12.2 -3.6 ${circle(1.3, 12.6, -3.5)} M-6 -3 H6 V-0.5 H-6 Z M-9 5 H9 V8 H-9 Z M-5 5 L-4.2 2.4 H4.2 L5 5 M-2.4 3.7 H2.4`,
  // A harp: its pillar, the curved neck, the soundboard and its strings.
  'M-9 12 Q-10.5 0 -8 -10 M-8 -10 Q-5 -14 -1 -10 Q4 -5 9 -8.5 Q11 -10 10 -11.5 M-7.6 12.4 L10 -9 M-5.4 12.8 L10.8 -7.2 M-11.5 12.5 H-4 M-5.6 -11.6 V9.8 M-2.6 -10.6 V6.3 M0.4 -8.2 V2.6 M3.4 -6.3 V-1.1 M-8 -10 h0.01',
  // A dragon: horned head, jaws open, its long neck, and a bat’s wing.
  `M-2 -4 Q0 -10 6 -9.5 L12.6 -6.4 Q13.4 -5.2 12.2 -4.4 L7.4 -3.8 L11.4 -1.4 Q11.4 0.4 9.4 0.6 Q4.4 0.8 1.2 1.4 Q-1.6 6 2 13 M-2 -4 Q-6 2 -5 13 M0.6 -8.6 Q-1.6 -13 -6.4 -13.6 Q-3.2 -11.4 -2.2 -6.8 M3 -9.6 Q2.6 -13.6 -0.6 -14 Q1 -12 0.8 -9.2 M5 -6.6 h0.01 M10.6 -6.2 h0.01 M-4 0.5 L-13 -9 Q-11.4 -6 -12.6 -3.4 Q-10 -3.6 -9.8 -0.6 Q-7.4 -1.2 -6.6 1.8 Q-5.6 2 -4.6 3 M-4 0.5 L-12.6 -3.4 M-4 0.5 L-9.8 -0.6`,
  // A kraken: its great head and eyes, and the arms curling.
  `M-6.5 -1 Q-8.5 -13 0 -13 Q8.5 -13 6.5 -1 Z ${circle(1.5, -2.8, -5.5)} ${circle(1.5, 2.8, -5.5)} M-2.8 -5.5 h0.01 M2.8 -5.5 h0.01 M-6.5 -1 Q-12.5 0 -12.5 5 Q-12.5 8.6 -9.6 8 Q-8 7.4 -9 5.8 M-4 0 Q-7.6 6 -5.4 10.4 Q-3.8 12.8 -2.2 11 M-1.2 0.4 Q-1.6 7 0 13 M1.2 0.4 Q3 6.4 1.8 9.6 Q1 11.6 2.8 11.8 M4 0 Q7.6 6 5.4 10.4 Q3.8 12.8 2.2 11 M6.5 -1 Q12.5 0 12.5 5 Q12.5 8.6 9.6 8 Q8 7.4 9 5.8`,
  // A book with a bookmark: its spine, the pages’ edge, a title and the ribbon out of the top.
  'M-9 -9 H8 V13 H-9 Q-11 13 -11 11 V-7 Q-11 -9 -9 -9 Z M-7.5 -9 V13 M8 -9 L10.5 -7.5 V11.5 L8 13 M2.5 -9 V-13.5 L4.5 -11.6 L6.5 -13.5 V-9 M-3.5 -4.5 H4.5 M-3.5 -1 H2.5 M-1.6 6 L0 4 L1.6 6 L0 8 Z',
  // A frog in mid-leap, from above: its eyes, and its legs flung out.
  `M0 -11 C4 -11 6 -8 5.5 -4 C5 1 4.5 5 0 6 C-4.5 5 -5 1 -5.5 -4 C-6 -8 -4 -11 0 -11 Z ${circle(1.8, -3.3, -9.4)} ${circle(1.8, 3.3, -9.4)} M-5.4 -4.5 L-9 -7 L-9.6 -11 M-9.6 -11 L-11.4 -11.6 M-9.6 -11 L-9.4 -13 M-9.6 -11 L-11.2 -9.6 M5.4 -4.5 L9 -7 L9.6 -11 M9.6 -11 L11.4 -11.6 M9.6 -11 L9.4 -13 M9.6 -11 L11.2 -9.6 M-4.2 4 L-7.6 8.4 L-8.6 12.2 M-8.6 12.2 L-10.8 11.6 M-8.6 12.2 L-6.8 12.6 M-8.6 12.2 L-9.8 10.2 M4.2 4 L7.6 8.4 L8.6 12.2 M8.6 12.2 L10.8 11.6 M8.6 12.2 L6.8 12.6 M8.6 12.2 L9.8 10.2 M-2 -6 Q0 -4.8 2 -6`,
  // A clock at midnight: both hands at twelve, and sparkles.
  clockAtMidnight(),
  // A tree stump: its rings, a crack, the bark and the roots.
  'M-10 -5 A10 4.5 0 1 1 10 -5 A10 4.5 0 1 1 -10 -5 M-6.5 -5 A6.5 2.8 0 1 1 6.5 -5 A6.5 2.8 0 1 1 -6.5 -5 M-3.2 -5 A3.2 1.3 0 1 1 3.2 -5 A3.2 1.3 0 1 1 -3.2 -5 M-10 -5 V5 Q-10.5 8 -13 9.5 M10 -5 V5 Q10.5 8 13 9.5 M-13 9.5 Q-6 8 -4 10 Q0 8 4 10 Q6 8 13 9.5 M-6 1 V6 M-1 2 V7.5 M5 1.5 V6.5 M0 -5 L2.5 -3.6',
  // A rosette: a ruffled ring round a star, and two ribbon tails.
  rosette(),
  // Inkwell (components/Buddy), its keepsake's: the nib of the app icon, with its two eyes and smile above the breather hole, the slit and the collar.
  'M0 -12.5 C2 -8 5 -4.5 8 -1 C6 2 4.8 5 4 9 H-4 C-4.8 5 -6 2 -8 -1 C-5 -4.5 -2 -8 0 -12.5 Z M-5.5 9.5 H5.5 V12.5 H-5.5 Z M1.4 1.5 a1.4 1.4 0 1 1 -2.8 0 a1.4 1.4 0 1 1 2.8 0 M0 2.9 V9 M-2.3 -5.2 h0.01 M2.3 -5.2 h0.01 M-1.7 -2.9 Q0 -1.6 1.7 -2.9',
]

/** A number as a path has it. */
function n(value: number): string {
  return value.toFixed(2)
}

/** A point `r` from (cx, cy) at `angle` radians, as a path's numbers. */
function at(r: number, angle: number, cx = 0, cy = 0): string {
  return `${n(cx + r * Math.cos(angle))} ${n(cy + r * Math.sin(angle))}`
}

/** A leaf, petal or feather from (x, y), `length` long toward `angle`, its sides bowed out `width`. */
function leaf(x: number, y: number, angle: number, length: number, width = 2.2): string {
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)]
  const [mx, my] = [x + (ux * length) / 2, y + (uy * length) / 2]
  return `M${n(x)} ${n(y)} Q${n(mx - uy * width)} ${n(my + ux * width)} ${n(x + ux * length)} ${n(y + uy * length)} Q${n(mx + uy * width)} ${n(my - ux * width)} ${n(x)} ${n(y)}`
}

/** A ring of `count` bumps round (cx, cy), dipping to `r` between them: a wax seal's edge, or a flower's petals. */
function bumps(count: number, r: number, peak: number, cx = 0, cy = 0): string {
  const turn = (i: number) => (i / count) * Math.PI * 2 - Math.PI / 2
  const edge = Array.from({ length: count }, (_, i) => `Q${at(peak, turn(i + 0.5), cx, cy)} ${at(r, turn(i + 1), cx, cy)}`).join(' ')
  return `M${at(r, turn(0), cx, cy)} ${edge} Z`
}

/** A star of `points`, its tips `outer` from (cx, cy) and its notches `inner`, one tip up. */
function star(points: number, outer: number, inner: number, cx = 0, cy = 0): string {
  const corners = Array.from({ length: points * 2 }, (_, i) => at(i % 2 ? inner : outer, (i / points) * Math.PI - Math.PI / 2, cx, cy))
  return `M${corners.join(' L')} Z`
}

/** A firework's burst: `count` rays from `r0` to `r1` round (cx, cy), with a spark past each. */
function burst(count: number, r0: number, r1: number, cx: number, cy: number, sparks = true): string {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2
    return `M${at(r0, angle, cx, cy)} L${at(r1, angle, cx, cy)}${sparks ? ` M${at(r1 + 1.8, angle, cx, cy)} h0.01` : ''}`
  }).join(' ')
}

/** A circle, as a path. */
function circle(r: number, cx = 0, cy = 0): string {
  return `M${n(cx + r)} ${n(cy)} a${r} ${r} 0 1 1 ${-2 * r} 0 a${r} ${r} 0 1 1 ${2 * r} 0`
}

/** A bar from (x0, y0) to (x1, y1), `width` across: a rectangle turned along it. */
function bar(x0: number, y0: number, x1: number, y1: number, width: number): string {
  const length = Math.hypot(x1 - x0, y1 - y0)
  const [px, py] = [(-(y1 - y0) / length) * (width / 2), ((x1 - x0) / length) * (width / 2)]
  return `M${n(x0 + px)} ${n(y0 + py)} L${n(x1 + px)} ${n(y1 + py)} L${n(x1 - px)} ${n(y1 - py)} L${n(x0 - px)} ${n(y0 - py)} Z`
}

/** A four-pointed sparkle at (x, y). */
function sparkle(x: number, y: number, r = 1.6): string {
  const [long, short] = [r * 1.4, r * 0.35]
  return `M${n(x)} ${n(y - long)} L${n(x + short)} ${n(y - short)} L${n(x + long)} ${n(y)} L${n(x + short)} ${n(y + short)} L${n(x)} ${n(y + long)} L${n(x - short)} ${n(y + short)} L${n(x - long)} ${n(y)} L${n(x - short)} ${n(y - short)} Z`
}

/** A pair of scissors, open: two finger loops, and the blades, each a long leaf, crossing at the pivot. */
function scissors(): string {
  const blade = (x0: number, y0: number, x1: number, y1: number) => leaf(x0, y0, Math.atan2(y1 - y0, x1 - x0), Math.hypot(x1 - x0, y1 - y0), 1.9)
  return `${circle(3.3, -5.6, 8.6)} ${circle(3.3, 5.6, 8.6)} ${blade(-3.6, 6, 5.2, -13)} ${blade(3.6, 6, -5.2, -13)} ${circle(0.7, 0, -0.9)}`
}

/** A telescope on a tripod: its tube in three, wider to the lens, the legs, and the star it's pointed at. */
function telescope(): string {
  return `${bar(-1.5, -4.5, 10.5, -10.5, 6)} ${bar(-10, -0.3, -1.5, -4.5, 4)} ${bar(-12.6, 1, -10, -0.3, 2.6)} M10.5 -10.5 L12 -7.5 M10.5 -10.5 L9 -13.5 M-0.5 -2 L-7 13 M-0.5 -2 L0.5 13 M-0.5 -2 L7 13 ${sparkle(11.5, 3, 1.4)}`
}

/** A rosette: a ruffled ring round a star, and two ribbon tails with a notch in each. */
function rosette(): string {
  return `${bumps(14, 7.6, 9.6, 0, -4.5)} ${circle(5.2, 0, -4.5)} ${star(5, 3, 1.25, 0, -4.5)} M-3.5 2.6 L-6.5 12 L-4 10.6 L-2.4 12.6 L-0.8 4.6 M3.5 2.6 L6.5 12 L4 10.6 L2.4 12.6 L0.8 4.6`
}

/** A clock at midnight: its face and the twelve hours marked, both hands at twelve, and sparkles about it. */
function clockAtMidnight(): string {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2
    return `M${at(i % 3 ? 7.6 : 6.6, angle, 0, 2)} L${at(8.4, angle, 0, 2)}`
  }).join(' ')
  return `${circle(10, 0, 2)} ${ticks} M0 2 L-1.3 -1 L0 -4.2 L1.3 -1 Z M0 2 V-6 ${sparkle(-11, -10.5)} ${sparkle(10.5, -11.5, 1.3)} ${sparkle(12, -5.5, 0.9)}`
}

/** A wax seal: twelve bumps round its edge, as the wax spreads under the seal, then a ring and an N. */
function seal(): string {
  return `${bumps(12, 10.5, 13.2)} ${circle(7)} M-3 3.5 V-3.5 L3 3.5 V-3.5`
}

/** A laurel wreath: two branches rising from a bow, a pair of leaves along each and one at its tip. */
function laurel(): string {
  const parts: string[] = []
  for (const side of [-1, 1]) {
    // Each branch curves out and up from the bow, then in at the top: a quadratic, mirrored for the right.
    const [x0, y0, x1, y1, x2, y2] = [side, 11, side * 13, 4, side * 5, -11]
    parts.push(`M${x0} ${y0} Q${x1} ${y1} ${x2} ${y2}`)
    // A leaf at `t` along the branch, turned out to one side or the other.
    const along = (t: number, turn: number, length: number) => {
      const x = (1 - t) ** 2 * x0 + 2 * t * (1 - t) * x1 + t ** 2 * x2
      const y = (1 - t) ** 2 * y0 + 2 * t * (1 - t) * y1 + t ** 2 * y2
      const angle = Math.atan2(2 * (1 - t) * (y1 - y0) + 2 * t * (y2 - y1), 2 * (1 - t) * (x1 - x0) + 2 * t * (x2 - x1))
      parts.push(leaf(x, y, angle + turn, length))
    }
    for (const t of [0.2, 0.38, 0.56, 0.74]) {
      along(t, 0.7, 4.4)
      along(t + 0.05, -0.7, 4.4)
    }
    along(1, 0, 3.6)
  }
  // The bow.
  parts.push('M0 11 L-3.5 9 V13 Z M0 11 L3.5 9 V13 Z')
  return parts.join(' ')
}

/** New Year's fireworks: a big burst, a small one, and sparks. */
function fireworks(): string {
  return `${burst(12, 2.5, 7.6, -2.5, -3.5)} ${burst(8, 1.2, 3.6, 8, 8, false)} M8 2.4 h0.01 M-11 9 h0.01 M-6 11.5 h0.01 M11 -11 h0.01`
}

/** A dove in flight with an olive branch in its beak. */
function dove(): string {
  const bird =
    'M-10.5 1.5 L-8 0.3 Q-7 -2.5 -4 -2 Q-0.5 -1 3.5 1 Q7.5 1.5 13.5 -2.5 Q12 1 14 3.5 Q9.5 4.5 6 6 Q1.5 9.5 -3.5 7 Q-6.5 5.5 -7.5 2.7 Z M-1.5 -0.5 Q-2.5 -7.5 3.5 -10.5 Q3.5 -7 5.5 -5.5 Q4 -3.5 6 -1.5 Q3.5 -0.5 2.5 0.5 M0.5 -2 L3 -7.5 M2.5 -1 L4.5 -4.5 M-5.9 -0.3 h0.01'
  return `${bird} M-10 1.7 Q-11 5.5 -8 9.5 ${leaf(-10.5, 4, Math.PI * 0.9, 4, 1.8)} ${leaf(-9.7, 6.5, Math.PI * 0.15, 4, 1.8)} ${leaf(-8.7, 8.5, Math.PI * 0.85, 3.6, 1.7)}`
}

/** A shamrock: three heart-shaped leaves round a stem. */
function shamrock(): string {
  // A leaf pointing up from its tip at the middle, as points for one move and four curves.
  const heart = [0, 0, -2, -2, -6, -4, -5, -8, -4, -11, -1, -10, 0, -8, 1, -10, 4, -11, 5, -8, 6, -4, 2, -2, 0, 0]
  const leaves = [0, 120, 240].map((degrees) => {
    const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]
    const points = Array.from({ length: heart.length / 2 }, (_, i) => {
      const [x, y] = [heart[i * 2] * 0.9, heart[i * 2 + 1] * 0.9]
      return `${n(x * c - y * s)} ${n(x * s + y * c - 3)}`
    })
    return `M${points[0]} C${points.slice(1, 4).join(' ')} C${points.slice(4, 7).join(' ')} C${points.slice(7, 10).join(' ')} C${points.slice(10, 13).join(' ')} Z`
  })
  return `${leaves.join(' ')} M0 -3 Q1 5 5 11.5`
}

/** A bouquet: three flowers on their stems, leaves, a paper wrap and a bow. */
function bouquet(): string {
  const flowers = [
    [-5.5, -5.5],
    [5.5, -5.5],
    [0, -9.5],
  ]
    .map(([x, y]) => `${bumps(5, 2.2, 4.4, x, y)} ${circle(1, x, y)}`)
    .join(' ')
  return `${flowers} M-4.5 -2.5 L-1 5 M4.5 -2.5 L1 5 M0 -6 V5 ${leaf(-1.5, 1, Math.PI * 1.15, 5, 1.8)} ${leaf(1.5, 1, -Math.PI * 0.15, 5, 1.8)} M-6.5 1 L-2 13 H2 L6.5 1 M0 7 L-3.5 5 V9 Z M0 7 L3.5 5 V9 Z`
}

/** A poppy: four round petals, a dark heart ringed with seeds, and its stem and leaf. */
function poppy(): string {
  const seeds = Array.from({ length: 8 }, (_, i) => `M${at(4.2, (i / 8) * Math.PI * 2, 0, -5)} h0.01`).join(' ')
  return `${bumps(4, 6, 13.5, 0, -5)} ${circle(2.3, 0, -5)} ${seeds} M0 4 Q1 8 -1 11.5 ${leaf(0.2, 8.5, -0.45, 5.5, 2)}`
}

/** Juneteenth's: a star, the burst round it, and the horizon. */
function juneteenth(): string {
  return `${star(12, 9.5, 6.5, 0, -1)} ${star(5, 4.4, 1.8, 0, -1)} M-13 11 Q0 3 13 11`
}

/** A medal: a striped ribbon, its ring, and the medal with a star on it. */
function medal(): string {
  return `M-6 -12 H6 L3 -3 H-3 Z M-2 -12 L-1 -3 M2 -12 L1 -3 M-2 -3 V-1 M2 -3 V-1 ${circle(6.5, 0, 5.5)} ${star(5, 3.8, 1.6, 0, 5.8)}`
}

/** A turkey, from the side: its tail fanned behind, a round body with a wing, the neck, head, beak and wattle, and legs. */
function turkey(): string {
  const tail = Array.from({ length: 7 }, (_, i) => {
    const angle = -Math.PI * 0.97 + (Math.PI * 0.75 * i) / 6
    return leaf(-1 + Math.cos(angle) * 4.5, 1 + Math.sin(angle) * 4.5, angle, 8, 2.4)
  }).join(' ')
  return `${tail} M9 2 a7 5.5 0 1 1 -14 0 a7 5.5 0 1 1 14 0 M-1 1.5 Q3 -1 6.5 2 Q3 5.5 -1 1.5 Z M6.5 -2 Q8.5 -5 8 -8 ${circle(2, 9, -9.5)} M11 -10 L13.3 -9.2 L11 -8.6 M11 -8.4 Q12.2 -6 10.4 -5 M9.4 -10.1 h0.01 M1 7.3 V11 M4.5 7.3 V11 M-0.5 11 H2.5 M3 11 H6`
}

/** A birthday cake: two tiers with icing dripping over each, sprinkles, three candles lit, on a plate. */
function cake(): string {
  // Icing along a tier's top: a scallop every 2.2 across.
  const drips = (left: number, right: number, y: number) => {
    const count = Math.round((right - left) / 2.2)
    const step = (right - left) / count
    return `M${left} ${y} ${Array.from({ length: count }, (_, i) => `Q${n(left + step * (i + 0.5))} ${y + 2.6} ${n(left + step * (i + 1))} ${y}`).join(' ')}`
  }
  const candles = [-4, 0, 4].map((x, i) => {
    const top = i === 1 ? -9.5 : -8.5
    return `M${x} -4 V${top} M${x} ${top - 1} Q${x - 1.1} ${top - 2.4} ${x} ${top - 3.8} Q${x + 1.1} ${top - 2.4} ${x} ${top - 1} Z`
  })
  return `M-11 3 H11 V12 H-11 Z ${drips(-11, 11, 5.2)} M-7 -4 H7 V3 H-7 Z ${drips(-7, 7, -1.8)} ${candles.join(' ')} M-8 9.5 h0.01 M-4 8.5 h0.01 M0 10 h0.01 M4 8.5 h0.01 M8 9.5 h0.01 M-13 12.5 H13`
}

const WIDTH = 60
const HEIGHT = 72
/** The perforations: a bite every 6 units along each edge. */
const HOLES = [
  ...Array.from({ length: WIDTH / 6 + 1 }, (_, i) => [i * 6, 0]),
  ...Array.from({ length: WIDTH / 6 + 1 }, (_, i) => [i * 6, HEIGHT]),
  ...Array.from({ length: HEIGHT / 6 - 1 }, (_, i) => [0, (i + 1) * 6]),
  ...Array.from({ length: HEIGHT / 6 - 1 }, (_, i) => [WIDTH, (i + 1) * 6]),
]
/** The holes as one path: a stamp a day in a calendar, or 200 in the Stampbook, is far fewer elements to draw than a circle each. */
const PERFORATIONS = HOLES.map(([x, y]) => `M${x + 2.2} ${y} a2.2 2.2 0 1 0 -4.4 0 a2.2 2.2 0 1 0 4.4 0`).join(' ')

/** The value printed in a stamp's corner, by rarity. */
const VALUE: Record<Rarity, string> = { common: '5', rare: '12', unique: '25', legendary: '50', mythic: '∞' }

/** Each ground, as a tile of a pattern in the stamp's own units; rays are drawn whole. */
function Tile({ ground, ink }: { ground: Ground; ink: string }) {
  const line = { stroke: ink, strokeWidth: 0.45, fill: 'none' }
  switch (ground) {
    case 'dots':
      return <circle cx={2} cy={2} r={0.55} style={{ fill: ink }} />
    case 'lines':
      return <path d="M-1 1 L1 -1 M0 4 L4 0 M3 5 L5 3" style={line} />
    case 'hatch':
      return <path d="M-1 1 L1 -1 M0 4 L4 0 M3 5 L5 3 M-1 3 L1 5 M0 0 L4 4 M3 -1 L5 1" style={line} />
    case 'waves':
      return <path d="M0 2 Q2 0.6 4 2 T8 2" style={line} />
    case 'checks':
      return <path d="M0 0 H3 V3 H0 Z M3 3 H6 V6 H3 Z" style={{ fill: ink }} />
    case 'stars':
      return <path d="M5 3.4 L5.5 4.5 L6.6 5 L5.5 5.5 L5 6.6 L4.5 5.5 L3.4 5 L4.5 4.5 Z" style={{ fill: ink }} />
    case 'confetti':
      // Its own colours, whatever the ink.
      return CONFETTI.map(([x, y, turn, colour]) => <rect key={`${x},${y}`} x={x} y={y} width={2} height={0.9} rx={0.3} transform={`rotate(${turn} ${x} ${y})`} style={{ fill: colour }} />)
    default:
      return null
  }
}
const TILE: Record<Ground, number> = { plain: 4, dots: 4, lines: 4, hatch: 4, waves: 8, checks: 6, stars: 10, rays: 4, confetti: 12 }

/** Confetti, scattered over a tile: where, turned how far, and in what colour. */
const CONFETTI: [number, number, number, string][] = [
  [1, 2, 30, STAMP_INKS.red],
  [6, 1, -20, STAMP_INKS.blue],
  [9.5, 5, 60, STAMP_INKS.amber],
  [3, 7, -50, STAMP_INKS.green],
  [7, 9.5, 15, STAMP_INKS.violet],
  [0.5, 10.5, 75, STAMP_INKS.rose],
]

/** A ground's pattern on its own, filling the box it's in, a little larger than on a stamp: a Christmas calendar door's face. */
export function GroundFill({ ground, ink }: { ground: Ground; ink: string }) {
  const id = `nib-fill-${useId().replace(/[^\w-]/g, '')}`
  if (ground === 'plain' || ground === 'rays') return null
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width={TILE[ground]} height={TILE[ground]} patternUnits="userSpaceOnUse" patternTransform="scale(2.5)">
          <Tile ground={ground} ink={ink} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" style={{ fill: `url(#${id})`, opacity: 0.35 }} />
    </svg>
  )
}

/** The sunburst ground: rays from behind the drawing to the frame. */
const RAYS = Array.from({ length: 28 }, (_, i) => {
  const angle = (i / 28) * Math.PI * 2
  return `M${(30 + Math.cos(angle) * 9).toFixed(2)} ${(31 + Math.sin(angle) * 9).toFixed(2)} L${(30 + Math.cos(angle) * 46).toFixed(2)} ${(31 + Math.sin(angle) * 46).toFixed(2)}`
}).join(' ')

/** The corner diamonds of a unique, legendary or mythic stamp's inner frame. */
const CORNERS = [
  [9.5, 9.5],
  [50.5, 9.5],
  [9.5, 62.5],
  [50.5, 62.5],
]
  .map(([x, y]) => `M${x - 1.7} ${y} L${x} ${y - 1.7} L${x + 1.7} ${y} L${x} ${y + 1.7} Z`)
  .join(' ')

/** A mythic stamp's three sparkles. */
const SPARKLES = [
  [15, 21],
  [46, 44],
  [43, 18],
].map(([x, y]) => `M${x} ${y - 2.4} L${x + 0.6} ${y - 0.6} L${x + 2.4} ${y} L${x + 0.6} ${y + 0.6} L${x} ${y + 2.4} L${x - 0.6} ${y + 0.6} L${x - 2.4} ${y} L${x - 0.6} ${y - 0.6} Z`)

/**
 * A postage stamp: the motif in its ink, printed twice over as an engraving
 * is, on its ground, with the value in the corner and the date below. Its
 * finish tells its rarity:
 * - common is plain
 * - rare is printed on a pattern
 * - unique is framed twice, with diamonds in the corners
 * - legendary is in gold foil
 * - mythic is in a rainbow foil that shimmers, with sparkles, while Motion
 *   allows it
 * Below 40 wide the fine print and the ground give way, too small to read.
 * `print`: for a file, away from the app's colours and Motion setting (a
 * compiled manuscript's cover, components/stampCover).
 */
export function StampArt({ stamp, width, print = false }: { stamp: Stamp; width: number; print?: boolean }) {
  // React's ids carry characters a url(#…) reference can't.
  const id = useId().replace(/[^\w-]/g, '')
  const mask = `nib-perforated-${id}`
  const shadow = `nib-stamp-shadow-${id}`
  const pattern = `nib-ground-${id}`
  const foil = `nib-foil-${id}`
  const when = shortDay(stamp.day)
  const rarity = stamp.rarity ?? 'common'
  const ground = stamp.ground ?? 'plain'
  const fine = width >= 40
  const framed = rarity === 'unique' || rarity === 'legendary' || rarity === 'mythic'
  const foiled = rarity === 'legendary' || rarity === 'mythic'
  // Read once a drawing: SVG's own animation knows nothing of the Motion setting.
  const moving = rarity === 'mythic' && !print && motion() > 0
  const paint = foiled ? `url(#${foil})` : stamp.ink
  return (
    <svg
      role="img"
      aria-label={`${MOTIFS[stamp.motif]}, ${when}`}
      data-rarity={rarity}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={width}
      height={(width * HEIGHT) / WIDTH}
      className="block overflow-visible"
      style={print ? { fontFamily: '-apple-system, system-ui, sans-serif' } : undefined}
    >
      <defs>
        <mask id={mask}>
          <rect width={WIDTH} height={HEIGHT} fill="white" />
          <path d={PERFORATIONS} fill="black" />
        </mask>
        <filter id={shadow} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx={0} dy={1} stdDeviation={1.2} floodColor="#000" floodOpacity={0.25} />
        </filter>
        {fine && ground !== 'plain' && ground !== 'rays' && (
          <pattern id={pattern} width={TILE[ground]} height={TILE[ground]} patternUnits="userSpaceOnUse">
            <Tile ground={ground} ink={stamp.ink} />
          </pattern>
        )}
        {rarity === 'legendary' && (
          <linearGradient id={foil} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9c6b1c" />
            <stop offset="0.3" stopColor="#f6dc86" />
            <stop offset="0.55" stopColor="#b8862b" />
            <stop offset="0.8" stopColor="#f2d27a" />
            <stop offset="1" stopColor="#8f6216" />
          </linearGradient>
        )}
        {rarity === 'mythic' && (
          <linearGradient id={foil} x1="0" y1="0" x2="1" y2="1" spreadMethod="reflect">
            <stop offset="0" stopColor="#e0526e" />
            <stop offset="0.2" stopColor="#e9a23b" />
            <stop offset="0.4" stopColor="#7cc36a" />
            <stop offset="0.6" stopColor="#3fb4c9" />
            <stop offset="0.8" stopColor="#6f74e0" />
            <stop offset="1" stopColor="#c45bd6" />
            {moving && <animateTransform attributeName="gradientTransform" type="translate" from="-1 -1" to="1 1" dur="7s" repeatCount="indefinite" />}
          </linearGradient>
        )}
      </defs>
      {/* The shadow on the perforated shape, not on the whole rectangle the mask cuts. */}
      <g filter={`url(#${shadow})`}>
        <rect width={WIDTH} height={HEIGHT} mask={`url(#${mask})`} style={{ fill: print ? '#f6f4ef' : 'color-mix(in srgb, var(--color-ink) 5%, var(--color-paper))' }} />
      </g>
      <rect x={6} y={6} width={WIDTH - 12} height={HEIGHT - 12} rx={1} style={{ fill: stamp.ink, fillOpacity: foiled ? 0.2 : 0.13 }} />
      {/* The ground, printed faint behind the drawing. */}
      {/* Rays drawn whole, held inside the panel by an svg of its own, which clips to itself. */}
      {fine && ground === 'rays' && (
        <svg x={6} y={6} width={WIDTH - 12} height={HEIGHT - 12} viewBox="6 6 48 60">
          <path d={RAYS} style={{ stroke: stamp.ink, strokeWidth: 0.7, strokeOpacity: 0.28 }} />
        </svg>
      )}
      {fine && ground !== 'plain' && ground !== 'rays' && <rect x={6} y={6} width={WIDTH - 12} height={HEIGHT - 12} style={{ fill: `url(#${pattern})`, opacity: ground === 'confetti' ? 0.75 : 0.22 }} />}
      <rect x={6} y={6} width={WIDTH - 12} height={HEIGHT - 12} rx={1} style={{ fill: 'none', stroke: paint, strokeWidth: foiled ? 2 : 1.2 }} />
      {framed && (
        <>
          <rect x={9.5} y={9.5} width={WIDTH - 19} height={HEIGHT - 19} rx={0.5} style={{ fill: 'none', stroke: paint, strokeWidth: 0.6 }} />
          <path d={CORNERS} style={{ fill: paint }} />
        </>
      )}
      {/* A wash of ink inside the drawing's shapes, then the drawing printed twice, the second a hair off and faint, as an engraving is. */}
      <path d={DRAWN[stamp.motif]} transform="translate(30 31)" style={{ fill: stamp.ink, fillOpacity: 0.16, fillRule: 'evenodd' }} />
      <path
        d={DRAWN[stamp.motif]}
        transform="translate(30.9 31.9)"
        style={{ fill: 'none', stroke: stamp.ink, strokeOpacity: 0.28, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}
      />
      <path
        d={DRAWN[stamp.motif]}
        transform="translate(30 31)"
        style={{ fill: 'none', stroke: stamp.ink, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}
      />
      {rarity === 'mythic' &&
        SPARKLES.map((d, i) => (
          <path key={i} d={d} style={{ fill: paint }}>
            {moving && <animate attributeName="opacity" values="0.25;1;0.25" dur={`${1.6 + i * 0.5}s`} repeatCount="indefinite" />}
          </path>
        ))}
      {fine && (
        <>
          <text x={framed ? 13 : 10} y={framed ? 16.5 : 14} style={{ fill: rarity === 'legendary' ? '#b8862b' : stamp.ink, fontSize: 6.5, fontWeight: 700 }}>
            {VALUE[rarity]}
          </text>
          <text x={framed ? 47 : 50} y={framed ? 16 : 13.5} textAnchor="end" style={{ fill: stamp.ink, fillOpacity: 0.7, fontSize: 4.4, fontWeight: 600, letterSpacing: 0.8 }}>
            NIB
          </text>
        </>
      )}
      <text x={30} y={framed ? 56.5 : 58} textAnchor="middle" style={{ fill: stamp.ink, fontSize: 7, fontWeight: 600, letterSpacing: 0.6 }}>
        {when.toUpperCase()}
      </text>
    </svg>
  )
}
