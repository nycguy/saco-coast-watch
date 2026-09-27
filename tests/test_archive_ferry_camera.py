import importlib.util, json, pathlib, tempfile, unittest, sys
from datetime import datetime, timezone, timedelta

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
P=ROOT/'scripts'/'archive_ferry_camera.py'
S=importlib.util.spec_from_file_location('archive_ferry_camera',P)
a=importlib.util.module_from_spec(S); S.loader.exec_module(a)

class ArchiveFerryCameraTests(unittest.TestCase):
 def snapshot(self,at,active=True):
  return {'snapshot_at':at,'water':{'forecast_peak_72h_ft':12.1 if active else 10.8,'residual_current_ft':0.8 if active else 0.1},'marine':{'stations':{'44007':{'wave_height_ft':7.0 if active else 2.0,'speed_mph':15,'gust_mph':20}}},'alerts':[]}
 def write_history(self,path,snaps):
  path.write_text(json.dumps({'schema_version':2,'snapshots':snaps}),encoding='utf-8')
 def fake_capture(self,dest):
  dest.write_bytes(b'\xff\xd8'+b'x'*5000+b'\xff\xd9')
  return dest
 def test_archives_when_storm_mode_is_active(self):
  now=datetime(2026,9,27,15,0,tzinfo=timezone.utc)
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td); hist=root/'history.json'; out=root/'archive'
   self.write_history(hist,[self.snapshot('2026-09-27T15:00:00Z',True)])
   result=a.archive(hist,out,now=now,capture_fn=self.fake_capture)
   self.assertTrue(result['active']); self.assertTrue(result['captured'])
   doc=json.loads((out/'index.json').read_text())
   self.assertEqual(len(doc['frames']),1)
   self.assertTrue((out/doc['frames'][0]['file']).exists())
 def test_does_not_capture_benign_conditions(self):
  now=datetime(2026,9,27,15,0,tzinfo=timezone.utc)
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td); hist=root/'history.json'; out=root/'archive'
   self.write_history(hist,[self.snapshot('2026-09-27T15:00:00Z',False)])
   result=a.archive(hist,out,now=now,capture_fn=lambda _dest: (_ for _ in ()).throw(AssertionError('should not capture')))
   self.assertFalse(result['active']); self.assertFalse(result['captured'])
   self.assertEqual(json.loads((out/'index.json').read_text())['frames'],[])
 def test_prunes_frames_older_than_24_hours(self):
  now=datetime(2026,9,27,15,0,tzinfo=timezone.utc)
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td); hist=root/'history.json'; out=root/'archive'; out.mkdir()
   old=out/'old.jpg'; old.write_bytes(b'old')
   (out/'index.json').write_text(json.dumps({'frames':[{'captured_at':'2026-09-26T10:00:00Z','file':'old.jpg'}]}))
   self.write_history(hist,[self.snapshot('2026-09-27T15:00:00Z',False)])
   a.archive(hist,out,now=now,capture_fn=self.fake_capture)
   self.assertFalse(old.exists())
   self.assertEqual(json.loads((out/'index.json').read_text())['frames'],[])

if __name__=='__main__':
 unittest.main()
