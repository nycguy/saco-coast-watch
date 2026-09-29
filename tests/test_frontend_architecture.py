import pathlib, re, unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
INDEX=ROOT/'index.html'
EXPECTED_JS=[
 'js/config.js','js/marine.js','js/data.js','js/weather.js','js/water-levels.js','js/intelligence.js',
 'js/alerts.js','js/chart.js','js/hazards.js','js/briefing.js','js/app.js','js/map.js','js/webcams.js'
]

class FrontendArchitectureTests(unittest.TestCase):
 def test_index_is_markup_shell_with_external_assets(self):
  html=INDEX.read_text(encoding='utf-8')
  self.assertLess(len(html),50000)
  self.assertIn('href="css/app.css"',html)
  self.assertNotRegex(html,r'<style\b')
  inline=[body for attrs,body in re.findall(r'<script\b([^>]*)>([\s\S]*?)</script>',html,re.I) if body.strip()]
  self.assertEqual(inline,[])
  positions=[]
  for src in EXPECTED_JS:
   token=f'src="{src}"'
   self.assertIn(token,html)
   positions.append(html.index(token))
  self.assertEqual(positions,sorted(positions))

 def test_frontend_modules_exist_and_are_nontrivial(self):
  css=(ROOT/'css'/'app.css').read_text(encoding='utf-8')
  self.assertGreater(len(css),50000)
  self.assertIn(':root{',css)
  for rel in EXPECTED_JS:
   p=ROOT/rel
   self.assertTrue(p.is_file(),rel)
   self.assertGreater(len(p.read_text(encoding='utf-8')),20,rel)

 def test_bootstrap_and_domain_separation(self):
  html=INDEX.read_text(encoding='utf-8')
  app=(ROOT/'js'/'app.js').read_text(encoding='utf-8')
  chart=(ROOT/'js'/'chart.js').read_text(encoding='utf-8')
  briefing=(ROOT/'js'/'briefing.js').read_text(encoding='utf-8')
  mapjs=(ROOT/'js'/'map.js').read_text(encoding='utf-8')
  webcams=(ROOT/'js'/'webcams.js').read_text(encoding='utf-8')
  intelligence=(ROOT/'js'/'intelligence.js').read_text(encoding='utf-8')
  hazards=(ROOT/'js'/'hazards.js').read_text(encoding='utf-8')
  self.assertIn('load();',app)
  self.assertIn('renderCoastalIntelligence()',app)
  self.assertIn('function renderChart()',chart)
  self.assertIn('function renderBriefing()',briefing)
  self.assertIn("L.map('coastalMap'",mapjs)
  self.assertIn('connectFerryLive();',webcams)
  self.assertIn('loadFerryArchive();',webcams)
  self.assertIn('function renderCoastalIntelligence()',intelligence)
  self.assertNotIn('function coastalEventReasons()',intelligence)
  self.assertNotIn('function renderStormMode()',intelligence)
  self.assertIn("if(typeof renderEventFocus==='function')renderEventFocus();",intelligence)
  self.assertIn('function normalizedEventState()',hazards)
  self.assertIn('function eventDisplayTitle(',hazards)
  self.assertIn('function renderHazards()',hazards)
  self.assertIn('async function loadHazards()',hazards)
  self.assertIn('eventPeakSummary',html)
  self.assertIn('eventWhyList',html)
  self.assertIn('eventHistoryPanel',html)
  self.assertIn('ferryArchiveContext',html)
  self.assertIn('ferryArchiveThumbs',html)
  self.assertIn('function renderEventHistory()',briefing)
  self.assertIn('function renderArchiveContext(',webcams)
  self.assertIn('function renderArchiveThumbnails()',webcams)
  self.assertIn('function setActiveArchiveThumb(',webcams)

 def test_residual_chart_interaction_contract(self):
  intelligence=(ROOT/'js'/'intelligence.js').read_text(encoding='utf-8')
  css=(ROOT/'css'/'app.css').read_text(encoding='utf-8')
  self.assertIn("miniLine('residualSpark',rows,'v',true,{",intelligence)
  self.assertIn("['Observed water level'",intelligence)
  self.assertIn("['Astronomical tide'",intelligence)
  self.assertIn("hit.addEventListener('pointermove'",intelligence)
  self.assertIn("hit.addEventListener('pointerdown'",intelligence)
  self.assertIn("event.key==='ArrowLeft'",intelligence)
  self.assertIn('.mini-chart-tooltip{',css)
  self.assertIn('touch-action:pan-y',css)

 def test_impact_timeline_alignment_and_favicon(self):
  html=INDEX.read_text(encoding='utf-8')
  css=(ROOT/'css'/'app.css').read_text(encoding='utf-8')
  favicon=ROOT/'favicon.svg'
  self.assertTrue(favicon.is_file())
  icon=favicon.read_text(encoding='utf-8')
  self.assertIn('viewBox="0 0 64 64"',icon)
  self.assertIn('lighthouse and wave icon',icon)
  self.assertIn('type="image/svg+xml" href="favicon.svg"',html)
  self.assertIn('.impact-forecast-panel{overflow:hidden;padding:18px 0 10px}',css)
  self.assertIn('.impact-forecast-panel .section-head{margin:0 18px 14px}',css)
  self.assertIn('padding:4px 18px 10px',css)
  self.assertIn('.impact-forecast-panel{padding:14px 0 8px}',css)
  self.assertIn('.impact-forecast-panel .section-head{margin:0 14px 12px}',css)

if __name__=='__main__':
 unittest.main()
