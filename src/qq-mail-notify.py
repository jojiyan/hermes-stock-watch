"""Send direct QQ SMTP stock alerts without exposing mailbox credentials."""
import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path


def send_qq_stock_alerts(report_path="ant-run-report.json", smtp_factory=None):
    report_file = Path(report_path)
    if not report_file.exists():
        print("QQ delivery skipped: no monitor report (not a confirmed stock alert)")
        return "no_report"

    report = json.loads(report_file.read_text(encoding="utf-8"))
    alerts = report.get("alerts", [])
    if not alerts:
        print("QQ delivery: no new confirmed stock alerts")
        return "no_alerts"

    username = os.environ.get("QQ_SMTP_EMAIL", "").strip()
    auth_code = os.environ.get("QQ_SMTP_AUTH_CODE", "").strip()
    destination = os.environ.get("QQ_NOTIFY_TO", "").strip() or username
    if not username or not auth_code:
        print("QQ delivery NOT CONFIGURED: set QQ_SMTP_EMAIL and QQ_SMTP_AUTH_CODE GitHub Secrets; GitHub Issue alerts remain active")
        return "not_configured"
    if not username.lower().endswith("@qq.com") or "@" not in destination:
        raise ValueError("Invalid QQ sender or notification recipient address")

    messages = []
    for item in alerts:
        # Only monitored inventory reported positive by Hermès stock.ecom may
        # be sent; never email failed requests or historical false/unknown stock.
        if item.get("ecom") is not True or not item.get("sku") or not item.get("url"):
            raise ValueError("Stock report has invalid positive inventory evidence")
        msg = EmailMessage()
        msg["From"] = username
        msg["To"] = destination
        msg["Subject"] = (
            "Hermès 官方电商有货 | " +
            str(item.get("market", "")) + " | " +
            str(item.get("name", "")) + " | " +
            str(item.get("color", ""))
        )
        msg.set_content(
            "Hermès 官方电商库存数据显示有货（stock.ecom=true）。\n"
            "注意：商品详情页购买按钮尚未二次确认，库存可能随时变化。\n\n"
            f"地区：{item.get('marketName', '')}\n"
            f"包款：{item.get('name', '')}\n"
            f"颜色：{item.get('color', '')}\n"
            f"价格：{item.get('price', '')}\n"
            f"SKU：{item['sku']}\n"
            f"购买链接：{item['url']}\n"
            f"检测时间：{report.get('checkedAt', '')}\n"
        )
        messages.append(msg)

    factory = smtp_factory or smtplib.SMTP_SSL
    try:
        with factory("smtp.qq.com", 465, context=ssl.create_default_context(), timeout=25) as server:
            server.login(username, auth_code)
            for msg in messages:
                server.send_message(msg)
    except Exception as e:
        # Do not expose credentials, sender/recipient addresses or raw SMTP
        # response in public GitHub Actions logs.
        print("QQ delivery FAILED: " + type(e).__name__)
        raise SystemExit(1) from None
    print(f"QQ SMTP accepted {len(messages)} message(s) for delivery")
    return "accepted"


if __name__ == "__main__":
    send_qq_stock_alerts()
