/**
 * The stampbook: 300 stamps to collect, each with a number, a name and a line
 * of story, printed (components/StampArt) as one of lib/stampWords' drawings, in
 * an ink, on a ground, and finished by its rarity: 187 common, 60 rare, 37
 * unique, 10 legendary and 6 mythic. They come in packs, one a day (`packFor`).
 * A stamp's number is its own for good: new ones go on the end, so the first
 * 200 are 1 to 200 and the hundred after them 201 to 300, whatever their rarity.
 */

/** Inks that read on paper and on the dark theme alike. */
export const STAMP_INKS = {
  red: '#d4573b',
  amber: '#e7a33e',
  green: '#5bb37a',
  blue: '#4f9bd9',
  rose: '#df5f86',
  violet: '#8b6fd6',
  teal: '#2ea597',
  umber: '#b47b4c',
  plum: '#b0508f',
  olive: '#8fa035',
  gold: '#c99a2e',
}
type Ink = keyof typeof STAMP_INKS

/** How hard a stamp is to come by, and how it's finished (components/StampArt): plain, patterned, framed, gold, shimmering. */
export const RARITIES = ['common', 'rare', 'unique', 'legendary', 'mythic'] as const
export type Rarity = (typeof RARITIES)[number]

/** The pattern printed behind a stamp's drawing; confetti is for Nib's birthday's alone. */
export const GROUNDS = ['plain', 'dots', 'lines', 'waves', 'checks', 'hatch', 'stars', 'rays', 'confetti'] as const
export type Ground = (typeof GROUNDS)[number]

/** The stampbook's stamps received, as `[day, number]`. */
export type Received = [string, number][]

/** Each rarity's name, as the writer sees it. */
export const RARITY_NAMES: Record<Rarity, string> = { common: 'Common', rare: 'Rare', unique: 'Unique', legendary: 'Legendary', mythic: 'Mythic' }

/** Each rarity's colour, wherever one is shown: a pack's dots, captions and glow, the market's names, and the Stampbook's bars. */
export const RARITY_INKS: Record<Rarity, string> = { common: '#a8a29a', rare: STAMP_INKS.blue, unique: STAMP_INKS.violet, legendary: '#c8961e', mythic: '#e0526e' }

export type Entry = {
  /** 1 to 300. */
  no: number
  name: string
  story: string
  /** What its drawing shows, as lib/stampWords' MOTIFS has it. */
  motif: string
  ink: string
  ground: Ground
  rarity: Rarity
}

