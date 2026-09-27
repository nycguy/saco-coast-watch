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
 def test_youtube_resolver_returns_live_stream_url(self):
  def runner(cmd,**_kwargs):
   self.assertIn('yt-dlp',cmd[0])
   self.assertEqual(cmd[-1],w.ABELLONA_LIVE)
   return SimpleNamespace(returncode=0,stdout=b'https://manifest.googlevideo.com/live.m3u8\n',stderr=b'')
  url=w.resolve_youtube_live_url(runner=runner,which=lambda _name:'/usr/local/bin/yt-dlp')
  self.assertEqual(url,'https://manifest.googlevideo.com/live.m3u8')
 def test_youtube_resolver_rejects_missing_url(self):
  def runner(_cmd,**_kwargs):
   return SimpleNamespace(returncode=0,stdout=b'no playable url\n',stderr=b'')
  with self.assertRaises(RuntimeError):
   w.resolve_youtube_live_url(runner=runner,which=lambda _name:'/usr/local/bin/yt-dlp')
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
 def test_abellona_resolves_then_captures_live_video(self):
  calls=[]
  with tempfile.TemporaryDirectory() as td:
   dest=pathlib.Path(td)/'abellona.jpg'
   def resolver():
    calls.append('resolve')
    return 'https://example.test/current-live.m3u8'
   def capturer(url,path):
    calls.append((url,path.name))
    path.write_bytes(self.jpeg())
   used=w.capture_abellona(dest,resolver=resolver,frame_capturer=capturer)
   self.assertEqual(used,w.ABELLONA_LIVE)
   self.assertEqual(calls,['resolve',('https://example.test/current-live.m3u8','abellona.jpg')])
   self.assertTrue(w.looks_like_jpeg(dest.read_bytes()))
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
