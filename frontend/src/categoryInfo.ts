/** Category labels: how to show them, and what each one means in plain words.
 *  Labels are stored the way Claude writes them ("doctor-explainer"); they are shown as "Doctor explainer". */

const ACRONYMS = new Set(['ugc', 'psa', 'kbc', 'tv', 'ivf', 'iui', 'cta', 'pcos', 'asr', 'faq', 'pov'])

/** "doctor-explainer" → "Doctor explainer", "ugc-style-skit" → "UGC style skit". */
export function label(v: string | null | undefined): string {
  if (!v) return ''
  const words = v.replace(/[-_]+/g, ' ').trim().split(/\s+/)
  return words.map((w, i) => ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ')
}

/** What you type back becomes the stored form: "Doctor explainer" → "doctor-explainer". */
export const unlabel = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '-')

export const FORMAT_INFO: Record<string, string> = {
  'doctor-explainer': 'A doctor talks to the camera and explains one thing in under a minute or so.',
  'doctor-explainer-long': 'The same, but longer: a doctor explaining a topic in depth, usually over 90 seconds.',
  'silent-text-reel': 'No one speaks. Text on screen or slides carry the message, often over music or trending audio.',
  'seasonal-promo-voiceover': 'A festival, awareness day or offer, told by a voice-over on top of footage or graphics.',
  'influencer-vlog': 'An influencer or creator films their own visit, day or experience, vlog style.',
  'patient-story': 'A real patient or couple tells what they went through.',
  'brand-milestone': 'The clinic celebrates itself: an anniversary, award, new branch or number of patients.',
  'comedy-skit': 'A short acted scene played for laughs, with the health point inside the joke.',
  'ugc-style-skit': 'An acted scene made to look like an ordinary person filmed it on their phone.',
  'family-skit': 'An acted scene between family members: mother-in-law, husband, parents.',
  'product-explainer': 'Explains a product, test, package or machine and what it does.',
  'jingle-promo': 'A promotional reel built around a song or jingle.',
  'voiceover-explainer': 'An explanation told by a voice-over, with no doctor on camera.',
  'kbc-amitabh-psa': 'A public-service clip in the style of a TV quiz show host. Came from the dental accounts.',
  'celeb-film-tie-in': 'Tied to a film or a celebrity appearance.',
  'pageant-skit': 'A skit featuring pageant contestants. Came from a dental account that sponsors a pageant.',
  'pageant-testimonial': 'A pageant contestant praising the clinic.',
  'pageant-testimonial-monologue': 'A longer pageant contestant piece to camera.',
  'pageant-montage': 'Clips from a pageant event cut together.',
  'pageant-rapid-fire': 'Quick questions and answers with pageant contestants.',
}

export const HOOK_INFO: Record<string, string> = {
  'silent': 'Nobody speaks in the first five seconds. The hook is on-screen text, music or the picture.',
  'question-to-camera': 'Opens by asking the viewer a question straight to the camera.',
  'bold-claim': 'Opens with a strong, confident statement that makes you want the proof.',
  'scenario-opener': 'Opens by putting you in a situation: "A friend told me…", "Imagine you are…".',
  'myth-bust': 'Opens by naming something people believe, then says it is wrong.',
  'listicle-pattern': 'Opens by promising a list: "3 signs…", "5 habits…".',
  'emotional-story': 'Opens with a feeling or a personal moment rather than a fact.',
  'statistic': 'Opens with a number: "1 in 6 couples…".',
  'self-intro': 'Opens with the speaker introducing themselves: "Hi, I\'m Dr…".',
  'family-dialogue': 'Opens with family members talking, usually a taunt or a worry.',
  'vlog-opener': 'Opens like a vlog: "Come with me today…".',
  'interview-question': 'Opens with someone off-camera asking the speaker a question.',
  'trending-audio': 'Opens on a trending sound or song rather than speech.',
  'trending-audio-overlay': 'A trending sound plays over text or footage for the whole reel.',
  'confession': 'Opens with the speaker admitting something personal or quoting a harsh comment they got.',
  'pun': 'Opens with wordplay or a joke on a phrase.',
  'scenario-analogy': 'Opens by comparing the medical point to something everyday.',
  'definition-opener': 'Opens by defining a term: "HSG is an X-ray of…".',
  'topical-tie-in': 'Opens by linking to something in the news or a current trend.',
  'celebrity-clip': 'Opens with a celebrity on screen.',
  'shock-claim': 'Opens with a statement meant to startle.',
  'seasonal-fear': 'Opens with a worry tied to a season or festival.',
  'rapid-fire': 'Opens straight into quick questions and answers.',
  'pain-point-empathy': 'Opens by naming a pain the viewer has and showing understanding.',
  'seasonal-greeting': 'Opens with a festival greeting.',
  'seasonal-offer-opener': 'Opens with a seasonal offer.',
  'tv-host-opener': 'Opens in the style of a TV show host.',
  'aspiration-opener': 'Opens with a hope or a dream the viewer has.',
  'explainer-intro': 'Opens by saying what the reel will explain.',
  'unknown': 'Claude could not tell how the reel opens, usually because the transcript was garbled.',
}

export const FLAG_INFO: Record<string, string> = {
  'organic': 'A normal post by the account, with no sign of payment or sponsorship. These are the reels worth learning from.',
  'influencer-collab': 'Made with an influencer or posted as a collab. Views are helped by the influencer\'s own audience.',
  'paid-celebrity': 'A celebrity was paid to appear.',
  'pageant-sponsorship': 'Part of a pageant the clinic sponsors.',
  'celebrity-tv-tie-in': 'Tied to a TV show or celebrity campaign.',
  'not-downloaded': 'The video could not be downloaded, so Claude only had the caption to go on.',
}

export const infoFor = (field: string, v: string): string | undefined =>
  (field === 'format' ? FORMAT_INFO : field === 'hook_type' ? HOOK_INFO : field === 'flag' ? FLAG_INFO : {})[v]