/** Printed plain: name, drawing, ink, story. */
const COMMON: [string, string, Ink, string][] = [
  ['First Nib', 'A nib', 'red', 'For the first word of anything.'],
  ['Blue-Black Nib', 'A nib', 'blue', 'For letters signed in ink that won’t fade.'],
  ['Steady Nib', 'A nib', 'olive', 'For the sentence cut down to what it needed.'],
  ['Inkpot', 'An inkpot', 'violet', 'Full to the brim, and nowhere to be yet.'],
  ['Desk Inkpot', 'An inkpot', 'amber', 'It has outlived three desks and one office.'],
  ['Spilled Ink', 'An inkpot', 'teal', 'The best page of the day had a blot on it.'],
  ['Pencil', 'A pencil', 'amber', 'Soft enough to rub out, sure enough to start.'],
  ['Carpenter’s Pencil', 'A pencil', 'umber', 'Sharpened with a knife, kept behind one ear.'],
  ['Stub of Pencil', 'A pencil', 'rose', 'Too short to hold, too good to throw away.'],
  ['Open Book', 'An open book', 'green', 'Left face down at the good part.'],
  ['Library Book', 'An open book', 'blue', 'Three weeks, and renewed twice.'],
  ['Book at Bedtime', 'An open book', 'plum', 'One more chapter, said every night.'],
  ['Feather', 'A feather', 'teal', 'Found on the path and kept in a book.'],
  ['Goose Quill', 'A feather', 'umber', 'Cut at a slant, the way they used to.'],
  ['Light Feather', 'A feather', 'rose', 'For a page that came easily, for once.'],
  ['Envelope', 'An envelope', 'red', 'Sealed, stamped, and very nearly sent.'],
  ['Airmail', 'An envelope', 'blue', 'Thin paper, a long way, worth the wait.'],
  ['Letter Home', 'An envelope', 'green', 'Nothing much happened, in four pages.'],
  ['Typewriter', 'A typewriter', 'olive', 'Each key a small decision, made out loud.'],
  ['Portable', 'A typewriter', 'red', 'It came in a case, and went everywhere.'],
  ['Carriage Return', 'A typewriter', 'violet', 'Ding, and on to the next line.'],
  ['Stack of Books', 'A stack of books', 'plum', 'To be read, someday, every one.'],
  ['Bedside Pile', 'A stack of books', 'amber', 'Leaning a little further every month.'],
  ['Second-Hand Books', 'A stack of books', 'teal', 'With someone else’s name inside the cover.'],
  ['Desk Lamp', 'A desk lamp', 'amber', 'Pulled close for the last page of the night.'],
  ['Reading Light', 'A desk lamp', 'teal', 'A circle of light, and the rest dark.'],
  ['Night Shift', 'A desk lamp', 'blue', 'Still on at two, for a good reason.'],
  ['Wax Seal', 'A wax seal', 'red', 'Pressed while warm, and not to be broken.'],
  ['Plum Seal', 'A wax seal', 'plum', 'For a secret kept well.'],
  ['Green Seal', 'A wax seal', 'green', 'For news that travelled by hand.'],
  ['Cup of Tea', 'A cup of tea', 'umber', 'Gone cold beside a paragraph that didn’t.'],
  ['Mint Tea', 'A cup of tea', 'green', 'For a slow afternoon.'],
  ['Morning Tea', 'A cup of tea', 'amber', 'Before anyone else is up.'],
  ['Key', 'A key', 'amber', 'For a drawer of old notebooks.'],
  ['Iron Key', 'A key', 'umber', 'It opens nothing now, and stays on the ring.'],
  ['Blue Key', 'A key', 'blue', 'For the word that unlocked the chapter.'],
  ['Crescent Moon', 'A crescent moon', 'blue', 'For writing after dark.'],
  ['New Moon', 'A crescent moon', 'violet', 'For something just beginning.'],
  ['Harvest Moon', 'A crescent moon', 'amber', 'Low and orange over the last field.'],
  ['Sun', 'The sun', 'amber', 'For a morning that went well.'],
  ['Midsummer Sun', 'The sun', 'red', 'The longest day, and a long page to match.'],
  ['Pale Sun', 'The sun', 'olive', 'January light, thin and welcome.'],
  ['Star', 'A star', 'amber', 'For a day you showed up.'],
  ['Evening Star', 'A star', 'violet', 'The first one out, before the rest.'],
  ['Red Star', 'A star', 'red', 'For the line you’d underline.'],
  ['Rain Cloud', 'A rain cloud', 'blue', 'Good writing weather.'],
  ['April Shower', 'A rain cloud', 'green', 'Here and gone, the street still shining.'],
  ['Grey Day', 'A rain cloud', 'teal', 'Nothing to do but stay in and write.'],
  ['Paper Plane', 'A paper plane', 'blue', 'Folded from a draft that didn’t make it.'],
  ['Note in Class', 'A paper plane', 'rose', 'Passed along three rows, and never caught.'],
  ['Long Flight', 'A paper plane', 'olive', 'It cleared the garden wall.'],
  ['Balloon', 'A hot-air balloon', 'red', 'For an idea that lifted off.'],
  ['Dawn Flight', 'A hot-air balloon', 'amber', 'Up before the wind.'],
  ['Drifting', 'A hot-air balloon', 'teal', 'Going wherever the air goes.'],
  ['Waves', 'Waves', 'blue', 'For words that came in and kept coming.'],
  ['High Tide', 'Waves', 'teal', 'Everything at once, then calm.'],
  ['Swell', 'Waves', 'violet', 'Far out, and rolling in slowly.'],
  ['Lighthouse', 'A lighthouse', 'red', 'For finding the way through a draft.'],
  ['Harbour Light', 'A lighthouse', 'amber', 'Home, at the end of a long piece.'],
  ['North Light', 'A lighthouse', 'blue', 'Steady, every night, without fail.'],
  ['Paper Boat', 'A paper boat', 'teal', 'Sent down the gutter after the rain.'],
  ['Newspaper Boat', 'A paper boat', 'umber', 'Yesterday’s news, out to sea.'],
  ['Little Fleet', 'A paper boat', 'rose', 'Folded in a row on a rainy afternoon.'],
  ['Mountains', 'Mountains', 'green', 'For a long piece, a step at a time.'],
  ['Blue Ridge', 'Mountains', 'blue', 'Fold after fold into the distance.'],
  ['Red Rock', 'Mountains', 'red', 'Bare, warm, and very old.'],
  ['Leaf', 'A leaf', 'green', 'Pressed between the pages of a diary.'],
  ['Autumn Leaf', 'A leaf', 'amber', 'The year turning, a little.'],
  ['Copper Leaf', 'A leaf', 'umber', 'Last on the branch, and then not.'],
  ['Tree', 'A tree', 'green', 'For something that grew slowly.'],
  ['Old Oak', 'A tree', 'umber', 'It was here before the house.'],
  ['Shade Tree', 'A tree', 'olive', 'A good place to read in August.'],
  ['Cat', 'A cat', 'umber', 'Asleep on the notes you needed.'],
  ['Ginger Cat', 'A cat', 'amber', 'Walked across the keyboard, mid-sentence.'],
  ['Night Cat', 'A cat', 'violet', 'Out until morning, home for breakfast.'],
  ['Ringed Planet', 'A ringed planet', 'violet', 'Seen once, through a borrowed telescope.'],
  ['Saturn', 'A ringed planet', 'amber', 'Far off, and taking its time.'],
  ['Kite', 'A kite', 'red', 'All string, and then all sky.'],
  ['Beach Kite', 'A kite', 'teal', 'Pulling hard in a sea wind.'],
  ['Sailboat', 'A sailboat', 'blue', 'For a piece that found its wind.'],
  ['Weekend Sail', 'A sailboat', 'rose', 'Nowhere in particular, all afternoon.'],
  ['Anchor', 'An anchor', 'blue', 'For holding fast to a habit.'],
  ['Rusted Anchor', 'An anchor', 'umber', 'It has been down there a long time.'],
  ['Shell', 'A spiral shell', 'rose', 'Held to the ear, the sea still in it.'],
  ['Spiral Shell', 'A spiral shell', 'amber', 'Each turn a little wider than the last.'],
  ['Whale', 'A whale', 'blue', 'Something big, under the surface.'],
  ['Grey Whale', 'A whale', 'teal', 'Passing the headland, once a year.'],
  ['Fish', 'A fish', 'teal', 'The one that got away, in a story.'],
  ['Goldfish', 'A fish', 'amber', 'Round and round, thinking it over.'],
  ['Tulip', 'A tulip', 'red', 'For the first warm week.'],
  ['Pink Tulip', 'A tulip', 'rose', 'From a bulb planted and forgotten.'],
  ['Toadstool', 'A mushroom', 'red', 'Up overnight, out of nowhere, like an idea.'],
  ['Field Mushroom', 'A mushroom', 'umber', 'Found early, before anyone else.'],
  ['Acorn', 'An acorn', 'umber', 'Small now. Wait and see.'],
  ['Green Acorn', 'An acorn', 'olive', 'Not quite ready to drop.'],
  ['Seedling', 'A seedling', 'green', 'For a new habit, two leaves in.'],
  ['Windowsill Sprout', 'A seedling', 'olive', 'Turned to the light every morning.'],
  ['Cactus', 'A cactus', 'green', 'Thrives on very little.'],
  ['Desert Bloom', 'A cactus', 'rose', 'Flowers once a year, and it’s worth it.'],
  ['Apple', 'An apple', 'red', 'For the teacher who said keep going.'],
  ['Green Apple', 'An apple', 'green', 'Sharp, and good for you.'],
  ['Owl', 'An owl', 'umber', 'Up late, and wise about it.'],
  ['Barn Owl', 'An owl', 'amber', 'A pale shape over the field at dusk.'],
  ['Swallow', 'A swallow', 'blue', 'Back again, so summer is too.'],
  ['Swift', 'A swallow', 'violet', 'Never lands, and never tires.'],
  ['Bee', 'A bee', 'amber', 'Busy, and all the better for it.'],
  ['Bumblebee', 'A bee', 'olive', 'Too heavy to fly, and flying anyway.'],
  ['Butterfly', 'A butterfly', 'rose', 'For something that changed.'],
  ['Blue Butterfly', 'A butterfly', 'blue', 'Gone before you could say so.'],
  ['Snail', 'A snail', 'olive', 'Slow, and gets there.'],
  ['Garden Snail', 'A snail', 'umber', 'Out after the rain, with a silver trail.'],
  ['Umbrella', 'An umbrella', 'red', 'For writing through the bad weather.'],
  ['Borrowed Umbrella', 'An umbrella', 'violet', 'Never given back.'],
  ['Bicycle', 'A bicycle', 'teal', 'Learned once, never forgotten.'],
  ['Red Bicycle', 'A bicycle', 'red', 'A bell, a basket, and the long way home.'],
  ['Alarm Clock', 'An alarm clock', 'amber', 'Set early, to write before work.'],
  ['Kitchen Clock', 'An alarm clock', 'teal', 'Five minutes fast, for years.'],
  ['Hourglass', 'An hourglass', 'amber', 'For a sprint, start to finish.'],
  ['Sand Glass', 'An hourglass', 'umber', 'Turned over, and begun again.'],
  ['Compass', 'A compass', 'red', 'For knowing where the story goes.'],
  ['Pocket Compass', 'A compass', 'green', 'North, roughly. Close enough.'],
  ['Reading Glasses', 'A pair of glasses', 'umber', 'Pushed up into the hair, and looked for.'],
  ['Round Glasses', 'A pair of glasses', 'violet', 'For seeing the small things.'],
  ['Camera', 'A camera', 'blue', 'For a scene caught in words instead.'],
  ['Old Camera', 'A camera', 'umber', 'Twenty-four pictures, then wait a week.'],
]

