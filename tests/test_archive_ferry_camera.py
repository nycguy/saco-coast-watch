import importlib.util, json, pathlib, tempfile, unittest, sys
from datetime import datetime, timezone

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
P=ROOT/'scripts'/'archive_ferry_camera.py'
S=importlib.util.spec_from_file_location('archive_ferry_camera',P)
a=importlib.util.module_from_spec(S); S.loader.exec_module(a)

class ArchiveFerryCameraTests(unittest.TestCase):
 def snapshot(self,at,active=True,recent=False):
  if active:
   event={'phase':'Ongoing','show_focus':True,'primary_display':'Coastal Storm','impact':{'label':'Significant','level':'orange','rank':2},'reasons':['NWS High Surf Advisory']}
  elif recent:
   event={'phase':'Recent','show_focus':False,'primary_display':'Routine Coastal Conditions','impact':{'label':'Routine','level':'green','rank':0},'recent_impact':{'label':'Elevated','level':'yellow','rank':1},'reasons':[],'recent_impacts':[{'label':'Portland residual'}]}
  else:
   event={'phase':'Routine','show_focus':False,'primary_display':'Routine Coastal Conditions','impact':{'label':'Routine','level':'green','rank':0},'reasons':[],'recent_impacts':[]}
  return {'snapshot_at':at,'event_state':event,'water':{},'marine':{'stations':{}},'alerts':[]}
 def write_history(self,path,snaps):
  path.write_text(json.dumps({'schema_version':2,'snapshots':snaps}),encoding='utf-8')
 def fake_capture(self,dest):
  dest.write_bytes(b'\xff\xd8'+b'x'*5000+b'\xff\xd9'); return dest
 def test_archives_when_event_focus_is_active(self):
  now=datetime(2026,9,27,15,0,tzinfo=timezone.utc)
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td); hist=root/'history.json'; out=root/'archive'
   self.write_history(hist,[self.snapshot('2026-09-27T15:00:00Z',True)])
   result=a.archive(hist,out,now=now,capture_fn=self.fake_capture)
   self.assertTrue(result['active']); self.assertTrue(result['captured'])
   self.assertIn('Coastal Storm',result['reasons'])
   doc=json.loads((out/'index.json').read_text()); self.assertEqual(len(doc['frames']),1); self.assertTrue((out/doc['frames'][0]['file']).exists())
 def test_does_not_capture_routine_conditions(self):
  now=datetime(2026,9,27,15,0,tzinfo=timezone.utc)
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td); hist=root/'history.json'; out=root/'archive'
   self.write_history(hist,[self.snapshot('2026-09-27T15:00:00Z',False)])
   result=a.archive(hist,out,now=now,capture_fn=lambda _dest: (_ for _ in ()).throw(AssertionError('should not capture')))
   self.assertFalse(result['active']); self.assertFalse(result['captured']); self.assertEqual(json.loads((out/'index.json').read_text())['frames'],[])
 def test_recent_only_event_does_not_continue_archiving(self):
  now=datetime(2026,9,27,15,0,tzinfo=timezone.utc)
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td); hist=root/'history.json'; out=root/'archive'
   self.write_history(hist,[self.snapshot('2026-09-27T15:00:00Z',False,True)])
   result=a.archive(hist,out,now=now,capture_fn=lambda _dest: (_ for _ in ()).throw(AssertionError('recent-only should not capture')))
   self.assertFalse(result['active']); self.assertFalse(result['captured'])
 def test_prunes_frames_older_than_24_hours(self):
  now=datetime(2026,9,27,15,0,tzinfo=timezone.utc)
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td); hist=root/'history.json'; out=root/'archive'; out.mkdir()
   old=out/'old.jpg'; old.write_bytes(b'old')
   (out/'index.json').write_text(json.dumps({'frames':[{'captured_at':'2026-09-26T10:00:00Z','file':'old.jpg'}]}))
   self.write_history(hist,[self.snapshot('2026-09-27T15:00:00Z',False)])
   a.archive(hist,out,now=now,capture_fn=self.fake_capture)
   self.assertFalse(old.exists()); self.assertEqual(json.loads((out/'index.json').read_text())['frames'],[])

if __name__=='__main__': unittest.main()
