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
 def test_abellona_falls_back_between_live_thumbnail_sizes(self):
  calls=[]
  def fetcher(url):
   calls.append(url)
   return b'bad' if len(calls)==1 else self.jpeg()
  with tempfile.TemporaryDirectory() as td:
   dest=pathlib.Path(td)/'abellona.jpg'
   used=w.fetch_abellona(dest,fetcher=fetcher)
   self.assertEqual(used,w.ABELLONA_THUMBNAILS[1])
   self.assertEqual(dest.read_bytes(),self.jpeg())
 def test_ferry_capture_uses_ffmpeg_and_validates_output(self):
  with tempfile.TemporaryDirectory() as td:
   dest=pathlib.Path(td)/'ferry.jpg'
   def runner(cmd,**_kwargs):
    pathlib.Path(cmd[-1]).write_bytes(self.jpeg())
    return SimpleNamespace(returncode=0,stderr=b'')
   used=w.capture_ferry(dest,runner=runner,which=lambda _name:'/usr/bin/ffmpeg')
   self.assertEqual(used,w.FERRY_STREAM)
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