/** Printed on a pattern: name, drawing, ink, ground, story. */
const RARE: [string, string, Ink, Ground, string][] = [
  ['Engraved Nib', 'A nib', 'umber', 'hatch', 'Cut line by line, the way good drafts are.'],
  ['Midnight Ink', 'An inkpot', 'violet', 'stars', 'The pot you only open after dark.'],
  ['Drafting Pencil', 'A pencil', 'blue', 'checks', 'For plans drawn on squared paper.'],
  ['Marginalia', 'An open book', 'red', 'lines', 'A book with notes in it is a better book.'],
  ['Peacock Quill', 'A feather', 'teal', 'dots', 'Too fine to write with, and used anyway.'],
  ['Special Delivery', 'An envelope', 'red', 'lines', 'Signed for at the door.'],
  ['Newsroom', 'A typewriter', 'umber', 'checks', 'Forty keys going, and a deadline.'],
  ['Library Stamp', 'A stack of books', 'green', 'dots', 'Due back on the date below.'],
  ['Midnight Oil', 'A desk lamp', 'amber', 'rays', 'For a night spent finishing it.'],
  ['Sealed Orders', 'A wax seal', 'plum', 'hatch', 'To be opened only by the one it’s for.'],
  ['Tea Leaves', 'A cup of tea', 'green', 'waves', 'Read at the bottom of the cup.'],
  ['Skeleton Key', 'A key', 'umber', 'hatch', 'It fits a door no one remembers.'],
  ['Moon on the Water', 'A crescent moon', 'blue', 'waves', 'Two moons, one of them shaking.'],
  ['Sunburst', 'The sun', 'amber', 'rays', 'For a day that went right from the start.'],
  ['Starfield', 'A star', 'violet', 'stars', 'Too many to count, so you wrote instead.'],
  ['Downpour', 'A rain cloud', 'blue', 'lines', 'Rain on the window, words on the page.'],
  ['Night Sky', 'A ringed planet', 'blue', 'stars', 'Seen from the garden, a long way off.'],
  ['Fair Weather', 'A hot-air balloon', 'amber', 'dots', 'Up over the fields, slowly.'],
  ['Folded Letter', 'A paper plane', 'red', 'lines', 'A letter, sent the quick way.'],
  ['Great Wave', 'Waves', 'teal', 'waves', 'For the day it all came at once.'],
  ['Storm Light', 'A lighthouse', 'red', 'hatch', 'Still turning, in the worst of it.'],
  ['Regatta', 'A paper boat', 'blue', 'checks', 'Folded boats, racing down the gutter.'],
  ['Trade Wind', 'A sailboat', 'teal', 'waves', 'Steady, the whole way across.'],
  ['Tide Pool', 'A spiral shell', 'rose', 'dots', 'Small things, left when the sea went out.'],
  ['Deep Water', 'A whale', 'blue', 'waves', 'Where the long thoughts live.'],
  ['River Fish', 'A fish', 'green', 'waves', 'Upstream every year, without a map.'],
  ['Summit', 'Mountains', 'violet', 'rays', 'For reaching the end of something big.'],
  ['Fallen Leaves', 'A leaf', 'amber', 'dots', 'Ankle-deep, and loud to walk through.'],
  ['Forest', 'A tree', 'green', 'hatch', 'For writing to lose yourself in.'],
  ['Tulip Field', 'A tulip', 'red', 'lines', 'Row after row, all one colour.'],
  ['Oak to Be', 'An acorn', 'olive', 'checks', 'Everything it will be, already inside.'],
  ['Spring Planting', 'A seedling', 'green', 'lines', 'Rows sown, and now to wait.'],
  ['Cat on the Rug', 'A cat', 'amber', 'checks', 'Asleep in the one patch of sun.'],
  ['Night Watch', 'An owl', 'violet', 'stars', 'Awake while the house sleeps.'],
  ['Migration', 'A swallow', 'blue', 'lines', 'Thousands of miles, back to the same barn.'],
  ['Meadow', 'A butterfly', 'rose', 'dots', 'Wildflowers, and something always moving.'],
  ['Grand Tour', 'A bicycle', 'red', 'checks', 'Every road of a summer, by bike.'],
  ['Small Hours', 'An alarm clock', 'blue', 'stars', 'Three in the morning, and still going.'],
  ['Last Grains', 'An hourglass', 'amber', 'rays', 'Finished just as the time ran out.'],
  ['Chart', 'A compass', 'teal', 'checks', 'For mapping the way through a plot.'],
]

