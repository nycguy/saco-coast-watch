import importlib.util, pathlib, tempfile, unittest
from types import SimpleNamespace

ROOT=pathlib.Path(__file__).resolve().parents[1]
P=ROOT/'scripts'/'fetch_webcam_snapshots.py'
S=importlib.util.spec_from_file_location('fetch_webcam_snapshots',P)
w=importlib.util.module_from_spec(S); S.loader.exec_module(w)

class WebcamSnapshotTests(unittest.TestCase):
 def jpeg(self):
  return b'\xff\xd8'+b'x'*5000+b'\xff\xd9'
 def test_jpeg_validation(self):
  self.assertTrue(w.looks_like_jpeg(self.jpeg()))
  self.assertFalse(w.looks_like_jpeg(b'not-a-jpeg'))
 def test_capture_frame_uses_actual_stream(self):
  with tempfile.TemporaryDirectory() as td:
   dest=pathlib.Path(td)/'frame.jpg'
   def runner(cmd,**_kwargs):
    self.assertIn('https://example.test/live.m3u8',cmd)
    pathlib.Path(cmd[-1]).write_bytes(self.jpeg())
    return SimpleNamespace(returncode=0,stderr=b'')
   used=w.capture_frame('https://example.test/live.m3u8',dest,runner=runner,which=lambda _name:'/usr/bin/ffmpeg')
   self.assertEqual(used,'https://example.test/live.m3u8')
   self.assertTrue(w.looks_like_jpeg(dest.read_bytes()))
 def test_abellona_is_live_embed_not_static_thumbnail(self):
  with tempfile.TemporaryDirectory() as td:
   d=w.build(td)
   cam=d['cameras']['abellona']
   self.assertEqual(cam['status'],'live_embed')
   self.assertIsNone(cam['image'])
   self.assertIn('actual muted live player',cam['note'])
   self.assertFalse((pathlib.Path(td)/'abellona.jpg').exists())
 def test_markup_autoplays_muted_abellona_live_player(self):
  html=(ROOT/'index.html').read_text(encoding='utf-8')
  self.assertIn('id="abellonaFrame" src="https://www.youtube.com/embed/HSQpqIWLViI?autoplay=1&amp;mute=1&amp;playsinline=1&amp;rel=0"',html)
  self.assertNotIn('id="abellonaPreviewImage"',html)
  self.assertNotIn('data-src="https://www.youtube.com/embed/HSQpqIWLViI',html)
 def test_markup_autoplays_muted_ferry_live_player(self):
  html=(ROOT/'index.html').read_text(encoding='utf-8')
  webcams=(ROOT/'js'/'webcams.js').read_text(encoding='utf-8')
  self.assertIn('id="ferryVideo" controls autoplay playsinline muted preload="auto"',html)
  self.assertNotIn('id="ferryStart"',html)
  self.assertIn('connectFerryLive();',webcams)
  self.assertIn('application/vnd.apple.mpegurl',webcams)
  self.assertIn('id="ferryArchiveRange"',html)
  self.assertIn('id="ferryReturnLive"',html)
  self.assertIn('loadFerryArchive();',webcams)
  self.assertIn('data/webcams/ferry-history/index.json',webcams)
 def test_camera_entry_marks_source_unavailable_without_fake_image(self):
  with tempfile.TemporaryDirectory() as td:
   dest=pathlib.Path(td)/'failed.jpg'
   def fail(_path):
    raise RuntimeError('offline')
   entry=w.camera_entry('Test','Source','https://example.test/live','data/webcams/test.jpg',dest,fail,'2026-09-27T13:00:00Z')
   self.assertEqual(entry['status'],'unavailable')
   self.assertIsNone(entry['image'])
   self.assertIsNone(entry['fetched_at'])
   self.assertFalse(dest.exists())

if __name__=='__main__':
 unittest.main()
