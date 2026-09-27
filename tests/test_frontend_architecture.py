import pathlib, re, unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
INDEX=ROOT/'index.html'
EXPECTED_JS=[
 'js/config.js','js/marine.js','js/data.js','js/weather.js','js/water-levels.js',
 'js/alerts.js','js/chart.js','js/briefing.js','js/app.js','js/map.js','js/webcams.js'
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
  app=(ROOT/'js'/'app.js').read_text(encoding='utf-8')
  chart=(ROOT/'js'/'chart.js').read_text(encoding='utf-8')
  briefing=(ROOT/'js'/'briefing.js').read_text(encoding='utf-8')
  mapjs=(ROOT/'js'/'map.js').read_text(encoding='utf-8')
  webcams=(ROOT/'js'/'webcams.js').read_text(encoding='utf-8')
  self.assertIn('load();',app)
  self.assertIn('function renderChart()',chart)
  self.assertIn('function renderBriefing()',briefing)
  self.assertIn("L.map('coastalMap'",mapjs)
  self.assertIn('connectFerryLive();',webcams)

if __name__=='__main__':
 unittest.main()