/** Framed twice, on a pattern: name, drawing, ink, ground, story. */
const UNIQUE: [string, string, Ink, Ground, string][] = [
  ['Golden Nib', 'A nib', 'amber', 'rays', 'Given for a lifetime of letters.'],
  ['Fair Copy', 'An inkpot', 'blue', 'hatch', 'For the version that goes out into the world.'],
  ['Last Pencil', 'A pencil', 'red', 'stars', 'Worn down to a stub over one whole book.'],
  ['The End', 'An open book', 'violet', 'rays', 'Written at last, at the foot of the page.'],
  ['Swan Feather', 'A feather', 'teal', 'waves', 'From the lake, the morning it all began.'],
  ['The Manuscript', 'A typewriter', 'umber', 'lines', 'Typed clean, every page numbered.'],
  ['Seal of Approval', 'A wax seal', 'red', 'dots', 'For a page you’d stand behind.'],
  ['Tea at Four', 'A cup of tea', 'rose', 'checks', 'With cake, and nobody in a hurry.'],
  ['Blue Moon', 'A crescent moon', 'blue', 'stars', 'Once in a while, and worth staying up for.'],
  ['Eclipse', 'The sun', 'violet', 'rays', 'Dark at noon, and everyone looking up.'],
  ['North Star', 'A star', 'blue', 'rays', 'For the reason you write at all.'],
  ['Rings of Saturn', 'A ringed planet', 'amber', 'stars', 'Far out, and keeping its own orbit.'],
  ['Around the World', 'A hot-air balloon', 'red', 'checks', 'Eighty days, and a notebook for each.'],
  ['Keeper’s Log', 'A lighthouse', 'teal', 'lines', 'Every night written down, for forty years.'],
  ['Voyage', 'A sailboat', 'blue', 'waves', 'Out past where the maps end.'],
  ['Whale Song', 'A whale', 'violet', 'waves', 'Heard for miles, and nobody knows why.'],
  ['Peak in Snow', 'Mountains', 'blue', 'hatch', 'White all year, and hardly ever climbed.'],
  ['Tree of Stories', 'A tree', 'green', 'dots', 'Initials in the bark, and a story for each.'],
  ['First Shoot', 'A seedling', 'olive', 'rays', 'Proof that something took.'],
  ['Library Cat', 'A cat', 'plum', 'checks', 'Belongs to everyone, sleeps on the dictionaries.'],
  ['Owl of Letters', 'An owl', 'amber', 'hatch', 'Wise, and up all night over it.'],
  ['Homecoming', 'A swallow', 'rose', 'rays', 'Back to the eaves where it was born.'],
  ['Emperor', 'A butterfly', 'plum', 'stars', 'Rarely seen, and never forgotten.'],
  ['Time Well Spent', 'An hourglass', 'teal', 'dots', 'For an hour that went into the page.'],
  ['True North', 'A compass', 'red', 'stars', 'For writing that knows where it’s going.'],
]

