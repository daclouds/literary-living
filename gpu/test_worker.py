import unittest
from unittest.mock import Mock
import requests
from worker import run

class WorkerProtocolTests(unittest.TestCase):
    def response(self, status=200, spec=None):
        r = Mock(status_code=status)
        r.json.return_value = spec or {"prompt": "a room"}
        return r

    def test_claim_render_upload_and_exit(self):
        session = Mock()
        session.post.return_value = self.response()
        session.put.return_value = self.response()
        renderer = Mock(return_value=b"test-png")
        run("https://callback.example", "job", "scoped", renderer, session)
        renderer.assert_called_once_with({"prompt": "a room"})
        self.assertEqual(session.put.call_args.kwargs["data"], b"test-png")
        self.assertFalse(session.put.call_args.kwargs["allow_redirects"])
        self.assertEqual(session.post.call_count, 1)

    def test_duplicate_claim_never_runs_gpu(self):
        session = Mock()
        session.post.return_value = self.response(409)
        renderer = Mock()
        run("https://callback.example", "job", "scoped", renderer, session)
        renderer.assert_not_called()
        session.put.assert_not_called()

    def test_inference_failure_reports_terminal_status(self):
        session = Mock()
        session.post.return_value = self.response()
        with self.assertRaises(RuntimeError):
            run("https://callback.example", "job", "scoped", Mock(side_effect=ValueError()), session)
        self.assertTrue(session.post.call_args.args[0].endswith('/fail'))

    def test_rejects_plain_http(self):
        with self.assertRaises(ValueError):
            run("http://callback.example", "job", "scoped", Mock(), Mock())

if __name__ == '__main__':
    unittest.main()
