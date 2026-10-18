import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CaptureAuditScriptTests(unittest.TestCase):
    def test_capture_script_parses_and_covers_requested_viewports(self):
        path = ROOT / "tests/capture_ui_audit.py"
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        viewports = next(node.value for node in tree.body
                         if isinstance(node, ast.Assign)
                         and any(isinstance(target, ast.Name) and target.id == "VIEWPORTS"
                                 for target in node.targets))
        self.assertEqual(ast.literal_eval(viewports), (
            ("desktop", 1440, 900, False),
            ("iphone", 390, 844, True),
            ("iphone-small", 375, 667, True),
        ))


if __name__ == "__main__":
    unittest.main()