/** The rarest, each its own drawing: name, drawing, ink, ground, story. */
const LEGENDARY: [string, string, Ink, Ground, string][] = [
  ['Laurels', 'A laurel wreath', 'gold', 'rays', 'For a page you were proud of.'],
  ['The Crown', 'A crown', 'gold', 'rays', 'For the writer in charge of every word.'],
  ['The Cup', 'A trophy', 'gold', 'rays', 'Raised for a draft finished at last.'],
  ['The Tall Ship', 'A tall ship', 'gold', 'waves', 'Under full sail, and a long way out.'],
  ['Treasure', 'A treasure chest', 'gold', 'dots', 'Found where the map said nothing.'],
  ['The Castle', 'A castle', 'gold', 'checks', 'Built a line at a time, and still standing.'],
]
const MYTHIC: [string, string, Ink, Ground, string][] = [
  ['The Phoenix', 'A phoenix', 'red', 'rays', 'For the draft that rose out of an old one.'],
  ['The Unicorn', 'A unicorn', 'violet', 'stars', 'Everyone has heard of one. Hardly anyone has seen one.'],
  ['The Comet', 'A comet', 'blue', 'stars', 'Once in a lifetime, across the whole sky.'],
  ['The Winged Nib', 'A winged nib', 'teal', 'rays', 'Nib’s own, and the rarest stamp of all.'],
]

