# Zoroya Custom Action

競合サイト分析GPT向けの最小構成です。公開URLを受け取り、以下を抽出します。

- title
- meta description
- canonical
- h1
- h2
- og:title
- og:description
- html lang

## 使い方

1. このフォルダを Vercel にデプロイします。
2. `openapi.yaml` の `servers.url` を本番ドメインへ変更します。
3. GPTs の Custom Actions で `openapi.yaml` を読み込みます。
4. GPT Instructions に「競合URLを受け取ったら最初にこのActionを呼ぶ」と明記します。

## 想定エンドポイント

`GET /api/extract?url=https://example.com`

## 返却値

```json
{
  "ok": true,
  "input_url": "https://example.com/",
  "final_url": "https://example.com/",
  "status": 200,
  "content_type": "text/html; charset=UTF-8",
  "title": "Example Domain",
  "meta_description": "...",
  "canonical": "https://example.com/",
  "h1": ["Example Domain"],
  "h2": [],
  "og_title": null,
  "og_description": null,
  "lang": "en",
  "notes": []
}
```

## 注意

- JavaScript描画後のDOMまでは取得しません。
- SPAやJS依存サイトは、Playwright版エンドポイントの追加が望ましいです。
- SSRF対策として、localhost・プライベートIP帯はブロックしています。
