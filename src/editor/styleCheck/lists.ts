/**
 * The style check's word lists (English, v1). Short on purpose: each entry is
 * one more chance of a false flag, and false flags are what make a writer
 * turn a checker off.
 */

/** Words that rarely add anything. */
export const FILLER = ['very', 'really', 'just', 'quite', 'rather', 'basically', 'actually', 'literally', 'totally', 'simply', 'truly', 'definitely', 'certainly', 'extremely', 'incredibly']

/** Phrases that soften a point the writer means. */
export const HEDGES = ['somewhat', 'perhaps', 'maybe', 'kind of', 'sort of', 'a bit', 'a little bit', 'i think', 'i guess', 'i feel like', 'seems to', 'seemed to', 'in my opinion', 'arguably', 'more or less', 'to some extent']

/** Words ending in -ly that aren't adverbs, or are adverbs nobody minds. */
export const NOT_ADVERBS = new Set(
  (
    'only early daily weekly monthly yearly hourly nightly quarterly likely unlikely family reply rely apply supply comply imply multiply ' +
    'ally bully belly jelly lily holly folly rally tally gully fly sly ply assembly anomaly monopoly homily melancholy italy july ' +
    'holy ugly lovely lonely lively friendly unfriendly deadly costly elderly orderly silly chilly hilly jolly curly burly surly wily oily ' +
    'smelly frilly homely manly motherly fatherly brotherly sisterly scholarly cowardly leisurely heavenly godly timely untimely ' +
    'butterfly firefly dragonfly anyway'
  ).split(' '),
)

/** Forms of "be" that start a passive. */
export const BE = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', "isn't", "aren't", "wasn't", "weren't", 'isn’t', 'aren’t', 'wasn’t', 'weren’t'])

/** Words that may sit between "be" and the participle: "was quickly written", "is not done". */
export const BETWEEN = new Set(['not', 'never', 'also', 'already', 'often', 'always', 'still', 'just', 'then', 'all', 'being', 'very', 'really', 'so', 'quite', 'rather'])

/** Irregular past participles. Regular ones end in -ed. */
export const IRREGULAR = new Set(
  (
    'arisen awoken been borne born beaten become begun bent bet bitten bled blown broken bred brought built burnt bought caught chosen ' +
    'come cost crept cut dealt dug done drawn dreamt driven drunk eaten fallen fed felt fought found fled flung flown forbidden forgotten ' +
    'forgiven frozen gotten given gone ground grown hung heard hidden hit held hurt kept knelt known laid led leant leapt learnt left lent ' +
    'let lain lit lost made meant met mistaken overcome paid proven put quit read rid ridden rung risen run said seen sought sold sent set ' +
    'sewn shaken shed shone shot shown shrunk shut sung sunk sat slain slept slid slung slit smelt sown spoken sped spent spilt spun spat ' +
    'split spoilt spread sprung stood stolen stuck stung stunk strewn struck strung sworn swept swollen swum swung taken taught torn told ' +
    'thought thrown thrust trodden understood undertaken undone upset woken worn woven wed wept won wound withdrawn written'
  ).split(' '),
)

/** Words ending in -ed that aren't participles. */
export const NOT_PARTICIPLES = new Set(
  'bed red shed fed led wed sled need feed seed speed bleed breed greed creed weed heed deed reed indeed proceed succeed exceed embed hundred sacred naked wicked rugged jagged crooked ragged beloved'.split(' '),
)

/** Phrases worn smooth by use. */
export const CLICHES = [
  'at the end of the day',
  'in the nick of time',
  'few and far between',
  'the calm before the storm',
  'avoid it like the plague',
  'better late than never',
  'last but not least',
  'only time will tell',
  'think outside the box',
  'at this point in time',
  'low-hanging fruit',
  'a blessing in disguise',
  'easier said than done',
  'every cloud has a silver lining',
  'in the blink of an eye',
  'a needle in a haystack',
  'it goes without saying',
  'all walks of life',
  'par for the course',
  'the tip of the iceberg',
  'when all is said and done',
  'crystal clear',
  'fit as a fiddle',
  'busy as a bee',
  'light as a feather',
  'read between the lines',
  'the bottom line',
  'touch base',
  'game changer',
  'paradigm shift',
  'slept like a log',
  'hit the nail on the head',
  'the elephant in the room',
  'the perfect storm',
  'the writing on the wall',
  'the best of both worlds',
  'back to square one',
  'bite the bullet',
  'break the ice',
  'cut to the chase',
  'the ball is in your court',
  'beat around the bush',
  'on the same page',
  'in a nutshell',
  'out of the blue',
  'under the weather',
  'worth its weight in gold',
  'head over heels',
  'against all odds',
  'all of a sudden',
  'as luck would have it',
  'deafening silence',
  'a sigh of relief',
  'a breath she didn’t know she was holding',
  'a breath he didn’t know he was holding',
]

/** Common words a repeat doesn't count for. */
export const COMMON = new Set(
  (
    'the a an and or but if then than that this these those there their they them he him his she her hers it its we us our you your i me my ' +
    'of in on at to for from by with as into onto over under about after before up down out off so not no yes all any some more most other ' +
    'such only own same too very can could will would shall should may might must do does did done have has had having be is are was were ' +
    'been being what which who whom whose when where why how one two said says say like just also even still back again'
  ).split(' '),
)