/** The hundred after the first 200, numbered 201 to 300 in this order: common, then rare, unique, legendary and mythic. */
const MORE_COMMON: [string, string, Ink, string][] = [
  ['Notebook', 'A spiral notebook', 'blue', 'Bought for one idea, and full of others.'],
  ['Pocket Notebook', 'A spiral notebook', 'red', 'Small enough to go everywhere you do.'],
  ['Back Pages', 'A spiral notebook', 'olive', 'Where the shopping lists and the good lines meet.'],
  ['Paperclip', 'A paperclip', 'teal', 'Holding the pages that belong together.'],
  ['Bent Paperclip', 'A paperclip', 'violet', 'Straightened out in a long meeting.'],
  ['Clipped Notes', 'A paperclip', 'amber', 'Three drafts, and the one on top is best.'],
  ['Scissors', 'A pair of scissors', 'red', 'For the paragraph that had to go.'],
  ['Paper Scissors', 'A pair of scissors', 'blue', 'Snowflakes in winter, cuttings all year.'],
  ['Cut and Paste', 'A pair of scissors', 'green', 'The old way of moving a scene.'],
  ['Teapot', 'A teapot', 'umber', 'Enough for two, and a second pot after.'],
  ['Brown Teapot', 'A teapot', 'red', 'Chipped at the spout, and pours the best.'],
  ['Pot for One', 'A teapot', 'plum', 'For an afternoon with only the page.'],
  ['Light Bulb', 'A light bulb', 'amber', 'The idea that came in the shower.'],
  ['Bright Idea', 'A light bulb', 'olive', 'Written on the back of a receipt.'],
  ['Last Light On', 'A light bulb', 'violet', 'The only window lit on the street.'],
  ['Magnifying Glass', 'A magnifying glass', 'teal', 'For the detail that makes a scene true.'],
  ['Close Reading', 'A magnifying glass', 'blue', 'Every word, and what it was doing there.'],
  ['Small Print', 'A magnifying glass', 'umber', 'Read twice, and signed anyway.'],
  ['Folded Map', 'A folded map', 'green', 'Never folds back the way it came.'],
  ['Road Map', 'A folded map', 'red', 'The long way round, on purpose.'],
  ['Town Plan', 'A folded map', 'amber', 'A cross where the café used to be.'],
  ['Ticket', 'A ticket', 'rose', 'Kept in a book as a bookmark.'],
  ['Return Ticket', 'A ticket', 'teal', 'There and back, with a story each way.'],
  ['Matinee', 'A ticket', 'violet', 'An afternoon show, and the street still light after.'],
  ['Rose', 'A rose', 'red', 'For something said well, and only once.'],
  ['Pressed Rose', 'A rose', 'plum', 'Flat between two pages of a novel.'],
  ['Climbing Rose', 'A rose', 'rose', 'Up the wall, a little higher every year.'],
  ['Rainbow', 'A rainbow', 'blue', 'Out the moment the rain gave up.'],
  ['After the Rain', 'A rainbow', 'green', 'Everything washed, and starting again.'],
  ['Double Rainbow', 'A rainbow', 'violet', 'Seen once, and told about for years.'],
  ['Armchair', 'An armchair', 'umber', 'The chair by the window, worn to your shape.'],
  ['Reading Chair', 'An armchair', 'green', 'One more page, and then the kettle.'],
  ['Fireside', 'An armchair', 'red', 'Feet up, and the evening ahead.'],
  ['Fountain Pen', 'A fountain pen', 'blue', 'Filled from the bottle, slowly, on purpose.'],
  ['School Pen', 'A fountain pen', 'teal', 'Cartridges in the pencil case, and ink on the fingers.'],
  ['Borrowed Pen', 'A fountain pen', 'olive', 'Never quite given back.'],
  ['Paper Kite', 'A kite', 'rose', 'Made from newspaper, and it flew.'],
  ['Kite String', 'A kite', 'olive', 'Let all the way out, and holding.'],
  ['Ship’s Anchor', 'An anchor', 'red', 'For the sentence everything else holds on to.'],
  ['Harbour Anchor', 'An anchor', 'teal', 'Dropped in a quiet bay for the night.'],
  ['Fairy Ring', 'A mushroom', 'violet', 'Overnight, in a circle, in the grass.'],
  ['Morel', 'A mushroom', 'olive', 'Found by someone who knew where to look.'],
  ['Window Cactus', 'A cactus', 'teal', 'Watered once a month, and thriving on it.'],
  ['Prickly Pear', 'A cactus', 'plum', 'Sharp outside, sweet within.'],
  ['Crab Apple', 'An apple', 'rose', 'Too sour to eat, and too pretty to leave on the tree.'],
  ['Windfall', 'An apple', 'amber', 'Fallen in the night, and free for the taking.'],
  ['Honeybee', 'A bee', 'umber', 'Busy all morning, and something to show for it.'],
  ['Garden Bee', 'A bee', 'green', 'Lavender to lavender, all afternoon.'],
  ['Slow Snail', 'A snail', 'teal', 'Getting there, a line at a time.'],
  ['Rain Snail', 'A snail', 'green', 'Out after the shower, in no hurry at all.'],
  ['Lost Umbrella', 'An umbrella', 'plum', 'Left on the train, and missed for a week.'],
  ['Big Umbrella', 'An umbrella', 'blue', 'Room under it for two and a conversation.'],
  ['Spectacles', 'A pair of glasses', 'blue', 'On the end of the nose, over the top of the page.'],
  ['Sunglasses', 'A pair of glasses', 'amber', 'For writing in the garden, in summer.'],
  ['Instant Camera', 'A camera', 'rose', 'Shaken, and waited for, and there you are.'],
  ['Holiday Snaps', 'A camera', 'teal', 'Two hundred pictures, and the best one blurred.'],
  ['Cowrie', 'A spiral shell', 'plum', 'Held up to the ear, and the sea in it.'],
  ['Minnow', 'A fish', 'blue', 'Quick, and gone the moment you looked.'],
  ['White Tulip', 'A tulip', 'olive', 'Bought on the way home, for no reason.'],
  ['Squirrel’s Store', 'An acorn', 'amber', 'Buried in autumn, and forgotten by spring.'],
  ['Tandem', 'A bicycle', 'blue', 'Two riders, and only one of them steering.'],
  ['Wind-Up Clock', 'An alarm clock', 'green', 'Ticking on the shelf, and wound every Sunday.'],
]
const MORE_RARE: [string, string, Ink, Ground, string][] = [
  ['Field Notes', 'A spiral notebook', 'green', 'checks', 'Every bird on the walk, and what it sang.'],
  ['Bound Draft', 'A paperclip', 'umber', 'hatch', 'Sixty pages, held by one bent wire.'],
  ['Tailor’s Shears', 'A pair of scissors', 'plum', 'lines', 'Measure twice, and cut the scene once.'],
  ['High Tea', 'A teapot', 'rose', 'dots', 'Three tiers, and the good china out.'],
  ['Eureka', 'A light bulb', 'amber', 'rays', 'Up out of the bath, and straight to the desk.'],
  ['The Clue', 'A magnifying glass', 'violet', 'hatch', 'Hidden in plain sight, on page one.'],
  ['Treasure Map', 'A folded map', 'umber', 'waves', 'A cross where no one has dug yet.'],
  ['Night Train', 'A ticket', 'blue', 'stars', 'A sleeper berth, and the dark going by.'],
  ['Rose Garden', 'A rose', 'red', 'dots', 'Named, every one, by the person who planted it.'],
  ['Sun Shower', 'A rainbow', 'teal', 'rays', 'Rain and sun at once, and both of them welcome.'],
  ['Wingback', 'An armchair', 'plum', 'checks', 'High enough to hide in with a book.'],
  ['Gold-Nibbed Pen', 'A fountain pen', 'violet', 'lines', 'Given on a birthday, and used every day since.'],
  ['Box Kite', 'A kite', 'red', 'checks', 'Built from a kit, and higher than the trees.'],
  ['Golden Apple', 'An apple', 'amber', 'rays', 'From a story older than anyone can say.'],
  ['Queen Bee', 'A bee', 'violet', 'hatch', 'The whole hive turning around one.'],
  ['Darkroom', 'A camera', 'red', 'stars', 'A red light, and the picture coming up.'],
  ['Coral Reef', 'A fish', 'rose', 'waves', 'A whole city under the water.'],
  ['Moonlit Snail', 'A snail', 'blue', 'stars', 'A silver line across the path by morning.'],
  ['Holding Fast', 'An anchor', 'teal', 'waves', 'The storm all night, and still there at dawn.'],
  ['Mushroom Wood', 'A mushroom', 'olive', 'dots', 'Damp, and quiet, and full of small things.'],
]
const MORE_UNIQUE: [string, string, Ink, Ground, string][] = [
  ['Commonplace Book', 'A spiral notebook', 'plum', 'rays', 'Every line worth keeping, for a whole life.'],
  ['The Final Cut', 'A pair of scissors', 'umber', 'stars', 'Shorter, and better for it.'],
  ['Midnight Feast', 'A teapot', 'violet', 'stars', 'Tea and toast at three, and the chapter done.'],
  ['First Light', 'A light bulb', 'teal', 'rays', 'The moment the whole plot made sense.'],
  ['The Detective', 'A magnifying glass', 'red', 'checks', 'Solved, in the last chapter, in the library.'],
  ['Uncharted', 'A folded map', 'blue', 'hatch', 'Blank at the edges, and that’s where you’re going.'],
  ['Last Train Home', 'A ticket', 'amber', 'lines', 'Caught with a minute to spare, and written about after.'],
  ['Rose Window', 'A rose', 'plum', 'rays', 'Light through glass, in every colour.'],
  ['End of the Rainbow', 'A rainbow', 'amber', 'dots', 'Nobody has got there yet, and everyone keeps looking.'],
  ['Author’s Chair', 'An armchair', 'red', 'hatch', 'Where the reading happens, on the night of the book.'],
  ['Signature Pen', 'A fountain pen', 'blue', 'stars', 'For signing the first copy.'],
  ['Kite Festival', 'A kite', 'teal', 'waves', 'A hundred kites, and a sky to hold them.'],
]
const MORE_LEGENDARY: [string, string, Ink, Ground, string][] = [
  ['The Telescope', 'A telescope', 'gold', 'stars', 'For seeing a long way, and further still.'],
  ['The Scroll', 'A scroll', 'gold', 'lines', 'Unrolled for the reading of something important.'],
  ['The Press', 'A printing press', 'gold', 'checks', 'For the day the words went out to everyone.'],
  ['The Harp', 'A harp', 'gold', 'waves', 'For words set to music, as the old poets did.'],
]
const MORE_MYTHIC: [string, string, Ink, Ground, string][] = [
  ['The Dragon', 'A dragon', 'green', 'rays', 'Asleep on a hoard of unfinished drafts.'],
  ['The Kraken', 'A kraken', 'plum', 'waves', 'From the deep, and bigger every time it’s told.'],
]

