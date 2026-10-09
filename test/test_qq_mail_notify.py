"""Test QQ notification formatting without sending any external email."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("qq_notify", Path(__file__).resolve().parents[1] / "src/qq-mail-notify.py")
notify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notify)


class FakeSMTP:
    sent = []
    login_count = 0

    def __init__(self, *args, **kwargs):
        self.args = args

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def login(self, username, auth_code):
        FakeSMTP.login_count += 1

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)


class QQMailTest(unittest.TestCase):
    def setUp(self):
        FakeSMTP.sent = []
        FakeSMTP.login_count = 0
        self.tmp = tempfile.TemporaryDirectory()
        self.report = str(Path(self.tmp.name) / "ant-run-report.json")
        self.env = {
            "QQ_SMTP_EMAIL": "testuser@qq.com",
            "QQ_SMTP_AUTH_CODE": "example-app-password",
            "QQ_NOTIFY_TO": "recipient@example.com",
        }
        self.addCleanup(self.tmp.cleanup)

    def write(self, alerts):
        Path(self.report).write_text(json.dumps({
            "checkedAt": "2026-10-09T10:00:00Z",
            "alerts": alerts
        }), encoding="utf-8")

    def test_no_alerts_never_authenticates(self):
        self.write([])
        with patch.dict(os.environ, self.env):
            self.assertEqual(notify.send_qq_stock_alerts(self.report, FakeSMTP), "no_alerts")
        self.assertEqual(FakeSMTP.login_count, 0)

    def test_valid_alert_is_sent_once_with_official_evidence(self):
        self.write([{
            "market": "US", "marketName": "Hermès USA",
            "ecom": True, "sku": "H086422CK89",
            "name": "Neo Garden 23 bag", "color": "Noir",
            "price": "$4,475",
            "url": "https://www.hermes.com/us/en/product/neo-garden-23-bag-H086422CK89/"
        }])
        with patch.dict(os.environ, self.env):
            self.assertEqual(notify.send_qq_stock_alerts(self.report, FakeSMTP), "accepted")
        self.assertEqual(len(FakeSMTP.sent), 1)
        self.assertIn("stock.ecom=true", FakeSMTP.sent[0].get_content())
        self.assertIn("H086422CK89", FakeSMTP.sent[0].get_content())

    def test_no_secrets_returns_unconfigured_without_sending(self):
        self.write([{"ecom": True, "sku": "H1111111111", "url": "https://www.hermes.com/us/en/product/a-H1111111111/"}])
        with patch.dict(os.environ, {"QQ_SMTP_EMAIL": "", "QQ_SMTP_AUTH_CODE": ""}):
            self.assertEqual(notify.send_qq_stock_alerts(self.report, FakeSMTP), "not_configured")
        self.assertEqual(FakeSMTP.sent, [])

    def test_rejects_unverified_availability(self):
        self.write([{"ecom": False, "sku": "H086422CK89", "url": "https://www.hermes.com/"}])
        with patch.dict(os.environ, self.env):
            with self.assertRaisesRegex(ValueError, "invalid positive inventory"):
                notify.send_qq_stock_alerts(self.report, FakeSMTP)
        self.assertEqual(FakeSMTP.sent, [])


if __name__ == "__main__":
    unittest.main()
