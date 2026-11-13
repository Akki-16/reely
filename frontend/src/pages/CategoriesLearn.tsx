import { useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SpecialityPicker, Toolbar, Ui } from '../App'
import { api, langName, lrColor } from '../api'
import type { CatGroup } from '../api'
import { infoFor, label } from '../categoryInfo'

const pct = (v: number | null | undefined) => v == null ? '—' : v.toFixed(2) + '%'

/** Everything about categories in plain words, with the labels found in your own reels. */
export default function CategoriesLearn() {
  const { spec } = useContext(Ui)
  const [g, setG] = useState<{ format: CatGroup[]; hook_type: CatGroup[]; flag: CatGroup[]; language: CatGroup[]; total: number; median: number | null } | null>(null)
  useEffect(() => {
    const scope: Record<string, string> = spec ? { speciality: spec } : {}
    Promise.all([api.categories({ a: 'format', b: 'hook_type', organic: 'false', ...scope }), api.categories({ a: 'flag', b: 'language', organic: 'false', ...scope })])
      .then(([x, y]) => setG({ format: x.a, hook_type: x.b, flag: y.a, language: y.b, total: x.total, median: x.median })).catch(() => {})
  }, [spec])
  const where = spec || 'all specialities'

  const table = (field: 'format' | 'hook_type' | 'flag' | 'language', rows: CatGroup[]) => {
    const main = rows.filter(r => r.n >= 3 || infoFor(field, r.value))
    const rare = rows.filter(r => !main.includes(r))
    return (
      <>
        <div className="learntable">
          <div className="learnrow head"><span>Name</span><span>What it means</span><span>Reels</span><span>Median like-rate</span></div>
          {main.map(r => (
            <div key={r.value} className="learnrow">
              <b>{field === 'language' ? langName(r.value) || r.value : label(r.value)}</b>
              <span>{field === 'language' ? 'The language spoken in the reel, as Whisper heard it.' : infoFor(field, r.value) || <span className="caption">A label Claude made up for reels that did not fit the usual list.</span>}
                {field !== 'language' && r.best?.hook && <span className="caption" style={{ display: 'block', marginTop: 3, fontStyle: 'italic' }}>e.g. “{r.best.hook.length > 110 ? r.best.hook.slice(0, 110) + '…' : r.best.hook}”</span>}</span>
              <span>{r.n}</span>
              <b style={{ color: lrColor(r.like_rate) }}>{pct(r.like_rate)}</b>
            </div>
          ))}
        </div>
        {rare.length > 0 && <div className="caption" style={{ lineHeight: 1.6, marginTop: 8 }}><b style={{ color: 'var(--c-sub)' }}>{rare.length} more used on only one or two reels:</b> {rare.map(r => label(r.value)).join(', ')}. Claude invents a label when nothing on its list fits. Merge these into a bigger one with <b>Tidy labels</b>.</div>}
      </>
    )
  }

  return (
    <>
      <Toolbar title="About categories">
        <Link to="/categories" style={{ fontWeight: 600, marginRight: 'auto', order: -1 }}>‹ Categories</Link>
        <SpecialityPicker />
      </Toolbar>
      <div className="main"><div className="main-inner learn">
        <div>
          <h1 className="large">About categories</h1>
          <div className="lead">What the labels mean, where they come from, how the numbers are worked out, and how to change them. The tables use your own reels in {where}{g ? `: ${g.total.toLocaleString()} analysed reels` : ''}.</div>
        </div>

        <section className="card pad">
          <h2>1. What a category is</h2>
          <p>When Reely analyses a reel, Claude reads its caption, the first five seconds of speech and the transcript, and gives the reel a few <b>labels</b>. A category is simply all the reels that share a label.</p>
          <p>There are four kinds of label. Every analysed reel gets one of each:</p>
          <div className="learnkinds">
            <div><b>Format</b><span>What kind of reel it is. A doctor explaining, a skit, a patient's story, text on screen.</span></div>
            <div><b>Hook type</b><span>How the reel opens, in its first five seconds. A question, a bold claim, a myth, a family conversation.</span></div>
            <div><b>Flag</b><span>Whether the reel is the account's own ordinary post (organic), or was helped by an influencer, a celebrity or a sponsorship.</span></div>
            <div><b>Language</b><span>The language spoken. This one is detected by Whisper from the audio, not by Claude.</span></div>
          </div>
          <p>Only reels that were downloaded, transcribed and annotated have labels. Reels that were only scraped (views counted, nothing more) are not in Categories.</p>
        </section>

        <section className="card pad">
          <h2>2. The numbers</h2>
          <div className="learnkinds">
            <div><b>Like-rate</b><span>Likes divided by views, as a percentage. A reel with 1,000 views and 12 likes has a like-rate of 1.2%. It shows how much the people who watched actually liked it. Views alone can be bought or boosted; likes from real viewers are much harder to fake.</span></div>
            <div><b>Median like-rate</b><span>Line up a category's reels from lowest like-rate to highest and take the one in the middle. That is the median. Reely uses it instead of the average because one viral reel can drag an average up and make a weak category look strong. The median tells you what a <i>typical</i> reel of that kind does.</span></div>
            <div><b>Reels</b><span>How many reels are in the category. More reels means the like-rate is more trustworthy.</span></div>
            <div><b>Accounts</b><span>How many different accounts those reels came from. A category that works across five accounts is a pattern. One that works on a single account may just be that account.</span></div>
            <div><b>Median views</b><span>The middle reel's view count, to show reach alongside like-rate.</span></div>
          </div>
          {g && <p>Right now the median like-rate across {where} is <b>{pct(g.median)}</b>. A category above that is doing better than usual for this speciality; one below is doing worse.</p>}
        </section>

        <section className="card pad">
          <h2>3. The two filters</h2>
          <div className="learnkinds">
            <div><b>Organic only</b><span>On by default. It leaves out reels flagged as influencer collabs, celebrity or sponsored posts. Those get views from someone else's audience, so their like-rates are not comparable with a clinic's own posts. Turn it off to see everything.</span></div>
            <div><b>5+ reels</b><span>Hides categories and combinations with fewer than five reels. A like-rate from one or two reels is luck, not a pattern. In the grid these show as grey “too few” cells. You can change the number, or choose Any size.</span></div>
          </div>
          <p>The speciality and account pickers at the top narrow everything to one speciality or one account.</p>
        </section>

        <section className="card pad">
          <h2>4. The three views</h2>
          <div className="learnkinds">
            <div><b>List</b><span>One kind of label at a time: all formats, or all hook types. Each has a bar and its median like-rate. Click one to see its reels on the right. The chips above the reels split that category by a second label, for example the hook types inside Doctor explainer; click a chip to narrow the reels.</span></div>
            <div><b>Grid</b><span>Two kinds crossed, for example format down the side and hook type across the top. Each cell is one combination, showing its median like-rate and reel count. <b>Green</b> cells are above the median for what you are looking at, and deeper green is further above. <b>Red</b> cells are below it. Grey cells have too few reels. An empty cell means no reel has that combination. Click a cell to list its reels underneath.</span></div>
            <div><b>Ranked</b><span>The same combinations as the grid, as a list from best like-rate to worst, each with its best hook. The three weakest are shown at the bottom so you know what to avoid.</span></div>
          </div>
        </section>

        <section className="card pad">
          <h2>5. What you can do with a category</h2>
          <div className="learnkinds">
            <div><b>Open a reel</b><span>Click any reel. It opens in a panel on the right with its video, transcript, notes and stats. The arrows or ← → move through the rest of that category.</span></div>
            <div><b>Send to</b><span>Each reel has a Send to button: add it to the Hook library, or send it to a client as a reference for scripts.</span></div>
            <div><b>Send all</b><span>Sends every reel of the category or combination in one go. Reels already there are skipped, and you can undo.</span></div>
            <div><b>Select</b><span>Tick just the reels you want, then send those.</span></div>
          </div>
        </section>

        <section className="card pad">
          <h2>6. Formats in your reels</h2>
          <p>What kind of reel it is.</p>
          {g ? table('format', g.format) : <div className="caption">Loading…</div>}
        </section>
        <section className="card pad">
          <h2>7. Hook types in your reels</h2>
          <p>How the reel opens in its first five seconds. This is the label that drifts most, because openings vary so much.</p>
          {g ? table('hook_type', g.hook_type) : <div className="caption">Loading…</div>}
        </section>
        <section className="card pad">
          <h2>8. Flags in your reels</h2>
          <p>Claude decides the flag from the caption (sponsor tags, collab names, #ad) and from a like-rate that is suspiciously low for the number of views. A flag can carry a note after it, such as “duplicate repost of…”.</p>
          {g ? table('flag', g.flag) : <div className="caption">Loading…</div>}
        </section>
        <section className="card pad">
          <h2>9. Languages in your reels</h2>
          {g ? table('language', g.language) : <div className="caption">Loading…</div>}
        </section>

        <section className="card pad">
          <h2>10. Changing a label</h2>
          <div className="learnkinds">
            <div><b>One reel</b><span>Open the reel and click its format, hook type or flag chip. Type the new label and press Return. Your edit is kept when the account is run again.</span></div>
            <div><b>Every reel with a label</b><span>In List view, press <b>Tidy labels</b> under the list. <b>Merge into</b> moves all of a label's reels into another label. <b>Rename</b> changes the label's name; typing an existing name merges the two. It applies to the whole speciality.</span></div>
            <div><b>How labels are written</b><span>You can type them with spaces and capitals, like “Doctor explainer”. Reely stores them in one standard form, so “Doctor explainer”, “doctor explainer” and “doctor-explainer” are all the same label.</span></div>
          </div>
        </section>

        <section className="card pad">
          <h2>11. Things to keep in mind</h2>
          <ul className="learnlist">
            <li>Claude gives the labels by reading text, not by watching the video. When the transcript is garbled or the reel is silent, it leans on the caption and can get it wrong. Fix it on the reel when you spot one.</li>
            <li>The starting list of labels was written for dental accounts, so a few (the pageant ones, the TV quiz one) only make sense there.</li>
            <li>A high like-rate on a small category is a hint, not a rule. Look at the reel count and the number of accounts before copying a pattern.</li>
            <li>Like-rate measures how much viewers liked a reel, not how many people it reached or how many patients it brought in.</li>
            <li>Categories describe single labels. The <b>Plan</b> tab of a client goes a step further: Claude groups the best reels into full recipes, called patterns, such as “Patient question, doctor answers”.</li>
          </ul>
        </section>
      </div></div>
    </>
  )
}