/** All 300, by number: the first 200's common, rare, unique, legendary and mythic, then the next hundred's. */
export const BOOK: Entry[] = [
  ...COMMON.map(([name, motif, ink, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground: 'plain' as Ground, rarity: 'common' as Rarity, story })),
  ...RARE.map(([name, motif, ink, ground, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'rare' as Rarity, story })),
  ...UNIQUE.map(([name, motif, ink, ground, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'unique' as Rarity, story })),
  ...LEGENDARY.map(([name, motif, ink, ground, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'legendary' as Rarity, story })),
  ...MYTHIC.map(([name, motif, ink, ground, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'mythic' as Rarity, story })),
  ...MORE_COMMON.map(([name, motif, ink, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground: 'plain' as Ground, rarity: 'common' as Rarity, story })),
  ...MORE_RARE.map(([name, motif, ink, ground, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'rare' as Rarity, story })),
  ...MORE_UNIQUE.map(([name, motif, ink, ground, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'unique' as Rarity, story })),
  ...MORE_LEGENDARY.map(([name, motif, ink, ground, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'legendary' as Rarity, story })),
  ...MORE_MYTHIC.map(([name, motif, ink, ground, story]) => ({ name, motif, ink: STAMP_INKS[ink], ground, rarity: 'mythic' as Rarity, story })),
].map((entry, i) => ({ ...entry, no: i + 1 }))

/** A stamp in a pack, how likely each rarity is out of 100, as collectible games publish them. */
export const LUCKY: Record<Rarity, number> = { mythic: 0.5, legendary: 1.5, unique: 5, rare: 23, common: 70 }

/** A number from 0 to just under 1 for `seed`, the same on every device: FNV-1a, then mixed so seeds a letter apart land far apart. */
function chance(seed: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return ((hash ^ (hash >>> 16)) >>> 0) / 2 ** 32
}

/**
 * A stamp drawn for `seed`, by number: at the odds (LUCKY), the same for the
 * same seed on every device, and nothing else to tip them. It's any stamp of
 * its rarity, as in a pack of cards, so repeats come along with new ones.
 */
export function drawStamp(seed: string): number {
  let roll = chance(`${seed}:lucky`) * 100
  const rarity = (Object.keys(LUCKY) as Rarity[]).find((one) => (roll -= LUCKY[one]) < 0) ?? 'common'
  const choices = BOOK.filter((entry) => entry.rarity === rarity)
  return choices[Math.floor(chance(`${seed}:stamp`) * choices.length)].no
}

/** The day's pack, by number: one stamp, the day's draw. */
export function packFor(day: string): number[] {
  return [drawStamp(day)]
}

/** The stamps from the book received (lib/rewards), by number: the days each came, oldest first. */
export function foundIn(received: [string, number][]): Map<number, string[]> {
  const found = new Map<number, string[]>()
  for (const [day, no] of [...received].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) found.set(no, [...(found.get(no) ?? []), day])
  return found
}
